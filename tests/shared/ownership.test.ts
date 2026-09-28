import { describe, expect, it } from 'vitest'
import { deckNeed } from '../../src/shared/ownership.ts'

// Spec §4.3: available = free + n for a built deck, free for a prospective one; short = max(0, n − max(0, available)).
describe('deckNeed', () => {
  it('owned: enough free copies for a prospective deck', () => {
    expect(deckNeed({ owned: 4, free: 4, n: 4, built: false })).toEqual({ available: 4, short: 0, status: 'owned', inOtherBuiltDecks: 0 })
  })

  it('a built deck counts its own copies toward itself', () => {
    // Own 4, this built deck uses 4 (so free is 0): nothing is short.
    expect(deckNeed({ owned: 4, free: 0, n: 4, built: true })).toEqual({ available: 4, short: 0, status: 'owned', inOtherBuiltDecks: 0 })
  })

  it('in_other_deck: the copies exist but other built decks hold them', () => {
    // Own 4, another built deck uses 3: a prospective deck wanting 2 is 1 short.
    expect(deckNeed({ owned: 4, free: 1, n: 2, built: false })).toEqual({ available: 1, short: 1, status: 'in_other_deck', inOtherBuiltDecks: 3 })
  })

  it('buy: not enough copies at all', () => {
    expect(deckNeed({ owned: 1, free: 1, n: 4, built: false })).toEqual({ available: 1, short: 3, status: 'buy', inOtherBuiltDecks: 0 })
    expect(deckNeed({ owned: 0, free: 0, n: 1, built: false }).status).toBe('buy')
  })

  it('treats over-claimed (negative) free copies as none available', () => {
    // Own 2; two built decks (this one using 2, another using 3) claim 5, so free is −3.
    expect(deckNeed({ owned: 2, free: -3, n: 2, built: true })).toEqual({ available: -1, short: 2, status: 'in_other_deck', inOtherBuiltDecks: 3 })
    expect(deckNeed({ owned: 2, free: -3, n: 4, built: false }).status).toBe('buy')
  })
})
