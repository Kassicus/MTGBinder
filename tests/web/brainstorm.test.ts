import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ChatItem, CreatedDeck } from '../../src/shared/types.ts'
import {
  answerReducer,
  applyChatEvent,
  asSentence,
  awaitingClaude,
  leaveDeletedThread,
  NO_ANSWER,
  shownItems,
  splitEvents,
} from '../../src/web/lib/brainstorm.ts'
import { parseInline, parseMarkdown } from '../../src/web/lib/markdown.ts'

describe('Markdown', () => {
  it('reads card links, bold, italics, code, and links inline', () => {
    expect(parseInline('Add [[Llanowar Elves]] and **cheap _ramp_** like `{G}` — see [Scryfall](https://scryfall.com).')).toEqual([
      { kind: 'text', text: 'Add ' },
      { kind: 'card', name: 'Llanowar Elves' },
      { kind: 'text', text: ' and ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'cheap ' }, { kind: 'em', children: [{ kind: 'text', text: 'ramp' }] }] },
      { kind: 'text', text: ' like ' },
      { kind: 'code', text: '{G}' },
      { kind: 'text', text: ' — see ' },
      { kind: 'link', href: 'https://scryfall.com', children: [{ kind: 'text', text: 'Scryfall' }] },
      { kind: 'text', text: '.' },
    ])
  })

  it('leaves unsafe links, stray markers, and snake_case alone', () => {
    expect(parseInline('[x](javascript:alert(1)) 2 * 3 * 4 and search_my_library')).toEqual([
      { kind: 'text', text: '[x](javascript:alert(1)) 2 * 3 * 4 and search_my_library' },
    ])
  })

  it("takes a link's text and a card's name from their own brackets only", () => {
    expect(parseInline('[see [Scryfall](https://scryfall.com)')).toEqual([
      { kind: 'text', text: '[see ' },
      { kind: 'link', href: 'https://scryfall.com', children: [{ kind: 'text', text: 'Scryfall' }] },
    ])
    expect(parseInline('[[[Sol Ring]]')).toEqual([
      { kind: 'text', text: '[' },
      { kind: 'card', name: 'Sol Ring' },
    ])
  })

  it('reads headings, lists, tables, code, rules, and paragraphs', () => {
    const blocks = parseMarkdown(
      [
        '## Ramp',
        '- [[Sol Ring]]: fast mana',
        '- [[Arcane Signet]]',
        '  fixes colors',
        '',
        '1. First',
        '2. Second',
        '',
        '| Card | Price |',
        '|---|---:|',
        '| [[Sol Ring]] | $1 |',
        '',
        '```',
        'raw text',
        '```',
        '---',
        'A paragraph',
        'on two lines.',
      ].join('\n'),
    )
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list', 'list', 'table', 'code', 'rule', 'paragraph'])
    expect(blocks[1]).toEqual({
      kind: 'list',
      ordered: false,
      items: [
        [{ kind: 'card', name: 'Sol Ring' }, { kind: 'text', text: ': fast mana' }],
        [{ kind: 'card', name: 'Arcane Signet' }, { kind: 'text', text: ' fixes colors' }],
      ],
    })
    expect(blocks[2]).toMatchObject({ ordered: true, items: [[{ text: 'First' }], [{ text: 'Second' }]] })
    expect(blocks[3]).toMatchObject({ head: [[{ text: 'Card' }], [{ text: 'Price' }]], rows: [[[{ kind: 'card' }], [{ text: '$1' }]]] })
    expect(blocks[4]).toEqual({ kind: 'code', text: 'raw text' })
    expect(blocks[6]).toEqual({ kind: 'paragraph', content: [{ kind: 'text', text: 'A paragraph\non two lines.' }] })
  })
})

describe('answer events', () => {
  it('splits server-sent events, keeping an unfinished one', () => {
    expect(splitEvents('data: {"a":1}\n\ndata: {"b"')).toEqual({ data: ['{"a":1}'], rest: 'data: {"b"' })
    expect(splitEvents('event: x\r\ndata: 1\r\n\r\n: comment\n\n')).toEqual({ data: ['1'], rest: '' })
  })

  it('builds the live answer from events', () => {
    let items: ChatItem[] = []
    items = applyChatEvent(items, { type: 'item', item: { kind: 'user', text: 'Hi', deck: null } })
    items = applyChatEvent(items, { type: 'title', title: 'Hi' })
    items = applyChatEvent(items, { type: 'item', item: { kind: 'note', text: '' } })
    items = applyChatEvent(items, { type: 'delta', text: 'Plan' })
    items = applyChatEvent(items, { type: 'item', item: { kind: 'text', text: '' } })
    items = applyChatEvent(items, { type: 'delta', text: 'Hel' })
    items = applyChatEvent(items, { type: 'delta', text: 'lo' })
    items = applyChatEvent(items, {
      type: 'item',
      item: { kind: 'tool', id: 't1', name: 'get_card', activity: 'Looking up Sol Ring', state: 'running', error: null, deck: null },
    })
    items = applyChatEvent(items, { type: 'delta', text: 'ignored' })
    items = applyChatEvent(items, { type: 'tool_done', id: 't1', state: 'failed', error: 'No card', deck: null })
    items = applyChatEvent(items, { type: 'error', message: 'Anthropic had a problem (500); try again shortly', canContinue: true })
    items = applyChatEvent(items, { type: 'done' })
    expect(items).toEqual<ChatItem[]>([
      { kind: 'user', text: 'Hi', deck: null },
      { kind: 'note', text: 'Plan' },
      { kind: 'text', text: 'Hello' },
      { kind: 'tool', id: 't1', name: 'get_card', activity: 'Looking up Sol Ring', state: 'failed', error: 'No card', deck: null },
      { kind: 'notice', tone: 'error', text: 'Anthropic had a problem (500); try again shortly' },
    ])
  })

  it("adds a finished tool's deck to its line, and ignores text right after a tool", () => {
    const deck: CreatedDeck = { id: 7, name: 'Green Stompy', format: 'commander', cardCount: 6, completion: 0.5, costToFinish: 12.5, unresolved: ['Zzyzx Elf Overlord'] }
    const save: ChatItem = { kind: 'tool', id: 't1', name: 'create_prospective_deck', activity: 'Saving Green Stompy', state: 'running', error: null, deck: null }
    const look: ChatItem = { kind: 'tool', id: 't2', name: 'get_card', activity: 'Looking up Sol Ring', state: 'running', error: null, deck: null }
    let items = applyChatEvent([save, look], { type: 'delta', text: 'stray' })
    expect(items).toEqual([save, look])
    items = applyChatEvent(items, { type: 'tool_done', id: 't1', state: 'done', error: null, deck })
    expect(items).toEqual([{ ...save, state: 'done', deck }, look])
    // Only the finished tool's line changes, so the others aren't drawn again.
    expect(items[1]).toBe(look)
  })
})

describe('an answer in this window', () => {
  const stored: ChatItem[] = [
    { kind: 'user', text: 'Hi', deck: null },
    { kind: 'text', text: 'Hello' },
  ]
  const event = (e: Parameters<typeof applyChatEvent>[1]) => ({ type: 'event' as const, event: e })

  it('shows the items stored before it, then the answer so far, even when the conversation is fetched again meanwhile', () => {
    let answer = answerReducer(NO_ANSWER, { type: 'start', stored })
    expect(shownItems(stored, answer)).toEqual(stored)
    answer = answerReducer(answer, event({ type: 'item', item: { kind: 'user', text: 'More?', deck: null } }))
    answer = answerReducer(answer, event({ type: 'item', item: { kind: 'text', text: '' } }))
    answer = answerReducer(answer, event({ type: 'delta', text: 'Sure' }))
    // Fetched again partway (a rename, the end of the answer): the stored conversation already holds the new question.
    const refetched: ChatItem[] = [...stored, { kind: 'user', text: 'More?', deck: null }, { kind: 'text', text: 'Sure' }]
    const shown = shownItems(refetched, answer)
    expect(shown).toEqual([...stored, { kind: 'user', text: 'More?', deck: null }, { kind: 'text', text: 'Sure' }])
    expect(shown[0]).toBe(stored[0])
    answer = answerReducer(answer, { type: 'end' })
    expect(shownItems(refetched, answer)).toBe(refetched)
  })

  it('keeps why an answer failed until the next one starts', () => {
    let answer = answerReducer(NO_ANSWER, { type: 'start', stored })
    answer = answerReducer(answer, event({ type: 'error', message: 'Anthropic refused the API key; check it in Settings', canContinue: true }))
    answer = answerReducer(answer, event({ type: 'done' }))
    answer = answerReducer(answer, { type: 'end' })
    expect(answer).toEqual({ live: null, before: [], lastError: 'Anthropic refused the API key; check it in Settings', ended: false, writing: false })
    expect(answerReducer(answer, { type: 'start', stored })).toEqual({ live: [], before: stored, lastError: null, ended: false, writing: false })
    expect(asSentence('Anthropic refused the API key; check it in Settings')).toBe('Anthropic refused the API key; check it in Settings.')
    expect(asSentence('Stopped.')).toBe('Stopped.')
  })

  it('shows Claude is thinking before its first word, after each round of tools, and after a retry or a fallback', () => {
    const user: ChatItem = { kind: 'user', text: 'Hi', deck: null }
    const tool = (id: string, state: 'running' | 'done' | 'failed'): ChatItem => ({
      kind: 'tool',
      id,
      name: 'get_card',
      activity: 'Looking up Sol Ring',
      state,
      error: null,
      deck: null,
    })
    const retried: ChatItem = { kind: 'notice', tone: 'info', text: "Claude's last message came through garbled, so Binder asked again." }
    const fallback: ChatItem = { kind: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' }
    const running = (live: ChatItem[] | null) => awaitingClaude({ live, ended: false })
    expect(running(null)).toBe(false)
    expect(running([])).toBe(true)
    expect(running([user])).toBe(true)
    expect(running([user, { kind: 'note', text: 'Plan' }])).toBe(false)
    expect(running([user, { kind: 'text', text: '' }])).toBe(false)
    expect(running([user, tool('a', 'running')])).toBe(false)
    expect(running([user, tool('a', 'running'), tool('b', 'done')])).toBe(false)
    expect(running([user, tool('a', 'failed'), tool('b', 'done')])).toBe(true)
    // More is coming after a retry notice or a fallback line.
    expect(running([user, { kind: 'text', text: 'Hm' }, retried])).toBe(true)
    expect(running([user, { kind: 'text', text: 'Hm' }, fallback])).toBe(true)
    // Once the server says the answer is over, a closing notice (Stopped., an error) is the end, even before the
    // conversation is fetched again.
    const stopped: ChatItem[] = [user, { kind: 'text', text: 'Hm' }, { kind: 'notice', tone: 'info', text: 'Stopped.' }]
    expect(awaitingClaude({ live: stopped, ended: true })).toBe(false)
    let answer = answerReducer(NO_ANSWER, { type: 'start', stored: [] })
    answer = answerReducer(answer, event({ type: 'item', item: user }))
    answer = answerReducer(answer, event({ type: 'error', message: 'Anthropic had a problem (500); try again shortly', canContinue: true }))
    expect(awaitingClaude(answer)).toBe(true)
    answer = answerReducer(answer, event({ type: 'done' }))
    expect(answer.ended).toBe(true)
    expect(awaitingClaude(answer)).toBe(false)
  })

  it('shows Claude is at work while it writes a tool call, until the call appears or the answer ends', () => {
    const user: ChatItem = { kind: 'user', text: 'Save it', deck: null }
    let answer = answerReducer(NO_ANSWER, { type: 'start', stored: [] })
    answer = answerReducer(answer, event({ type: 'item', item: user }))
    answer = answerReducer(answer, event({ type: 'item', item: { kind: 'text', text: '' } }))
    answer = answerReducer(answer, event({ type: 'delta', text: 'Saving it now.' }))
    expect(awaitingClaude(answer)).toBe(false)
    answer = answerReducer(answer, event({ type: 'working' }))
    expect([answer.writing, awaitingClaude(answer)]).toEqual([true, true])
    expect(answer.live).toEqual([user, { kind: 'text', text: 'Saving it now.' }])
    const tool: ChatItem = { kind: 'tool', id: 't', name: 'create_prospective_deck', activity: 'Saving Elves', state: 'running', error: null, deck: null }
    answer = answerReducer(answer, event({ type: 'item', item: tool }))
    expect([answer.writing, awaitingClaude(answer)]).toEqual([false, false])
    // Stopped or failed while writing: the answer is over.
    answer = answerReducer(answer, event({ type: 'working' }))
    answer = answerReducer(answer, event({ type: 'error', message: 'Anthropic had a problem (500); try again shortly', canContinue: true }))
    expect(answer.writing).toBe(false)
    answer = answerReducer(answer, event({ type: 'working' }))
    answer = answerReducer(answer, event({ type: 'done' }))
    expect([answer.writing, awaitingClaude(answer)]).toEqual([false, false])
  })
})

describe('deleting a conversation', () => {
  it('leaves it at once, never asks for it again, and forgets it once nothing shows it', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })
    let threadFetches = 0
    let listFetches = 0
    const thread = {
      queryKey: ['thread', 7],
      queryFn: () => {
        threadFetches++
        return Promise.resolve({ id: 7 })
      },
    }
    const list = {
      queryKey: ['threads'],
      queryFn: () => {
        listFetches++
        return new Promise<never>(() => {})
      },
    }
    queryClient.setQueryData(['thread', 7], { id: 7 })
    queryClient.setQueryData(['threads'], [{ id: 7 }])
    // The open conversation's view, and the list beside it.
    const view = new QueryObserver(queryClient, thread)
    const unmountView = view.subscribe(() => {})
    const unmountList = new QueryObserver(queryClient, list).subscribe(() => {})
    const whenLeaving: Array<{ shown: unknown; listFetches: number }> = []
    leaveDeletedThread(queryClient, 7, () =>
      whenLeaving.push({ shown: view.getOptimisticResult(queryClient.defaultQueryOptions(thread)).data, listFetches }),
    )
    // It leaves at once, before the list is fetched again (which it starts, without waiting for it).
    expect(whenLeaving).toEqual([{ shown: { id: 7 }, listFetches: 0 }])
    expect(listFetches).toBe(1)
    // The view can render again before the page changes (React may render the delete's own update first): it still
    // shows the conversation, and nothing fetches it (no Loading…, no 404).
    expect(view.getOptimisticResult(queryClient.defaultQueryOptions(thread)).data).toEqual({ id: 7 })
    view.setOptions(thread)
    expect(threadFetches).toBe(0)
    // Once the view is gone, so is the conversation.
    unmountView()
    expect(queryClient.getQueryCache().find({ queryKey: ['thread', 7] })).toBeUndefined()
    expect(threadFetches).toBe(0)
    unmountList()
    queryClient.clear()
  })
})
