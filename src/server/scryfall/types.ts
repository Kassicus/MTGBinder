// The subset of Scryfall's JSON that Binder reads. https://scryfall.com/docs/api/cards

export interface ScryfallImageUris {
  small?: string
  normal?: string
  large?: string
  art_crop?: string
}

export interface ScryfallCardFace {
  name: string
  oracle_id?: string
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  flavor_text?: string
  colors?: string[]
  power?: string
  toughness?: string
  loyalty?: string
  artist?: string
  image_uris?: ScryfallImageUris
}

export interface ScryfallCard {
  id: string
  oracle_id?: string
  name: string
  lang: string
  layout: string
  released_at: string
  set: string
  set_name: string
  /** expansion, core, masters, commander, promo, box, memorabilia, funny, masterpiece, ... */
  set_type?: string
  collector_number: string
  rarity: string
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  flavor_text?: string
  power?: string
  toughness?: string
  loyalty?: string
  colors?: string[]
  color_identity: string[]
  keywords?: string[]
  legalities: Record<string, string>
  games: string[]
  finishes: string[]
  artist?: string
  prices: Record<string, string | null>
  image_uris?: ScryfallImageUris
  card_faces?: ScryfallCardFace[]
  purchase_uris?: Record<string, string>
  scryfall_uri: string
  promo: boolean
  digital: boolean
  oversized?: boolean
}

export interface ScryfallBulkData {
  type: string
  updated_at: string
  jsonl_download_uri?: string
  [key: string]: unknown
}

export interface ScryfallErrorBody {
  object: 'error'
  status: number
  code: string
  details: string
}

export interface ScryfallList<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  next_page?: string
  total_cards?: number
  /** Parts of a search query Scryfall ignored. */
  warnings?: string[]
}
