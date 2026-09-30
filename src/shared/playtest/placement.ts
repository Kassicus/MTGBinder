import type { CardKind, Pos } from './types.ts'

/**
 * Where a card entering the battlefield goes by default (spec §5.9.3): beside the last card of its kind, in its kind's
 * row. Lands run along the seat's own edge, creatures along the middle of the table, and other permanents between.
 */

/** Where a card goes on the battlefield, from its front face's type line. A land creature sits with the lands. */
export function kindOf(typeLine: string): CardKind {
  if (/\bLand\b/.test(typeLine)) return 'land'
  if (/\bCreature\b/.test(typeLine)) return 'creature'
  if (/\b(Instant|Sorcery)\b/.test(typeLine)) return 'spell'
  return 'other'
}

/** Each row's distance from the seat's edge. A spell resolving to the battlefield is placed as another permanent. */
export const ROW_Y: Record<CardKind, number> = { land: 0.2, other: 0.5, spell: 0.5, creature: 0.8 }
/** How far apart cards are placed, and where a row starts and ends. */
export const STEP = 0.07
export const ROW_START = 0.06
export const ROW_END = 0.94
/** A card this close to a row's line counts as in that row. */
const ROW_BAND = 0.12
/** Each time a full row wraps, the next pass sits this much further from the edge, so the cards stay apart. */
const WRAP_SHIFT = 0.05

/**
 * The spot for a card of `kind`, given the spots already taken on that seat's battlefield (the cards there, and any
 * placed earlier in the same move): right of the rightmost card in the row. Once the row is full, the first free spot
 * from the left, on the row's line or, when that's full too, a little further out each pass.
 */
export function defaultSpot(kind: CardKind, taken: readonly Pos[]): Pos {
  const y = ROW_Y[kind]
  const inRow = taken.filter((p) => Math.abs(p.y - y) < ROW_BAND)
  if (inRow.length === 0) return { x: ROW_START, y }
  const right = round(Math.max(...inRow.map((p) => p.x)) + STEP)
  if (right <= ROW_END) return { x: right, y }
  for (let pass = 0; pass < 10; pass++) {
    const passY = round(Math.min(0.97, y + WRAP_SHIFT * pass))
    for (let x = ROW_START; x <= ROW_END + 1e-9; x = round(x + STEP)) {
      const free = inRow.every((p) => Math.abs(p.x - x) >= STEP / 2 || Math.abs(p.y - passY) >= WRAP_SHIFT / 2)
      if (free) return { x, y: passY }
    }
  }
  return { x: ROW_START, y }
}

/** Keeps a dragged spot on the battlefield. */
export function clampPos(pos: Pos): Pos {
  return { x: round(Math.min(0.97, Math.max(0.03, pos.x))), y: round(Math.min(0.97, Math.max(0.03, pos.y))) }
}

/** Four decimal places are plenty for a spot, and keep saved games short. */
const round = (n: number) => Math.round(n * 10000) / 10000
