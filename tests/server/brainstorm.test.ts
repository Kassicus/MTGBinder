import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrainstorm, MAX_ROUNDS, titleFrom } from '../../src/server/ai/chat.ts'
import { canContinue, chatItems, estimateCost, forReplay, NOTICE, replayMessages } from '../../src/server/ai/history.ts'
import { DECK_CONTEXT_TAG, SYSTEM_PROMPT } from '../../src/server/ai/prompt.ts'
import { createThread, getMessages, getThread, type ContentBlock, type StoredMessage } from '../../src/server/ai/threads.ts'
import { createBrainstormTools } from '../../src/server/ai/tools.ts'
import type { DB } from '../../src/server/db/index.ts'
import type { ChatEvent, ChatItem } from '../../src/shared/types.ts'
import { stubScryfall } from '../helpers/app.ts'
import { count, createTestDb } from '../helpers/db.ts'
import { fakeAiClient, fakeAnthropic, invalidMessages, type FakeAnthropic, type FakeReply } from '../helpers/fake-anthropic.ts'
import { deck, inDeck, own } from '../helpers/library.ts'

let db: DB

beforeEach(() => {
  db = createTestDb()
  own(db, 'Llanowar Elves', undefined, 2)
  own(db, 'Sol Ring', undefined, 1)
})

async function setup(...replies: FakeReply[]) {
  const fake = await fakeAnthropic(...replies)
  const tools = createBrainstormTools({ db, scryfall: stubScryfall() })
  const brainstorm = createBrainstorm({ db, ai: fakeAiClient(fake), tools, now: () => new Date('2026-09-28T12:00:00Z') })
  return { fake, brainstorm, tools }
}

async function ask(brainstorm: ReturnType<typeof createBrainstorm>, threadId: number, text: string | null, signal?: AbortSignal) {
  const events: ChatEvent[] = []
  await brainstorm.answer(threadId, text, (e) => events.push(e), signal)
  return events
}

const elfSearch: FakeReply = {
  content: [
    { type: 'thinking', thinking: 'Check which elves they own.', signature: 'sig-a' },
    { type: 'text', text: 'Let me check your elves.' },
    { type: 'tool_use', id: 'toolu_1', name: 'search_my_library', input: { query: 't:elf' } },
  ],
  stop_reason: 'tool_use',
}
const answer: FakeReply = { content: [{ type: 'text', text: 'You own [[Llanowar Elves]] (2 free).' }], stop_reason: 'end_turn' }
const lookUp = (i: number): FakeReply => ({
  content: [{ type: 'tool_use', id: `toolu_${i}`, name: 'get_card', input: { name: 'Sol Ring' } }],
  stop_reason: 'tool_use',
})
/** A tool call whose streamed input isn't JSON at all. */
const garbled = (i: number): FakeReply => ({
  content: [{ type: 'tool_use', id: `toolu_${i}`, name: 'get_card', input: null, rawJson: 'name = Sol Ring' }],
  stop_reason: 'tool_use',
})
const retried = (e: ChatEvent) => e.type === 'item' && e.item.kind === 'notice' && e.item.text === NOTICE.retried

describe('answering a question', () => {
  it('streams the answer, runs the tool, and stores each round with its result', async () => {
    const { fake, brainstorm } = await setup(elfSearch, answer)
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Which elves do I own?')

    expect(events.map((e) => (e.type === 'item' ? `item:${e.item.kind}` : e.type))).toEqual([
      'item:user',
      'title',
      'item:note',
      'delta',
      'item:text',
      'delta',
      'delta',
      'delta',
      'working',
      'item:tool',
      'tool_done',
      'item:text',
      'delta',
      'delta',
      'delta',
      'delta',
      'delta',
      'done',
    ])
    const tool = events.find((e) => e.type === 'item' && e.item.kind === 'tool')
    expect(tool).toMatchObject({ item: { activity: 'Searching your library for `t:elf`', state: 'running' } })
    expect(events.find((e) => e.type === 'tool_done')).toMatchObject({ id: 'toolu_1', state: 'done' })

    const stored = getMessages(db, id)
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(stored[1]!.content).toEqual([
      { type: 'thinking', thinking: 'Check which elves they own.', signature: 'sig-a' },
      { type: 'text', text: 'Let me check your elves.' },
      { type: 'tool_use', id: 'toolu_1', name: 'search_my_library', input: { query: 't:elf' } },
    ])
    const result = stored[2]!.content[0] as Extract<ContentBlock, { type: 'tool_result' }>
    expect(result.tool_use_id).toBe('toolu_1')
    expect(JSON.parse(result.content as string)).toMatchObject({ total: 1, cards: [{ name: 'Llanowar Elves', owned: 2, free: 2 }] })
    expect(stored[1]!.meta).toMatchObject({ model: 'claude-opus-5-5', stopReason: 'tool_use' })
    expect(getThread(db, id)!.title).toBe('Which elves do I own?')
    expect(canContinue(stored)).toBe(false)

    // The second request replays the first round verbatim, reasoning signature included.
    expect(fake.requests[1]!.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Which elves do I own?' }] },
      { role: 'assistant', content: stored[1]!.content },
      { role: 'user', content: stored[2]!.content },
    ])
  })

  it('asks Claude Opus 5.5 for its notes, at medium effort, with refusal fallbacks and a cached system prompt', async () => {
    const { fake, brainstorm } = await setup(answer)
    await ask(brainstorm, createThread(db, null), 'Hi')
    const { headers, body } = fake.requests[0]!
    expect(headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01,thinking-display-updates-2026-08-18,thinking-binding-controls-2026-08-01')
    expect(headers['x-api-key']).toBe('sk-ant-test-0000')
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      thinking: { type: 'adaptive', display: 'updates', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      stream: true,
    })
    const tools = body.tools as Array<{ name: string; eager_input_streaming: boolean }>
    expect(tools.map((t) => t.name)).toEqual(['search_my_library', 'search_scryfall', 'get_card', 'get_deck', 'create_prospective_deck'])
    expect(tools.every((t) => t.eager_input_streaming)).toBe(true)
  })

  it('opens a conversation about a deck with the deck, in the first message only', async () => {
    const burn = deck(db, 'Burn', 'built', 'modern')
    inDeck(db, burn, 'Lightning Bolt', 4)
    const { fake, brainstorm, tools } = await setup(answer, answer)
    const id = createThread(db, burn)
    const events = await ask(brainstorm, id, 'How do I make this faster?')
    const again = await ask(brainstorm, id, 'And cheaper?')
    expect(events[1]).toEqual({ type: 'title', title: 'How do I make this faster?' })
    expect(again.some((e) => e.type === 'title')).toBe(false)

    expect(events[0]).toEqual({ type: 'item', item: { kind: 'user', text: 'How do I make this faster?', deck: 'Burn' } })
    const first = fake.requests[0]!.body.messages[0]!.content as Array<{ text: string }>
    expect(first).toHaveLength(2)
    expect(first[0]!.text.startsWith(DECK_CONTEXT_TAG)).toBe(true)
    expect(first[0]!.text).toContain('4 Lightning Bolt (main; to buy)')
    expect(first[1]!.text).toBe('How do I make this faster?')
    const second = fake.requests[1]!.body.messages.at(-1)!.content as Array<{ text: string }>
    expect(second).toEqual([{ type: 'text', text: 'And cheaper?' }])
    // The system prompt stays the same, so the cache holds across conversations.
    expect((fake.requests[0]!.body.system as Array<{ text: string }>)[0]!.text).toBe(SYSTEM_PROMPT)

    const items = chatItems(getMessages(db, id), tools.describe)
    expect(items[0]).toEqual({ kind: 'user', text: 'How do I make this faster?', deck: 'Burn' })
  })

  it('opens a conversation about a deck with the deck, even after its first question was declined', async () => {
    const burn = deck(db, 'Burn', 'built', 'modern')
    inDeck(db, burn, 'Lightning Bolt', 4)
    const { fake, brainstorm, tools } = await setup({ content: [], stop_reason: 'refusal' }, answer)
    const id = createThread(db, burn)
    await ask(brainstorm, id, 'Something declined')
    const events = await ask(brainstorm, id, 'How do I make this faster?')
    expect(events[0]).toEqual({ type: 'item', item: { kind: 'user', text: 'How do I make this faster?', deck: 'Burn' } })
    // The declined question, and the deck summary with it, are left out: the new question brings the summary again.
    const sent = fake.requests[1]!.body.messages
    expect(sent).toHaveLength(1)
    const content = sent[0]!.content as Array<{ text: string }>
    expect(content[0]!.text.startsWith(DECK_CONTEXT_TAG)).toBe(true)
    expect(content[1]!.text).toBe('How do I make this faster?')
    expect(chatItems(getMessages(db, id), tools.describe).filter((i) => i.kind === 'user')).toEqual([
      { kind: 'user', text: 'Something declined', deck: 'Burn' },
      { kind: 'user', text: 'How do I make this faster?', deck: 'Burn' },
    ])
  })

  it('shows a note only when Claude writes one', async () => {
    const { brainstorm } = await setup({
      content: [
        { type: 'thinking', thinking: '', signature: 'sig-e' },
        { type: 'text', text: 'Hi there' },
      ],
      stop_reason: 'end_turn',
    })
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Hi')
    expect(events.map((e) => (e.type === 'item' ? `item:${e.item.kind}` : e.type))).toEqual(['item:user', 'title', 'item:text', 'delta', 'done'])
    // The empty reasoning block is still stored, to be sent back as it came.
    expect(getMessages(db, id)[1]!.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-e' })
  })

  it('tells Claude when a tool fails, and carries on', async () => {
    const { brainstorm } = await setup(
      { content: [{ type: 'tool_use', id: 'toolu_1', name: 'search_my_library', input: { query: 'mv>' } }], stop_reason: 'tool_use' },
      answer,
    )
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Cheap spells?')
    const done = events.find((e) => e.type === 'tool_done')
    expect(done).toMatchObject({ state: 'failed' })
    expect((done as { error: string }).error).toMatch(/^That query isn't valid/)
    const result = getMessages(db, id)[2]!.content[0] as Extract<ContentBlock, { type: 'tool_result' }>
    expect(result).toMatchObject({ is_error: true })
    expect(result.content).toMatch(/^Error: That query isn't valid/)
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('refuses tool input that breaks the schema, without running the tool', async () => {
    const { brainstorm } = await setup(
      { content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_deck', input: { deck_id: 'three' } }], stop_reason: 'tool_use' },
      answer,
    )
    const id = createThread(db, null)
    await ask(brainstorm, id, 'Read my deck')
    const result = getMessages(db, id)[2]!.content[0] as Extract<ContentBlock, { type: 'tool_result' }>
    expect(result.is_error).toBe(true)
  })

  it('asks again when a streamed tool input is not JSON at all', async () => {
    const { fake, brainstorm, tools } = await setup(
      { content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_card', input: null, rawJson: 'name = Sol Ring' }], stop_reason: 'tool_use' },
      answer,
    )
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Tell me about Sol Ring')
    expect(fake.requests).toHaveLength(2)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    // The owner sees that Binder asked again. The garbled attempt isn't stored, so after a reload none of it shows.
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.retried } })
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(chatItems(getMessages(db, id), tools.describe).map((i) => i.kind)).toEqual(['user', 'text'])
  })
})

describe('when an answer goes wrong', () => {
  it('reports an API failure and lets Continue ask again', async () => {
    const { brainstorm } = await setup({ status: 401, type: 'authentication_error', message: 'invalid x-api-key' }, answer)
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Hi')
    expect(events.at(-2)).toEqual({ type: 'error', message: 'Anthropic refused the API key; check it in Settings', canContinue: true })
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user'])

    await ask(brainstorm, id, null)
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(canContinue(getMessages(db, id))).toBe(false)
  })

  it("explains Anthropic's failures in plain words, without the raw error body", async () => {
    const { brainstorm } = await setup(
      { status: 529, type: 'overloaded_error', message: 'Overloaded' },
      { status: 400, type: 'invalid_request_error', message: 'messages: text content blocks must be non-empty' },
      // Partway through an answer an error has no HTTP status, only its type.
      { content: [{ type: 'text', text: 'Let me think' }], error: { type: 'rate_limit_error', message: 'Output tokens per minute exceeded' } },
      { content: [{ type: 'text', text: 'Let me think' }], error: { type: 'invalid_request_error', message: 'Something unexpected' } },
    )
    const id = createThread(db, null)
    expect((await ask(brainstorm, id, 'Hi')).at(-2)).toEqual({
      type: 'error',
      message: 'Anthropic is overloaded right now; try again shortly',
      canContinue: true,
    })
    expect((await ask(brainstorm, id, null)).at(-2)).toEqual({
      type: 'error',
      message: 'Anthropic answered with an error (400): messages: text content blocks must be non-empty',
      canContinue: true,
    })
    expect((await ask(brainstorm, id, null)).at(-2)).toEqual({
      type: 'error',
      message: 'Anthropic is rate-limiting requests; try again shortly',
      canContinue: true,
    })
    expect((await ask(brainstorm, id, null)).at(-2)).toEqual({
      type: 'error',
      message: 'Anthropic answered with an error: Something unexpected',
      canContinue: true,
    })
  })

  it('explains a failure partway through an answer, and lets Continue ask again', async () => {
    const { brainstorm } = await setup(
      { content: [{ type: 'text', text: 'Let me think' }], error: { type: 'overloaded_error', message: 'Overloaded' } },
      { content: [{ type: 'text', text: 'Let me think' }], error: { type: 'api_error', message: 'Internal server error' } },
      answer,
    )
    const id = createThread(db, null)
    expect((await ask(brainstorm, id, 'Hi')).at(-2)).toEqual({
      type: 'error',
      message: 'Anthropic is overloaded right now; try again shortly',
      canContinue: true,
    })
    expect((await ask(brainstorm, id, null)).at(-2)).toEqual({ type: 'error', message: 'Anthropic had a problem; try again shortly', canContinue: true })
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user'])
    await ask(brainstorm, id, null)
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('fails at once when the connection drops partway through, and lets Continue ask again', async () => {
    const { fake, brainstorm } = await setup({ content: [{ type: 'text', text: 'Half an answer' }], drop: true }, answer)
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Hi')
    // Asking again would resend the whole conversation: that is the owner's call, with Continue.
    expect(fake.requests).toHaveLength(1)
    expect(events.some(retried)).toBe(false)
    expect(events.at(-2)).toEqual({
      type: 'error',
      message: 'The connection to Anthropic dropped partway through; Continue asks again',
      canContinue: true,
    })
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user'])
    await ask(brainstorm, id, null)
    expect(fake.requests).toHaveLength(2)
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('records a refusal and keeps the declined question out of later requests', async () => {
    const { fake, brainstorm, tools } = await setup({ content: [], stop_reason: 'refusal' }, answer)
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Something declined')
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'error', text: NOTICE.refusal } })
    expect(canContinue(getMessages(db, id))).toBe(false)

    await ask(brainstorm, id, 'Something else')
    expect(fake.requests[1]!.body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Something else' }] }])
    expect(chatItems(getMessages(db, id), tools.describe).map((i) => i.kind)).toEqual(['user', 'notice', 'user', 'text'])
  })

  it('leaves a whole declined turn out of later requests, tool rounds included, and still shows it', async () => {
    const save: FakeReply = {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'create_prospective_deck',
          input: { name: 'Elves', format: 'commander', cards: [{ name: 'Llanowar Elves', quantity: 1 }] },
        },
      ],
      stop_reason: 'tool_use',
    }
    const { fake, brainstorm, tools } = await setup(save, { content: [], stop_reason: 'refusal' }, answer)
    const id = createThread(db, null)
    await ask(brainstorm, id, 'Save an elf deck')
    expect(count(db, 'decks')).toBe(1)
    await ask(brainstorm, id, 'Something else')
    expect(fake.requests[2]!.body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Something else' }] }])
    const items = chatItems(getMessages(db, id), tools.describe)
    expect(items.map((i) => i.kind)).toEqual(['user', 'tool', 'notice', 'user', 'text'])
    expect(items[1]).toMatchObject({ kind: 'tool', state: 'done', deck: { name: 'Elves', format: 'commander' } })
  })

  it('leaves a question that failed unanswered before a refusal out too', async () => {
    const { fake, brainstorm } = await setup({ status: 500, type: 'api_error', message: 'boom' }, { content: [], stop_reason: 'refusal' }, answer)
    const id = createThread(db, null)
    await ask(brainstorm, id, 'First try')
    await ask(brainstorm, id, 'Declined')
    await ask(brainstorm, id, 'Something else')
    expect(fake.requests[2]!.body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Something else' }] }])
  })

  it('drops what the declining model wrote before a fallback, and runs only the tool calls after it', async () => {
    const { fake, brainstorm } = await setup(
      {
        content: [
          { type: 'thinking', thinking: 'first model' },
          { type: 'text', text: 'Looking' },
          { type: 'tool_use', id: 'toolu_0', name: 'get_card', input: { name: 'Sol Ring' } },
          { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' },
          { type: 'tool_use', id: 'toolu_1', name: 'get_card', input: { name: 'Llanowar Elves' } },
        ],
        stop_reason: 'tool_use',
        model: 'claude-opus-5',
      },
      answer,
    )
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Compare')
    expect(events).toContainEqual({ type: 'item', item: { kind: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' } })
    const stored = getMessages(db, id)
    expect(stored[1]!.content.map((b) => b.type)).toEqual(['text', 'fallback', 'tool_use'])
    expect(stored[2]!.content).toHaveLength(1)
    expect((stored[2]!.content[0] as { tool_use_id: string }).tool_use_id).toBe('toolu_1')
    expect(stored[1]!.meta!.model).toBe('claude-opus-5')
    expect(fake.requests[1]!.body.messages[1]!.content).toEqual(stored[1]!.content)
  })

  it('keeps the text of an answer cut off by max_tokens, and never runs its tool call', async () => {
    const { brainstorm } = await setup({
      content: [
        { type: 'text', text: 'Here is a long plan' },
        { type: 'tool_use', id: 'toolu_1', name: 'create_prospective_deck', input: { name: 'Elves', format: 'commander', cards: [] } },
      ],
      stop_reason: 'max_tokens',
    })
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Build it')
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.cutOff } })
    expect(events.some((e) => e.type === 'item' && e.item.kind === 'tool')).toBe(false)
    expect(getMessages(db, id)[1]!.content).toEqual([{ type: 'text', text: 'Here is a long plan' }])
    expect(count(db, 'decks')).toBe(0)
  })

  it('runs tool calls only when Claude stopped to use them', async () => {
    const { brainstorm, tools } = await setup({
      content: [
        { type: 'text', text: 'Here is the plan' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'create_prospective_deck',
          input: { name: 'Elves', format: 'commander', cards: [{ name: 'Llanowar Elves', quantity: 1 }] },
        },
      ],
      stop_reason: 'model_context_window_exceeded',
    })
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Build it')
    expect(events.some((e) => e.type === 'item' && e.item.kind === 'tool')).toBe(false)
    expect(count(db, 'decks')).toBe(0)
    // The conversation has outgrown Claude's context window: said as such, not as a long answer.
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.tooLong } })
    expect(getMessages(db, id)[1]!.content).toEqual([{ type: 'text', text: 'Here is the plan' }])
    expect(chatItems(getMessages(db, id), tools.describe).at(-1)).toEqual({ kind: 'notice', tone: 'info', text: NOTICE.tooLong })
  })

  it("says when a conversation is too long for Claude to take at all, and doesn't offer Continue", async () => {
    const { brainstorm } = await setup({ status: 400, type: 'invalid_request_error', message: 'prompt is too long: 1000012 tokens > 1000000 maximum' })
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'One more thing')
    // Said once, as the notice it reloads with: not as an error as well.
    expect(events.at(-2)).toEqual({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.tooLong } })
    expect(events.some((e) => e.type === 'error')).toBe(false)
    // Recorded as a conversation that outgrew the context window, with nothing said.
    expect(getMessages(db, id).at(-1)).toMatchObject({
      role: 'assistant',
      content: [],
      meta: { model: 'claude-opus-5-5', stopReason: 'model_context_window_exceeded', usage: null },
    })
  })

  it('never sends back the record of a conversation grown too long for Claude', async () => {
    const { fake, brainstorm } = await setup(
      { status: 400, type: 'invalid_request_error', message: 'prompt is too long: 1000012 tokens > 1000000 maximum' },
      { content: [{ type: 'thinking', thinking: '' }], stop_reason: 'model_context_window_exceeded' },
      answer,
    )
    const id = createThread(db, null)
    await ask(brainstorm, id, 'One more thing')
    await ask(brainstorm, id, 'And another')
    // The fake refuses an empty message, as the API does: a request that sent one would fail.
    expect((await ask(brainstorm, id, 'Shorter, then?')).some((e) => e.type === 'error')).toBe(false)
    expect(getMessages(db, id).map((m) => `${m.role}:${m.content.length}`)).toEqual([
      'user:1',
      'assistant:0',
      'user:1',
      'assistant:0',
      'user:1',
      'assistant:1',
    ])
    expect(fake.requests.map((r) => r.body.messages.map((m) => m.role).join(' '))).toEqual(['user', 'user user', 'user user user'])
  })

  it('never stores or sends back an empty text block', async () => {
    const fallback = { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' } as const
    const { fake, brainstorm } = await setup(
      // The declining model's partial is an empty text block.
      { content: [{ type: 'text', text: '' }, fallback, { type: 'text', text: 'Here you go' }], stop_reason: 'end_turn', model: 'claude-opus-5' },
      // Nothing worth sending back: nothing is stored.
      { content: [{ type: 'text', text: ' ' }, fallback], stop_reason: 'end_turn', model: 'claude-opus-5' },
      answer,
    )
    const id = createThread(db, null)
    await ask(brainstorm, id, 'First')
    expect(getMessages(db, id)[1]!.content.map((b) => b.type)).toEqual(['fallback', 'text'])
    await ask(brainstorm, id, 'Second')
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    // The fake refuses an empty text block as the API does, so this request shows none was sent back.
    const events = await ask(brainstorm, id, 'Third')
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(fake.requests).toHaveLength(3)
  })

  it('estimates spend from every attempt the usage lists, each at its own model\'s prices', async () => {
    const attempt = { cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    const fellBack = (declined: number): FakeReply => ({
      content: [{ type: 'text', text: 'Here you go' }],
      stop_reason: 'end_turn',
      model: 'claude-opus-5',
      usage: {
        input_tokens: 2000,
        output_tokens: 300,
        iterations: [
          { ...attempt, type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: declined },
          { ...attempt, type: 'fallback_message', model: 'claude-opus-5', input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 400 },
        ],
      },
    })
    const { brainstorm } = await setup(fellBack(50), fellBack(0))
    const partway = createThread(db, null)
    await ask(brainstorm, partway, 'Hi')
    // Per million tokens: Opus 5.5 declined partway, 1000 × $4 + 50 × $20; Opus 5 answered, 2000 × $5 + 300 × $25 +
    // 400 × $0.50. The top-level usage counts only the last attempt.
    expect(estimateCost(getMessages(db, partway))).toBe(0.0227)
    // Declined before it wrote anything: not billed.
    const before = createThread(db, null)
    await ask(brainstorm, before, 'Hi')
    expect(estimateCost(getMessages(db, before))).toBe(0.0177)
  })

  it('stops on request, keeping the text so far', async () => {
    const { brainstorm } = await setup({ content: [{ type: 'text', text: 'Elves are great because' }], hang: true })
    const id = createThread(db, null)
    const controller = new AbortController()
    const events: ChatEvent[] = []
    const running = brainstorm.answer(id, 'Tell me about elves', (e) => {
      events.push(e)
      if (e.type === 'delta' && events.filter((x) => x.type === 'delta').length === 3) controller.abort()
    }, controller.signal)
    expect(brainstorm.busy(id)).toBe(true)
    expect(() => brainstorm.check(id, 'again')).toThrow(expect.objectContaining({ status: 409, code: 'busy' }))
    await running
    expect(brainstorm.busy(id)).toBe(false)
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.stopped } })
    const stored = getMessages(db, id)
    expect(stored[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Elves are great because' }], meta: { stopReason: 'stopped' } })
    // What streamed before the stop is still counted toward the cost.
    expect(stored[1]!.meta!.usage).toMatchObject({ input_tokens: 1000 })
  })

  it('stop() stops the answer in progress', async () => {
    const { brainstorm } = await setup({ content: [{ type: 'text', text: 'Thinking about it' }], hang: true })
    const id = createThread(db, null)
    const events: ChatEvent[] = []
    const running = brainstorm.answer(id, 'Go', (e) => {
      events.push(e)
      if (e.type === 'delta') brainstorm.stop(id)
    })
    await running
    expect(brainstorm.stop(id)).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('keeps where another model took over when an answer is stopped', async () => {
    const { brainstorm, tools } = await setup({
      content: [
        { type: 'text', text: 'Elves love' },
        { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' },
        { type: 'text', text: 'Here is a safer take' },
      ],
      hang: true,
    })
    const id = createThread(db, null)
    const controller = new AbortController()
    let texts = 0
    await brainstorm.answer(
      id,
      'Go',
      (e) => {
        if (e.type === 'item' && e.item.kind === 'text') texts++
        else if (e.type === 'delta' && texts === 2) controller.abort()
      },
      controller.signal,
    )
    const stored = getMessages(db, id)[1]!
    expect(stored.content).toEqual([
      { type: 'text', text: 'Elves love' },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
      { type: 'text', text: 'Here is a safer take' },
    ])
    expect(stored.meta).toMatchObject({ model: 'claude-opus-5', stopReason: 'stopped' })
    // After a reload, the fallback line shows where it happened, rather than a note that another model answered.
    expect(chatItems(getMessages(db, id), tools.describe).slice(1)).toEqual<ChatItem[]>([
      { kind: 'text', text: 'Elves love' },
      { kind: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' },
      { kind: 'text', text: 'Here is a safer take' },
      { kind: 'notice', tone: 'info', text: NOTICE.stopped },
    ])
  })

  it('keeps every text block of a stopped answer, a paragraph apart', async () => {
    const { brainstorm } = await setup({ content: [{ type: 'text', text: 'First part.' }, { type: 'text', text: 'Second' }], hang: true })
    const id = createThread(db, null)
    const controller = new AbortController()
    let texts = 0
    await brainstorm.answer(
      id,
      'Go',
      (e) => {
        if (e.type === 'item' && e.item.kind === 'text') texts++
        else if (e.type === 'delta' && texts === 2) controller.abort()
      },
      controller.signal,
    )
    expect(getMessages(db, id)[1]!.content).toEqual([{ type: 'text', text: 'First part.\n\nSecond' }])
  })

  it("says when another model answers, and keeps the model a stopped answer came from", async () => {
    // After a refusal, Anthropic may keep answering with the model that took over, with no fallback block to say so.
    const { brainstorm, tools } = await setup(
      { content: [{ type: 'text', text: 'From Opus 5' }], stop_reason: 'end_turn', model: 'claude-opus-5' },
      { content: [{ type: 'text', text: 'Still Opus 5' }], hang: true, model: 'claude-opus-5' },
    )
    const id = createThread(db, null)
    await ask(brainstorm, id, 'First')
    const controller = new AbortController()
    await brainstorm.answer(id, 'Second', (e) => e.type === 'delta' && controller.abort(), controller.signal)
    expect(getMessages(db, id)[3]!.meta).toMatchObject({ model: 'claude-opus-5', stopReason: 'stopped' })
    // One notice for the switch; the stopped answer doesn't fake a switch back.
    expect(chatItems(getMessages(db, id), tools.describe)).toEqual<ChatItem[]>([
      { kind: 'user', text: 'First', deck: null },
      {
        kind: 'notice',
        tone: 'info',
        text: 'Claude Opus 5 answered from here: after a refusal, Anthropic keeps a conversation on the model that took over for about an hour.',
      },
      { kind: 'text', text: 'From Opus 5' },
      { kind: 'user', text: 'Second', deck: null },
      { kind: 'text', text: 'Still Opus 5' },
      { kind: 'notice', tone: 'info', text: NOTICE.stopped },
    ])
  })

  it('refuses a second answer while one is running, without touching it', async () => {
    const { fake, brainstorm } = await setup({ content: [{ type: 'text', text: 'Thinking about it' }], hang: true })
    const id = createThread(db, null)
    const first: ChatEvent[] = []
    let streaming = () => {}
    const started = new Promise<void>((resolve) => (streaming = resolve))
    const running = brainstorm.answer(id, 'Go', (e) => {
      first.push(e)
      if (e.type === 'delta') streaming()
    })
    await started
    const second = await ask(brainstorm, id, 'Again')
    expect(second).toEqual([{ type: 'error', message: 'Claude is still answering in this conversation', canContinue: false }, { type: 'done' }])
    expect(brainstorm.busy(id)).toBe(true)
    expect(brainstorm.stop(id)).toBe(true)
    await running
    expect(first.at(-1)).toEqual({ type: 'done' })
    expect(fake.requests).toHaveLength(1)
    // The running answer kept its text; the second message was never stored.
    expect(getMessages(db, id).map((m) => (m.content[0] as { text?: string }).text)).toEqual(['Go', 'Thinking about it'])
  })

  it('makes no request for an answer stopped before it starts', async () => {
    const { fake, brainstorm } = await setup(answer)
    const id = createThread(db, null)
    const controller = new AbortController()
    controller.abort()
    const events = await ask(brainstorm, id, 'Hi', controller.signal)
    expect(fake.requests).toHaveLength(0)
    expect(events.slice(-2)).toEqual([{ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.stopped } }, { type: 'done' }])
    expect(canContinue(getMessages(db, id))).toBe(true)
  })

  it('stops the garbled response before asking again', async () => {
    const { fake, brainstorm } = await setup(
      { content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_card', input: null, rawJson: 'name = Sol Ring' }], hang: true },
      answer,
    )
    const id = createThread(db, null)
    await ask(brainstorm, id, 'Tell me about Sol Ring')
    expect(fake.requests).toHaveLength(2)
    await vi.waitFor(() => expect(fake.requests[0]!.hungUp).toBe(true))
  })

  it('stops an answer that keeps calling tools after MAX_ROUNDS requests, and lets Continue go on', async () => {
    const { fake, brainstorm } = await setup(...Array.from({ length: MAX_ROUNDS }, (_, i) => lookUp(i)))
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Keep looking')
    expect(fake.requests).toHaveLength(MAX_ROUNDS)
    expect(events.at(-2)).toEqual({
      type: 'error',
      message: `Claude took more than ${MAX_ROUNDS} steps without finishing; Continue lets it go on`,
      canContinue: true,
    })
    expect(getMessages(db, id)).toHaveLength(1 + 2 * MAX_ROUNDS)
  })

  it('asks again at most twice in a row when tool input comes through garbled, then lets Continue try again', async () => {
    const { fake, brainstorm } = await setup(garbled(1), garbled(2), garbled(3))
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Tell me about Sol Ring')
    expect(fake.requests).toHaveLength(3)
    expect(events.filter(retried)).toHaveLength(2)
    expect(events.at(-2)).toEqual({
      type: 'error',
      message: "Claude's answer came through garbled 3 times in a row; Continue asks again",
      canContinue: true,
    })
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user'])

    fake.reply(answer)
    await ask(brainstorm, id, null)
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('counts every request toward MAX_ROUNDS, retries after garbled tool input included', async () => {
    // Every other answer comes through garbled, so no two retries run in a row.
    const { fake, brainstorm } = await setup(...Array.from({ length: MAX_ROUNDS }, (_, i) => (i % 2 === 0 ? lookUp(i) : garbled(i))))
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Keep looking')
    expect(fake.requests).toHaveLength(MAX_ROUNDS)
    expect(events.at(-2)).toEqual({
      type: 'error',
      message: `Claude took more than ${MAX_ROUNDS} steps without finishing; Continue lets it go on`,
      canContinue: true,
    })
    // Half the requests made a tool round (Claude's message and the results); the garbled ones stored nothing.
    expect(getMessages(db, id)).toHaveLength(1 + MAX_ROUNDS)
    // The last answer came through garbled with no request left for a retry, so no notice says Binder asked again.
    expect(events.filter(retried)).toHaveLength(MAX_ROUNDS / 2 - 1)
  })

  it('checks for a key, the conversation, and something to continue before starting', async () => {
    const fake = await fakeAnthropic()
    const tools = createBrainstormTools({ db, scryfall: stubScryfall() })
    const keyless = createBrainstorm({ db, ai: fakeAiClient(fake, null), tools })
    const id = createThread(db, null)
    expect(() => keyless.check(id, 'Hi')).toThrow(expect.objectContaining({ status: 409, code: 'no_key' }))
    const { brainstorm } = await setup()
    expect(() => brainstorm.check(999, 'Hi')).toThrow(expect.objectContaining({ status: 404 }))
    expect(() => brainstorm.check(id, null)).toThrow(expect.objectContaining({ status: 409, code: 'nothing_to_continue' }))
  })
})

describe('history', () => {
  const message = (role: 'user' | 'assistant', content: ContentBlock[], stopReason?: string): StoredMessage => ({
    id: 0,
    role,
    content,
    meta: stopReason ? { model: 'claude-opus-5-5', stopReason, usage: null } : null,
    createdAt: '',
  })

  it('titles a conversation by the first line of its first message', () => {
    expect(titleFrom('  Build me an elf deck\nwith lords')).toBe('Build me an elf deck')
    expect(titleFrom('x'.repeat(80))).toBe(`${'x'.repeat(59)}…`)
  })

  it('keeps only text before the last fallback block', () => {
    const blocks = [
      { type: 'thinking', thinking: 'a', signature: 's' },
      { type: 'text', text: 'b' },
      { type: 'tool_use', id: 't', name: 'get_card', input: {} },
      { type: 'fallback', from: { model: 'x' }, to: { model: 'y' } },
      { type: 'thinking', thinking: 'c', signature: 's' },
    ] as ContentBlock[]
    expect(forReplay(blocks).map((b) => b.type)).toEqual(['text', 'fallback', 'thinking'])
    const plain = [{ type: 'thinking', thinking: 'a', signature: 's' }, { type: 'text', text: 'b' }] as ContentBlock[]
    expect(forReplay(plain)).toEqual(plain)
  })

  it('leaves each declined turn out of what Claude sees, back to the last finished answer', () => {
    const q = (text: string) => message('user', [{ type: 'text', text }])
    const said = (text: string, stopReason = 'end_turn') => message('assistant', [{ type: 'text', text }], stopReason)
    const call = message('assistant', [{ type: 'tool_use', id: 't', name: 'get_card', input: {} }], 'tool_use')
    const result = message('user', [{ type: 'tool_result', tool_use_id: 't', content: '{}' }])
    const refusal = message('assistant', [], 'refusal')
    const seen = (messages: StoredMessage[]) =>
      replayMessages(messages).map((m) => {
        const block = (m.content as ContentBlock[])[0]!
        return block.type === 'text' ? block.text : block.type
      })
    // A tool round before the refusal goes with it.
    expect(seen([q('q1'), refusal, q('q2'), call, result, refusal])).toEqual([])
    // So does a question that failed, unanswered, before the declined one.
    expect(seen([q('q0'), said('a0'), q('q1'), q('q2'), refusal, q('q3')])).toEqual(['q0', 'a0', 'q3'])
    // A stopped or cut-off answer is a finished one: what came before it stays.
    expect(seen([q('q0'), call, result, said('a0', 'stopped'), q('q1'), refusal])).toEqual(['q0', 'tool_use', 'tool_result', 'a0'])
    expect(seen([q('q0'), said('a0', 'max_tokens'), q('q1'), call, result, refusal, q('q2')])).toEqual(['q0', 'a0', 'q2'])
  })

  it('shows tool calls with their outcome, notes, and notices', () => {
    const messages = [
      message('user', [{ type: 'text', text: 'Build it' }]),
      message(
        'assistant',
        [
          { type: 'thinking', thinking: 'Plan', signature: 's' },
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'tool_use', id: 't1', name: 'get_card', input: { name: 'Sol Ring' } },
          { type: 'tool_use', id: 't2', name: 'create_prospective_deck', input: { name: 'Elves', format: 'commander', cards: [{ name: 'x', quantity: 2 }] } },
        ],
        'tool_use',
      ),
      message('user', [
        { type: 'tool_result', tool_use_id: 't1', content: 'Error: No card is named "Sol Rign".', is_error: true },
        {
          type: 'tool_result',
          tool_use_id: 't2',
          content: JSON.stringify({ deck_id: 7, name: 'Elves', format: 'commander', cards: 2, completion_percent: 50, cost_to_finish_usd: 1.5, unresolved: ['Elf Lord'] }),
        },
      ]),
      message('assistant', [{ type: 'text', text: 'Done' }], 'max_tokens'),
    ]
    const items = chatItems(messages, (name) => `use ${name}`)
    expect(items).toEqual<ChatItem[]>([
      { kind: 'user', text: 'Build it', deck: null },
      { kind: 'note', text: 'Plan' },
      { kind: 'tool', id: 't1', name: 'get_card', activity: 'use get_card', state: 'failed', error: 'No card is named "Sol Rign".', deck: null },
      {
        kind: 'tool',
        id: 't2',
        name: 'create_prospective_deck',
        activity: 'use create_prospective_deck',
        state: 'done',
        error: null,
        deck: { id: 7, name: 'Elves', format: 'commander', cardCount: 2, completion: 0.5, costToFinish: 1.5, unresolved: ['Elf Lord'] },
      },
      { kind: 'text', text: 'Done' },
      { kind: 'notice', tone: 'info', text: NOTICE.cutOff },
    ])
  })

  it('says once when another model answers from a message on, and when Claude Opus 5.5 is back', () => {
    const q = (text: string) => message('user', [{ type: 'text', text }])
    const by = (model: string, content: ContentBlock[], stopReason = 'end_turn'): StoredMessage => ({
      ...message('assistant', content, stopReason),
      meta: { model, stopReason, usage: null },
    })
    const call = (id: string) => by('claude-opus-5', [{ type: 'tool_use', id, name: 'get_card', input: { name: 'Sol Ring' } }], 'tool_use')
    const result = (id: string) => message('user', [{ type: 'tool_result', tool_use_id: id, content: '{}' }])
    const shown = (messages: StoredMessage[]) =>
      chatItems(messages, () => 'look').map((i) => (i.kind === 'notice' ? i.text : i.kind === 'text' || i.kind === 'user' ? i.text : i.kind))
    const opus5 = 'Claude Opus 5 answered from here: after a refusal, Anthropic keeps a conversation on the model that took over for about an hour.'
    // A sticky answer of several rounds: one notice, before its first message.
    const sticky = [q('Q1'), by('claude-opus-5-5', [{ type: 'text', text: 'A1' }]), q('Q2'), call('t1'), result('t1'), call('t2'), result('t2')]
    const stickyEnd = by('claude-opus-5', [{ type: 'text', text: 'A2' }])
    expect(shown([...sticky, stickyEnd])).toEqual(['Q1', 'A1', 'Q2', opus5, 'tool', 'tool', 'A2'])
    // Back on Claude Opus 5.5.
    expect(shown([...sticky, stickyEnd, q('Q3'), by('claude-opus-5-5', [{ type: 'text', text: 'A3' }])])).toEqual([
      'Q1',
      'A1',
      'Q2',
      opus5,
      'tool',
      'tool',
      'A2',
      'Q3',
      'Claude Opus 5.5 answered from here.',
      'A3',
    ])
    // A fallback block already says so, and the sticky answers after it need no notice.
    const fallback = by('claude-opus-5', [
      { type: 'text', text: 'Partly' },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
      { type: 'text', text: 'Rest' },
    ] as ContentBlock[])
    expect(shown([q('Q1'), fallback, q('Q2'), by('claude-opus-5', [{ type: 'text', text: 'A2' }])])).toEqual(['Q1', 'Partly', 'fallback', 'Rest', 'Q2', 'A2'])
    // A dated snapshot id names the same model.
    expect(shown([q('Q1'), by('claude-opus-5-5-20260915', [{ type: 'text', text: 'A1' }])])).toEqual(['Q1', 'A1'])
    // A refusal changes nothing, whichever model declined.
    const refusal = by('claude-opus-5', [], 'refusal')
    expect(shown([q('Q1'), by('claude-opus-5-5', [{ type: 'text', text: 'A1' }]), q('Q2'), refusal, q('Q3'), by('claude-opus-5-5', [{ type: 'text', text: 'A3' }])])).toEqual([
      'Q1',
      'A1',
      'Q2',
      NOTICE.refusal,
      'Q3',
      'A3',
    ])
  })

  it("estimates spend from recorded usage at the prices of the model that wrote it", () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 2_000_000 }
    const by = (model: string) => [{ ...message('assistant', [{ type: 'text', text: 'x' }], 'end_turn'), meta: { model, stopReason: 'end_turn', usage } }]
    // Opus 5.5: 4 + 2 + 1 + 0.4
    expect(estimateCost(by('claude-opus-5-5') as StoredMessage[])).toBe(7.4)
    // Opus 5, after a fallback: 5 + 2.5 + 1.25 + 1; a model Binder doesn't know is priced the same.
    expect(estimateCost(by('claude-opus-5') as StoredMessage[])).toBe(9.75)
    expect(estimateCost(by('claude-opus-5-20261101') as StoredMessage[])).toBe(9.75)
    expect(estimateCost(by('claude-next') as StoredMessage[])).toBe(9.75)
  })

  it('estimates nothing for a refusal declined before it wrote anything, however many models declined', () => {
    const attempt = { cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    const ended = (usage: object, stopReason = 'refusal', model = 'claude-opus-5-5') =>
      [{ ...message('assistant', [], stopReason), meta: { model, stopReason, usage } }] as StoredMessage[]
    // The whole fallback chain declined.
    const chain = {
      input_tokens: 100_000,
      output_tokens: 0,
      iterations: [
        { ...attempt, type: 'message', model: 'claude-opus-5-5', input_tokens: 100_000, output_tokens: 0 },
        { ...attempt, type: 'fallback_message', model: 'claude-opus-5', input_tokens: 100_000, output_tokens: 0 },
      ],
    }
    expect(estimateCost(ended(chain, 'refusal', 'claude-opus-5'))).toBe(0)
    // One refusal, with no fallback.
    const single = { input_tokens: 100_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    expect(estimateCost(ended(single))).toBe(0)
    // Declined partway through, what it read and wrote is billed: 100,000 × $4 + 50 × $20 per million tokens.
    expect(estimateCost(ended({ ...single, output_tokens: 50 }))).toBe(0.401)
    // Any other answer is billed for what it read, even with nothing written.
    expect(estimateCost(ended(single, 'model_context_window_exceeded'))).toBe(0.4)
  })

  it('prices an attempt that names no model at Claude Opus 5.5, unless it is the last', () => {
    const attempt = { cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    const answered = (iterations: object[]) =>
      [
        {
          ...message('assistant', [{ type: 'text', text: 'x' }], 'end_turn'),
          meta: { model: 'claude-opus-5', stopReason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0, iterations } },
        },
      ] as StoredMessage[]
    // Opus 5.5 declined partway, 1,000,000 × $4 + 50 × $20; Opus 5 answered, 2000 × $5 + 300 × $25 (per million).
    const fellBack = [
      { ...attempt, type: 'message', model: null, input_tokens: 1_000_000, output_tokens: 50 },
      { ...attempt, type: 'fallback_message', model: 'claude-opus-5', input_tokens: 2000, output_tokens: 300 },
    ]
    expect(estimateCost(answered(fellBack))).toBe(4.0185)
    // The last attempt is the answer, by the answer's model: Opus 5, 5 + 2.5.
    expect(estimateCost(answered([{ ...attempt, type: 'message', model: null, input_tokens: 1_000_000, output_tokens: 100_000 }]))).toBe(7.5)
  })

  it('never sends back an answer with nothing in it, and shows it by its notice alone', () => {
    const q = (text: string) => message('user', [{ type: 'text', text }])
    const by = (model: string, content: ContentBlock[], stopReason = 'end_turn'): StoredMessage => ({
      ...message('assistant', content, stopReason),
      meta: { model, stopReason, usage: null },
    })
    // Too long for Claude: recorded as Binder's model, with nothing said.
    const tooLong = by('claude-opus-5-5', [], 'model_context_window_exceeded')
    const refusal = by('claude-opus-5-5', [], 'refusal')
    const messages = [q('Q1'), by('claude-opus-5', [{ type: 'text', text: 'A1' }]), q('Q2'), tooLong, q('Q3')]
    expect(replayMessages(messages).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user'])
    // It ends a turn like any finished answer: a later refusal leaves out only what came after it.
    expect(replayMessages([q('Q1'), tooLong, q('Q2'), refusal]).map((m) => (m.content as ContentBlock[])[0])).toEqual([{ type: 'text', text: 'Q1' }])
    // No note that Claude Opus 5.5 answered: nothing did.
    const shown = chatItems(messages, () => 'look').map((i) => (i.kind === 'notice' || i.kind === 'text' || i.kind === 'user' ? i.text : i.kind))
    expect(shown).toEqual(['Q1', expect.stringMatching(/^Claude Opus 5 answered from here:/), 'A1', 'Q2', NOTICE.tooLong, 'Q3'])
  })
})

describe('the fake Messages API', () => {
  it('refuses what the API would refuse, so the tests check what Binder sends back', () => {
    const question = { role: 'user', content: [{ type: 'text', text: 'Hi' }] }
    const call = { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_card', input: {} }] }
    const result = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] }
    expect(invalidMessages([question, call, result])).toBeNull()
    expect(invalidMessages([call, result])).toMatch(/first message must use the "user" role/)
    expect(invalidMessages([{ role: 'user', content: [{ type: 'text', text: ' ' }] }])).toMatch(/non-whitespace text/)
    expect(invalidMessages([question, { role: 'assistant', content: [] }, question])).toMatch(/non-empty content/)
    expect(invalidMessages([question, call, question])).toMatch(/without `tool_result` blocks/)
    expect(invalidMessages([question, { role: 'assistant', content: [{ type: 'text', text: 'Sure' }] }, result])).toMatch(/unexpected `tool_use_id`/)
  })
})
