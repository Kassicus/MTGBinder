import { describe, expect, it } from 'vitest'
import { finderList, type FinderState } from '../../src/web/lib/finder-list.ts'

const idle: FinderState<string> = { typed: '', query: '', data: undefined, isFetching: false, isPlaceholderData: false, error: null }
const list = (state: Partial<FinderState<string>>) => finderList({ ...idle, ...state })

describe('finder list', () => {
  it('stays hidden until there is a query', () => {
    expect(list({})).toMatchObject({ results: [], show: false, announcement: '' })
    // Typed, but the debounce hasn't produced a query yet.
    expect(list({ typed: 'bolt' })).toMatchObject({ results: [], show: false, announcement: '' })
  })

  it('shows nothing while the first lookup loads, so "No matches" never flashes before any result', () => {
    expect(list({ typed: 'bolt', query: 'bolt', isFetching: true })).toEqual({
      results: [], selectable: true, show: false, dimmed: false, announcement: '',
    })
  })

  it('lists settled results and announces how many', () => {
    expect(list({ typed: 'bolt', query: 'bolt', data: ['Lightning Bolt', 'Boltwing Marauder'] })).toEqual({
      results: ['Lightning Bolt', 'Boltwing Marauder'], selectable: true, show: true, dimmed: false, announcement: '2 matches',
    })
  })

  it('shows and announces "No matches" once a lookup settles empty', () => {
    expect(list({ typed: 'xyzq', query: 'xyzq', data: [] })).toEqual({
      results: [], selectable: true, show: true, dimmed: false, announcement: 'No matches',
    })
  })

  it('keeps "No matches" up, dimmed and unannounced, while typing on from an empty result', () => {
    const pending = { results: [], selectable: false, show: true, dimmed: true, announcement: '' }
    // Waiting out the debounce: the results are still for the previous query.
    expect(list({ typed: 'xyzqa', query: 'xyzq', data: [] })).toEqual(pending)
    // Fetching the new query, with the previous (empty) result as placeholder.
    expect(list({ typed: 'xyzqa', query: 'xyzqa', data: [], isPlaceholderData: true, isFetching: true })).toEqual(pending)
    // Refetching a cached empty result for exactly what's typed.
    expect(list({ typed: 'xyzqa', query: 'xyzqa', data: [], isFetching: true })).toMatchObject({ show: true, dimmed: true, announcement: '' })
    // Settled again.
    expect(list({ typed: 'xyzqa', query: 'xyzqa', data: [] })).toMatchObject({ show: true, dimmed: false, announcement: 'No matches' })
  })

  it("keeps the previous query's cards on screen, but not selectable, while a new query loads", () => {
    const stale = { results: ['Lightning Bolt'], selectable: false, show: true, dimmed: false, announcement: '' }
    expect(list({ typed: 'bolts', query: 'bolt', data: ['Lightning Bolt'] })).toEqual(stale)
    expect(list({ typed: 'bolts', query: 'bolts', data: ['Lightning Bolt'], isPlaceholderData: true, isFetching: true })).toEqual(stale)
  })

  it('shows and announces an error instead of results', () => {
    expect(list({ typed: 'bolt', query: 'bolt', error: new Error('Card data is missing') })).toEqual({
      results: [], selectable: false, show: true, dimmed: false, announcement: 'Card data is missing',
    })
  })

  it('drops a lingering "No matches" as soon as the field is cleared', () => {
    expect(list({ typed: '', query: 'xyzq', data: [] })).toMatchObject({ show: false, dimmed: false, announcement: '' })
  })
})
