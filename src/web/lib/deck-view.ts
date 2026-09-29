import type { Board, BuyListItem, DeckDetail, DeckLine, DeckSummary } from '../../shared/types.ts'
import { BOARD_ORDER } from './decks.ts'
import { formatUsd, plural } from './format.ts'

/** Card types in the order the deck list shows them (spec §5.4.2). */
export const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land', 'Other'] as const
export type CardType = (typeof TYPE_ORDER)[number]

/**
 * The one type a card is listed under, judged on its front face: creatures first (artifact and enchantment creatures,
 * Dryad Arbor), then lands (artifact lands), then planeswalkers, battles, instants, sorceries, artifacts, enchantments.
 */
export function cardType(typeLine: string): CardType {
  const types = frontTypes(typeLine)
  for (const type of ['Creature', 'Land', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment'] as const) {
    if (types.includes(type)) return type
  }
  return 'Other'
}

/** The front face's supertypes and types, as whole words: "Land Creature — Forest Dryad" gives Land and Creature. */
function frontTypes(typeLine: string): string[] {
  const front = typeLine.split(' // ')[0] ?? ''
  return (front.split(' — ')[0] ?? '').split(' ')
}

export interface LineGroup {
  label: string
  count: number
  lines: DeckLine[]
}

export interface BoardSection {
  board: Board
  count: number
  groups: LineGroup[]
}

/**
 * A deck's lines by board, then by type (in TYPE_ORDER) or by category (alphabetical, "Uncategorized" last). Lines in
 * a group are sorted by mana value, then name. Empty boards are left out.
 */
export function groupLines(lines: readonly DeckLine[], by: 'type' | 'category'): BoardSection[] {
  return BOARD_ORDER.flatMap((board) => {
    const inBoard = lines.filter((l) => l.board === board)
    if (inBoard.length === 0) return []
    const groups = new Map<string, DeckLine[]>()
    for (const line of inBoard) {
      const label = by === 'type' ? cardType(line.typeLine) : (line.category ?? 'Uncategorized')
      const group = groups.get(label)
      if (group) group.push(line)
      else groups.set(label, [line])
    }
    const labels = [...groups.keys()].sort((a, b) =>
      by === 'type'
        ? TYPE_ORDER.indexOf(a as CardType) - TYPE_ORDER.indexOf(b as CardType)
        : a === 'Uncategorized' ? 1 : b === 'Uncategorized' ? -1 : a.localeCompare(b),
    )
    return [
      {
        board,
        count: inBoard.reduce((sum, l) => sum + l.quantity, 0),
        groups: labels.map((label) => {
          const group = (groups.get(label) ?? []).sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name))
          return { label, count: group.reduce((sum, l) => sum + l.quantity, 0), lines: group }
        }),
      },
    ]
  })
}

/**
 * Main-deck nonland copies per mana value, 0 through 6 and "7+" (spec §5.4.2 mana curve). A card with Land among its
 * front face's types is a land here, even when it's listed as a Creature (Dryad Arbor).
 */
export function manaCurve(lines: readonly DeckLine[]): Array<{ label: string; count: number }> {
  const buckets = Array.from({ length: 8 }, (_, i) => ({ label: i === 7 ? '7+' : String(i), count: 0 }))
  for (const line of lines) {
    if (line.board !== 'main' || frontTypes(line.typeLine).includes('Land')) continue
    const bucket = buckets[Math.min(7, Math.floor(line.cmc))]
    if (bucket) bucket.count += line.quantity
  }
  return buckets
}

/** Copies per card type in the deck proper (commander and main boards), in TYPE_ORDER, leaving out zero counts. */
export function typeCounts(lines: readonly DeckLine[]): Array<{ type: CardType; count: number }> {
  const counts = new Map<CardType, number>()
  for (const line of lines) {
    if (line.board !== 'main' && line.board !== 'commander') continue
    const type = cardType(line.typeLine)
    counts.set(type, (counts.get(type) ?? 0) + line.quantity)
  }
  return TYPE_ORDER.filter((t) => counts.has(t)).map((type) => ({ type, count: counts.get(type) ?? 0 }))
}

/**
 * A deck's completion (0–1) as a whole percent, rounded down. The hair added first stops float error from reading one
 * too low: 29 / 100 × 100 is 28.999999999999996.
 */
export function completionPercent(completion: number): number {
  return Math.floor(completion * 100 + 1e-9)
}

/** The buy list as plain text, "4 Lightning Bolt" per line (spec §5.4.2 "Copy as text"). */
export function buyListText(items: readonly BuyListItem[]): string {
  return items.map((i) => `${i.quantity} ${i.name}`).join('\n')
}

/**
 * Cards the deck is short of (every board but maybe), one entry per card: what "Mark as built" warns about. Each has
 * its `oracleId`, which tells cards apart when names don't (two cards gone from the card data share one).
 */
export function shortCards(lines: readonly DeckLine[]): Array<{ oracleId: string; name: string; short: number }> {
  const seen = new Map<string, { oracleId: string; name: string; short: number }>()
  for (const line of lines) {
    if (line.board !== 'maybe' && line.short > 0 && !seen.has(line.oracleId)) {
      seen.set(line.oracleId, { oracleId: line.oracleId, name: line.name, short: line.short })
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * What a line's status icon says. A maybe line is short of copies other built decks hold, of copies this built deck
 * uses on its other boards, or both: "2 held by other built decks, 1 already used by this deck".
 */
export function statusLabel(line: DeckLine): string {
  if (line.status === 'owned') return 'Owned'
  if (line.status === 'buy') return `Buy ${line.short}`
  if (line.board !== 'maybe') return `${line.short} held by other built decks`
  const elsewhere = Math.min(line.short, line.inOtherBuiltDecks)
  const own = line.short - elsewhere
  return [elsewhere > 0 && `${elsewhere} held by other built decks`, own > 0 && `${own} already used by this deck`]
    .filter(Boolean)
    .join(', ')
}

/**
 * Each card's format problems, once per card: a card on two boards has its warnings on both lines, but it's one card
 * with those problems. Each has its `oracleId`, as in shortCards.
 */
export function cardWarnings(lines: readonly DeckLine[]): Array<{ oracleId: string; name: string; warnings: string[] }> {
  const seen = new Map<string, { oracleId: string; name: string; warnings: string[] }>()
  for (const line of lines) {
    if (line.warnings.length > 0 && !seen.has(line.oracleId)) {
      seen.set(line.oracleId, { oracleId: line.oracleId, name: line.name, warnings: line.warnings })
    }
  }
  return [...seen.values()]
}

/** How many format warnings a deck has: its own, and each card's once. */
export function warningCount(deck: Pick<DeckDetail, 'warnings' | 'lines'>): number {
  return deck.warnings.length + cardWarnings(deck.lines).reduce((sum, c) => sum + c.warnings.length, 0)
}

/**
 * How much of the deck (every board but maybe) scanning into it has covered: each line counts its scanned copies up
 * to its quantity. Null when nothing was ever scanned into it.
 */
export function scannedProgress(lines: readonly DeckLine[]): { scanned: number; of: number } | null {
  if (!lines.some((l) => l.scanned > 0)) return null
  const counted = lines.filter((l) => l.board !== 'maybe')
  return {
    scanned: counted.reduce((sum, l) => sum + Math.min(l.scanned, l.quantity), 0),
    of: counted.reduce((sum, l) => sum + l.quantity, 0),
  }
}

/**
 * What finishing a deck costs, in words: "$12.34 to finish", "$12.34 to finish, and 2 cards without a price",
 * "2 cards to buy, without a price", or "Nothing to buy".
 */
export function costLabel(deck: Pick<DeckSummary, 'costToFinish' | 'unpricedToBuy'>): string {
  const unpriced = plural(deck.unpricedToBuy, 'card')
  if (deck.costToFinish > 0 && deck.unpricedToBuy > 0) return `${formatUsd(deck.costToFinish)} to finish, and ${unpriced} without a price`
  if (deck.costToFinish > 0) return `${formatUsd(deck.costToFinish)} to finish`
  if (deck.unpricedToBuy > 0) return `${unpriced} to buy, without a price`
  return 'Nothing to buy'
}

/** What the whole deck costs, in words: "$412.50 total", or "$412.50 total (2 cards without a price)". */
export function valueLabel(deck: Pick<DeckSummary, 'valueUsd' | 'unpricedCards'>): string {
  const total = `${formatUsd(deck.valueUsd)} total`
  return deck.unpricedCards > 0 ? `${total} (${plural(deck.unpricedCards, 'card')} without a price)` : total
}
