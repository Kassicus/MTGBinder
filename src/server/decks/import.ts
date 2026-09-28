import { parseDecklist } from '../../shared/decklist.ts'
import { normalizeName } from '../../shared/normalize.ts'
import type { DeckImportMatch, DeckImportPreview, DeckImportRow } from '../../shared/types.ts'
import { createFuzzySearch, type FuzzyHit, type FuzzySearch } from '../cards/fuzzy.ts'
import { cardNameIndex, type CardNameIndex } from '../cards/names.ts'
import type { DB } from '../db/index.ts'

/** Lowest name similarity a fuzzy match may have (spec §5.4.2). */
export const FUZZY_THRESHOLD = 0.92

/** Most card lines one decklist may have, in a preview or an import. */
export const MAX_IMPORT_LINES = 5000

/** Most distinct names one preview sends through the fuzzy search; later ones come back unresolved. */
export const FUZZY_LIMIT = 500

/** A decklist with more than MAX_IMPORT_LINES card lines. */
export class DecklistTooLongError extends Error {
  constructor(lines: number) {
    super(`A decklist can have at most ${MAX_IMPORT_LINES.toLocaleString('en-US')} card lines; this one has ${lines.toLocaleString('en-US')}.`)
    this.name = 'DecklistTooLongError'
  }
}

/**
 * The fuzzy search for one preview: counts symbols on first use, searches each normalized name once, and answers
 * null without searching once `limit` distinct names have been searched.
 */
function limitedFuzzySearch(keys: CardNameIndex['keys'], limit: number): (query: string) => FuzzyHit | null {
  let search: FuzzySearch | undefined
  const results = new Map<string, FuzzyHit | null>()
  return (query) => {
    const known = results.get(query)
    if (known !== undefined) return known
    if (results.size >= limit) return null
    search ??= createFuzzySearch(keys)
    const found = search(query, FUZZY_THRESHOLD)[0] ?? null
    results.set(query, found)
    return found
  }
}

/**
 * Exact name, then a face name, then the most similar name at or above the threshold (spec §5.4.2). The exact and
 * face lookups are map lookups made per line, since a name's exact spelling can pick a different card than its
 * normalized form ("Rampant, Growth"); the fuzzy search remembers each normalized name.
 */
function match(
  index: CardNameIndex,
  fuzzy: (query: string) => FuzzyHit | null,
  name: string,
): { oracleId: string; match: DeckImportMatch; score: number | null } | null {
  const hit = index.find(name)
  if (hit) return { ...hit, score: null }
  const key = normalizeName(name)
  if (key === '') return null
  const best = fuzzy(key)
  return best && { oracleId: best.oracleId, match: 'fuzzy', score: Math.round(best.score * 1000) / 1000 }
}

export interface PreviewOptions {
  /** Most distinct names sent through the fuzzy search (default FUZZY_LIMIT); later ones come back unresolved. */
  fuzzyLimit?: number
}

/**
 * Resolves a pasted decklist to cards without changing anything. A line that names a printing ((SET) number) keeps
 * that printing when it belongs to the matched card. At most `fuzzyLimit` distinct names go through the fuzzy search,
 * so a hostile paste can't hold up the server. Throws DecklistTooLongError for more than MAX_IMPORT_LINES card lines.
 */
export function previewDeckImport(db: DB, text: string, { fuzzyLimit = FUZZY_LIMIT }: PreviewOptions = {}): DeckImportPreview {
  const { entries, skipped } = parseDecklist(text)
  if (entries.length > MAX_IMPORT_LINES) throw new DecklistTooLongError(entries.length)
  const index = cardNameIndex(db)
  const fuzzy = limitedFuzzySearch(index.keys, fuzzyLimit)
  const printing = db.prepare('SELECT id, oracle_id FROM cards WHERE set_code = ? AND collector_number = ?')
  const rows: DeckImportRow[] = entries.map((entry) => {
    const found = match(index, fuzzy, entry.name)
    const base = { line: entry.line, quantity: entry.quantity, board: entry.board, name: entry.name }
    if (!found) return { ...base, match: 'unresolved', score: null, card: null }
    let cardId: string | null = null
    if (entry.setCode && entry.collectorNumber) {
      const p = printing.get(entry.setCode, entry.collectorNumber) as { id: string; oracle_id: string } | undefined
      if (p?.oracle_id === found.oracleId) cardId = p.id
    }
    return {
      ...base,
      match: found.match,
      score: found.score,
      card: { oracleId: found.oracleId, cardId, name: index.name(found.oracleId) ?? entry.name },
    }
  })
  const counts: Record<DeckImportMatch, number> = { exact: 0, face: 0, fuzzy: 0, unresolved: 0 }
  for (const row of rows) counts[row.match]++
  return { rows, skipped, counts }
}
