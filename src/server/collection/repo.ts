import { finishPrice } from '../../shared/prices.ts'
import type { CollectionStats, Copy, Finish, ImportItem, ImportResult } from '../../shared/types.ts'
import { parsePrices } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { COPY_PRICE_SQL, finishOrderSql } from './sql.ts'

interface CopyRow {
  card_id: string
  set_code: string
  set_name: string
  collector_number: string
  finish: Finish
  quantity: number
  prices: string
  added_at: string
}

/** Every owned copy of a card identity, one entry per printing and finish, newest printing first. */
export function getCopies(db: DB, oracleId: string): Copy[] {
  const rows = db
    .prepare(
      `SELECT co.card_id, c.set_code, c.set_name, c.collector_number, co.finish, co.quantity, c.prices, co.added_at
       FROM cards c JOIN collection co ON co.card_id = c.id
       WHERE c.oracle_id = ?
       ORDER BY c.released_at DESC, c.set_code, c.collector_number, ${finishOrderSql('co.finish')}`,
    )
    .all(oracleId) as CopyRow[]
  return rows.map((r) => ({
    cardId: r.card_id,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    finish: r.finish,
    quantity: r.quantity,
    priceUsd: finishPrice(parsePrices(r.prices), r.finish),
    addedAt: r.added_at,
  }))
}

/**
 * Adds copies of one printing in one finish (positive delta) or removes them (negative). Removing more than are owned
 * removes them all. Returns how many are left. The caller checks that the card exists and comes in that finish.
 * A row's `added_at` is the last time copies were added to it (what "date added" sorts by); removing leaves it alone.
 */
export function adjustCopies(db: DB, cardId: string, finish: Finish, delta: number, now = new Date()): number {
  return db.transaction(() => {
    const current =
      (db.prepare('SELECT quantity FROM collection WHERE card_id = ? AND finish = ?').pluck().get(cardId, finish) as
        | number
        | undefined) ?? 0
    const next = Math.max(0, current + delta)
    const at = now.toISOString()
    if (next === 0) {
      db.prepare('DELETE FROM collection WHERE card_id = ? AND finish = ?').run(cardId, finish)
    } else if (current === 0) {
      db.prepare(
        'INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(cardId, finish, next, at, at)
    } else {
      db.prepare(
        `UPDATE collection SET quantity = @next, updated_at = @at, added_at = CASE WHEN @delta > 0 THEN @at ELSE added_at END
         WHERE card_id = @cardId AND finish = @finish`,
      ).run({ next, at, delta, cardId, finish })
    }
    return next
  })()
}

/** Totals for the library header (spec §5.3). */
export function collectionStats(db: DB): CollectionStats {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(co.quantity), 0) AS total,
         COUNT(DISTINCT c.oracle_id) AS unique_cards,
         COALESCE(SUM(co.quantity * CAST(round(${COPY_PRICE_SQL} * 100) AS INTEGER)), 0) AS value_cents,
         COALESCE(SUM(CASE WHEN ${COPY_PRICE_SQL} IS NULL THEN co.quantity ELSE 0 END), 0) AS unpriced,
         MAX(co.added_at) AS last_added
       FROM collection co CROSS JOIN cards c ON c.id = co.card_id`,
    )
    .get() as { total: number; unique_cards: number; value_cents: number; unpriced: number; last_added: string | null }
  return {
    totalCards: row.total,
    uniqueCards: row.unique_cards,
    valueUsd: row.value_cents / 100,
    unpricedCards: row.unpriced,
    lastAddedAt: row.last_added,
  }
}

/**
 * Adds every item's copies in one transaction (all or nothing). Items for the same printing and finish add up, and
 * every row they touch counts as added now. The caller checks that each card exists and comes in its finish.
 */
export function addCopies(db: DB, items: readonly ImportItem[], now = new Date()): ImportResult {
  const at = now.toISOString()
  const upsert = db.prepare(
    `INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (@cardId, @finish, @quantity, @at, @at)
     ON CONFLICT (card_id, finish) DO UPDATE
       SET quantity = quantity + excluded.quantity, added_at = excluded.added_at, updated_at = excluded.updated_at`,
  )
  return db.transaction(() => {
    const rows = new Set<string>()
    let copies = 0
    for (const item of items) {
      upsert.run({ ...item, at })
      rows.add(`${item.cardId}/${item.finish}`)
      copies += item.quantity
    }
    return { rows: rows.size, copies }
  })()
}

export interface ExportRow {
  quantity: number
  name: string
  setCode: string
  collectorNumber: string
  finish: Finish
}

/** Every collection row for export, by name, then set, number, and finish. */
export function exportRows(db: DB): ExportRow[] {
  return db
    .prepare(
      `SELECT co.quantity AS quantity, c.name AS name, c.set_code AS setCode, c.collector_number AS collectorNumber,
         co.finish AS finish
       FROM collection co CROSS JOIN cards c ON c.id = co.card_id
       ORDER BY c.name COLLATE NOCASE, c.set_code, CAST(c.collector_number AS INTEGER), c.collector_number,
         ${finishOrderSql('co.finish')}`,
    )
    .all() as ExportRow[]
}
