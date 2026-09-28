import type { DeckRef, LineStatus, Ownership } from './types.ts'

/** Copies not committed to built decks (spec §4.3). Negative when built decks claim more copies than you own. */
export function freeCopies(owned: number, decks: readonly DeckRef[]): number {
  return owned - decks.filter((d) => d.status === 'built').reduce((sum, d) => sum + d.quantity, 0)
}

export const NO_OWNERSHIP: Ownership = { owned: 0, free: 0, decks: [] }

export interface DeckNeedInput {
  /** Copies owned across every printing and finish. */
  owned: number
  /** Owned copies not in built decks (from freeCopies; may be negative). */
  free: number
  /** Copies this deck uses, summed over every board but maybe; for a maybe line, that line's quantity. */
  n: number
  /** The deck is built, so its own `n` copies are already part of the built-deck allocation. False for maybe lines. */
  built: boolean
}

export interface DeckNeed {
  /** Copies this deck can use: free copies, plus its own allocation when built. */
  available: number
  /** Copies missing: max(0, n − max(0, available)). */
  short: number
  status: LineStatus
  /** Copies other built decks hold (the "Y" in "own X, Y in other built decks"). */
  inOtherBuiltDecks: number
}

/**
 * A card identity's standing in one deck (spec §4.3). A built deck's own copies count toward itself. The status is
 * `owned` when nothing is short, `in_other_deck` when enough copies exist but other built decks hold them, and `buy`
 * when there aren't enough copies at all.
 */
export function deckNeed({ owned, free, n, built }: DeckNeedInput): DeckNeed {
  const available = built ? free + n : free
  const short = Math.max(0, n - Math.max(0, available))
  const status: LineStatus = short === 0 ? 'owned' : owned >= n ? 'in_other_deck' : 'buy'
  return { available, short, status, inOtherBuiltDecks: owned - free - (built ? n : 0) }
}
