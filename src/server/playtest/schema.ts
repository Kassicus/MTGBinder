import { z } from 'zod'
import type { Action, CardData, Dest } from '../../shared/playtest/types.ts'

/**
 * The shapes the playtest routes accept (spec §6: every body is checked at the route). Typed against the game's own
 * types, so a change to an action that isn't made here too fails the typecheck.
 */

const Seat = z.union([z.literal(0), z.literal(1)])
const Id = z.string().min(1).max(40)
const Ids = z.array(Id).min(1).max(200)
const Text = (max: number) => z.string().max(max)
const Count = z.number().int().min(1).max(100)
const Delta = z.number().int().min(-10_000).max(10_000)
const Pos = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })

const Face = z.object({
  name: Text(200),
  manaCost: Text(200),
  typeLine: Text(200),
  oracleText: Text(5000),
  power: Text(20).nullable(),
  toughness: Text(20).nullable(),
  loyalty: Text(20).nullable(),
  image: Text(500).nullable(),
})

const Card: z.ZodType<CardData> = z.object({
  name: z.string().trim().min(1).max(200),
  faces: z.array(Face).min(1).max(4),
  imageSmall: Text(500).nullable(),
  colors: z.string().regex(/^[WUBRG]{0,5}$/),
  kind: z.enum(['land', 'creature', 'other', 'spell', 'emblem']),
})

const DestSchema: z.ZodType<Dest> = z.union([
  z.object({ zone: z.enum(['hand', 'graveyard', 'exile', 'command', 'stack']) }),
  z.object({ zone: z.literal('library'), at: z.enum(['top', 'bottom']) }),
  z.object({ zone: z.literal('battlefield'), seat: Seat, at: z.array(Pos).max(200).optional() }),
])

export const ActionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mulligan'), seat: Seat }),
  z.object({ type: z.literal('keep'), seat: Seat, bottom: z.array(Id).max(10) }),
  z.object({ type: z.literal('draw'), seat: Seat, count: Count }),
  z.object({ type: z.literal('move'), ids: Ids, to: DestSchema }),
  z.object({ type: z.literal('tap'), ids: Ids, tapped: z.boolean() }),
  z.object({ type: z.literal('flip'), id: Id }),
  z.object({ type: z.literal('faceDown'), ids: Ids, down: z.boolean() }),
  z.object({ type: z.literal('counter'), ids: Ids, name: Text(40), delta: Delta }),
  z.object({ type: z.literal('setCounter'), ids: Ids, name: Text(40), value: z.number().int().min(0).max(10_000) }),
  z.object({ type: z.literal('attach'), id: Id, to: Id.nullable() }),
  z.object({ type: z.literal('token'), seat: Seat, token: Card, count: Count }),
  z.object({ type: z.literal('copy'), id: Id }),
  z.object({ type: z.literal('ability'), id: Id }),
  z.object({ type: z.literal('resolve'), item: Id }),
  z.object({ type: z.literal('life'), seat: Seat, delta: Delta }),
  z.object({ type: z.literal('poison'), seat: Seat, delta: Delta }),
  z.object({ type: z.literal('commanderDamage'), seat: Seat, commander: Id, delta: Delta }),
  z.object({ type: z.literal('shuffle'), seat: Seat }),
  z.object({ type: z.literal('mill'), seat: Seat, count: Count }),
  z.object({ type: z.literal('reveal'), ids: Ids }),
  z.object({
    type: z.literal('arrange'),
    seat: Seat,
    top: z.array(Id).max(100),
    bottom: z.array(Id).max(100),
    graveyard: z.array(Id).max(100),
    hand: z.array(Id).max(100),
    exile: z.array(Id).max(100),
  }),
  z.object({ type: z.literal('search'), seat: Seat, ids: Ids, to: DestSchema, shuffle: z.boolean() }),
  z.object({ type: z.literal('nextTurn') }),
])

export const StartBody = z.object({
  /** Seat 1's deck, and seat 2's or null to goldfish. */
  decks: z.tuple([z.number().int().min(1), z.number().int().min(1).nullable()]),
  first: z.union([z.literal('random'), Seat]),
  life: z.number().int().min(1).max(999),
  startingDraws: z.boolean(),
})

/** Names the game an action is for: when it started, as the game says. */
const StartedAt = z.string().min(1).max(40)

export const AppendBody = z.object({ startedAt: StartedAt, seq: z.number().int().min(0), action: ActionSchema })

/** Undo's query: the game, and the position of the action taken back. */
export const UndoQuery = z.object({
  startedAt: StartedAt,
  seq: z.string().regex(/^(0|[1-9]\d{0,8})$/, 'must be a whole number from 0').transform(Number),
})
