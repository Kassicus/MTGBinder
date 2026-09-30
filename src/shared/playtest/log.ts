import { apply, startGame } from './game.ts'
import { visibleTo } from './status.ts'
import type { Action, CardState, GameState, SeatIndex, Setup, Zone } from './types.ts'

/**
 * The game's log (spec §5.9.6): each action in words, as each seat would know it. A line names a card only when the
 * seat reading it could see the card before or after the action; revealing names it to both.
 */

export interface LogEntry {
  /** The turn the action was played in (0 during mulligans). */
  turn: number
  /** The line for each seat: seat 1's view, then seat 2's. Moving a card around its own side isn't logged. */
  text: [string, string] | null
}

/** The whole game's log: the setup's game, then each action's line. */
export function gameLog(setup: Setup, actions: readonly Action[]): LogEntry[] {
  let game = startGame(setup)
  return actions.map((action) => {
    const after = apply(game, action)
    const entry: LogEntry = { turn: game.turn, text: lineFor(game, action, after) }
    game = after
    return entry
  })
}

/** One action's line for each seat, or null for an action the log leaves out. */
export function lineFor(before: GameState, action: Action, after: GameState): [string, string] | null {
  const first = describe(before, action, after, 0)
  return first === null ? null : [first, describe(before, action, after, 1)!]
}

/** "A", "A and B", "A, B, and C", "A, B, C, and 2 more". */
export function list(items: readonly string[]): string {
  if (items.length <= 2) return items.join(' and ')
  if (items.length <= 4) return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
  return `${items.slice(0, 3).join(', ')}, and ${items.length - 3} more`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function describe(before: GameState, action: Action, after: GameState, viewer: SeatIndex): string | null {
  const seat = (i: SeatIndex) => before.seats[i]!.name
  /** A card's name when `viewer` could see it before or after the action. */
  const seen = (id: string, anyway = false) => {
    const was = before.cards[id]
    const now = after.cards[id]
    const visible = anyway || (was !== undefined && visibleTo(was, viewer)) || (now !== undefined && visibleTo(now, viewer))
    return visible ? nameOf(before, after, id) : null
  }
  /** The cards' names, repeats counted and the hidden ones too: "Goblin ×3 and 2 cards". */
  const cards = (ids: readonly string[], anyway = false) => {
    const counts = new Map<string, number>()
    let hidden = 0
    for (const id of ids) {
      const name = seen(id, anyway)
      if (name === null) hidden++
      else counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const shown = [...counts].map(([name, n]) => (n === 1 ? name : `${name} ×${n}`))
    if (hidden === 0) return list(shown)
    const unseen = hidden === 1 ? 'a card' : plural(hidden, 'card')
    return shown.length === 0 ? unseen : list([...shown, unseen])
  }

  switch (action.type) {
    case 'mulligan':
      return `${seat(action.seat)} took a mulligan (${after.mulligans} so far)`
    case 'keep': {
      const kept = before.seats[action.seat]!.hand.length - action.bottom.length
      return `${seat(action.seat)} kept ${kept} and put ${action.bottom.length} on the bottom`
    }
    case 'draw':
      return drew(before, after, action.seat, viewer, cards)
    case 'move':
      return moved(before, after, action.ids, action.to.zone, action.to.zone === 'library' ? action.to.at : null, seat, cards)
    case 'tap':
      return `${seat(controllerOf(before, action.ids[0]!))} ${action.tapped ? 'tapped' : 'untapped'} ${cards(action.ids)}`
    case 'flip': {
      const c = after.cards[action.id]!
      // A face-down card's faces are hidden from the other seat, the one it turns to as well.
      if (seen(action.id) === null) return `${seat(c.controller)} turned a card over`
      return `${seat(c.controller)} turned ${cards([action.id])} to ${after.data[c.id]!.faces[c.face]!.name}`
    }
    case 'faceDown':
      return `${seat(controllerOf(before, action.ids[0]!))} turned ${cards(action.ids)} face ${action.down ? 'down' : 'up'}`
    case 'counter': {
      const n = Math.abs(action.delta)
      const counter = plural(n, `${action.name} counter`)
      return `${seat(controllerOf(before, action.ids[0]!))} ${action.delta >= 0 ? `put ${counter} on` : `removed ${counter} from`} ${cards(action.ids)}`
    }
    case 'setCounter':
      return `${seat(controllerOf(before, action.ids[0]!))} set the ${action.name} counters on ${cards(action.ids)} to ${action.value}`
    case 'attach': {
      const who = seat(controllerOf(before, action.id))
      if (action.to !== null) return `${who} attached ${cards([action.id])} to ${cards([action.to])}`
      const host = before.cards[action.id]!.attachedTo
      return host === null ? `${who} detached ${cards([action.id])}` : `${who} detached ${cards([action.id])} from ${cards([host])}`
    }
    case 'token':
      if (action.token.kind === 'emblem') {
        return `${seat(action.seat)} got ${action.count === 1 ? 'an emblem' : `${action.count} emblems`}: ${action.token.name}`
      }
      return `${seat(action.seat)} created ${action.count === 1 ? `a ${action.token.name} token` : `${action.count} ${action.token.name} tokens`}`
    case 'copy':
      return `${seat(controllerOf(before, action.id))} created a token copy of ${cards([action.id])}`
    case 'ability':
      return `${seat(controllerOf(before, action.id))} used an ability of ${cards([action.id])}`
    case 'resolve': {
      const item = before.stack.find((i) => i.id === action.item)!
      if (item.kind === 'ability') {
        // Named only for a seat that could see its source, as the line for using it was.
        const source = seen(item.source)
        return source === null ? 'An ability resolved' : `${source}'s ability resolved`
      }
      return `${cards([item.id])} resolved`
    }
    case 'life': {
      const now = after.seats[action.seat]!.life
      return `${seat(action.seat)} ${action.delta >= 0 ? 'gained' : 'lost'} ${Math.abs(action.delta)} life (${now})`
    }
    case 'poison': {
      const now = after.seats[action.seat]!.poison
      return `${seat(action.seat)} ${action.delta >= 0 ? 'got' : 'lost'} ${plural(Math.abs(action.delta), 'poison counter')} (${now})`
    }
    case 'commanderDamage': {
      const now = after.seats[action.seat]!.commanderDamage[action.commander] ?? 0
      const from = cards([action.commander])
      return action.delta >= 0
        ? `${seat(action.seat)} took ${action.delta} damage from ${from} (${now} in all)`
        : `${seat(action.seat)}'s damage from ${from} went down by ${-action.delta} (${now} in all)`
    }
    case 'shuffle':
      return `${seat(action.seat)} shuffled their library`
    case 'mill': {
      const milled = before.seats[action.seat]!.library.slice(0, action.count)
      return `${seat(action.seat)} milled ${cards(milled)}`
    }
    case 'reveal':
      return `${seat(ownerOf(before, action.ids[0]!))} revealed ${cards(action.ids, true)}`
    case 'arrange': {
      const parts: string[] = []
      if (action.top.length > 0) parts.push(`${action.top.length} on top`)
      if (action.bottom.length > 0) parts.push(`${action.bottom.length} on the bottom`)
      if (action.graveyard.length > 0) parts.push(`${cards(action.graveyard)} into the graveyard`)
      if (action.hand.length > 0) parts.push(`${cards(action.hand)} into their hand`)
      if (action.exile.length > 0) parts.push(`${cards(action.exile)} into exile`)
      const n = action.top.length + action.bottom.length + action.graveyard.length + action.hand.length + action.exile.length
      return `${seat(action.seat)} looked at the top ${plural(n, 'card')}: ${list(parts)}`
    }
    case 'search': {
      const put = `put ${cards(action.ids)} ${where(action.to.zone, action.to.zone === 'library' ? action.to.at : null)}`
      // A search back into the library shuffles before the cards are put there, so they stay where they're put.
      if (action.shuffle && action.to.zone === 'library') return `${seat(action.seat)} searched their library, shuffled it, and ${put}`
      return `${seat(action.seat)} searched their library and ${put}${action.shuffle ? ', then shuffled' : ''}`
    }
    case 'nextTurn': {
      const drawn = after.seats[after.active]!.hand.filter((id) => !before.seats[after.active]!.hand.includes(id))
      const draw = drawn.length > 0 ? ` and drew ${cards(drawn)}` : after.seats[after.active]!.drewFromEmpty ? ' and had no card to draw' : ''
      return `Turn ${after.turn}: ${seat(after.active)} untapped${draw}`
    }
  }
}

function nameOf(before: GameState, after: GameState, id: string): string {
  const c = after.cards[id] ?? before.cards[id]
  const data = after.data[id] ?? before.data[id]
  if (!c || !data) return 'a card'
  // A card is named by the face it showed on the battlefield, else its front.
  const shown = before.cards[id]?.zone === 'battlefield' ? before.cards[id]! : c
  return (data.faces[shown.face] ?? data.faces[0]!).name
}

const controllerOf = (g: GameState, id: string) => g.cards[id]!.controller
const ownerOf = (g: GameState, id: string) => g.cards[id]!.owner

function drew(
  before: GameState,
  after: GameState,
  seatIndex: SeatIndex,
  viewer: SeatIndex,
  cards: (ids: readonly string[]) => string,
): string {
  const name = before.seats[seatIndex]!.name
  const drawn = after.seats[seatIndex]!.hand.filter((id) => !before.seats[seatIndex]!.hand.includes(id))
  const empty = !before.seats[seatIndex]!.drewFromEmpty && after.seats[seatIndex]!.drewFromEmpty
  if (drawn.length === 0) return `${name} had no card to draw`
  const what = viewer === seatIndex ? cards(drawn) : drawn.length === 1 ? 'a card' : plural(drawn.length, 'card')
  return `${name} drew ${what}${empty ? ', and the library ran out' : ''}`
}

const ZONE_WORDS: Record<Zone, string> = {
  library: 'the library',
  hand: 'their hand',
  battlefield: 'the battlefield',
  graveyard: 'the graveyard',
  exile: 'exile',
  command: 'the command zone',
  stack: 'the stack',
}

/** Where cards went: "into the graveyard", "on top of the library". */
function where(zone: Zone, at: 'top' | 'bottom' | null): string {
  switch (zone) {
    case 'library':
      return at === 'bottom' ? 'on the bottom of the library' : 'on top of the library'
    case 'battlefield':
      return 'onto the battlefield'
    case 'stack':
      return 'on the stack'
    case 'exile':
      return 'into exile'
    default:
      return `into ${ZONE_WORDS[zone]}`
  }
}

function moved(
  before: GameState,
  after: GameState,
  ids: readonly string[],
  to: Zone,
  at: 'top' | 'bottom' | null,
  seat: (i: SeatIndex) => string,
  cards: (ids: readonly string[]) => string,
): string | null {
  const first: CardState = before.cards[ids[0]!]!
  const from = first.zone
  const names = cards(ids)
  if (from === 'battlefield' && to === 'battlefield') {
    const now = after.cards[ids[0]!]!
    if (now.controller === first.controller) return null
    return `${seat(now.controller)} gained control of ${names}`
  }
  const who = seat(from === 'battlefield' || from === 'stack' ? first.controller : first.owner)
  if (from === 'hand' && to === 'battlefield') return `${who} played ${names}`
  if ((from === 'hand' || from === 'command') && to === 'stack') return `${who} cast ${names}`
  if (from === 'hand' && to === 'graveyard') return `${who} discarded ${names}`
  if (to === 'exile') return `${who} exiled ${names}${from === 'battlefield' ? '' : ` from ${ZONE_WORDS[from]}`}`
  if (from === 'battlefield' && to === 'hand') return `${who} returned ${names} to their hand`
  const tail = from === 'battlefield' || from === 'hand' ? '' : ` from ${ZONE_WORDS[from]}`
  return `${who} put ${names} ${where(to, at)}${tail}`
}
