import type { FormatId } from '../types.ts'

/**
 * The playtest's game (spec §5.9): a setup, plus the actions played, which `apply` turns into the board. Everything
 * here is plain data, so a game can be stored as JSON and replayed by the page and the server alike.
 */

/** Bumped whenever an old game's actions would no longer replay the same way (spec §5.9.7). */
export const MODEL_VERSION = 1

/** A seat: 0 is seat 1, 1 is seat 2. */
export type SeatIndex = 0 | 1

/** Where a card goes when it enters the battlefield by default, and what playing it does. An emblem goes to the command zone. */
export type CardKind = 'land' | 'creature' | 'other' | 'spell' | 'emblem'

/** One face of a card, as a game card carries it. */
export interface PlayFace {
  name: string
  manaCost: string
  typeLine: string
  oracleText: string
  power: string | null
  toughness: string | null
  loyalty: string | null
  /** Scryfall's normal image of this face (the card's own image for the front of a single-image card). */
  image: string | null
}

/** What a game card is: a snapshot of the printing, never changed by the game. */
export interface CardData {
  name: string
  /** At least one; the front first. */
  faces: PlayFace[]
  /** The front's small image, for cards on the board. */
  imageSmall: string | null
  /** WUBRG letters ('' for colorless), for a token's text frame. */
  colors: string
  kind: CardKind
  /**
   * The tokens and emblems the card makes (spec §5.9.8), from the card data. Missing for a token, and for a card from
   * card data imported before Binder knew tokens.
   */
  tokens?: CardData[]
}

/** One card in a deck snapshot. */
export interface SetupCard {
  /** Unique in the game: `1-17` is seat 1's 17th card. */
  id: string
  commander: boolean
  data: CardData
}

export interface SeatSetup {
  deckId: number
  /** The deck's name, which names the seat in the game. */
  name: string
  format: FormatId
  /** Commander-board and main-board cards, one per copy. */
  cards: SetupCard[]
  /** Copies left out because their card is gone from the card data (spec §5.4.2). */
  leftOut: number
}

export interface Setup {
  version: number
  /** Seeds the shuffles. */
  seed: number
  /** One seat when goldfishing. */
  seats: SeatSetup[]
  startingSeat: SeatIndex
  life: number
  /** Whether the starting seat draws on turn 1. */
  startingDraws: boolean
}

/**
 * A spot on the battlefield: the card's center, as fractions of its controller's half. `x` runs left to right; `y` runs
 * from that seat's own edge (0) to the middle of the table (1).
 */
export interface Pos {
  x: number
  y: number
}

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack'
/** The zones each seat has; the stack is shared. */
export type SeatZone = Exclude<Zone, 'stack'>
export const SEAT_ZONES: readonly SeatZone[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']

export interface CardState {
  id: string
  owner: SeatIndex
  /** Who controls it: its owner, unless it was dragged onto the other seat's battlefield. */
  controller: SeatIndex
  zone: Zone
  commander: boolean
  token: boolean
  /** The rest only mean something on the battlefield, and reset when a card leaves it. */
  tapped: boolean
  faceDown: boolean
  /** The face showing (a double-faced card's back is 1). */
  face: number
  counters: Record<string, number>
  attachedTo: string | null
  pos: Pos | null
}

/** Something on the stack: a spell (a card) or an ability marker naming the card it came from. */
export type StackItem =
  | { kind: 'spell'; id: string }
  | { kind: 'ability'; id: string; source: string; controller: SeatIndex; name: string }

export interface SeatState {
  name: string
  life: number
  poison: number
  /** Damage taken from each enemy commander, by its card id. */
  commanderDamage: Record<string, number>
  /** Times each of its own commanders left the command zone for the stack or the battlefield (tax is 2 each). */
  casts: Record<string, number>
  drewFromEmpty: boolean
  /** Top card first. */
  library: string[]
  hand: string[]
  /** Bottom to top: the last card is drawn over the others. */
  battlefield: string[]
  /** Oldest first: the last card is the pile's top. */
  graveyard: string[]
  exile: string[]
  command: string[]
}

export interface GameState {
  seats: SeatState[]
  cards: Record<string, CardState>
  /** What each card is, by id: the decks' cards and every token made. */
  data: Record<string, CardData>
  /** Bottom to top. */
  stack: StackItem[]
  /** The shuffles' random number generator. */
  rng: number
  phase: 'mulligan' | 'playing'
  /** During mulligans: the seat choosing, and its mulligans so far. */
  choosing: SeatIndex
  mulligans: number
  /** 0 during mulligans. */
  turn: number
  active: SeatIndex
  startingSeat: SeatIndex
  startingDraws: boolean
  /** Numbers new tokens and ability markers. */
  nextId: number
}

/** Where a move sends cards. Hands, libraries, graveyards, exile, and command zones are always their owners'. */
export type Dest =
  | { zone: 'hand' | 'graveyard' | 'exile' | 'command' | 'stack' }
  | { zone: 'library'; at: 'top' | 'bottom' }
  /** `seat` controls them there; `at` gives each card's spot, else each goes to its default spot. */
  | { zone: 'battlefield'; seat: SeatIndex; at?: Pos[] }

export type Action =
  | { type: 'mulligan'; seat: SeatIndex }
  /** Keeps the hand but `bottom`, which go under the library: the first one ends up at the very bottom. */
  | { type: 'keep'; seat: SeatIndex; bottom: string[] }
  | { type: 'draw'; seat: SeatIndex; count: number }
  /** For the library's top, the first card ends up on top; for its bottom, at the very bottom. */
  | { type: 'move'; ids: string[]; to: Dest }
  | { type: 'tap'; ids: string[]; tapped: boolean }
  | { type: 'flip'; id: string }
  | { type: 'faceDown'; ids: string[]; down: boolean }
  | { type: 'counter'; ids: string[]; name: string; delta: number }
  | { type: 'setCounter'; ids: string[]; name: string; value: number }
  | { type: 'attach'; id: string; to: string | null }
  /** Makes `count` tokens of `token` on `seat`'s battlefield, or, for an emblem, in its command zone. */
  | { type: 'token'; seat: SeatIndex; token: CardData; count: number }
  | { type: 'copy'; id: string }
  | { type: 'ability'; id: string }
  | { type: 'resolve'; item: string }
  | { type: 'life'; seat: SeatIndex; delta: number }
  | { type: 'poison'; seat: SeatIndex; delta: number }
  | { type: 'commanderDamage'; seat: SeatIndex; commander: string; delta: number }
  | { type: 'shuffle'; seat: SeatIndex }
  | { type: 'mill'; seat: SeatIndex; count: number }
  | { type: 'reveal'; ids: string[] }
  /** Looking at the library's top cards: each goes somewhere, and together they are exactly the top cards. */
  | { type: 'arrange'; seat: SeatIndex; top: string[]; bottom: string[]; graveyard: string[]; hand: string[]; exile: string[] }
  | { type: 'search'; seat: SeatIndex; ids: string[]; to: Dest; shuffle: boolean }
  | { type: 'nextTurn' }

/** A saved game: when it started (which names it), its setup, and the actions played, in order. */
export interface SavedGame {
  startedAt: string
  setup: Setup
  actions: Action[]
}
