import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { invalidateCollection } from '../../src/web/lib/collection.ts'

const KEYS = [
  ['card', 'c-1'],
  ['search', '/api/search/scryfall?q=bolt'],
  ['search', '/api/search/library?q=bolt'],
  ['collection', 'stats'],
  ['decks'],
  ['deck', 1],
  ['settings'],
]

/** The keys a call to invalidateCollection marks for refetching, on a client holding one query per key. */
function invalidatedBy(options?: { keepScryfallSearches?: boolean }): string[] {
  const client = new QueryClient()
  for (const key of KEYS) client.setQueryData(key, 'cached')
  invalidateCollection(client, options)
  return KEYS.filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => key.join(' '))
}

describe('invalidateCollection', () => {
  it('refetches card details, every search, library stats, and decks', () => {
    expect(invalidatedBy()).toEqual(['card c-1', 'search /api/search/scryfall?q=bolt', 'search /api/search/library?q=bolt', 'collection stats', 'decks', 'deck 1'])
  })

  it("leaves Scryfall searches alone for a deck change, so a click doesn't query Scryfall again", () => {
    expect(invalidatedBy({ keepScryfallSearches: true })).toEqual(['card c-1', 'search /api/search/library?q=bolt', 'collection stats', 'decks', 'deck 1'])
  })
})
