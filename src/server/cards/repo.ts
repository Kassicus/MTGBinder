import { normalizeName } from '../../shared/normalize.ts'
import type { Card, CardSummary, Prices, Printing } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'
import { getMeta, setMeta } from '../db/meta.ts'
import { CARD_COLUMNS, type CardRow, type StoredFace } from './map.ts'

/**
 * Inserts rows with INSERT OR REPLACE. Only for the import staging table and for seeding test/dev databases:
 * REPLACE deletes the old row first, which would break foreign keys on a populated `cards` table.
 */
export function insertCardRows(db: DB, table: 'cards' | 'cards_staging', rows: readonly CardRow[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO ${table} (${CARD_COLUMNS.join(', ')}) VALUES (${CARD_COLUMNS.map((c) => `@${c}`).join(', ')})`,
  )
  db.transaction((batch: readonly CardRow[]) => {
    for (const row of batch) stmt.run(row)
  })(rows)
}

/** Bump when the default-printing rule in rebuildCardNames changes, so existing databases get rebuilt at startup. */
export const CARD_NAMES_VERSION = 4

/** Scryfall set types of special products: promos, boxed sets like Secret Lair, collectibles, joke sets, and so on. */
export const SPECIAL_SET_TYPES = [
  'promo', 'box', 'memorabilia', 'masterpiece', 'funny', 'token', 'minigame', 'vanguard', 'treasure_chest', 'alchemy',
] as const

/**
 * Reprint products filed under regular set types: The List (`masters`), plus Secret Lair and Unknown Event so they
 * stay demoted in card data imported before set types were stored.
 */
const SPECIAL_SET_CODES = ['plst', 'sld', 'unk'] as const

const sqlList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ')

/** SQL that is true for a printing from a special product; `table` qualifies the columns (e.g. 'c.'). */
export const specialPrintingSql = (table = '') =>
  `(${table}set_type IN (${sqlList(SPECIAL_SET_TYPES)}) OR ${table}set_code IN (${sqlList(SPECIAL_SET_CODES)}))`

/**
 * Which printing of a card to show or pick by default, as an ORDER BY list over `cards` columns (best first): not a
 * promo, not dated in the future, not a special product (SPECIAL_SET_TYPES, SPECIAL_SET_CODES), printed in English,
 * newest, then lowest collector number.
 */
export const DEFAULT_PRINTING_ORDER = `
  is_promo ASC,
  released_at > date('now') ASC,
  ${specialPrintingSql()} ASC,
  lang <> 'en' ASC,
  released_at DESC, set_code ASC, CAST(collector_number AS INTEGER) ASC, collector_number ASC`

/**
 * Rebuilds `card_names` (one row per card identity) and its trigram index. The default printing is the newest one
 * that isn't a promo, isn't dated in the future, isn't from a special product, and is in English, falling back
 * through those in that order (DEFAULT_PRINTING_ORDER).
 */
export function rebuildCardNames(db: DB): void {
  db.transaction(() => {
    db.exec('DELETE FROM card_names')
    db.exec(`
      INSERT INTO card_names (oracle_id, name, face_names, search_name, default_card_id)
      SELECT oracle_id, name, face_names, search_name, id FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY oracle_id ORDER BY ${DEFAULT_PRINTING_ORDER}) AS pick
        FROM cards
      ) WHERE pick = 1`)
    db.exec(`INSERT INTO card_names_fts (card_names_fts) VALUES ('rebuild')`)
    setMeta(db, 'card_names_version', String(CARD_NAMES_VERSION))
  })()
}

/** Rebuilds the name index if it was built by an older rule. Returns true when it rebuilt. */
export function ensureCardNamesCurrent(db: DB): boolean {
  const hasCards = db.prepare('SELECT 1 FROM cards LIMIT 1').get() !== undefined
  if (!hasCards || getMeta(db, 'card_names_version') === String(CARD_NAMES_VERSION)) return false
  rebuildCardNames(db)
  return true
}

function parsePrice(value: string | null | undefined): number | null {
  return value == null ? null : Number(value)
}

/** Reads the `prices` JSON column. */
export function parsePrices(json: string): Prices {
  const p = JSON.parse(json) as Record<string, string | null>
  return { usd: parsePrice(p.usd), usdFoil: parsePrice(p.usd_foil), usdEtched: parsePrice(p.usd_etched) }
}

export function rowToCard(row: CardRow): Card {
  const faces = row.card_faces ? (JSON.parse(row.card_faces) as StoredFace[]) : []
  return {
    id: row.id,
    oracleId: row.oracle_id,
    name: row.name,
    faceNames: row.face_names.split('\n'),
    layout: row.layout,
    releasedAt: row.released_at,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    manaCost: row.mana_cost,
    cmc: row.cmc,
    typeLine: row.type_line,
    oracleText: row.oracle_text,
    flavorText: row.flavor_text,
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    colors: row.colors,
    colorIdentity: row.color_identity,
    keywords: JSON.parse(row.keywords) as string[],
    legalities: JSON.parse(row.legalities) as Record<string, string>,
    finishes: JSON.parse(row.finishes) as Card['finishes'],
    artist: row.artist,
    prices: parsePrices(row.prices),
    imageNormal: row.image_normal,
    imageSmall: row.image_small,
    imageArtCrop: row.image_art_crop,
    faces: faces.map((f) => ({
      name: f.name,
      manaCost: f.mana_cost,
      typeLine: f.type_line,
      oracleText: f.oracle_text,
      power: f.power,
      toughness: f.toughness,
      loyalty: f.loyalty,
      imageNormal: f.image_normal,
    })),
    purchaseUris: row.purchase_uris ? (JSON.parse(row.purchase_uris) as Record<string, string>) : {},
    scryfallUri: row.scryfall_uri,
    isPromo: row.is_promo === 1,
  }
}

export function getCard(db: DB, id: string): Card | null {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined
  return row ? rowToCard(row) : null
}

/** Every printing of a card identity, newest first. */
export function getPrintings(db: DB, oracleId: string): Printing[] {
  const rows = db
    .prepare('SELECT * FROM cards WHERE oracle_id = ? ORDER BY released_at DESC, set_code ASC, collector_number ASC')
    .all(oracleId) as CardRow[]
  return rows.map((r) => ({
    id: r.id,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    releasedAt: r.released_at,
    rarity: r.rarity,
    finishes: JSON.parse(r.finishes) as Printing['finishes'],
    prices: parsePrices(r.prices),
    imageSmall: r.image_small,
    isPromo: r.is_promo === 1,
  }))
}

interface SummaryRow {
  oracle_id: string
  card_id: string
  name: string
  mana_cost: string
  type_line: string
  image_small: string | null
}

const SUMMARY_COLUMNS = 'n.oracle_id, n.default_card_id AS card_id, n.name, c.mana_cost, c.type_line, c.image_small'

function toSummary(r: SummaryRow): CardSummary {
  return { oracleId: r.oracle_id, cardId: r.card_id, name: r.name, manaCost: r.mana_cost, typeLine: r.type_line, imageSmall: r.image_small }
}

/**
 * Card-name autocomplete, one result per card identity. Case-, accent-, and punctuation-insensitive.
 * Query words match independently, in any order, anywhere in the name (so `jace mind` finds Jace, the Mind Sculptor).
 * Ranking: name starts with the whole query, then a word starts with it, then any other match; ties go to shorter names.
 * The query is normalized to [a-z0-9 ] first, so it can never inject FTS or LIKE syntax.
 */
export function autocomplete(db: DB, query: string, limit = 10): CardSummary[] {
  const q = normalizeName(query)
  if (q === '') return []
  const prefix = `${q}%`
  const wordPrefix = `% ${q}%`
  const words = q.split(' ')
  const longWords = words.filter((w) => w.length >= 3)
  const shortWords = words.filter((w) => w.length < 3)
  let rows: SummaryRow[]
  if (longWords.length === 0) {
    // The trigram index needs at least 3 characters; queries with no word that long use prefix matching.
    rows = db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM card_names n JOIN cards c ON c.id = n.default_card_id
         WHERE n.search_name LIKE @prefix OR n.search_name LIKE @wordPrefix
         ORDER BY CASE WHEN n.search_name LIKE @prefix THEN 0 ELSE 1 END, length(n.name), n.name
         LIMIT @limit`,
      )
      .all({ prefix, wordPrefix, limit }) as SummaryRow[]
  } else {
    // Words of 3+ characters must all hit the trigram index; each shorter word is checked with LIKE.
    const match = longWords.map((w) => `"${w}"`).join(' AND ')
    const shortParams: Record<string, string> = {}
    let shortClauses = ''
    shortWords.forEach((w, i) => {
      shortParams[`short${i}`] = `%${w}%`
      shortClauses += ` AND n.search_name LIKE @short${i}`
    })
    rows = db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM card_names_fts f
         JOIN card_names n ON n.rowid = f.rowid
         JOIN cards c ON c.id = n.default_card_id
         WHERE card_names_fts MATCH @match${shortClauses}
         ORDER BY CASE WHEN n.search_name LIKE @prefix THEN 0 WHEN n.search_name LIKE @wordPrefix THEN 1 ELSE 2 END,
                  length(n.name), n.name
         LIMIT @limit`,
      )
      .all({ match, prefix, wordPrefix, limit, ...shortParams }) as SummaryRow[]
  }
  return rows.map(toSummary)
}

/**
 * The card a written name means, as its default printing: its full name, or one face's (for [[Fire]] or [[Fire // Ice]]),
 * ignoring case, accents, and punctuation. Null when no card has that name. Candidates rank as in cardNameIndex: the
 * whole written name before its front half, an exact name (any letter case) before one that matches only without
 * punctuation ("Rampant Growth" before the joke card "Rampant, Growth"), and a card from a regular set before one from
 * a special product.
 */
export function findCardByName(db: DB, name: string): CardSummary | null {
  const written = name.trim()
  const front = (name.split(' // ')[0] ?? name).trim()
  const key = normalizeName(front)
  if (key === '') return null
  const full = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM card_names n JOIN cards c ON c.id = n.default_card_id
       WHERE n.search_name IN (@full, @key)
       ORDER BY n.search_name = @full DESC,
                lower(n.name) = lower(CASE WHEN n.search_name = @full THEN @written ELSE @front END) DESC,
                ${specialPrintingSql('c.')} ASC, n.name
       LIMIT 1`,
    )
    .get({ full: normalizeName(written), key, written, front }) as SummaryRow | undefined
  const row =
    full ??
    (
      db
        .prepare(
          `SELECT ${SUMMARY_COLUMNS}, n.face_names FROM card_names n JOIN cards c ON c.id = n.default_card_id
           WHERE instr(n.face_names, char(10)) > 0 AND n.search_name LIKE ?
           ORDER BY ${specialPrintingSql('c.')} ASC, n.name`,
        )
        .all(`%${key}%`) as Array<SummaryRow & { face_names: string }>
    ).find((r) => r.face_names.split('\n').some((face) => normalizeName(face) === key))
  return row ? toSummary(row) : null
}
