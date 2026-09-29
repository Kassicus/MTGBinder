import { canonColors } from '../../shared/colors.ts'
import { checkDeck, type RuleCard } from '../../shared/formats.ts'
import { deckNeed, NO_OWNERSHIP } from '../../shared/ownership.ts'
import type { Board, BuyList, BuyListItem, DeckDetail, DeckLine, DeckSummary, Ownership } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'
import { getOwnership } from '../ownership/repo.ts'
import { scannedIntoDeck } from '../scanner/repo.ts'
import { getSettings } from '../settings.ts'
import { getDeckRow, getLineRows, listDeckRows, type DeckRow, type LineRow } from './repo.ts'

/** The one warning on a line whose card is gone from the card data (see MISSING_CARD_NAME). */
export const MISSING_CARD_WARNING = 'No longer in the card data (Scryfall changed it): remove this line and add the card again'

const BOARDS: readonly Board[] = ['commander', 'main', 'side', 'maybe']

/** The cheapest way to buy one copy of a card identity. */
interface Cheapest {
  usd: number | null
  cardId: string | null
  purchaseUrl: string | null
}

interface PriceRow {
  oracle_id: string
  id: string
  set_type: string
  purchase_uris: string | null
  usd: number | null
  foil: number | null
  etched: number | null
}

/**
 * The lowest usd among these printings, else the lowest foil price, else the lowest etched price. Of printings with
 * the same price, one with a TCGplayer link wins, then the first by id, so the buy list names the same one each time.
 */
function cheapestOf(printings: readonly PriceRow[]): Cheapest {
  let best: Cheapest = { usd: null, cardId: null, purchaseUrl: null }
  for (const key of ['usd', 'foil', 'etched'] as const) {
    for (const p of printings) {
      const price = p[key]
      if (price === null) continue
      const link = p.purchase_uris ? ((JSON.parse(p.purchase_uris) as Record<string, string>).tcgplayer ?? null) : null
      if (best.usd === null || price < best.usd || (price === best.usd && link !== null && best.purchaseUrl === null)) {
        best = { usd: price, cardId: p.id, purchaseUrl: link }
      }
    }
    if (best.usd !== null) break
  }
  return best
}

/**
 * The cheapest price per card identity across its paper printings (spec §4.3): the lowest usd, else the lowest foil
 * price, else the lowest etched price, with the TCGplayer link of the printing it comes from. Memorabilia printings
 * (gold-bordered World Championship decks, Collectors' Edition, 30th Anniversary) can't be played, so they count only
 * when no other printing has a price.
 */
function cheapestPrices(db: DB, oracleIds: readonly string[]): Map<string, Cheapest> {
  const rows = db
    .prepare(
      `SELECT oracle_id, id, set_type, purchase_uris,
         CAST(json_extract(prices, '$.usd') AS REAL) AS usd,
         CAST(json_extract(prices, '$.usd_foil') AS REAL) AS foil,
         CAST(json_extract(prices, '$.usd_etched') AS REAL) AS etched
       FROM cards WHERE oracle_id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    )
    .all(JSON.stringify([...new Set(oracleIds)])) as PriceRow[]
  const byOracle = new Map<string, PriceRow[]>()
  for (const row of rows) {
    const list = byOracle.get(row.oracle_id)
    if (list) list.push(row)
    else byOracle.set(row.oracle_id, [row])
  }
  const result = new Map<string, Cheapest>()
  for (const [oracleId, printings] of byOracle) {
    const playable = cheapestOf(printings.filter((p) => p.set_type !== 'memorabilia'))
    result.set(oracleId, playable.usd !== null ? playable : cheapestOf(printings.filter((p) => p.set_type === 'memorabilia')))
  }
  return result
}

const isBasic = (typeLine: string) => /\bBasic\b/.test(typeLine)

interface Analysis {
  summary: DeckSummary
  lines: DeckLine[]
  warnings: string[]
  buyList: BuyList
}

/**
 * Ownership, prices, statuses, completion, buy list, and format warnings for one deck (spec §4.3, §4.4). `scanned`:
 * the copies scans added to it, by "<board>/<oracle id>" (see scannedIntoDeck). A line whose card is gone from the
 * card data counts toward the deck's size, but not its cost or completion, and its copies have no price.
 */
function analyze(
  deck: DeckRow,
  rows: readonly LineRow[],
  ownership: ReadonlyMap<string, Ownership>,
  prices: ReadonlyMap<string, Cheapest>,
  ignoreBasics: boolean,
  scanned: ReadonlyMap<string, number> = new Map(),
): Analysis {
  const built = deck.status === 'built'
  const missing = new Set(rows.filter((r) => r.card_id === '').map((r) => r.oracle_id))
  const boards = Object.fromEntries(BOARDS.map((b) => [b, 0])) as Record<Board, number>
  const inDeck = new Map<string, number>() // copies per card identity, every board but maybe
  const ruleCards = new Map<string, RuleCard>()
  for (const row of rows) {
    boards[row.board] += row.quantity
    if (row.board !== 'maybe') inDeck.set(row.oracle_id, (inDeck.get(row.oracle_id) ?? 0) + row.quantity)
    const rule = ruleCards.get(row.oracle_id) ?? {
      oracleId: row.oracle_id,
      name: row.name,
      typeLine: row.type_line,
      oracleText: row.oracle_text,
      keywords: JSON.parse(row.keywords) as string[],
      colorIdentity: row.color_identity,
      legalities: JSON.parse(row.legalities) as Record<string, string>,
      boards: {},
    }
    rule.boards[row.board] = (rule.boards[row.board] ?? 0) + row.quantity
    ruleCards.set(row.oracle_id, rule)
  }
  const check = checkDeck(deck.format, [...ruleCards.values()])

  const needOf = (oracleId: string, n: number, asBuilt: boolean) => {
    const own = ownership.get(oracleId) ?? NO_OWNERSHIP
    return { own, need: deckNeed({ owned: own.owned, free: own.free, n, built: asBuilt }) }
  }

  const lines: DeckLine[] = rows.map((row) => {
    const maybe = row.board === 'maybe'
    const n = maybe ? row.quantity : (inDeck.get(row.oracle_id) ?? 0)
    const { own, need } = needOf(row.oracle_id, n, !maybe && built)
    // A maybe line is judged as if prospective, but a built deck's own copies on its other boards aren't another deck's.
    const inOtherBuiltDecks = maybe && built ? Math.max(0, need.inOtherBuiltDecks - (inDeck.get(row.oracle_id) ?? 0)) : need.inOtherBuiltDecks
    return {
      id: row.id,
      oracleId: row.oracle_id,
      cardId: row.card_id,
      setCode: row.set_code,
      collectorNumber: row.collector_number,
      preferredCardId: row.preferred_card_id,
      name: row.name,
      manaCost: row.mana_cost,
      typeLine: row.type_line,
      cmc: row.cmc,
      colorIdentity: row.color_identity,
      imageSmall: row.image_small,
      imageNormal: row.image_normal,
      quantity: row.quantity,
      board: row.board,
      category: row.category,
      priceUsd: prices.get(row.oracle_id)?.usd ?? null,
      status: need.status,
      short: need.short,
      owned: own.owned,
      inOtherBuiltDecks,
      scanned: scanned.get(`${row.board}/${row.oracle_id}`) ?? 0,
      warnings: missing.has(row.oracle_id) ? [MISSING_CARD_WARNING] : (check.cards.get(row.oracle_id) ?? []),
    }
  })

  const items: BuyListItem[] = []
  let counted = 0
  let available = 0
  for (const [oracleId, n] of inDeck) {
    const rule = ruleCards.get(oracleId)
    if (!rule || missing.has(oracleId) || (ignoreBasics && isBasic(rule.typeLine))) continue
    const { need } = needOf(oracleId, n, built)
    counted += n
    available += n - need.short
    if (need.short > 0) {
      const price = prices.get(oracleId)
      const shown = rows.find((r) => r.oracle_id === oracleId)
      items.push({
        oracleId,
        cardId: price?.cardId ?? shown?.card_id ?? '',
        name: rule.name,
        quantity: need.short,
        priceUsd: price?.usd ?? null,
        purchaseUrl: price?.purchaseUrl ?? null,
      })
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name))
  const totalCents = items.reduce((sum, i) => sum + (i.priceUsd === null ? 0 : Math.round(i.priceUsd * 100) * i.quantity), 0)
  const unpriced = items.reduce((sum, i) => sum + (i.priceUsd === null ? i.quantity : 0), 0)
  // The whole deck, owned or not, at each line's price; a line whose card is gone has none.
  const valued = lines.filter((l) => l.board !== 'maybe')
  const valueCents = valued.reduce((sum, l) => sum + (l.priceUsd === null ? 0 : Math.round(l.priceUsd * 100) * l.quantity), 0)

  const commanders = rows.filter((r) => r.board === 'commander')
  const identitySource = deck.format === 'commander' && commanders.length > 0 ? commanders : rows.filter((r) => r.board !== 'maybe')

  return {
    summary: {
      id: deck.id,
      name: deck.name,
      format: deck.format,
      status: deck.status,
      notes: deck.notes,
      createdAt: deck.created_at,
      updatedAt: deck.updated_at,
      boards,
      cardCount: boards.commander + boards.main + boards.side,
      completion: counted === 0 ? 1 : available / counted,
      costToFinish: totalCents / 100,
      unpricedToBuy: unpriced,
      valueUsd: valueCents / 100,
      unpricedCards: valued.reduce((sum, l) => sum + (l.priceUsd === null ? l.quantity : 0), 0),
      colorIdentity: canonColors(identitySource.flatMap((r) => [...r.color_identity])),
    },
    lines,
    warnings: check.deck,
    buyList: { items, totalUsd: totalCents / 100, unpriced, ignoreBasics },
  }
}

/** Every deck's summary, by name. */
export function deckSummaries(db: DB): DeckSummary[] {
  const decks = listDeckRows(db)
  const rows = getLineRows(db)
  const oracleIds = rows.map((r) => r.oracle_id)
  const ownership = getOwnership(db, oracleIds)
  const prices = cheapestPrices(db, oracleIds)
  const { buylistIgnoreBasics } = getSettings(db)
  const byDeck = new Map<number, LineRow[]>()
  for (const row of rows) {
    const list = byDeck.get(row.deck_id)
    if (list) list.push(row)
    else byDeck.set(row.deck_id, [row])
  }
  return decks.map((deck) => analyze(deck, byDeck.get(deck.id) ?? [], ownership, prices, buylistIgnoreBasics).summary)
}

/** Analyzes one stored deck, or returns null when there is no such deck. */
function analyzeDeck(db: DB, id: number): Analysis | null {
  const deck = getDeckRow(db, id)
  if (!deck) return null
  const rows = getLineRows(db, id)
  const oracleIds = rows.map((r) => r.oracle_id)
  const { buylistIgnoreBasics } = getSettings(db)
  return analyze(deck, rows, getOwnership(db, oracleIds), cheapestPrices(db, oracleIds), buylistIgnoreBasics, scannedIntoDeck(db, id))
}

/** One deck with its lines, warnings, and buy list, or null when there is no such deck. */
export function deckDetail(db: DB, id: number): DeckDetail | null {
  const analysis = analyzeDeck(db, id)
  return analysis && { ...analysis.summary, lines: analysis.lines, warnings: analysis.warnings, buyList: analysis.buyList }
}

/** One deck's summary, or null when there is no such deck. */
export function deckSummary(db: DB, id: number): DeckSummary | null {
  return analyzeDeck(db, id)?.summary ?? null
}
