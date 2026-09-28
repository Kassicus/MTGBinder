import { Hono } from 'hono'
import { z } from 'zod'
import { toArena, toMtgo, type ExportLine } from '../../shared/decklist.ts'
import { FORMAT_IDS } from '../../shared/formats.ts'
import type { FormatId } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'
import { ApiError, parseWith, PathId, pathId, readJson } from '../http.ts'
import { deckDetail, deckSummaries, deckSummary } from './analysis.ts'
import { DecklistTooLongError, MAX_IMPORT_LINES, previewDeckImport } from './import.ts'
import {
  addToDeck,
  createDeck,
  deleteDeck,
  duplicateDeck,
  getDeckRow,
  getLineRows,
  importIntoDeck,
  MAX_DECK_NAME,
  MAX_LINE_QUANTITY,
  removeLine,
  updateDeck,
  updateLine,
  type LineRow,
} from './repo.ts'

const FormatSchema = z.enum(FORMAT_IDS as [FormatId, ...FormatId[]])
const StatusSchema = z.enum(['prospective', 'built'])
const BoardSchema = z.enum(['commander', 'main', 'side', 'maybe'])
const Name = z.string().trim().min(1).max(MAX_DECK_NAME)
const CardId = z.string().min(1).max(100)

const CreateBody = z.object({
  name: Name,
  format: FormatSchema,
  status: StatusSchema.default('prospective'),
  notes: z.string().max(5000).default(''),
})
const UpdateBody = z.object({
  name: Name.optional(),
  format: FormatSchema.optional(),
  status: StatusSchema.optional(),
  notes: z.string().max(5000).optional(),
})
const AddBody = z.object({
  cardId: CardId,
  board: BoardSchema.default('main'),
  delta: z.number().int().min(-1000).max(1000).refine((n) => n !== 0, 'must not be 0').default(1),
})
const LineBody = z.object({
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).optional(),
  board: BoardSchema.optional(),
  category: z.string().max(60).nullable().optional(),
  preferredCardId: CardId.nullable().optional(),
})
const PreviewBody = z.object({ text: z.string().max(200_000) })
const ImportBody = z.object({
  items: z
    .array(z.object({ oracleId: CardId, cardId: CardId.nullable(), quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY), board: BoardSchema }))
    .max(MAX_IMPORT_LINES),
  replace: z.boolean().default(false),
})
const ExportQuery = z.object({ format: z.enum(['arena', 'mtgo']).default('arena') })

const deckId = (param: string) => pathId(param, 'Deck not found')

function requireDeck(db: DB, id: number): void {
  if (!getDeckRow(db, id)) throw new ApiError(404, 'not_found', 'Deck not found')
}

/**
 * The name Arena and MTGO list a card by: the full "A // B" name for split and aftermath cards ("Fire // Ice"), and
 * the front face for every other multi-face card (adventure, modal double-faced, transform, flip, reversible).
 */
function exportName(row: LineRow): string {
  if (row.layout === 'split' || row.layout === 'aftermath') return row.name
  return row.face_names.split('\n')[0] || row.name
}

export function deckRoutes(deps: { db: DB }): Hono {
  const routes = new Hono()
  const { db } = deps

  routes.get('/', (c) => c.json(deckSummaries(db)))

  routes.post('/', async (c) => {
    const fields = parseWith(CreateBody, await readJson(c.req))
    return c.json(deckSummary(db, createDeck(db, fields)), 201)
  })

  routes.get('/:id', (c) => {
    const detail = deckDetail(db, deckId(c.req.param('id')))
    if (!detail) throw new ApiError(404, 'not_found', 'Deck not found')
    return c.json(detail)
  })

  routes.patch('/:id', async (c) => {
    const id = deckId(c.req.param('id'))
    const patch = parseWith(UpdateBody, await readJson(c.req))
    if (!updateDeck(db, id, patch)) throw new ApiError(404, 'not_found', 'Deck not found')
    return c.json(deckSummary(db, id))
  })

  routes.delete('/:id', (c) => {
    if (!deleteDeck(db, deckId(c.req.param('id')))) throw new ApiError(404, 'not_found', 'Deck not found')
    return c.body(null, 204)
  })

  routes.post('/:id/duplicate', (c) => {
    const copy = duplicateDeck(db, deckId(c.req.param('id')))
    if (copy === null) throw new ApiError(404, 'not_found', 'Deck not found')
    return c.json(deckSummary(db, copy), 201)
  })

  routes.post('/:id/cards', async (c) => {
    const id = deckId(c.req.param('id'))
    const { cardId, board, delta } = parseWith(AddBody, await readJson(c.req))
    requireDeck(db, id)
    if (!db.prepare('SELECT 1 FROM cards WHERE id = ?').get(cardId)) {
      throw new ApiError(404, 'not_found', "That printing isn't in your local card data yet; refresh card data in Settings.")
    }
    return c.json({ quantity: addToDeck(db, id, cardId, board, delta) })
  })

  routes.patch('/:id/lines/:lineId', async (c) => {
    const id = deckId(c.req.param('id'))
    const lineId = PathId.safeParse(c.req.param('lineId'))
    const patch = parseWith(LineBody, await readJson(c.req))
    const result = lineId.success ? updateLine(db, id, lineId.data, patch) : 'no_line'
    if (result === 'no_line') throw new ApiError(404, 'not_found', 'Deck line not found')
    if (result === 'wrong_card') throw new ApiError(400, 'wrong_card', "That printing isn't a printing of this card")
    return c.body(null, 204)
  })

  routes.delete('/:id/lines/:lineId', (c) => {
    const id = deckId(c.req.param('id'))
    const lineId = PathId.safeParse(c.req.param('lineId'))
    if (!lineId.success || !removeLine(db, id, lineId.data)) throw new ApiError(404, 'not_found', 'Deck line not found')
    return c.body(null, 204)
  })

  routes.post('/:id/import/preview', async (c) => {
    const id = deckId(c.req.param('id'))
    const { text } = parseWith(PreviewBody, await readJson(c.req))
    requireDeck(db, id)
    try {
      return c.json(previewDeckImport(db, text))
    } catch (err) {
      if (err instanceof DecklistTooLongError) throw new ApiError(400, 'bad_request', err.message)
      throw err
    }
  })

  routes.post('/:id/import', async (c) => {
    const id = deckId(c.req.param('id'))
    const { items, replace } = parseWith(ImportBody, await readJson(c.req))
    requireDeck(db, id)
    const oracleOf = db.prepare('SELECT oracle_id FROM cards WHERE id = ?').pluck()
    const known = db.prepare('SELECT 1 FROM card_names WHERE oracle_id = ?')
    // Checked up front so the import is all or nothing (the card data may have changed since the preview).
    for (const item of items) {
      if (!known.get(item.oracleId)) throw new ApiError(400, 'bad_import', `Card ${item.oracleId} isn't in the card data; preview the list again`)
      if (item.cardId !== null && oracleOf.get(item.cardId) !== item.oracleId) {
        throw new ApiError(400, 'bad_import', `Printing ${item.cardId} isn't a printing of that card; preview the list again`)
      }
    }
    return c.json(importIntoDeck(db, id, items, replace))
  })

  routes.get('/:id/export', (c) => {
    const id = deckId(c.req.param('id'))
    const { format } = parseWith(ExportQuery, c.req.query())
    requireDeck(db, id)
    // A line whose card is gone from the card data has no name to export.
    const lines: ExportLine[] = getLineRows(db, id).filter((r) => r.card_id !== '').map((r) => ({
      quantity: r.quantity,
      name: exportName(r),
      board: r.board,
      setCode: r.set_code,
      collectorNumber: r.collector_number,
    }))
    return c.text(format === 'mtgo' ? toMtgo(lines) : toArena(lines))
  })

  return routes
}
