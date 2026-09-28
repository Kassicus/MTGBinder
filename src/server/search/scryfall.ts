import { NO_OWNERSHIP } from '../../shared/ownership.ts'
import type { CardSort } from '../../shared/search/sorts.ts'
import type { SearchPage, SortDir } from '../../shared/types.ts'
import { scryfallToRow, shouldImport, type CardRow } from '../cards/map.ts'
import type { DB } from '../db/index.ts'
import { getOwnership } from '../ownership/repo.ts'
import { ScryfallError, type ScryfallClient } from '../scryfall/client.ts'
import type { ScryfallCard, ScryfallList } from '../scryfall/types.ts'
import { toSearchCard } from './run.ts'

export const SCRYFALL_PAGE_SIZE = 175

const ORDER: Record<CardSort, string> = { name: 'name', mv: 'cmc', price: 'usd', color: 'color', rarity: 'rarity' }

export interface ScryfallSearchParams {
  q: string
  sort: CardSort
  /** Scryfall's own `edhrec` order (most-played first), in place of `sort`'s. */
  order?: 'edhrec'
  dir: SortDir
  page: number
}

/**
 * Runs a query through Scryfall's search (its full syntax, one result per card) and marks each result with the
 * owner's stake. Digital-only cards are dropped from the page, so a page can hold fewer than 175 results, and the
 * total is Scryfall's estimate unless the whole search fits on the first page. "No cards matched" and a page past the
 * last come back as an empty page; other failures throw ScryfallError.
 */
export async function searchScryfall(db: DB, client: ScryfallClient, params: ScryfallSearchParams): Promise<SearchPage> {
  const query = new URLSearchParams({
    q: params.q,
    unique: 'cards',
    order: params.order ?? ORDER[params.sort],
    dir: params.dir,
    page: String(params.page),
  })
  let list: ScryfallList<ScryfallCard>
  try {
    list = await client.getJson<ScryfallList<ScryfallCard>>(`/cards/search?${query}`)
  } catch (err) {
    const empty = { total: 0, estimated: false, page: params.page, pageSize: SCRYFALL_PAGE_SIZE, hasMore: false, cards: [] }
    if (err instanceof ScryfallError && err.code === 'not_found') return { ...empty, warnings: err.warnings }
    // Scryfall answers a page past the last (a stale link, or results that shrank) with a 422.
    if (err instanceof ScryfallError && err.status === 422 && params.page > 1) return { ...empty, warnings: [] }
    throw err
  }
  // Drop digital-only cards, tokens, and art cards here rather than adding `game:paper` to the query: an added term
  // would survive when Scryfall ignores every term the user typed, turning a typo into "every paper card".
  const rows = list.data
    .filter((card) => shouldImport(card))
    .map((card) => scryfallToRow(card))
    .filter((row): row is CardRow => row !== null)
  const ownership = getOwnership(db, rows.map((r) => r.oracle_id))
  const whole = params.page === 1 && !list.has_more
  return {
    total: whole ? rows.length : (list.total_cards ?? rows.length),
    estimated: !whole,
    page: params.page,
    pageSize: SCRYFALL_PAGE_SIZE,
    hasMore: list.has_more,
    cards: rows.map((row) => toSearchCard(row, ownership.get(row.oracle_id) ?? NO_OWNERSHIP)),
    warnings: list.warnings ?? [],
  }
}
