import type { Board, DeckImportItem, DeckStatus, FormatId } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'

export interface DeckRow {
  id: number
  name: string
  format: FormatId
  status: DeckStatus
  notes: string
  created_at: string
  updated_at: string
}

/** The longest deck name, and the most copies one deck line holds. */
export const MAX_DECK_NAME = 100
export const MAX_LINE_QUANTITY = 999

/**
 * The name a line shows when its card is no longer in the card data (Scryfall re-keyed it): the line stays, so it can
 * be removed, and still counts toward the deck's size. Its `card_id` is ''.
 */
export const MISSING_CARD_NAME = 'A card no longer in the card data'

/** A deck line joined to the printing it shows (the chosen printing, else the card's default). */
export interface LineRow {
  id: number
  deck_id: number
  oracle_id: string
  preferred_card_id: string | null
  quantity: number
  board: Board
  category: string | null
  card_id: string
  name: string
  mana_cost: string
  type_line: string
  oracle_text: string
  cmc: number
  color_identity: string
  keywords: string
  legalities: string
  image_small: string | null
  image_normal: string | null
  set_code: string
  collector_number: string
  /** Scryfall layout of the printing shown (normal, split, aftermath, adventure, transform, ...). */
  layout: string
  /** The printing's face names, one per line (just the name for a single-faced card). */
  face_names: string
}

export interface DeckFields {
  name: string
  format: FormatId
  status: DeckStatus
  notes: string
}

/** Every deck, by name. */
export function listDeckRows(db: DB): DeckRow[] {
  return db.prepare('SELECT * FROM decks ORDER BY name COLLATE NOCASE, id').all() as DeckRow[]
}

export function getDeckRow(db: DB, id: number): DeckRow | null {
  return (db.prepare('SELECT * FROM decks WHERE id = ?').get(id) as DeckRow | undefined) ?? null
}

// A line whose card is gone from the card data gets placeholders (see MISSING_CARD_NAME, bound as @missing) rather
// than dropping out.
const LINE_SELECT = `
  SELECT dc.id, dc.deck_id, dc.oracle_id, dc.preferred_card_id, dc.quantity, dc.board, dc.category,
    COALESCE(c.id, '') AS card_id, COALESCE(c.name, @missing) AS name, COALESCE(c.mana_cost, '') AS mana_cost,
    COALESCE(c.type_line, '') AS type_line, COALESCE(c.oracle_text, '') AS oracle_text, COALESCE(c.cmc, 0) AS cmc,
    COALESCE(c.color_identity, '') AS color_identity, COALESCE(c.keywords, '[]') AS keywords,
    COALESCE(c.legalities, '{}') AS legalities, c.image_small, c.image_normal, COALESCE(c.set_code, '') AS set_code,
    COALESCE(c.collector_number, '') AS collector_number, COALESCE(c.layout, 'normal') AS layout,
    COALESCE(c.face_names, '') AS face_names
  FROM deck_cards dc
  LEFT JOIN card_names n ON n.oracle_id = dc.oracle_id
  LEFT JOIN cards c ON c.id = COALESCE(dc.preferred_card_id, n.default_card_id)`

/** A deck's lines (or every deck's, with no id), each with the printing it shows. */
export function getLineRows(db: DB, deckId?: number): LineRow[] {
  const missing = MISSING_CARD_NAME
  return (
    deckId === undefined
      ? db.prepare(LINE_SELECT).all({ missing })
      : db.prepare(`${LINE_SELECT} WHERE dc.deck_id = @deckId ORDER BY name COLLATE NOCASE, dc.board`).all({ missing, deckId })
  ) as LineRow[]
}

export function createDeck(db: DB, fields: DeckFields, now = new Date()): number {
  const at = now.toISOString()
  return Number(
    db
      .prepare('INSERT INTO decks (name, format, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(fields.name, fields.format, fields.status, fields.notes, at, at).lastInsertRowid,
  )
}

/** Changes a deck's fields; returns false when there is no such deck. */
export function updateDeck(db: DB, id: number, patch: Partial<DeckFields>, now = new Date()): boolean {
  const current = getDeckRow(db, id)
  if (!current) return false
  const next = { ...current, ...patch }
  db.prepare('UPDATE decks SET name = ?, format = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
    next.name,
    next.format,
    next.status,
    next.notes,
    now.toISOString(),
    id,
  )
  return true
}

/** Deletes a deck and its lines; returns false when there is no such deck. */
export function deleteDeck(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM decks WHERE id = ?').run(id).changes > 0
}

/** "<name> (copy)", shortening a long name so the copy's stays within MAX_DECK_NAME. */
export function copyName(name: string): string {
  const suffix = ' (copy)'
  return `${name.slice(0, MAX_DECK_NAME - suffix.length).trimEnd()}${suffix}`
}

/**
 * Copies a deck and its lines as a new prospective deck named "<name> (copy)", so the copy never claims owned cards
 * twice. Returns the new id, or null when there is no such deck.
 */
export function duplicateDeck(db: DB, id: number, now = new Date()): number | null {
  const deck = getDeckRow(db, id)
  if (!deck) return null
  return db.transaction(() => {
    const copy = createDeck(db, { name: copyName(deck.name), format: deck.format, status: 'prospective', notes: deck.notes }, now)
    db.prepare(
      `INSERT INTO deck_cards (deck_id, oracle_id, preferred_card_id, quantity, board, category)
       SELECT ?, oracle_id, preferred_card_id, quantity, board, category FROM deck_cards WHERE deck_id = ?`,
    ).run(copy, id)
    return copy
  })()
}

const touch = (db: DB, deckId: number, now: Date) =>
  db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(now.toISOString(), deckId)

/** The printing to store as a line's choice: null when it's the card's default printing (so it follows the default). */
function preferredFor(db: DB, oracleId: string, cardId: string | null): string | null {
  if (cardId === null) return null
  const defaultId = db.prepare('SELECT default_card_id FROM card_names WHERE oracle_id = ?').pluck().get(oracleId)
  return cardId === defaultId ? null : cardId
}

/**
 * Adds copies of a card to a deck board (negative delta removes them; reaching 0 removes the line), up to
 * MAX_LINE_QUANTITY. A new line remembers the printing it was added from. Returns the line's quantity afterwards.
 * Removing copies the deck hasn't got changes nothing.
 */
export function addToDeck(db: DB, deckId: number, cardId: string, board: Board, delta: number, now = new Date()): number {
  return db.transaction(() => {
    const oracleId = db.prepare('SELECT oracle_id FROM cards WHERE id = ?').pluck().get(cardId) as string
    const line = db
      .prepare('SELECT id, quantity FROM deck_cards WHERE deck_id = ? AND oracle_id = ? AND board = ?')
      .get(deckId, oracleId, board) as { id: number; quantity: number } | undefined
    const next = Math.min(MAX_LINE_QUANTITY, Math.max(0, (line?.quantity ?? 0) + delta))
    if (!line && next === 0) return 0
    if (!line) {
      db.prepare('INSERT INTO deck_cards (deck_id, oracle_id, preferred_card_id, quantity, board) VALUES (?, ?, ?, ?, ?)').run(
        deckId,
        oracleId,
        preferredFor(db, oracleId, cardId),
        next,
        board,
      )
    } else if (next === 0) {
      db.prepare('DELETE FROM deck_cards WHERE id = ?').run(line.id)
    } else {
      db.prepare('UPDATE deck_cards SET quantity = ? WHERE id = ?').run(next, line.id)
    }
    touch(db, deckId, now)
    return next
  })()
}

export interface LinePatch {
  quantity?: number
  board?: Board
  category?: string | null
  /** A printing of the line's card, or null for the default printing. */
  preferredCardId?: string | null
}

export type LineUpdate = 'updated' | 'no_line' | 'wrong_card'

/**
 * Changes one line. Moving it to a board that already holds the card merges the two lines (up to MAX_LINE_QUANTITY
 * copies). A preferred printing must be a printing of the same card.
 */
export function updateLine(db: DB, deckId: number, lineId: number, patch: LinePatch, now = new Date()): LineUpdate {
  return db.transaction((): LineUpdate => {
    const line = db
      .prepare('SELECT id, oracle_id, quantity, board FROM deck_cards WHERE id = ? AND deck_id = ?')
      .get(lineId, deckId) as { id: number; oracle_id: string; quantity: number; board: Board } | undefined
    if (!line) return 'no_line'
    if (patch.preferredCardId !== undefined && patch.preferredCardId !== null) {
      const oracle = db.prepare('SELECT oracle_id FROM cards WHERE id = ?').pluck().get(patch.preferredCardId)
      if (oracle !== line.oracle_id) return 'wrong_card'
    }
    if (patch.quantity !== undefined) db.prepare('UPDATE deck_cards SET quantity = ? WHERE id = ?').run(patch.quantity, line.id)
    if (patch.category !== undefined) {
      const category = patch.category?.trim() || null
      db.prepare('UPDATE deck_cards SET category = ? WHERE id = ?').run(category, line.id)
    }
    if (patch.preferredCardId !== undefined) {
      db.prepare('UPDATE deck_cards SET preferred_card_id = ? WHERE id = ?').run(
        preferredFor(db, line.oracle_id, patch.preferredCardId),
        line.id,
      )
    }
    if (patch.board !== undefined && patch.board !== line.board) {
      const target = db
        .prepare('SELECT id FROM deck_cards WHERE deck_id = ? AND oracle_id = ? AND board = ?')
        .get(deckId, line.oracle_id, patch.board) as { id: number } | undefined
      if (target) {
        const quantity = db.prepare('SELECT quantity FROM deck_cards WHERE id = ?').pluck().get(line.id) as number
        db.prepare(`UPDATE deck_cards SET quantity = MIN(${MAX_LINE_QUANTITY}, quantity + ?) WHERE id = ?`).run(quantity, target.id)
        db.prepare('DELETE FROM deck_cards WHERE id = ?').run(line.id)
      } else {
        db.prepare('UPDATE deck_cards SET board = ? WHERE id = ?').run(patch.board, line.id)
      }
    }
    touch(db, deckId, now)
    return 'updated'
  })()
}

/** Removes one line; returns false when the deck has no such line. */
export function removeLine(db: DB, deckId: number, lineId: number, now = new Date()): boolean {
  const removed = db.prepare('DELETE FROM deck_cards WHERE id = ? AND deck_id = ?').run(lineId, deckId).changes > 0
  if (removed) touch(db, deckId, now)
  return removed
}

/**
 * Adds decklist lines to a deck in one transaction, optionally replacing everything already there. Items for the
 * same card and board add up. An item's category (trimmed) is set on its line; a blank or missing one leaves the
 * line's category as it is. The caller checks that every card exists. Returns the lines and copies written.
 */
export function importIntoDeck(
  db: DB,
  deckId: number,
  items: readonly DeckImportItem[],
  replace: boolean,
  now = new Date(),
): { lines: number; copies: number } {
  const upsert = db.prepare(
    `INSERT INTO deck_cards (deck_id, oracle_id, preferred_card_id, quantity, board, category)
     VALUES (@deckId, @oracleId, @preferred, @quantity, @board, @category)
     ON CONFLICT (deck_id, oracle_id, board) DO UPDATE SET quantity = MIN(${MAX_LINE_QUANTITY}, quantity + excluded.quantity),
       preferred_card_id = COALESCE(excluded.preferred_card_id, preferred_card_id),
       category = COALESCE(excluded.category, category)`,
  )
  return db.transaction(() => {
    if (replace) db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deckId)
    const lines = new Set<string>()
    let copies = 0
    for (const item of items) {
      upsert.run({
        deckId,
        oracleId: item.oracleId,
        preferred: preferredFor(db, item.oracleId, item.cardId),
        quantity: item.quantity,
        board: item.board,
        category: item.category?.trim() || null,
      })
      lines.add(`${item.oracleId}/${item.board}`)
      copies += item.quantity
    }
    touch(db, deckId, now)
    return { lines: lines.size, copies }
  })()
}
