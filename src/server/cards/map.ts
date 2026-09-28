import { canonColors } from '../../shared/colors.ts'
import { normalizeName } from '../../shared/normalize.ts'
import type { ScryfallCard } from '../scryfall/types.ts'

export { canonColors }

/** One row of the `cards` table (one Scryfall printing). JSON columns are stored as strings. */
export interface CardRow {
  id: string
  oracle_id: string
  name: string
  face_names: string
  search_name: string
  lang: string
  layout: string
  released_at: string
  set_code: string
  set_name: string
  collector_number: string
  rarity: string
  mana_cost: string
  cmc: number
  type_line: string
  oracle_text: string
  flavor_text: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  power_num: number | null
  toughness_num: number | null
  loyalty_num: number | null
  colors: string
  color_identity: string
  keywords: string
  legalities: string
  games: string
  finishes: string
  artist: string | null
  prices: string
  image_normal: string | null
  image_small: string | null
  image_art_crop: string | null
  card_faces: string | null
  purchase_uris: string | null
  scryfall_uri: string
  is_promo: number
  is_digital: number
  set_type: string
}

/** Shape of each element in the `card_faces` JSON column. */
export interface StoredFace {
  name: string
  mana_cost: string
  type_line: string
  oracle_text: string
  power: string | null
  toughness: string | null
  loyalty: string | null
  image_normal: string | null
}

/** `cards` columns in table order. A test asserts this matches CardRow's keys exactly. */
export const CARD_COLUMNS = [
  'id', 'oracle_id', 'name', 'face_names', 'search_name', 'lang', 'layout', 'released_at',
  'set_code', 'set_name', 'collector_number', 'rarity', 'mana_cost', 'cmc', 'type_line',
  'oracle_text', 'flavor_text', 'power', 'toughness', 'loyalty', 'power_num', 'toughness_num',
  'loyalty_num', 'colors', 'color_identity', 'keywords', 'legalities', 'games', 'finishes',
  'artist', 'prices', 'image_normal', 'image_small', 'image_art_crop', 'card_faces',
  'purchase_uris', 'scryfall_uri', 'is_promo', 'is_digital', 'set_type',
] as const satisfies readonly (keyof CardRow)[]

/**
 * Version of what scryfallToRow stores. Bump it when a mapping change needs data that only a new import can supply
 * (2: `set_type`); card data imported by an older version then counts as stale and refreshes at the next start.
 */
export const CARD_DATA_VERSION = 2

const SKIPPED_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series'])

/** Numeric value of a power/toughness/loyalty string, or null when it isn't a plain number ("*", "1+*", "X"). */
export function toNum(value: string | null | undefined): number | null {
  if (value == null || !/^[+-]?\d+(\.\d+)?$/.test(value)) return null
  return Number(value)
}

/** Whether a bulk-data card belongs in the local mirror (real paper cards only). */
export function shouldImport(card: ScryfallCard): boolean {
  return !card.digital && card.games.includes('paper') && card.oversized !== true && !SKIPPED_LAYOUTS.has(card.layout)
}

/** Flattens a Scryfall card into a `cards` row. Returns null if the card has no oracle id anywhere. */
export function scryfallToRow(card: ScryfallCard): CardRow | null {
  const faces = card.card_faces ?? []
  const front = faces[0]
  const oracleId = card.oracle_id ?? front?.oracle_id
  if (!oracleId) return null

  const fromFaces = (key: 'power' | 'toughness' | 'loyalty'): string | null =>
    card[key] ?? faces.find((f) => f[key] != null)?.[key] ?? null
  const power = fromFaces('power')
  const toughness = fromFaces('toughness')
  const loyalty = fromFaces('loyalty')
  const images = card.image_uris ?? front?.image_uris
  const storedFaces: StoredFace[] = faces.map((f) => ({
    name: f.name,
    mana_cost: f.mana_cost ?? '',
    type_line: f.type_line ?? '',
    oracle_text: f.oracle_text ?? '',
    power: f.power ?? null,
    toughness: f.toughness ?? null,
    loyalty: f.loyalty ?? null,
    image_normal: f.image_uris?.normal ?? null,
  }))

  return {
    id: card.id,
    oracle_id: oracleId,
    name: card.name,
    face_names: faces.length > 0 ? faces.map((f) => f.name).join('\n') : card.name,
    search_name: normalizeName(card.name),
    lang: card.lang,
    layout: card.layout,
    released_at: card.released_at,
    set_code: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    rarity: card.rarity,
    mana_cost: card.mana_cost ?? faces.map((f) => f.mana_cost ?? '').filter((m) => m !== '').join(' // '),
    cmc: card.cmc ?? front?.cmc ?? 0,
    type_line: card.type_line ?? faces.map((f) => f.type_line ?? '').join(' // '),
    oracle_text: card.oracle_text ?? faces.map((f) => f.oracle_text ?? '').join('\n//\n'),
    flavor_text: card.flavor_text ?? (faces.map((f) => f.flavor_text ?? '').filter((t) => t !== '').join('\n') || null),
    power,
    toughness,
    loyalty,
    power_num: toNum(power),
    toughness_num: toNum(toughness),
    loyalty_num: toNum(loyalty),
    colors: canonColors(card.colors ?? faces.flatMap((f) => f.colors ?? [])),
    color_identity: canonColors(card.color_identity),
    keywords: JSON.stringify(card.keywords ?? []),
    legalities: JSON.stringify(card.legalities),
    games: JSON.stringify(card.games),
    finishes: JSON.stringify(card.finishes),
    artist: card.artist ?? front?.artist ?? null,
    prices: JSON.stringify({
      usd: card.prices.usd ?? null,
      usd_foil: card.prices.usd_foil ?? null,
      usd_etched: card.prices.usd_etched ?? null,
    }),
    image_normal: images?.normal ?? null,
    image_small: images?.small ?? null,
    image_art_crop: images?.art_crop ?? null,
    card_faces: faces.length > 0 ? JSON.stringify(storedFaces) : null,
    purchase_uris: card.purchase_uris ? JSON.stringify(card.purchase_uris) : null,
    scryfall_uri: card.scryfall_uri,
    is_promo: card.promo ? 1 : 0,
    is_digital: card.digital ? 1 : 0,
    set_type: card.set_type ?? '',
  }
}
