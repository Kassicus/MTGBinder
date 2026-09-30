import { clampPos, defaultSpot } from './placement.ts'
import { shuffled } from './rng.ts'
import { attachmentsOf, faceOf, isTucked, looseCards } from './status.ts'
import {
  MODEL_VERSION,
  type Action,
  type CardData,
  type CardState,
  type Dest,
  type GameState,
  type Pos,
  type SeatIndex,
  type SeatState,
  type Setup,
} from './types.ts'

/** An action that doesn't fit the game: a card that isn't where the action needs it, a seat that isn't playing. */
export class PlaytestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaytestError'
  }
}

/** My playgroup's mulligan (spec §5.9.2): draw 10, keep 7. */
export const OPENING_DRAW = 10
export const KEEP = 7
/** The most of anything one action makes or draws. */
export const MAX_COUNT = 100

/**
 * The game before any action: every seat's life, commanders in the command zone, the rest shuffled into the library
 * (seat 1's first, then seat 2's), and the starting seat's first 10 cards drawn for its mulligan.
 */
export function startGame(setup: Setup): GameState {
  if (setup.version !== MODEL_VERSION) throw new PlaytestError('This game was saved by another version of Binder')
  if (setup.seats.length < 1 || setup.seats.length > 2) throw new PlaytestError('A game has one or two seats')
  if (setup.startingSeat >= setup.seats.length) throw new PlaytestError('The starting seat is not playing')
  let rng = setup.seed >>> 0
  const cards: Record<string, CardState> = {}
  const data: Record<string, CardData> = {}
  const seats = setup.seats.map((seatSetup, i): SeatState => {
    const owner = i as SeatIndex
    for (const card of seatSetup.cards) {
      if (cards[card.id]) throw new PlaytestError(`Two cards have the id ${card.id}`)
      cards[card.id] = blankCard(card.id, owner, card.commander ? 'command' : 'library', card.commander, false)
      data[card.id] = card.data
    }
    let library: string[]
    ;[library, rng] = shuffled(
      seatSetup.cards.filter((c) => !c.commander).map((c) => c.id),
      rng,
    )
    return {
      name: seatSetup.name,
      life: setup.life,
      poison: 0,
      commanderDamage: {},
      casts: {},
      drewFromEmpty: false,
      library,
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: seatSetup.cards.filter((c) => c.commander).map((c) => c.id),
    }
  })
  const state: GameState = {
    seats,
    cards,
    data,
    stack: [],
    rng,
    phase: 'mulligan',
    choosing: setup.startingSeat,
    mulligans: 0,
    turn: 0,
    active: setup.startingSeat,
    startingSeat: setup.startingSeat,
    startingDraws: setup.startingDraws,
    nextId: 1,
  }
  drawCards(state, setup.startingSeat, OPENING_DRAW)
  return state
}

/** The game after every action, in order. Throws PlaytestError at the first one that doesn't apply. */
export function replay(setup: Setup, actions: readonly Action[]): GameState {
  return actions.reduce(apply, startGame(setup))
}

/**
 * The game after one more action. The game passed in is never changed: what the action touches is copied, and the
 * rest is shared, so a card the action didn't touch is the same object before and after.
 */
export function apply(state: GameState, action: Action): GameState {
  const mulliganAction = action.type === 'mulligan' || action.type === 'keep'
  if (state.phase === 'mulligan' && !mulliganAction) throw new PlaytestError('Finish the mulligans first')
  if (state.phase === 'playing' && mulliganAction) throw new PlaytestError('The mulligans are over')
  const d: GameState = { ...state, seats: state.seats.map((s) => ({ ...s })), cards: { ...state.cards }, stack: [...state.stack] }

  switch (action.type) {
    case 'mulligan': {
      choosingSeat(d, action.seat)
      const seat = d.seats[action.seat]!
      for (const id of seat.hand) setCard(d, id, { zone: 'library' })
      ;[seat.library, d.rng] = shuffled([...seat.hand, ...seat.library], d.rng)
      seat.hand = []
      drawCards(d, action.seat, OPENING_DRAW)
      d.mulligans++
      break
    }
    case 'keep': {
      choosingSeat(d, action.seat)
      const seat = d.seats[action.seat]!
      distinct(action.bottom)
      const toBottom = Math.max(0, seat.hand.length - KEEP)
      if (action.bottom.length !== toBottom) throw new PlaytestError(`Put exactly ${toBottom} cards on the bottom`)
      for (const id of action.bottom) inZone(d, id, 'hand', action.seat)
      moveAll(d, action.bottom, { zone: 'library', at: 'bottom' })
      if (d.seats.length === 2 && action.seat === d.startingSeat) {
        d.choosing = other(action.seat)
        d.mulligans = 0
        drawCards(d, d.choosing, OPENING_DRAW)
      } else {
        d.phase = 'playing'
        d.turn = 1
        d.active = d.startingSeat
        if (d.startingDraws) drawCards(d, d.startingSeat, 1)
      }
      break
    }
    case 'draw':
      seatOf(d, action.seat)
      drawCards(d, action.seat, count(action.count))
      break
    case 'move':
      distinct(action.ids)
      for (const id of action.ids) card(d, id)
      moveAll(d, action.ids, action.to)
      break
    case 'tap':
      distinct(action.ids)
      for (const id of action.ids) setCard(d, onBattlefield(d, id).id, { tapped: action.tapped })
      break
    case 'flip': {
      const c = onBattlefield(d, action.id)
      const faces = d.data[c.id]!.faces.length
      if (faces < 2) throw new PlaytestError(`${nameOf(d, c.id)} has only one face`)
      setCard(d, c.id, { face: (c.face + 1) % faces })
      break
    }
    case 'faceDown':
      distinct(action.ids)
      for (const id of action.ids) setCard(d, onBattlefield(d, id).id, { faceDown: action.down })
      break
    case 'counter':
    case 'setCounter': {
      distinct(action.ids)
      const name = action.name.trim()
      if (name === '') throw new PlaytestError('A counter needs a name')
      for (const id of action.ids) {
        const c = onBattlefield(d, id)
        const was = c.counters[name] ?? 0
        const value = action.type === 'counter' ? Math.max(0, was + whole(action.delta)) : Math.max(0, whole(action.value))
        const counters = { ...c.counters }
        if (value === 0) delete counters[name]
        else counters[name] = value
        setCard(d, id, { counters })
      }
      break
    }
    case 'attach': {
      const c = onBattlefield(d, action.id)
      if (action.to === null) {
        detach(d, c)
        break
      }
      onBattlefield(d, action.to)
      // Following the host's own host must never lead back to the card: that would attach it to itself.
      for (let host: string | null = action.to; host !== null; host = d.cards[host]?.attachedTo ?? null) {
        if (host === c.id) throw new PlaytestError(`${nameOf(d, c.id)} can't be attached to itself`)
      }
      setCard(d, c.id, { attachedTo: action.to })
      break
    }
    case 'token': {
      seatOf(d, action.seat)
      d.data = { ...d.data }
      for (let i = 0; i < count(action.count); i++) {
        const id = `t${d.nextId++}`
        d.data[id] = action.token
        d.cards[id] = blankCard(id, action.seat, 'battlefield', false, true)
        placeOnBattlefield(d, id, action.seat)
      }
      break
    }
    case 'copy': {
      const source = onBattlefield(d, action.id)
      const id = `t${d.nextId++}`
      d.data = { ...d.data, [id]: d.data[source.id]! }
      // A copy of a transformed double-faced card is a copy of the face showing.
      d.cards[id] = { ...blankCard(id, source.controller, 'battlefield', false, true), face: source.face }
      placeOnBattlefield(d, id, source.controller)
      break
    }
    case 'ability': {
      const c = card(d, action.id)
      if (c.zone === 'library') throw new PlaytestError("A card in the library can't use an ability")
      // Both seats see the stack, so a face-down card's marker mustn't say what the card is.
      const name = c.zone === 'battlefield' && c.faceDown ? 'A face-down card' : faceOf(d, c).name
      d.stack.push({ kind: 'ability', id: `m${d.nextId++}`, source: c.id, controller: c.controller, name })
      break
    }
    case 'resolve': {
      const item = d.stack.find((i) => i.id === action.item)
      if (!item) throw new PlaytestError('That is no longer on the stack')
      if (item.kind === 'ability') {
        d.stack = d.stack.filter((i) => i !== item)
      } else {
        const c = card(d, item.id)
        const permanent = d.data[c.id]!.kind !== 'spell'
        moveAll(d, [c.id], permanent ? { zone: 'battlefield', seat: c.controller } : { zone: 'graveyard' })
      }
      break
    }
    case 'life':
      seatOf(d, action.seat).life += whole(action.delta)
      break
    case 'poison': {
      const seat = seatOf(d, action.seat)
      seat.poison = Math.max(0, seat.poison + whole(action.delta))
      break
    }
    case 'commanderDamage': {
      const seat = seatOf(d, action.seat)
      const commander = card(d, action.commander)
      if (!commander.commander || commander.owner === action.seat) {
        throw new PlaytestError(`${nameOf(d, commander.id)} isn't an enemy commander`)
      }
      const value = Math.max(0, (seat.commanderDamage[commander.id] ?? 0) + whole(action.delta))
      seat.commanderDamage = { ...seat.commanderDamage, [commander.id]: value }
      break
    }
    case 'shuffle': {
      const seat = seatOf(d, action.seat)
      ;[seat.library, d.rng] = shuffled(seat.library, d.rng)
      break
    }
    case 'mill': {
      const seat = seatOf(d, action.seat)
      moveAll(d, seat.library.slice(0, count(action.count)), { zone: 'graveyard' })
      break
    }
    case 'reveal':
      distinct(action.ids)
      for (const id of action.ids) card(d, id)
      break
    case 'arrange': {
      const seat = seatOf(d, action.seat)
      const { top, bottom, graveyard, hand, exile } = action
      const all = [...top, ...bottom, ...graveyard, ...hand, ...exile]
      distinct(all)
      const looked = new Set(seat.library.slice(0, all.length))
      if (!all.every((id) => looked.has(id))) throw new PlaytestError('Those are not the top cards of the library')
      seat.library = [...top, ...seat.library.slice(all.length)]
      moveAll(d, bottom, { zone: 'library', at: 'bottom' })
      moveAll(d, graveyard, { zone: 'graveyard' })
      moveAll(d, hand, { zone: 'hand' })
      moveAll(d, exile, { zone: 'exile' })
      break
    }
    case 'search': {
      const seat = seatOf(d, action.seat)
      distinct(action.ids)
      for (const id of action.ids) inZone(d, id, 'library', action.seat)
      // A tutor back into the library ("shuffle, then put that card on top") shuffles the rest first, so the cards
      // found stay where they're put; anywhere else, the library is shuffled after they've left it.
      const intoLibrary = action.to.zone === 'library'
      if (action.shuffle && intoLibrary) {
        const found = new Set(action.ids)
        ;[seat.library, d.rng] = shuffled(seat.library.filter((id) => !found.has(id)), d.rng)
      }
      moveAll(d, action.ids, action.to)
      if (action.shuffle && !intoLibrary) [seat.library, d.rng] = shuffled(seat.library, d.rng)
      break
    }
    case 'nextTurn': {
      d.turn++
      d.active = d.seats.length === 2 ? other(d.active) : d.active
      for (const id of d.seats[d.active]!.battlefield) {
        if (d.cards[id]!.tapped) setCard(d, id, { tapped: false })
      }
      drawCards(d, d.active, 1)
      break
    }
  }
  return d
}

/** A card with nothing on it yet. */
function blankCard(id: string, owner: SeatIndex, zone: CardState['zone'], commander: boolean, token: boolean): CardState {
  return {
    id,
    owner,
    controller: owner,
    zone,
    commander,
    token,
    tapped: false,
    faceDown: false,
    face: 0,
    counters: {},
    attachedTo: null,
    pos: null,
  }
}

const other = (seat: SeatIndex): SeatIndex => (seat === 0 ? 1 : 0)

function seatOf(d: GameState, seat: SeatIndex): SeatState {
  const found = d.seats[seat]
  if (!found) throw new PlaytestError('That seat is not playing')
  return found
}

function choosingSeat(d: GameState, seat: SeatIndex): void {
  seatOf(d, seat)
  if (seat !== d.choosing) throw new PlaytestError("It's the other seat's turn to choose its hand")
}

/**
 * A card of the game. Ids come from saved actions, so only the game's own cards count: an id like `constructor` or
 * `__proto__` names something every object has, not a card.
 */
function card(d: GameState, id: string): CardState {
  if (!Object.hasOwn(d.cards, id)) throw new PlaytestError('That card is no longer in the game')
  return d.cards[id]!
}

function inZone(d: GameState, id: string, zone: CardState['zone'], seat: SeatIndex): CardState {
  const c = card(d, id)
  if (c.zone !== zone || c.owner !== seat) throw new PlaytestError(`${nameOf(d, id)} isn't in that ${zone}`)
  return c
}

function onBattlefield(d: GameState, id: string): CardState {
  const c = card(d, id)
  if (c.zone !== 'battlefield') throw new PlaytestError(`${nameOf(d, id)} isn't on the battlefield`)
  return c
}

const nameOf = (d: GameState, id: string) => d.data[id]?.name ?? 'That card'

function distinct(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) throw new PlaytestError('A card is named twice')
}

function whole(n: number): number {
  if (!Number.isInteger(n)) throw new PlaytestError('Counts are whole numbers')
  return n
}

function count(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) throw new PlaytestError(`Counts run from 1 to ${MAX_COUNT}`)
  return n
}

function setCard(d: GameState, id: string, patch: Partial<CardState>): void {
  d.cards[id] = { ...d.cards[id]!, ...patch }
}

/** Draws cards one at a time; drawing from an empty library marks the seat (spec §5.9.5) and stops. */
function drawCards(d: GameState, seatIndex: SeatIndex, n: number): void {
  const seat = d.seats[seatIndex]!
  for (let i = 0; i < n; i++) {
    const [top, ...rest] = seat.library
    if (top === undefined) {
      seat.drewFromEmpty = true
      return
    }
    seat.library = rest
    seat.hand = [...seat.hand, top]
    setCard(d, top, { zone: 'hand' })
  }
}

/** The zone array a card is in: its controller's battlefield, the stack, or its owner's other zones. */
function takeOut(d: GameState, c: CardState): void {
  if (c.zone === 'stack') {
    d.stack = d.stack.filter((i) => !(i.kind === 'spell' && i.id === c.id))
    return
  }
  const seat = d.seats[c.zone === 'battlefield' ? c.controller : c.owner]!
  seat[c.zone] = seat[c.zone].filter((id) => id !== c.id)
}

/**
 * How far out from its host the board draws each card tucked under it, toward the middle of the table: the Board's
 * FieldCard peeks each out by 22% of a card's height, and a card is 30% of its half's height.
 */
const TUCK_STEP = 0.07

/** Where the board draws a card tucked under `host`, `steps` out from it (the first card tucked is furthest out). */
function tuckedSpot(host: CardState, steps: number): Pos {
  return clampPos({ x: host.pos!.x, y: host.pos!.y + TUCK_STEP * steps })
}

/**
 * Every card attached to `host`, which is leaving the battlefield, comes off it. One tucked under it stays where it
 * was drawn, so it doesn't jump back to the spot it had before it was attached (a spot nothing kept free); one
 * attached across sides is drawn at its own spot, and stays there. Called while the game still has `host` on the
 * battlefield.
 */
function detachFrom(d: GameState, host: CardState): void {
  const tucked = attachmentsOf(d, host).map((c) => c.id)
  for (const c of Object.values(d.cards)) {
    if (c.attachedTo !== host.id) continue
    const i = tucked.indexOf(c.id)
    setCard(d, c.id, i === -1 ? { attachedTo: null } : { attachedTo: null, pos: tuckedSpot(host, tucked.length - i) })
  }
}

/** Detach: a card tucked under its host comes out where it was drawn, on top of the others; any other stays put. */
function detach(d: GameState, c: CardState): void {
  if (!isTucked(d, c)) {
    setCard(d, c.id, { attachedTo: null })
    return
  }
  const host = d.cards[c.attachedTo!]!
  const tucked = attachmentsOf(d, host).map((t) => t.id)
  setCard(d, c.id, { attachedTo: null, pos: tuckedSpot(host, tucked.length - tucked.indexOf(c.id)) })
  const seat = d.seats[c.controller]!
  seat.battlefield = [...seat.battlefield.filter((id) => id !== c.id), c.id]
}

/** The spots taken on a seat's battlefield: every card there that isn't tucked under another. */
function takenSpots(d: GameState, seat: SeatIndex): Pos[] {
  return looseCards(d, seat).flatMap((c) => (c.pos ? [c.pos] : []))
}

/** Puts a card already marked as on `seat`'s battlefield at its default spot, on top of the others. */
function placeOnBattlefield(d: GameState, id: string, seat: SeatIndex, at?: Pos): void {
  const pos = at ?? defaultSpot(d.data[id]!.kind, takenSpots(d, seat))
  setCard(d, id, { pos })
  const s = d.seats[seat]!
  s.battlefield = [...s.battlefield, id]
}

/**
 * Moves cards, in order. A library's top or bottom takes them so the first ends up on top, or at the very bottom.
 * Leaving the battlefield clears what only means something there; a token leaving the battlefield and the stack
 * vanishes; a commander leaving the command zone for the stack or battlefield adds to its tax.
 */
function moveAll(d: GameState, ids: readonly string[], to: Dest): void {
  if (to.zone === 'battlefield') {
    seatOf(d, to.seat)
    if (to.at && to.at.length !== ids.length) throw new PlaytestError('Each card needs its own spot')
  }
  const order = to.zone === 'library' ? [...ids].reverse() : ids
  order.forEach((id, i) => moveOne(d, id, to, to.zone === 'battlefield' ? to.at?.[i] : undefined))
}

function moveOne(d: GameState, id: string, to: Dest, at: Pos | undefined): void {
  const c = card(d, id)
  const from = c.zone
  takeOut(d, c)
  if (c.token && to.zone !== 'battlefield' && to.zone !== 'stack') {
    // What's attached comes off first, while the token is still there to tell where its cards were drawn.
    if (from === 'battlefield') detachFrom(d, c)
    delete d.cards[id]
    return
  }
  if (c.commander && from === 'command' && (to.zone === 'stack' || to.zone === 'battlefield')) {
    const owner = d.seats[c.owner]!
    owner.casts = { ...owner.casts, [id]: (owner.casts[id] ?? 0) + 1 }
  }
  let next: CardState = { ...c, zone: to.zone }
  if (from === 'battlefield' && to.zone !== 'battlefield') {
    next = { ...next, tapped: false, faceDown: false, face: 0, counters: {}, attachedTo: null, pos: null }
    detachFrom(d, c)
  }
  if (to.zone !== 'battlefield' && to.zone !== 'stack') next.controller = next.owner
  if (to.zone === 'battlefield') next.controller = to.seat
  // Dragging an attached card to a spot of its own, or to the other side, takes it off its host.
  if (from === 'battlefield' && to.zone === 'battlefield' && (at !== undefined || c.controller !== to.seat)) {
    next.attachedTo = null
  }
  d.cards[id] = next

  switch (to.zone) {
    case 'battlefield': {
      // A card moved within its own side keeps its spot unless it's given one.
      const keep = from === 'battlefield' && c.controller === to.seat && at === undefined ? c.pos! : at
      placeOnBattlefield(d, id, to.seat, keep)
      break
    }
    case 'stack':
      d.stack = [...d.stack, { kind: 'spell', id }]
      break
    case 'library': {
      const owner = d.seats[c.owner]!
      owner.library = to.at === 'top' ? [id, ...owner.library] : [...owner.library, id]
      break
    }
    default: {
      const owner = d.seats[c.owner]!
      owner[to.zone] = [...owner[to.zone], id]
    }
  }
}
