import type { DB } from '../../src/server/db/index.ts'
import type { DeckStatus, Finish } from '../../src/shared/types.ts'
import { fixtureCard } from './fixtures.ts'

/** Adds copies of a fixture printing to the collection. */
export function own(db: DB, name: string, set: string | undefined, quantity: number, finish: Finish = 'nonfoil', addedAt = '2026-01-01T00:00:00.000Z'): void {
  const card = fixtureCard(name, set)
  db.prepare(
    `INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (card_id, finish) DO UPDATE SET quantity = quantity + excluded.quantity`,
  ).run(card.id, finish, quantity, addedAt, addedAt)
}

/** Creates a deck and returns its id. */
export function deck(db: DB, name: string, status: DeckStatus, format = 'commander'): number {
  return Number(
    db
      .prepare("INSERT INTO decks (name, format, status, created_at, updated_at) VALUES (?, ?, ?, 't', 't')")
      .run(name, format, status).lastInsertRowid,
  )
}

/** Puts copies of a fixture card (by name) into a deck board. */
export function inDeck(db: DB, deckId: number, name: string, quantity: number, board: 'commander' | 'main' | 'side' | 'maybe' = 'main'): void {
  const card = fixtureCard(name)
  db.prepare('INSERT INTO deck_cards (deck_id, oracle_id, quantity, board) VALUES (?, ?, ?, ?)').run(deckId, card.oracle_id, quantity, board)
}
