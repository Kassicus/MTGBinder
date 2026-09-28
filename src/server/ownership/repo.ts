import { freeCopies } from '../../shared/ownership.ts'
import type { DeckRef, DeckStatus, Ownership } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'

/** Owned count, free count, and containing decks for each card identity (every id gets an entry, zeros if unowned). */
export function getOwnership(db: DB, oracleIds: readonly string[]): Map<string, Ownership> {
  const unique = [...new Set(oracleIds)]
  const result = new Map<string, Ownership>(unique.map((id) => [id, { owned: 0, free: 0, decks: [] }]))
  if (unique.length === 0) return result
  const ids = JSON.stringify(unique)
  const owned = db
    .prepare(
      `SELECT c.oracle_id, SUM(co.quantity) AS owned FROM collection co JOIN cards c ON c.id = co.card_id
       WHERE c.oracle_id IN (SELECT value FROM json_each(?)) GROUP BY c.oracle_id`,
    )
    .all(ids) as Array<{ oracle_id: string; owned: number }>
  const decks = db
    .prepare(
      `SELECT dc.oracle_id, d.id, d.name, d.status,
         SUM(CASE WHEN dc.board != 'maybe' THEN dc.quantity ELSE 0 END) AS quantity,
         SUM(CASE WHEN dc.board = 'maybe' THEN dc.quantity ELSE 0 END) AS maybe
       FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
       WHERE dc.oracle_id IN (SELECT value FROM json_each(?))
       GROUP BY dc.oracle_id, d.id ORDER BY d.name COLLATE NOCASE, d.id`,
    )
    .all(ids) as Array<{ oracle_id: string; id: number; name: string; status: DeckStatus; quantity: number; maybe: number }>
  for (const row of owned) {
    const entry = result.get(row.oracle_id)
    if (entry) entry.owned = row.owned
  }
  for (const row of decks) {
    const deck: DeckRef = { id: row.id, name: row.name, status: row.status, quantity: row.quantity, maybe: row.maybe }
    result.get(row.oracle_id)?.decks.push(deck)
  }
  for (const entry of result.values()) entry.free = freeCopies(entry.owned, entry.decks)
  return result
}
