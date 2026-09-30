import type { CardState, GameState, PlayFace, SeatIndex, SeatState } from './types.ts'

/** What the board works out from the game (spec §5.9.5, §5.9.6). */

export const LOSING_POISON = 10
export const LOSING_COMMANDER_DAMAGE = 21

/** Why a seat would have lost: 0 life or less, 10 poison, 21 from one commander, or a draw from an empty library. */
export function losingReasons(seat: SeatState): string[] {
  const reasons: string[] = []
  if (seat.life <= 0) reasons.push(`${seat.life} life`)
  if (seat.poison >= LOSING_POISON) reasons.push(`${seat.poison} poison`)
  if (Object.values(seat.commanderDamage).some((n) => n >= LOSING_COMMANDER_DAMAGE)) reasons.push('21 commander damage')
  if (seat.drewFromEmpty) reasons.push('drew from an empty library')
  return reasons
}

/** A commander's tax: 2 for each time it left the command zone for the stack or the battlefield. */
export function commanderTax(game: GameState, id: string): number {
  const c = game.cards[id]
  return c ? 2 * (game.seats[c.owner]!.casts[id] ?? 0) : 0
}

/** The face showing. */
export function faceOf(game: GameState, c: CardState): PlayFace {
  const faces = game.data[c.id]!.faces
  return faces[c.face] ?? faces[0]!
}

/** Whether a card has a back face to turn to (a double-faced card: each face has its own image). */
export function canFlip(game: GameState, id: string): boolean {
  const faces = game.data[id]?.faces ?? []
  return faces.length > 1 && faces.every((f) => f.image !== null)
}

/**
 * Whether `viewer` can see what a card is: anything in a public zone (the battlefield, the stack, graveyards, exile,
 * command zones), and the cards in its own hand. A face-down card shows only to its controller. Libraries are hidden,
 * except to their own seat while it looks at them, which the page handles on its own.
 */
export function visibleTo(c: CardState, viewer: SeatIndex): boolean {
  if (c.zone === 'library') return false
  if (c.zone === 'hand') return c.owner === viewer
  if (c.zone === 'battlefield' && c.faceDown) return c.controller === viewer
  return true
}

/** Every card on a seat's side that isn't tucked under another card, bottom to top. */
export function looseCards(game: GameState, seat: SeatIndex): CardState[] {
  return game.seats[seat]!.battlefield.map((id) => game.cards[id]!).filter((c) => !isTucked(game, c))
}

/** An attached card is drawn under its host when the host is on the same side. */
export function isTucked(game: GameState, c: CardState): boolean {
  if (c.attachedTo === null) return false
  const host = game.cards[c.attachedTo]
  return host !== undefined && host.zone === 'battlefield' && host.controller === c.controller
}

/** The cards tucked under a host, in their order on the battlefield (bottom to top). */
export function attachmentsOf(game: GameState, host: CardState): CardState[] {
  return game.seats[host.controller]!.battlefield.map((id) => game.cards[id]!).filter((c) => c.attachedTo === host.id && isTucked(game, c))
}
