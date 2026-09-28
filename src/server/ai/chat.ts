import Anthropic from '@anthropic-ai/sdk'
import type { ChatEvent } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'
import { deckDetail } from '../decks/analysis.ts'
import { ApiError } from '../http.ts'
import { AI_MODEL, describeAiError, isPromptTooLong, type AiClient } from './client.ts'
import { canContinue, cutOffNotice, forReplay, isCutOff, NOTICE, outgrown, replayMessages } from './history.ts'
import { deckContext, SYSTEM_PROMPT } from './prompt.ts'
import { appendMessages, getMessages, getThread, type ContentBlock, type MessageMeta } from './threads.ts'
import type { BrainstormTools } from './tools.ts'

/** Most requests per answer: tool rounds and Binder's retries count; failed attempts the SDK retries don't (they aren't billed). */
export const MAX_ROUNDS = 16
/** Room for Claude's thinking and answer in one request (spec §5.5: streamed, so no request timeout). */
export const MAX_TOKENS = 64_000
/**
 * How hard Claude thinks: Opus 5.5's default. On Opus 5.5, `medium` does better than Opus 5 did at `high`, and each
 * level up thinks longer and costs more (spec §5.5).
 */
export const EFFORT = 'medium'
/** Longest conversation title, taken from the first message. */
const TITLE_LENGTH = 60
const BUSY = 'Claude is still answering in this conversation'

/** Whether a response's content holds anything to send back: text, a tool call, or a thinking block. */
const worthKeeping = (content: readonly ContentBlock[]) =>
  content.some((b) => b.type === 'text' || b.type === 'tool_use' || b.type === 'thinking' || b.type === 'redacted_thinking')

export interface Brainstorm {
  /** Whether Claude is answering in this conversation right now. */
  busy(threadId: number): boolean
  /**
   * Throws the ApiError an answer would fail with before it starts: no API key, a missing conversation, one already
   * answering, one grown too long for Claude (a new message), or nothing to continue (`text` null) — so the route can
   * answer with a status instead of a stream.
   */
  check(threadId: number, text: string | null): void
  /**
   * Answers the owner's message, or continues an answer that failed partway (`text` null), streaming what happens
   * through `emit`. Never throws: failures become an `error` event. `signal` stops it, keeping the text so far.
   */
  answer(threadId: number, text: string | null, emit: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void>
  /** Stops the answer in progress; false when there is none. */
  stop(threadId: number): boolean
}

/** Something Claude has said in an answer so far: its text, or where another model took over. */
export type Said = { type: 'text'; text: string } | Extract<ContentBlock, { type: 'fallback' }>

/**
 * What a stopped answer keeps: its text, each run of text blocks joined a paragraph apart, and the fallback blocks
 * between them, so the chat still shows where another model took over.
 */
export function keepStopped(said: readonly Said[]): ContentBlock[] {
  const kept: ContentBlock[] = []
  let run: string[] = []
  const endRun = () => {
    if (run.length > 0) kept.push({ type: 'text', text: run.join('\n\n') })
    run = []
  }
  for (const block of said) {
    if (block.type === 'text') {
      if (block.text.trim() !== '') run.push(block.text.trim())
    } else {
      endRun()
      kept.push(block)
    }
  }
  endRun()
  return kept
}

/** A conversation's title: the first line of its first message, shortened. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]!.trim()
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
}

export function createBrainstorm(deps: { db: DB; ai: AiClient; tools: BrainstormTools; now?: () => Date }): Brainstorm {
  const { db, ai, tools } = deps
  const now = deps.now ?? (() => new Date())
  const active = new Map<number, AbortController>()

  function check(threadId: number, text: string | null) {
    if (!getThread(db, threadId)) throw new ApiError(404, 'not_found', 'Conversation not found')
    if (!ai.get()) throw new ApiError(409, 'no_key', 'Add an Anthropic API key in Settings to brainstorm with Claude')
    if (active.has(threadId)) throw new ApiError(409, 'busy', BUSY)
    if (text !== null && outgrown(getMessages(db, threadId))) throw new ApiError(409, 'too_long', NOTICE.tooLong)
    if (text === null && !canContinue(getMessages(db, threadId))) throw new ApiError(409, 'nothing_to_continue', 'Claude has already answered')
  }

  /**
   * Stores the owner's message, with the deck's summary before it when it opens what Claude sees of a conversation about
   * a deck: nothing is stored yet, or only turns Claude declined, which are left out with their summary.
   */
  function addQuestion(threadId: number, text: string, emit: (event: ChatEvent) => void) {
    const thread = getThread(db, threadId)!
    const content: ContentBlock[] = []
    let deckName: string | null = null
    if (thread.deck && replayMessages(getMessages(db, threadId)).length === 0) {
      const deck = deckDetail(db, thread.deck.id)
      if (deck) {
        content.push({ type: 'text', text: deckContext(deck) })
        deckName = deck.name
      }
    }
    content.push({ type: 'text', text })
    appendMessages(db, threadId, [{ role: 'user', content }], titleFrom(text), now())
    emit({ type: 'item', item: { kind: 'user', text, deck: deckName } })
    if (thread.title === '') emit({ type: 'title', title: titleFrom(text) })
  }

  async function run(client: Anthropic, threadId: number, emit: (event: ChatEvent) => void, signal: AbortSignal) {
    const history = replayMessages(getMessages(db, threadId))
    let badJson = 0
    for (let round = 0; ; round++) {
      // Stopped between requests (or before the first): ask nothing more.
      if (signal.aborted) {
        emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.stopped } })
        return
      }
      if (round === MAX_ROUNDS) throw new Error(`Claude took more than ${MAX_ROUNDS} steps without finishing; Continue lets it go on`)
      const stream = client.beta.messages.stream(
        {
          model: AI_MODEL,
          max_tokens: MAX_TOKENS,
          // Opus 5.5 writes its notes between tool calls as thinking blocks: `updates` returns those notes (its reasoning
          // stays hidden). A thinking block replayed after the system prompt or tools changed (a Binder update) is
          // dropped rather than refused.
          thinking: { type: 'adaptive', display: 'updates', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
          output_config: { effort: EFFORT },
          betas: ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18', 'thinking-binding-controls-2026-08-01'],
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: tools.definitions,
          messages: history,
        },
        { signal },
      )
      // What Claude has said so far, in order: its text, and where another model took over. Kept if the owner stops it.
      const said: Said[] = []
      // Whether the thinking block streaming now has shown a note: reasoning blocks stay empty, so only a note shows.
      let noted = false
      let message: Anthropic.Beta.BetaMessage
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            const block = event.content_block
            noted = false
            if (block.type === 'text') {
              said.push({ type: 'text', text: '' })
              emit({ type: 'item', item: { kind: 'text', text: '' } })
            } else if (block.type === 'fallback') {
              said.push({ type: 'fallback', from: block.from, to: block.to })
              emit({ type: 'item', item: { kind: 'fallback', from: block.from.model, to: block.to.model } })
            } else if (block.type === 'tool_use') {
              // Its line appears once the whole call is written, which can take a while (a deck's every card).
              emit({ type: 'working' })
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              const last = said.at(-1)
              if (last?.type === 'text') last.text += event.delta.text
              emit({ type: 'delta', text: event.delta.text })
            } else if (event.delta.type === 'thinking_delta' && event.delta.thinking !== '') {
              if (!noted) emit({ type: 'item', item: { kind: 'note', text: '' } })
              noted = true
              emit({ type: 'delta', text: event.delta.thinking })
            }
          }
        }
        message = await stream.finalMessage()
      } catch (err) {
        if (signal.aborted) {
          // Keep what Claude said so far, and where another model took over; a partly written tool call or reasoning
          // can't be sent back, so they go.
          const content = keepStopped(said)
          if (content.some((b) => b.type === 'text')) {
            // The model this request went to: after a refusal fallback, Anthropic may keep answering with another one.
            const meta: MessageMeta = { model: stream.currentMessage?.model ?? AI_MODEL, stopReason: 'stopped', usage: stream.currentMessage?.usage ?? null }
            appendMessages(db, threadId, [{ role: 'assistant', content, meta }], undefined, now())
          }
          emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.stopped } })
          return
        }
        if (!(err instanceof Anthropic.APIError) && err instanceof Anthropic.AnthropicError) {
          // The SDK wraps a network failure partway through with its cause: the connection dropped. Asking again would
          // send the whole conversation again, so that is the owner's call, with Continue.
          if (err.cause !== undefined) throw new Error('The connection to Anthropic dropped partway through; Continue asks again')
          // A tool input Claude streamed that isn't JSON at all: stop that response, and ask again, at most twice in a
          // row. A retry is a request like any other, so it counts toward MAX_ROUNDS. The SDK's own error quotes the raw
          // input, so say it plainly.
          stream.abort()
          if (badJson++ >= 2) throw new Error(`Claude's answer came through garbled ${badJson} times in a row; Continue asks again`)
          // With no request left, the loop ends with the MAX_ROUNDS error instead of asking again.
          if (round + 1 < MAX_ROUNDS) emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.retried } })
          continue
        }
        if (isPromptTooLong(err)) {
          // A conversation too long for Claude to take at all: recorded as one that outgrew the context window with
          // nothing said, so Continue isn't offered (asking again would only send it all again), and it reloads with the
          // same notice, which is all that's said now. The record is never sent back: the API refuses an empty message.
          const meta: MessageMeta = { model: AI_MODEL, stopReason: 'model_context_window_exceeded', usage: null }
          appendMessages(db, threadId, [{ role: 'assistant', content: [], meta }], undefined, now())
          emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.tooLong } })
          return
        }
        throw err
      }
      badJson = 0
      const meta: MessageMeta = { model: message.model, stopReason: message.stop_reason ?? 'end_turn', usage: message.usage }
      if (message.stop_reason === 'refusal') {
        // Declined even after the fallbacks. What streamed is discarded; the record hides the turn from now on.
        appendMessages(db, threadId, [{ role: 'assistant', content: [], meta }], undefined, now())
        emit({ type: 'item', item: { kind: 'notice', tone: 'error', text: NOTICE.refusal } })
        return
      }
      const content = forReplay(message.content as ContentBlock[])
      const calls = content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      if (message.stop_reason !== 'tool_use' || calls.length === 0) {
        // Only an answer that stopped to use tools has calls to run. One cut off (max_tokens, or the context window) keeps
        // only its text: a call or note cut off may look complete. Any other keeps what it wrote but a call, which would
        // have no result to go with it.
        const cutOff = isCutOff(message.stop_reason)
        const kept = content.filter((b) => (cutOff ? b.type === 'text' : b.type !== 'tool_use'))
        // A conversation grown too long for the context window is recorded even with nothing to keep (an empty message,
        // never sent back), so Continue isn't offered: asking again would only send it all again.
        const tooLong = message.stop_reason === 'model_context_window_exceeded'
        if (worthKeeping(kept) || tooLong) appendMessages(db, threadId, [{ role: 'assistant', content: kept, meta }], undefined, now())
        if (cutOff) emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: cutOffNotice(message.stop_reason) } })
        return
      }
      for (const call of calls) {
        emit({
          type: 'item',
          item: { kind: 'tool', id: call.id, name: call.name, activity: tools.describe(call.name, call.input), state: 'running', error: null, deck: null },
        })
      }
      const results = await Promise.all(
        calls.map(async (call): Promise<ContentBlock> => {
          try {
            const outcome = await tools.run(call.name, call.input)
            emit({ type: 'tool_done', id: call.id, state: 'done', error: null, deck: outcome.deck })
            return { type: 'tool_result', tool_use_id: call.id, content: outcome.content }
          } catch (err) {
            const problem = err instanceof Error ? err.message : String(err)
            emit({ type: 'tool_done', id: call.id, state: 'failed', error: problem, deck: null })
            return { type: 'tool_result', tool_use_id: call.id, content: `Error: ${problem}`, is_error: true }
          }
        }),
      )
      // The call and its results are stored together (a tool may have made a deck), even when stopped meanwhile.
      appendMessages(db, threadId, [{ role: 'assistant', content, meta }, { role: 'user', content: results }], undefined, now())
      history.push({ role: 'assistant', content }, { role: 'user', content: results })
    }
  }

  return {
    busy: (threadId) => active.has(threadId),
    check,
    async answer(threadId, text, emit, signal) {
      // One answer at a time: the route checks first, but a second call must never replace or stop the running one.
      if (active.has(threadId)) {
        emit({ type: 'error', message: BUSY, canContinue: false })
        emit({ type: 'done' })
        return
      }
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      // A signal that is already aborted never fires its listeners.
      if (signal?.aborted) controller.abort()
      signal?.addEventListener('abort', onAbort)
      active.set(threadId, controller)
      try {
        const client = ai.get()
        if (!client) throw new Error('Add an Anthropic API key in Settings to brainstorm with Claude')
        if (text !== null) addQuestion(threadId, text, emit)
        await run(client, threadId, emit, controller.signal)
      } catch (err) {
        const message = err instanceof Anthropic.AuthenticationError ? 'Anthropic refused the API key; check it in Settings' : describeAiError(err)
        emit({ type: 'error', message, canContinue: canContinue(getMessages(db, threadId)) })
      } finally {
        signal?.removeEventListener('abort', onAbort)
        active.delete(threadId)
        emit({ type: 'done' })
      }
    },
    stop(threadId) {
      const controller = active.get(threadId)
      controller?.abort()
      return controller !== undefined
    },
  }
}
