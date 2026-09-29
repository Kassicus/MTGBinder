import { describe, expect, it } from 'vitest'
import { CARD_DATA_QUERIES } from '../../src/web/lib/use-bulk-status.ts'

describe('after a card-data refresh', () => {
  it('refetches the Sets pages, whose totals follow the card data, with lookups, searches, and decks', () => {
    expect(CARD_DATA_QUERIES).toEqual(['autocomplete', 'card', 'search', 'collection', 'catalog', 'sets', 'decks', 'deck', 'library-size'])
  })
})
