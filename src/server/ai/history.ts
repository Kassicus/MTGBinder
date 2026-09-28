import type Anthropic from '@anthropic-ai/sdk'
import { baseModel, modelName } from '../../shared/models.ts'
import type { ChatItem } from '../../shared/types.ts'
import { AI_MODEL } from './client.ts'
import { deckContextName } from './prompt.ts'
import type { ContentBlock, StoredMessage } from './threads.ts'
import { createdDeckFrom } from './tools.ts'

/** US dollars per million tokens: input, output, 5-minute cache writes, and cache reads. */
interface Price {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/**
 * Each model's prices: Binder's, and those a refusal falls back to. Cache writes are 1.25 times input; reads are 0.05
 * times on Opus 5.5, 0.1 times on the others, and $0.25 on Fable 5.1.
 */
const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
}
/** A model Binder doesn't know is priced as Claude Opus 5, the usual fallback. */
const priceOf = (model: string | null | undefined): Price => PRICES[baseModel(model ?? AI_MODEL)] ?? PRICES['claude-opus-5']!

export const NOTICE = {
  refusal: "Claude declined to answer this. Asking another way usually works; this part of the conversation won't be sent to Claude again.",
  cutOff: 'The answer was cut off because it got too long.',
  tooLong: 'This conversation has grown too long for Claude. Start a new one to go on.',
  stopped: 'Stopped.',
  /** Shown live only: the garbled attempt isn't stored, so the conversation reloads without it. */
  retried: "Claude's last message came through garbled, so Binder asked again.",
} as const

/**
 * A response's content as it may be sent back (the API's echo rule for a refusal fallback partway through an answer):
 * before the last `fallback` block, only text is kept, so thinking and tool calls of the model that declined are
 * dropped, and never run. An empty text block goes wherever it is: the API refuses one.
 */
export function forReplay(content: readonly ContentBlock[]): ContentBlock[] {
  const last = content.findLastIndex((b) => b.type === 'fallback')
  return content.filter((b, i) => (b.type === 'text' ? b.text.trim() !== '' : i >= last || b.type === 'fallback'))
}

/** Stop reasons that cut an answer off partway: its text is kept, and a tool call in it is never run. */
export const isCutOff = (stopReason: string | null | undefined) => stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded'

/** The notice for an answer cut off: too long an answer, or a conversation grown too long for Claude's context window. */
export const cutOffNotice = (stopReason: string | null | undefined) =>
  stopReason === 'model_context_window_exceeded' ? NOTICE.tooLong : NOTICE.cutOff

const isRefusal = (m: StoredMessage) => m.role === 'assistant' && m.meta?.stopReason === 'refusal'
/** An answer Claude finished: it stopped for any reason but to use tools or to decline. */
const isFinished = (m: StoredMessage) => m.role === 'assistant' && m.meta?.stopReason !== 'tool_use' && !isRefusal(m)

/**
 * The conversation as Claude sees it: every stored message verbatim, except declined turns. A refusal hides the whole
 * turn it ends, back to Claude's last finished answer: the owner's messages since then and any tool rounds, so the next
 * message isn't declined again for them. A turn is hidden only once it's the end of the conversation, so what comes
 * before it, and the prefix a thinking block is bound to, never changes. An answer with nothing in it (the record of a
 * conversation grown too long for Claude) is never sent: the API refuses an empty message.
 */
export function replayMessages(messages: readonly StoredMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const seen: StoredMessage[] = []
  let turn: StoredMessage[] = []
  for (const m of messages) {
    if (isRefusal(m)) {
      turn = []
      continue
    }
    turn.push(m)
    if (isFinished(m)) {
      seen.push(...turn)
      turn = []
    }
  }
  return [...seen, ...turn].filter((m) => m.content.length > 0).map((m) => ({ role: m.role, content: m.content }))
}

/** Whether the conversation ends waiting for Claude, so Continue can ask again. */
export function canContinue(messages: readonly StoredMessage[]): boolean {
  return messages.at(-1)?.role === 'user'
}

/**
 * Whether the conversation has outgrown Claude's context window: its last answer says so. Only a new conversation can go
 * on; another message would only send it all again.
 */
export const outgrown = (m: readonly StoredMessage[]) =>
  m.at(-1)?.role === 'assistant' && m.at(-1)?.meta?.stopReason === 'model_context_window_exceeded'

/**
 * Estimated spend in US dollars, from each answer's recorded token usage, at the prices of the model that wrote it.
 * When the usage lists each attempt that went into an answer (a refusal fallback's, say), those are added up, each at
 * its own model's prices: the top-level counts can leave some out. An attempt that doesn't name its model went to
 * Binder's, unless it's the last, which is the answer's. An attempt declined before it wrote anything isn't billed, so
 * it's left out: one another model took over from, or the last of an answer declined in the end.
 */
export function estimateCost(messages: readonly StoredMessage[]): number {
  let usd = 0
  for (const m of messages) {
    const u = m.meta?.usage
    if (!u) continue
    const attempts = u.iterations?.length ? u.iterations : null
    const declined = m.meta?.stopReason === 'refusal'
    for (const [i, part] of (attempts ?? [u]).entries()) {
      const last = attempts === null || i === attempts.length - 1
      if (part.output_tokens === 0 && (!last || declined)) continue
      const named = attempts !== null && 'model' in part ? part.model : null
      const price = priceOf(named ?? (last ? m.meta?.model : AI_MODEL))
      usd +=
        (part.input_tokens * price.input +
          part.output_tokens * price.output +
          (part.cache_creation_input_tokens ?? 0) * price.cacheWrite +
          (part.cache_read_input_tokens ?? 0) * price.cacheRead) /
        1_000_000
    }
  }
  return Math.round(usd * 10_000) / 10_000
}

const toolResultText = (block: Extract<ContentBlock, { type: 'tool_result' }>) =>
  typeof block.content === 'string'
    ? block.content
    : (block.content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('')

/** The notice for a message answered by another model than the one before it, with no fallback block to say so. */
const answeredFrom = (model: string) =>
  baseModel(model) === AI_MODEL
    ? `${modelName(model)} answered from here.`
    : `${modelName(model)} answered from here: after a refusal, Anthropic keeps a conversation on the model that took over for about an hour.`

/**
 * What a stored conversation shows (spec §5.5): the owner's messages, Claude's text and its notes between tool calls, a
 * line per tool call with how it went, fallbacks, a notice where another model answers from, and notices for refusals,
 * cut-off answers, and stopped ones. `describe` gives a tool call's activity line.
 */
export function chatItems(messages: readonly StoredMessage[], describe: (name: string, input: unknown) => string): ChatItem[] {
  const items: ChatItem[] = []
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  // The model last shown answering. After a refusal fallback, Anthropic may keep answering the conversation with the
  // model that took over, for about an hour; those answers carry no fallback block, only their model.
  let answering: string = AI_MODEL
  for (const m of messages) {
    if (m.role === 'user') {
      let deck: string | null = null
      const texts: string[] = []
      for (const block of m.content) {
        if (block.type === 'text') {
          const name = deckContextName(block.text)
          if (name === null) texts.push(block.text)
          else deck = name
        } else if (block.type === 'tool_result') {
          const tool = tools.get(block.tool_use_id)
          if (!tool) continue
          const text = toolResultText(block)
          tool.state = block.is_error ? 'failed' : 'done'
          tool.error = block.is_error ? text.replace(/^Error: /, '') : null
          tool.deck = !block.is_error && tool.name === 'create_prospective_deck' ? createdDeckFrom(text) : null
        }
      }
      if (texts.length > 0) items.push({ kind: 'user', text: texts.join('\n\n'), deck })
      continue
    }
    // One notice per change of model; a fallback block says so itself, and a refusal, or an answer with nothing in it
    // (a conversation grown too long for Claude), changes nothing.
    if (m.meta && m.meta.stopReason !== 'refusal' && m.content.length > 0) {
      const fellBack = m.content.some((b) => b.type === 'fallback')
      if (!fellBack && baseModel(m.meta.model) !== baseModel(answering)) items.push({ kind: 'notice', tone: 'info', text: answeredFrom(m.meta.model) })
      answering = m.meta.model
    }
    for (const block of m.content) {
      if (block.type === 'text' && block.text !== '') items.push({ kind: 'text', text: block.text })
      else if (block.type === 'thinking' && block.thinking !== '') items.push({ kind: 'note', text: block.thinking })
      else if (block.type === 'fallback') items.push({ kind: 'fallback', from: block.from.model, to: block.to.model })
      else if (block.type === 'tool_use') {
        const tool: Extract<ChatItem, { kind: 'tool' }> = {
          kind: 'tool',
          id: block.id,
          name: block.name,
          activity: describe(block.name, block.input),
          state: 'running',
          error: null,
          deck: null,
        }
        tools.set(block.id, tool)
        items.push(tool)
      }
    }
    const stop = m.meta?.stopReason
    if (stop === 'refusal') items.push({ kind: 'notice', tone: 'error', text: NOTICE.refusal })
    else if (isCutOff(stop)) items.push({ kind: 'notice', tone: 'info', text: cutOffNotice(stop) })
    else if (stop === 'stopped') items.push({ kind: 'notice', tone: 'info', text: NOTICE.stopped })
  }
  return items
}
