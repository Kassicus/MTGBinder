import { clampPos } from '../../shared/playtest/placement.ts'
import type { CardKind, CardState, Dest, Pos, SeatIndex } from '../../shared/playtest/types.ts'
import type { FormatId } from '../../shared/types.ts'

/** The playtest board's arithmetic (spec §5.9.3, §5.9.4), kept apart from React so it can be tested. */

/** A card is 63 × 88 mm. */
export const CARD_RATIO = 88 / 63

/** A battlefield card's height for a half this tall: 30% of it (its three rows just fit), from 56 to 150 px. */
export function cardHeight(halfHeight: number): number {
  return Math.round(Math.min(150, Math.max(56, halfHeight * 0.3)))
}

export interface Box {
  width: number
  height: number
}

/**
 * A spot's pixel position (the card's center) in its battlefield. The bottom half has its seat's edge at the bottom;
 * the top half is flipped, with its seat's edge at the top.
 */
export function toScreen(pos: Pos, box: Box, flipped: boolean): { x: number; y: number } {
  return { x: pos.x * box.width, y: (flipped ? pos.y : 1 - pos.y) * box.height }
}

/** The spot for a pixel position in a battlefield, kept on it. */
export function fromScreen(point: { x: number; y: number }, box: Box, flipped: boolean): Pos {
  const y = point.y / box.height
  return clampPos({ x: point.x / box.width, y: flipped ? y : 1 - y })
}

/** Starting life (spec §5.9.2): 40 when either deck is a Commander deck, else 20. */
export function startingLife(formats: readonly FormatId[]): number {
  return formats.includes('commander') ? 40 : 20
}

/** Playing a card (a double-click): a permanent to its default spot, an instant or sorcery onto the stack. */
export function playDest(kind: CardKind, seat: SeatIndex): Dest {
  return kind === 'spell' ? { zone: 'stack' } : { zone: 'battlefield', seat }
}

/** Clicking selected cards taps them all, unless they're all tapped already: then it untaps them. */
export function tapTo(cards: readonly CardState[]): boolean {
  return !cards.every((c) => c.tapped)
}

/** Whether moving a commander there first asks "Command zone instead?" (spec §5.9.5). */
export function asksCommandZone(card: CardState, to: Dest): boolean {
  return card.commander && ['graveyard', 'exile', 'hand', 'library'].includes(to.zone)
}

/** The cards whose centers fall inside a dragged box (pixels, in the battlefield). */
export function cardsInBox(
  cards: readonly CardState[],
  box: { left: number; top: number; right: number; bottom: number },
  field: Box,
  flipped: boolean,
): string[] {
  return cards
    .filter((c) => {
      if (!c.pos) return false
      const { x, y } = toScreen(c.pos, field, flipped)
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
    })
    .map((c) => c.id)
}

/** A counter's tag on a card: "+3/+3" for three +1/+1 counters, "◆4" for loyalty, else its name and number. */
export function counterTag(name: string, value: number): string {
  if (name === '+1/+1') return `+${value}/+${value}`
  if (name === '-1/-1') return `−${value}/−${value}`
  if (name === 'loyalty') return `◆${value}`
  return `${name} ${value}`
}

export type BoardKey = 'tap' | 'flip' | 'plus' | 'minus' | 'draw' | 'switch' | 'undo' | 'clear'

/**
 * What a key does on the board (spec §5.9.4), or null. Cmd+Z undoes (the one with Cmd); the rest are bare keys, and
 * none follows a `g` (which starts going to another page).
 */
export function boardKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, afterG: boolean): BoardKey | null {
  if (e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'z' && !e.shiftKey) return 'undo'
  if (e.metaKey || e.ctrlKey || e.altKey || afterG) return null
  switch (e.key) {
    case 't':
      return 'tap'
    case 'f':
      return 'flip'
    case '+':
    case '=':
      return 'plus'
    case '-':
      return 'minus'
    case 'd':
      return 'draw'
    case 'Tab':
      return e.shiftKey ? null : 'switch'
    case 'Escape':
      return 'clear'
    default:
      return null
  }
}
