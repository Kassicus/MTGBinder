import { NO_OWNERSHIP } from '../../shared/ownership.ts'
import { finishPrice } from '../../shared/prices.ts'
import { parseSearch } from '../../shared/search/parse.ts'
import { type CardSort, isCardSort } from '../../shared/search/sorts.ts'
import type { Finish, Ownership, SearchCard, SearchPage, SearchSort, SortDir } from '../../shared/types.ts'
import type { CardRow } from '../cards/map.ts'
import { DEFAULT_PRINTING_ORDER, parsePrices } from '../cards/repo.ts'
import { COPY_PRICE_SQL, finishOrderSql } from '../collection/sql.ts'
import type { DB } from '../db/index.ts'
import { getOwnership } from '../ownership/repo.ts'
import { compileFilter, rarityRankSql, SearchQueryError, type CompiledFilter, type SearchScope } from './compile.ts'

export const LOCAL_PAGE_SIZE = 60

export interface SearchParams {
  q: string
  sort: SearchSort
  dir: SortDir
  page: number
}

export interface LibrarySearchParams extends SearchParams {
  /** `cards`: one row per card identity; `printings`: one row per owned printing and finish. */
  view: 'cards' | 'printings'
}

/** Sort keys over the result columns (`name`, `cmc`, …). */
const SORT_SQL: Record<CardSort, string> = {
  name: 'name COLLATE NOCASE',
  mv: 'cmc',
  price: "CAST(json_extract(prices, '$.usd') AS REAL)",
  // Scryfall's color order: W, U, B, R, G, then multicolor, then colorless.
  color: "CASE WHEN colors = '' THEN 6 WHEN length(colors) > 1 THEN 5 ELSE instr('WUBRG', colors) - 1 END",
  rarity: rarityRankSql('rarity'),
}

function orderBy(sort: CardSort, dir: SortDir): string {
  const key = SORT_SQL[sort]
  // Missing values (no price) always sort last; ties break by name, then collector order for printings.
  return `ORDER BY (${key}) IS NULL, ${key} ${dir === 'desc' ? 'DESC' : 'ASC'}, name COLLATE NOCASE, set_code, collector_number`
}

function compileQuery(q: string, scope: SearchScope): CompiledFilter {
  const parsed = parseSearch(q)
  if (!parsed.ok) throw new SearchQueryError(parsed.error.message, parsed.error.span)
  return compileFilter(parsed.ast, scope)
}

type ResultRow = CardRow & {
  /** Library rows: the collection row's finish, which also picks the price. */
  row_finish?: Finish
  /** Library rows: copies matching the search. */
  quantity?: number
}

/**
 * Maps a `cards` row to a search result. Library rows carry their finish and quantity, and are priced by that finish;
 * other rows show the nonfoil price and no finish.
 */
export function toSearchCard(row: ResultRow, ownership: Ownership): SearchCard {
  const prices = parsePrices(row.prices)
  return {
    cardId: row.id,
    oracleId: row.oracle_id,
    name: row.name,
    manaCost: row.mana_cost,
    typeLine: row.type_line,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    priceUsd: row.row_finish ? finishPrice(prices, row.row_finish) : prices.usd,
    imageNormal: row.image_normal,
    imageSmall: row.image_small,
    finish: row.row_finish ?? null,
    quantity: row.quantity ?? null,
    ownership,
  }
}

function withOwnership(db: DB, rows: ResultRow[]): SearchCard[] {
  const ownership = getOwnership(db, rows.map((r) => r.oracle_id))
  return rows.map((r) => toSearchCard(r, ownership.get(r.oracle_id) ?? NO_OWNERSHIP))
}

function page(total: number, params: SearchParams, cards: SearchCard[]): SearchPage {
  return {
    total,
    estimated: false,
    page: params.page,
    pageSize: LOCAL_PAGE_SIZE,
    hasMore: params.page * LOCAL_PAGE_SIZE < total,
    cards,
    warnings: [],
  }
}

/**
 * Searches every printing in the local card data (the offline stand-in for Scryfall). One result per card identity:
 * its default printing when that printing matches, otherwise the matching printing the default-printing rule ranks
 * first (DEFAULT_PRINTING_ORDER, so a regular printing over a newer special product).
 * Picks printings over narrow columns first and reads full rows only for the page (full scans beat the oracle index here).
 */
export function searchLocal(db: DB, params: SearchParams): SearchPage {
  const filter = compileQuery(params.q, 'cards')
  const limits = { limit: LOCAL_PAGE_SIZE, offset: (params.page - 1) * LOCAL_PAGE_SIZE }
  // DEFAULT_PRINTING_ORDER names bare `cards` columns; card_names shares none of them, so they resolve to `c`.
  const rows = db
    .prepare(
      `WITH picked AS (
         SELECT id FROM (
           SELECT c.id, ROW_NUMBER() OVER (
             PARTITION BY c.oracle_id ORDER BY (c.id = n.default_card_id) DESC, ${DEFAULT_PRINTING_ORDER}, c.id
           ) AS pick
           FROM cards c NOT INDEXED JOIN card_names n ON n.oracle_id = c.oracle_id
           WHERE ${filter.sql}
         ) WHERE pick = 1
       )
       SELECT c.*, count(*) OVER () AS total_count FROM picked p JOIN cards c ON c.id = p.id
       ${orderBy(isCardSort(params.sort) ? params.sort : 'name', params.dir)}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...filter.params, ...limits }) as Array<ResultRow & { total_count: number }>
  // The window count rides on the page's rows; a page past the end has none, so count separately then.
  const total =
    rows[0]?.total_count ??
    (params.page === 1
      ? 0
      : (db
          .prepare(`SELECT count(*) FROM (SELECT DISTINCT c.oracle_id FROM cards c NOT INDEXED WHERE ${filter.sql})`)
          .pluck()
          .get(filter.params) as number))
  return page(total, params, withOwnership(db, rows))
}

// Library queries start from the (small) collection and look cards up by id. CROSS JOIN pins that join order rather
// than letting the planner walk all ~100k printings; SQLite treats CROSS JOIN as an ordering hint.
const LIBRARY_FROM = 'FROM collection co CROSS JOIN cards c ON c.id = co.card_id'

// Per-identity owned and built-deck totals, joined only for filters that use them (free, qty, is:wanted).
const OWNERSHIP_JOINS = `
  LEFT JOIN (
    SELECT c2.oracle_id, SUM(co2.quantity) AS owned
    FROM collection co2 CROSS JOIN cards c2 ON c2.id = co2.card_id GROUP BY c2.oracle_id
  ) own ON own.oracle_id = c.oracle_id
  LEFT JOIN (
    SELECT dc.oracle_id, SUM(dc.quantity) AS allocated
    FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
    WHERE d.status = 'built' AND dc.board != 'maybe' GROUP BY dc.oracle_id
  ) alloc ON alloc.oracle_id = c.oracle_id`

/**
 * Library sort keys over `c` and `co`: `added` is the row's date and `quantity` its copies (the cards view swaps in the
 * identity's latest date and its matching copies across printings).
 */
const LIBRARY_SORT_SQL: Record<SearchSort, string> = {
  name: 'c.name COLLATE NOCASE',
  mv: 'c.cmc',
  price: COPY_PRICE_SQL,
  color: "CASE WHEN c.colors = '' THEN 6 WHEN length(c.colors) > 1 THEN 5 ELSE instr('WUBRG', c.colors) - 1 END",
  rarity: rarityRankSql('c.rarity'),
  added: 'co.added_at',
  quantity: 'co.quantity',
}

interface LibraryPick {
  row_id: number
  quantity: number
  total_count: number
}

/**
 * Searches the owner's collection. Filters apply to each owned printing and finish (collection row). The `printings`
 * view returns each matching row; the `cards` view returns one row per card identity, showing the matching collection
 * row (printing and finish) with the most copies, with `quantity` = matching copies across its printings.
 * Results are priced by each row's finish. Picks rows over narrow columns first and reads full rows only for the page.
 */
export function searchLibrary(db: DB, params: LibrarySearchParams): SearchPage {
  const filter = compileQuery(params.q, 'library')
  const from = `${LIBRARY_FROM} ${filter.ownership ? OWNERSHIP_JOINS : ''}`
  const dir = params.dir === 'desc' ? 'DESC' : 'ASC'
  const order = `ORDER BY sort_key IS NULL, sort_key ${dir}, name COLLATE NOCASE, set_code, collector_number, ${finishOrderSql('finish')}`
  const limits = { limit: LOCAL_PAGE_SIZE, offset: (params.page - 1) * LOCAL_PAGE_SIZE }
  let picks: LibraryPick[]
  let countSql: string
  if (params.view === 'printings') {
    picks = db
      .prepare(
        `SELECT co.id AS row_id, co.quantity AS quantity, count(*) OVER () AS total_count,
           ${LIBRARY_SORT_SQL[params.sort]} AS sort_key, c.name AS name, c.set_code AS set_code,
           c.collector_number AS collector_number, co.finish AS finish
         ${from} WHERE ${filter.sql}
         ${order} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...filter.params, ...limits }) as LibraryPick[]
    countSql = `SELECT count(*) ${from} WHERE ${filter.sql}`
  } else {
    const sortKey = params.sort === 'added' ? 'm.added_at' : params.sort === 'quantity' ? 'm.quantity' : LIBRARY_SORT_SQL[params.sort]
    picks = db
      .prepare(
        `WITH matched AS (
           SELECT co.id AS row_id,
             SUM(co.quantity) OVER card AS quantity,
             MAX(co.added_at) OVER card AS added_at,
             ROW_NUMBER() OVER (PARTITION BY c.oracle_id ORDER BY co.quantity DESC, co.added_at DESC, c.id, co.id) AS pick
           ${from} WHERE ${filter.sql}
           WINDOW card AS (PARTITION BY c.oracle_id)
         )
         SELECT m.row_id AS row_id, m.quantity AS quantity, count(*) OVER () AS total_count,
           ${sortKey} AS sort_key, c.name AS name, c.set_code AS set_code,
           c.collector_number AS collector_number, co.finish AS finish
         FROM matched m CROSS JOIN collection co ON co.id = m.row_id CROSS JOIN cards c ON c.id = co.card_id
         WHERE m.pick = 1
         ${order} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...filter.params, ...limits }) as LibraryPick[]
    countSql = `SELECT count(DISTINCT c.oracle_id) ${from} WHERE ${filter.sql}`
  }
  // The window count rides on the page's rows; a page past the end has none, so count separately then.
  const total = picks[0]?.total_count ?? (params.page === 1 ? 0 : (db.prepare(countSql).pluck().get(filter.params) as number))
  const full = new Map(
    (
      db
        .prepare(
          `SELECT c.*, co.id AS row_id, co.finish AS row_finish
           ${LIBRARY_FROM} WHERE co.id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(picks.map((p) => p.row_id))) as Array<ResultRow & { row_id: number }>
    ).map((row) => [row.row_id, row]),
  )
  const rows = picks.flatMap((p) => {
    const row = full.get(p.row_id)
    return row ? [{ ...row, quantity: p.quantity }] : []
  })
  return page(total, params, withOwnership(db, rows))
}
