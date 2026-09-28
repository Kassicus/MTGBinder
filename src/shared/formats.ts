import { canonColors } from './colors.ts'
import type { Board, FormatId } from './types.ts'

export interface FormatRules {
  id: FormatId
  label: string
  /** Key in Scryfall's `legalities`, or null when anything goes (casual). */
  legality: string | null
  /** Main deck plus commanders must be exactly this many cards. */
  exactCards: number | null
  /** Main deck must have at least this many cards. */
  minCards: number | null
  /** Copies of one card across commander, main, and side boards (restricted cards: 1). */
  maxCopies: number | null
  /** Most sideboard cards; 0 means no sideboard. */
  maxSideboard: number | null
  /** `required`: 1–2 commanders; `none`: no commander board; `optional`: anything goes (casual). */
  commanders: 'required' | 'none' | 'optional'
}

const constructed = (id: FormatId, label: string): FormatRules => ({
  id,
  label,
  legality: id,
  exactCards: null,
  minCards: 60,
  maxCopies: 4,
  maxSideboard: 15,
  commanders: 'none',
})

/** Deck-building rules per format (spec §4.4). */
export const FORMATS: Record<FormatId, FormatRules> = {
  commander: {
    id: 'commander',
    label: 'Commander',
    legality: 'commander',
    exactCards: 100,
    minCards: null,
    maxCopies: 1,
    maxSideboard: 0,
    commanders: 'required',
  },
  standard: constructed('standard', 'Standard'),
  pioneer: constructed('pioneer', 'Pioneer'),
  modern: constructed('modern', 'Modern'),
  legacy: constructed('legacy', 'Legacy'),
  vintage: constructed('vintage', 'Vintage'),
  pauper: constructed('pauper', 'Pauper'),
  casual: {
    id: 'casual',
    label: 'Casual',
    legality: null,
    exactCards: null,
    minCards: null,
    maxCopies: null,
    maxSideboard: null,
    commanders: 'optional',
  },
}

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[]

/** What the format rules need to know about one card identity in a deck. */
export interface RuleCard {
  oracleId: string
  name: string
  typeLine: string
  oracleText: string
  keywords: readonly string[]
  /** WUBRG letters, '' for colorless. */
  colorIdentity: string
  legalities: Readonly<Record<string, string>>
  /** Copies on each board. */
  boards: Partial<Record<Board, number>>
}

export interface DeckCheck {
  /** Problems with the deck as a whole (size, sideboard, commanders). */
  deck: string[]
  /** Problems with individual cards, by oracle id (legality, copies, color identity, commander eligibility). */
  cards: Map<string, string[]>
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** A card's own copy limit: basic lands and "any number" cards have none; "up to seven" cards have their own. */
function ownCopyLimit(card: RuleCard): number | null {
  if (/\bBasic\b/.test(card.typeLine) || /A deck can have any number of cards named/.test(card.oracleText)) return Infinity
  const upTo = /A deck can have up to (\w+) cards named/.exec(card.oracleText)?.[1]
  if (upTo === undefined) return null
  const n = /^\d+$/.test(upTo) ? Number(upTo) : NUMBER_WORDS.indexOf(upTo.toLowerCase())
  return n >= 0 ? n : null
}

const frontType = (card: RuleCard) => card.typeLine.split(' // ')[0] ?? ''
const textLines = (card: RuleCard) => card.oracleText.split('\n')
const isBackground = (card: RuleCard) => frontType(card).includes('Background')

/**
 * Legendary creatures, cards that say they can be your commander, legendary cards that are creatures off the
 * battlefield (Grist, the Hunger Tide), and Backgrounds (as a second commander).
 */
function canCommand(card: RuleCard): boolean {
  const front = frontType(card)
  return (
    (front.includes('Legendary') && front.includes('Creature')) ||
    card.oracleText.includes('can be your commander') ||
    (front.includes('Legendary') && /isn't on the battlefield, it's a .*creature/.test(card.oracleText)) ||
    isBackground(card)
  )
}

/** The partner abilities a commander has: plain Partner, "Partner—<kind>", "Partner with <name>", and the rest. */
function partnering(card: RuleCard) {
  const lines = textLines(card)
  return {
    plain: lines.some((l) => l === 'Partner' || l.startsWith('Partner (')),
    kind: lines.map((l) => /^Partner—(.+?)(?: \(|$)/.exec(l)?.[1]).find((k) => k !== undefined),
    with: lines.map((l) => /^Partner with (.+?)(?: \(|$)/.exec(l)?.[1]).find((n) => n !== undefined),
    background: card.keywords.some((k) => k.toLowerCase() === 'choose a background'),
    companion: card.keywords.some((k) => k.toLowerCase() === "doctor's companion"),
    doctor: frontType(card).includes('Time Lord Doctor'),
  }
}

/** Whether two cards may share the command zone. */
function canPair(a: RuleCard, b: RuleCard): boolean {
  const pa = partnering(a)
  const pb = partnering(b)
  return (
    (pa.plain && pb.plain) ||
    (pa.kind !== undefined && pa.kind === pb.kind) ||
    (pa.with === b.name && pb.with === a.name) ||
    (pa.background && isBackground(b)) ||
    (pb.background && isBackground(a)) ||
    (pa.companion && pb.doctor) ||
    (pb.companion && pa.doctor)
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const copies = (n: number) => (n === 1 ? '1 copy' : `${n} copies`)

/**
 * Checks a deck against its format (spec §4.4). Warnings never block anything. Counting rules (size, sideboard,
 * copies, commanders) ignore the maybe board; legality and color identity apply to every card.
 */
export function checkDeck(formatId: FormatId, cards: readonly RuleCard[]): DeckCheck {
  const format = FORMATS[formatId]
  const deck: string[] = []
  const byCard = new Map<string, string[]>()
  const warn = (card: RuleCard, message: string) => {
    const list = byCard.get(card.oracleId) ?? []
    list.push(message)
    byCard.set(card.oracleId, list)
  }
  const count = (board: Board) => cards.reduce((sum, c) => sum + (c.boards[board] ?? 0), 0)
  const commanderCards = cards.filter((c) => (c.boards.commander ?? 0) > 0)
  const deckSize = count('main') + count('commander')

  if (format.exactCards !== null && deckSize !== format.exactCards) {
    deck.push(`${format.label} decks have exactly ${format.exactCards} cards, counting commanders (this one has ${deckSize})`)
  }
  if (format.minCards !== null && count('main') < format.minCards) {
    deck.push(`${format.label} decks need at least ${format.minCards} main-deck cards (this one has ${count('main')})`)
  }
  if (format.maxSideboard === 0 && count('side') > 0) {
    deck.push(`${format.label} decks have no sideboard (this one has ${plural(count('side'), 'card')})`)
  } else if (format.maxSideboard !== null && count('side') > format.maxSideboard) {
    deck.push(`Sideboards hold at most ${format.maxSideboard} cards (this one has ${count('side')})`)
  }

  if (format.commanders === 'required') {
    const n = count('commander')
    if (n === 0) deck.push('Choose a commander')
    else if (n > 2) deck.push(`A deck has at most 2 commanders (this one has ${n})`)
    for (const card of commanderCards) {
      if (!canCommand(card)) warn(card, "Can't be a commander")
    }
    const [first, second] = commanderCards
    if (n === 2 && first && second && commanderCards.length === 2 && !canPair(first, second)) {
      deck.push(`${first.name} and ${second.name} can't share the command zone (they need Partner, a Background, or Doctor's companion)`)
    }
    if (n === 1 && first && isBackground(first) && !frontType(first).includes('Creature')) {
      warn(first, 'A Background needs a commander that says "Choose a Background"')
    }
  } else if (format.commanders === 'none' && commanderCards.length > 0) {
    deck.push(`${format.label} decks have no commander; move ${plural(count('commander'), 'card')} to the main deck`)
  }

  const identity = new Set(commanderCards.flatMap((c) => [...c.colorIdentity]))
  for (const card of cards) {
    if (format.legality !== null) {
      const status = card.legalities[format.legality] ?? 'not_legal'
      if (status === 'banned') warn(card, `Banned in ${format.label}`)
      else if (status === 'not_legal') warn(card, `Not legal in ${format.label}`)
    }
    if (format.maxCopies !== null) {
      const inDeck = (card.boards.commander ?? 0) + (card.boards.main ?? 0) + (card.boards.side ?? 0)
      const restricted = format.legality !== null && card.legalities[format.legality] === 'restricted'
      const limit = ownCopyLimit(card) ?? (restricted ? 1 : format.maxCopies)
      if (inDeck > limit) warn(card, `${format.label} allows ${copies(limit)}${restricted ? ' (restricted)' : ''}; this deck has ${inDeck}`)
    }
    if (format.commanders === 'required' && commanderCards.length > 0 && (card.boards.commander ?? 0) === 0) {
      const outside = canonColors([...card.colorIdentity].filter((c) => !identity.has(c)))
      if (outside !== '') warn(card, `Outside the commander's color identity (${outside})`)
    }
  }
  return { deck, cards: byCard }
}
