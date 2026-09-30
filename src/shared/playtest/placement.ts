import type { CardKind, Pos } from './types.ts'

/**
 * Where a card entering the battlefield goes by default (spec §5.9.3): beside the last card of its kind, in its kind's
 * row. Lands run along the seat's own edge, creatures along the middle of the table, and other permanents between.
 */

/**
 * Where a card goes on the battlefield, from its front face's type line. A land creature sits with the lands; an
 * emblem goes to the command zone instead.
 */
export function kindOf(typeLine: string): CardKind {
  if (/^Emblem\b/.test(typeLine)) return 'emblem'
  if (/\bLand\b/.test(typeLine)) return 'land'
  if (/\bCreature\b/.test(typeLine)) return 'creature'
  if (/\b(Instant|Sorcery)\b/.test(typeLine)) return 'spell'
  return 'other'
}

/**
 * Each row's distance from the seat's edge. A spell resolving to the battlefield is placed as another permanent, and
 * so is an emblem dragged there.
 */
export const ROW_Y: Record<CardKind, number> = { land: 0.2, other: 0.5, spell: 0.5, emblem: 0.5, creature: 0.8 }
/** How far apart cards are placed, and where a row starts and ends. */
export const STEP = 0.07
export const ROW_START = 0.06
export const ROW_END = 0.94
/** A card this close to a row's line counts as in that row. */
const ROW_BAND = 0.12
/** Each time a full row wraps, the next pass sits this much further from the edge, so the cards stay apart. */
const WRAP_SHIFT = 0.05
/** How many passes a full row makes before its cards start sharing spots. */
const PASSES = 10
/** How many spots fit along a row, STEP apart from ROW_START to ROW_END. */
const SLOTS = Math.floor((ROW_END - ROW_START) / STEP + 1e-9) + 1

/**
 * The spot for a card of `kind`, given the spots already taken on that seat's battlefield (the cards there, and any
 * placed earlier in the same move): right of the rightmost card in the row. Once the row is full, the first free spot
 * from the left, on the row's line or, when that's full too, a little further out each pass. Once every pass is full,
 * the row's spots in turn, half a pass out from its line, so the cards keep spreading rather than pile up on one spot.
 */
export function defaultSpot(kind: CardKind, taken: readonly Pos[]): Pos {
  const y = ROW_Y[kind]
  const inRow = taken.filter((p) => Math.abs(p.y - y) < ROW_BAND)
  if (inRow.length === 0) return { x: ROW_START, y }
  const right = round(Math.max(...inRow.map((p) => p.x)) + STEP)
  if (right <= ROW_END) return { x: right, y }
  const passY = (pass: number) => round(Math.min(0.97, y + WRAP_SHIFT * pass))
  for (let pass = 0; pass < PASSES; pass++) {
    const line = passY(pass)
    for (let slot = 0; slot < SLOTS; slot++) {
      const x = slotX(slot)
      // Every taken spot counts, not just the row's: the later passes sit beyond the row's band.
      const free = taken.every((p) => Math.abs(p.x - x) >= STEP / 2 || Math.abs(p.y - line) >= WRAP_SHIFT / 2)
      if (free) return { x, y: line }
    }
  }
  // Every pass is full: each card in the band the passes cover moves the next one a spot further along the row.
  const band = taken.filter((p) => p.y > y - WRAP_SHIFT / 2 && p.y < passY(PASSES - 1) + WRAP_SHIFT / 2).length
  return clampPos({ x: slotX(band % SLOTS), y: y + WRAP_SHIFT / 2 })
}

/** The x of a row's spot, counting from its left. */
const slotX = (slot: number) => round(ROW_START + STEP * slot)

/** Keeps a dragged spot on the battlefield. */
export function clampPos(pos: Pos): Pos {
  return { x: round(Math.min(0.97, Math.max(0.03, pos.x))), y: round(Math.min(0.97, Math.max(0.03, pos.y))) }
}

/** Four decimal places are plenty for a spot, and keep saved games short. */
const round = (n: number) => Math.round(n * 10000) / 10000
