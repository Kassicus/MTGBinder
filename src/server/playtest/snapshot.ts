import { OPENING_DRAW } from '../../shared/playtest/game.ts'
import { kindOf } from '../../shared/playtest/placement.ts'
import type { CardData, PlayFace, SeatSetup, SetupCard } from '../../shared/playtest/types.ts'
import type { StoredFace } from '../cards/map.ts'
import type { DB } from '../db/index.ts'
import { getDeckRow } from '../decks/repo.ts'
import { ApiError } from '../http.ts'

/** A deck needs this many main-board cards to be played (spec §5.9.2): as many as a mulligan draws. */
export const MIN_MAIN_CARDS = OPENING_DRAW

interface SnapshotRow {
  board: 'commander' | 'main'
  quantity: number
  /** Null for a line whose card is gone from the card data. */
  card_id: string | null
  name: string | null
  mana_cost: string
  type_line: string
  oracle_text: string
  power: string | null
  toughness: string | null
  loyalty: string | null
  colors: string
  image_small: string | null
  image_normal: string | null
  card_faces: string | null
}

// Each line's chosen printing, else its card's default printing (spec §4.1); commanders first, then by name.
const SNAPSHOT_SELECT = `
  SELECT dc.board, dc.quantity, c.id AS card_id, c.name, c.mana_cost, c.type_line, c.oracle_text, c.power, c.toughness,
    c.loyalty, c.colors, c.image_small, c.image_normal, c.card_faces
  FROM deck_cards dc
  LEFT JOIN card_names n ON n.oracle_id = dc.oracle_id
  LEFT JOIN cards c ON c.id = COALESCE(dc.preferred_card_id, n.default_card_id)
  WHERE dc.deck_id = ? AND dc.board IN ('commander', 'main')
  ORDER BY dc.board = 'main', c.name COLLATE NOCASE, dc.id`

/** A printing as a game card: its faces (each with its own image when it has one), front image, colors, and kind. */
export function cardDataOf(row: Omit<SnapshotRow, 'board' | 'quantity' | 'card_id'> & { name: string }): CardData {
  const stored = row.card_faces ? (JSON.parse(row.card_faces) as StoredFace[]) : []
  const faces: PlayFace[] =
    stored.length > 1
      ? stored.map((f, i) => ({
          name: f.name,
          manaCost: f.mana_cost,
          typeLine: f.type_line,
          oracleText: f.oracle_text,
          power: f.power,
          toughness: f.toughness,
          loyalty: f.loyalty,
          // A split or adventure card's halves share one image: the card's.
          image: f.image_normal ?? (i === 0 ? row.image_normal : null),
        }))
      : [
          {
            name: row.name,
            manaCost: row.mana_cost,
            typeLine: row.type_line,
            oracleText: row.oracle_text,
            power: row.power,
            toughness: row.toughness,
            loyalty: row.loyalty,
            image: row.image_normal,
          },
        ]
  return { name: row.name, faces, imageSmall: row.image_small, colors: row.colors, kind: kindOf(faces[0]!.typeLine) }
}

/**
 * A deck as a seat plays it (spec §5.9.1): one game card per copy on its commander and main boards, numbered
 * `<seat>-1`, `<seat>-2`, … Side and maybe boards are left out, and so are lines whose card is gone from the card data
 * (counted in `leftOut`). Throws a 404 for a deck that doesn't exist and a 400 for one too small to play.
 */
export function snapshotDeck(db: DB, deckId: number, seat: 1 | 2): SeatSetup {
  const deck = getDeckRow(db, deckId)
  if (!deck) throw new ApiError(404, 'not_found', 'That deck no longer exists')
  const rows = db.prepare(SNAPSHOT_SELECT).all(deckId) as SnapshotRow[]
  const cards: SetupCard[] = []
  let leftOut = 0
  let main = 0
  for (const row of rows) {
    if (row.card_id === null || row.name === null) {
      leftOut += row.quantity
      continue
    }
    const data = cardDataOf({ ...row, name: row.name })
    if (row.board === 'main') main += row.quantity
    for (let i = 0; i < row.quantity; i++) {
      cards.push({ id: `${seat}-${cards.length + 1}`, commander: row.board === 'commander', data })
    }
  }
  if (main < MIN_MAIN_CARDS) {
    throw new ApiError(
      400,
      'deck_too_small',
      `${deck.name} has ${main} main-board ${main === 1 ? 'card' : 'cards'}; a deck needs at least ${MIN_MAIN_CARDS} to play`,
    )
  }
  return { deckId, name: deck.name, format: deck.format, cards, leftOut }
}
