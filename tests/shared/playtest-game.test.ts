import { describe, expect, it } from 'vitest'
import { apply, PlaytestError, replay, startGame } from '../../src/shared/playtest/game.ts'
import { commanderTax, isTucked, losingReasons } from '../../src/shared/playtest/status.ts'
import type { Action, GameState, SeatIndex } from '../../src/shared/playtest/types.ts'
import { cardData, deck, doubleFaced, setup } from '../helpers/playtest.ts'

/** Both seats keep their first 7 (the last 3 drawn go to the bottom): turn 1 has begun. */
function playing(game: GameState = startGame(setup())): GameState {
  let g = game
  while (g.phase === 'mulligan') g = apply(g, { type: 'keep', seat: g.choosing, bottom: g.seats[g.choosing]!.hand.slice(7) })
  return g
}

const run = (game: GameState, ...actions: Action[]) => actions.reduce(apply, game)
const hand = (g: GameState, seat: SeatIndex = 0) => g.seats[seat]!.hand
const library = (g: GameState, seat: SeatIndex = 0) => g.seats[seat]!.library
/** Plays a card from seat 1's hand to its battlefield. */
const play = (g: GameState, id: string, seat: SeatIndex = 0) => apply(g, { type: 'move', ids: [id], to: { zone: 'battlefield', seat } })
const firstCreature = (g: GameState, seat: SeatIndex = 0) => hand(g, seat).find((id) => g.data[id]!.kind === 'creature')!

describe('starting a game', () => {
  it('puts commanders in the command zone, shuffles the rest, and deals the starting seat 10', () => {
    const g = startGame(setup())
    expect(g.phase).toBe('mulligan')
    expect(g.choosing).toBe(0)
    expect(g.turn).toBe(0)
    expect(g.seats[0]!.command).toEqual(['1-c1'])
    expect(hand(g)).toHaveLength(10)
    expect(library(g)).toHaveLength(30)
    expect(hand(g, 1)).toEqual([])
    expect(library(g, 1)).toHaveLength(40)
    expect(g.seats.map((s) => s.life)).toEqual([40, 40])
    expect(g.cards['1-c1']).toMatchObject({ zone: 'command', commander: true, owner: 0, controller: 0 })
  })

  it('shuffles the same way for the same seed, and differently for another', () => {
    const order = (seed: number) => {
      const g = startGame(setup({ seed }))
      return [...hand(g), ...library(g)]
    }
    expect(order(7)).toEqual(order(7))
    expect(order(7)).not.toEqual(order(8))
    expect(order(7)).not.toEqual(Array.from({ length: 40 }, (_, i) => `1-${i + 1}`))
  })

  it('deals the other seat first when it starts', () => {
    const g = startGame(setup({ startingSeat: 1 }))
    expect(g.choosing).toBe(1)
    expect(hand(g, 1)).toHaveLength(10)
    expect(hand(g, 0)).toEqual([])
  })

  it('refuses a game from another version, and a starting seat that is not playing', () => {
    expect(() => startGame(setup({ version: 99 }))).toThrow(PlaytestError)
    expect(() => startGame(setup({ seats: [deck(1, 20)], startingSeat: 1 }))).toThrow('The starting seat is not playing')
  })
})

describe('mulligans (draw 10, keep 7)', () => {
  it('shuffles the hand back and draws 10 again, as often as asked', () => {
    let g = startGame(setup())
    const first = hand(g)
    g = apply(g, { type: 'mulligan', seat: 0 })
    g = apply(g, { type: 'mulligan', seat: 0 })
    expect(g.mulligans).toBe(2)
    expect(hand(g)).toHaveLength(10)
    expect(library(g)).toHaveLength(30)
    expect(hand(g)).not.toEqual(first)
    expect(new Set([...hand(g), ...library(g)]).size).toBe(40)
  })

  it('puts 3 on the bottom, the first one marked at the very bottom, then deals the other seat', () => {
    let g = startGame(setup())
    const [a, b, c] = hand(g) as [string, string, string]
    g = apply(g, { type: 'keep', seat: 0, bottom: [a, b, c] })
    expect(hand(g)).toHaveLength(7)
    expect(library(g).slice(-3)).toEqual([c, b, a])
    expect(g.cards[a]!.zone).toBe('library')
    expect(g.choosing).toBe(1)
    expect(g.mulligans).toBe(0)
    expect(hand(g, 1)).toHaveLength(10)
    expect(g.phase).toBe('mulligan')
  })

  it('begins turn 1 once both seats keep, with the starting seat not drawing unless the setup says so', () => {
    const g = playing()
    expect(g).toMatchObject({ phase: 'playing', turn: 1, active: 0 })
    expect(hand(g)).toHaveLength(7)
    expect(hand(playing(startGame(setup({ startingDraws: true }))))).toHaveLength(8)
  })

  it('begins at once when goldfishing', () => {
    const g = playing(startGame(setup({ seats: [deck(1, 20)] })))
    expect(g).toMatchObject({ phase: 'playing', turn: 1, active: 0 })
  })

  it('needs exactly 3 cards from the hand, from the seat choosing', () => {
    const g = startGame(setup())
    const h = hand(g)
    expect(() => apply(g, { type: 'keep', seat: 0, bottom: h.slice(0, 2) })).toThrow('Put exactly 3 cards on the bottom')
    expect(() => apply(g, { type: 'keep', seat: 0, bottom: [h[0]!, h[0]!, h[1]!] })).toThrow('A card is named twice')
    expect(() => apply(g, { type: 'keep', seat: 0, bottom: [h[0]!, h[1]!, library(g)[0]!] })).toThrow(PlaytestError)
    expect(() => apply(g, { type: 'mulligan', seat: 1 })).toThrow("It's the other seat's turn to choose its hand")
  })

  it('allows nothing else during mulligans, and no mulligan after', () => {
    const g = startGame(setup())
    expect(() => apply(g, { type: 'draw', seat: 0, count: 1 })).toThrow('Finish the mulligans first')
    expect(() => apply(playing(), { type: 'mulligan', seat: 0 })).toThrow('The mulligans are over')
  })
})

describe('replaying', () => {
  it('gives the same game as playing the actions one by one, and never changes the game it starts from', () => {
    const s = setup()
    let g = startGame(s)
    const actions: Action[] = []
    const step = (action: Action) => {
      const before = JSON.stringify(g)
      const next = apply(g, action)
      expect(JSON.stringify(g)).toBe(before)
      g = next
      actions.push(action)
    }
    step({ type: 'mulligan', seat: 0 })
    step({ type: 'keep', seat: 0, bottom: hand(g).slice(0, 3) })
    step({ type: 'keep', seat: 1, bottom: hand(g, 1).slice(0, 3) })
    step({ type: 'move', ids: [firstCreature(g)], to: { zone: 'battlefield', seat: 0 } })
    step({ type: 'shuffle', seat: 0 })
    step({ type: 'nextTurn' })
    step({ type: 'token', seat: 1, token: cardData('Goblin'), count: 2 })
    expect(replay(s, actions)).toEqual(g)
  })

  it('shares what an action leaves alone', () => {
    const g = playing()
    const id = firstCreature(g)
    const next = play(g, id)
    expect(next.cards[library(g)[0]!]).toBe(g.cards[library(g)[0]!])
    expect(next.cards[id]).not.toBe(g.cards[id])
  })
})

describe('drawing', () => {
  it('draws from the top, and marks a seat that draws from an empty library', () => {
    let g = playing(startGame(setup({ seats: [deck(1, 12)] })))
    const top = library(g)[0]!
    g = apply(g, { type: 'draw', seat: 0, count: 1 })
    expect(hand(g).at(-1)).toBe(top)
    expect(losingReasons(g.seats[0]!)).toEqual([])
    g = apply(g, { type: 'draw', seat: 0, count: 5 })
    expect(library(g)).toEqual([])
    expect(hand(g)).toHaveLength(12)
    expect(g.seats[0]!.drewFromEmpty).toBe(true)
    expect(losingReasons(g.seats[0]!)).toEqual(['drew from an empty library'])
  })

  it('draws 1 to 100 cards', () => {
    expect(() => apply(playing(), { type: 'draw', seat: 0, count: 0 })).toThrow('Counts run from 1 to 100')
    expect(() => apply(playing(), { type: 'draw', seat: 0, count: 1.5 })).toThrow(PlaytestError)
  })
})

describe('moving cards', () => {
  it('puts a card entering the battlefield beside the last of its kind: lands by the edge, creatures in the middle', () => {
    let g = playing()
    const creatures = hand(g).filter((id) => g.data[id]!.kind === 'creature').slice(0, 2)
    g = run(g, ...creatures.map((id): Action => ({ type: 'move', ids: [id], to: { zone: 'battlefield', seat: 0 } })))
    expect(g.cards[creatures[0]!]!.pos).toEqual({ x: 0.06, y: 0.8 })
    expect(g.cards[creatures[1]!]!.pos).toEqual({ x: 0.13, y: 0.8 })
    g = apply(g, { type: 'token', seat: 0, token: cardData('Forest', 'land'), count: 1 })
    expect(g.cards['t1']!.pos).toEqual({ x: 0.06, y: 0.2 })
  })

  it('puts cards where they are dropped, on top of the others', () => {
    let g = playing()
    const [a, b] = hand(g).filter((id) => g.data[id]!.kind === 'creature') as [string, string]
    g = apply(g, { type: 'move', ids: [a, b], to: { zone: 'battlefield', seat: 0, at: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.4 }] } })
    expect(g.cards[b]!.pos).toEqual({ x: 0.6, y: 0.4 })
    g = apply(g, { type: 'move', ids: [a], to: { zone: 'battlefield', seat: 0, at: [{ x: 0.2, y: 0.3 }] } })
    expect(g.seats[0]!.battlefield).toEqual([b, a])
    expect(() => apply(g, { type: 'move', ids: [a, b], to: { zone: 'battlefield', seat: 0, at: [{ x: 0.1, y: 0.1 }] } })).toThrow(
      'Each card needs its own spot',
    )
  })

  it('stacks cards on the library so the first ends up on top, or at the very bottom', () => {
    let g = playing()
    const [a, b] = hand(g) as [string, string]
    g = apply(g, { type: 'move', ids: [a, b], to: { zone: 'library', at: 'top' } })
    expect(library(g).slice(0, 2)).toEqual([a, b])
    g = apply(g, { type: 'move', ids: [a, b], to: { zone: 'library', at: 'bottom' } })
    expect(library(g).slice(-2)).toEqual([b, a])
  })

  it('clears what only means something on the battlefield when a card leaves it, and takes attached cards off it', () => {
    let g = playing()
    const [host, aura] = hand(g).filter((id) => g.data[id]!.kind === 'creature') as [string, string]
    g = run(
      g,
      { type: 'move', ids: [host, aura], to: { zone: 'battlefield', seat: 0 } },
      { type: 'tap', ids: [host], tapped: true },
      { type: 'counter', ids: [host], name: '+1/+1', delta: 2 },
      { type: 'faceDown', ids: [host], down: true },
      { type: 'attach', id: aura, to: host },
      { type: 'move', ids: [host], to: { zone: 'hand' } },
    )
    expect(g.cards[host]).toMatchObject({ zone: 'hand', tapped: false, faceDown: false, counters: {}, pos: null })
    expect(g.cards[aura]).toMatchObject({ zone: 'battlefield', attachedTo: null })
  })

  it('gives control to the seat whose battlefield a card is dropped on, and sends it to its owner when it leaves', () => {
    let g = playing()
    const id = firstCreature(g)
    g = play(g, id)
    g = apply(g, { type: 'move', ids: [id], to: { zone: 'battlefield', seat: 1 } })
    expect(g.cards[id]).toMatchObject({ owner: 0, controller: 1 })
    expect(g.seats[1]!.battlefield).toEqual([id])
    expect(g.seats[0]!.battlefield).toEqual([])
    g = apply(g, { type: 'move', ids: [id], to: { zone: 'graveyard' } })
    expect(g.seats[0]!.graveyard).toEqual([id])
    expect(g.cards[id]).toMatchObject({ controller: 0 })
  })

  it('makes a token vanish when it leaves the battlefield', () => {
    let g = apply(playing(), { type: 'token', seat: 0, token: cardData('Goblin'), count: 1 })
    g = apply(g, { type: 'move', ids: ['t1'], to: { zone: 'graveyard' } })
    expect(g.cards['t1']).toBeUndefined()
    expect(g.seats[0]!.graveyard).toEqual([])
    expect(g.seats[0]!.battlefield).toEqual([])
  })

  it('refuses a card that is gone, or named twice', () => {
    const g = playing()
    expect(() => apply(g, { type: 'move', ids: ['nope'], to: { zone: 'hand' } })).toThrow('That card is no longer in the game')
    const id = hand(g)[0]!
    expect(() => apply(g, { type: 'move', ids: [id, id], to: { zone: 'exile' } })).toThrow('A card is named twice')
  })
})

describe('commanders', () => {
  it('adds 2 tax each time a commander leaves the command zone for the stack or the battlefield', () => {
    let g = playing()
    expect(commanderTax(g, '1-c1')).toBe(0)
    g = apply(g, { type: 'move', ids: ['1-c1'], to: { zone: 'stack' } })
    g = apply(g, { type: 'resolve', item: '1-c1' })
    expect(g.cards['1-c1']!.zone).toBe('battlefield')
    expect(commanderTax(g, '1-c1')).toBe(2)
    g = apply(g, { type: 'move', ids: ['1-c1'], to: { zone: 'command' } })
    g = apply(g, { type: 'move', ids: ['1-c1'], to: { zone: 'battlefield', seat: 0 } })
    expect(commanderTax(g, '1-c1')).toBe(4)
    g = apply(g, { type: 'move', ids: ['1-c1'], to: { zone: 'graveyard' } })
    expect(commanderTax(g, '1-c1')).toBe(4)
  })

  it('counts commander damage from enemy commanders only, and marks 21 from one', () => {
    let g = playing()
    g = apply(g, { type: 'commanderDamage', seat: 1, commander: '1-c1', delta: 21 })
    expect(g.seats[1]!.commanderDamage).toEqual({ '1-c1': 21 })
    expect(losingReasons(g.seats[1]!)).toEqual(['21 commander damage'])
    g = apply(g, { type: 'commanderDamage', seat: 1, commander: '1-c1', delta: -30 })
    expect(g.seats[1]!.commanderDamage).toEqual({ '1-c1': 0 })
    expect(() => apply(g, { type: 'commanderDamage', seat: 0, commander: '1-c1', delta: 1 })).toThrow("isn't an enemy commander")
    expect(() => apply(g, { type: 'commanderDamage', seat: 1, commander: hand(g)[0]!, delta: 1 })).toThrow(PlaytestError)
  })
})

describe('turns', () => {
  it('passes the turn, untaps what the new seat controls, and draws its card', () => {
    let g = playing()
    const mine = firstCreature(g)
    const theirs = firstCreature(g, 1)
    g = run(
      g,
      { type: 'move', ids: [mine], to: { zone: 'battlefield', seat: 0 } },
      { type: 'move', ids: [theirs], to: { zone: 'battlefield', seat: 1 } },
      { type: 'tap', ids: [mine, theirs], tapped: true },
      { type: 'nextTurn' },
    )
    expect(g).toMatchObject({ turn: 2, active: 1 })
    expect(g.cards[theirs]!.tapped).toBe(false)
    expect(g.cards[mine]!.tapped).toBe(true)
    expect(hand(g, 1)).toHaveLength(7)
  })

  it('stays with the one seat when goldfishing', () => {
    const g = apply(playing(startGame(setup({ seats: [deck(1, 20)] }))), { type: 'nextTurn' })
    expect(g).toMatchObject({ turn: 2, active: 0 })
    expect(hand(g)).toHaveLength(8)
  })
})

describe('cards on the battlefield', () => {
  it('taps, flips a double-faced card, turns face down, and refuses those off the battlefield', () => {
    let g = playing(startGame(setup({ seats: [{ ...deck(1, 20), cards: [...deck(1, 20).cards, { id: '1-dfc', commander: false, data: doubleFaced('Delver', 'Aberration') }] }] })))
    g = apply(g, { type: 'move', ids: ['1-dfc'], to: { zone: 'battlefield', seat: 0 } })
    g = apply(g, { type: 'flip', id: '1-dfc' })
    expect(g.cards['1-dfc']!.face).toBe(1)
    g = apply(g, { type: 'flip', id: '1-dfc' })
    expect(g.cards['1-dfc']!.face).toBe(0)
    g = apply(g, { type: 'faceDown', ids: ['1-dfc'], down: true })
    expect(g.cards['1-dfc']!.faceDown).toBe(true)
    const inHand = hand(g)[0]!
    expect(() => apply(g, { type: 'tap', ids: [inHand], tapped: true })).toThrow("isn't on the battlefield")
    g = play(g, inHand)
    expect(() => apply(g, { type: 'flip', id: inHand })).toThrow('has only one face')
  })

  it('adds, removes, and sets counters, dropping one at 0', () => {
    let g = playing()
    const id = firstCreature(g)
    g = run(g, { type: 'move', ids: [id], to: { zone: 'battlefield', seat: 0 } }, { type: 'counter', ids: [id], name: '+1/+1', delta: 3 })
    expect(g.cards[id]!.counters).toEqual({ '+1/+1': 3 })
    g = run(g, { type: 'counter', ids: [id], name: '+1/+1', delta: -5 }, { type: 'setCounter', ids: [id], name: 'loyalty', value: 4 })
    expect(g.cards[id]!.counters).toEqual({ loyalty: 4 })
    expect(() => apply(g, { type: 'counter', ids: [id], name: ' ', delta: 1 })).toThrow('A counter needs a name')
  })

  it('attaches a card under its host, never in a loop, and a card dropped at its own spot comes off', () => {
    let g = playing()
    const [host, a, b] = hand(g).filter((id) => g.data[id]!.kind === 'creature') as [string, string, string]
    g = run(g, { type: 'move', ids: [host, a, b], to: { zone: 'battlefield', seat: 0 } }, { type: 'attach', id: a, to: host }, { type: 'attach', id: b, to: a })
    expect(isTucked(g, g.cards[a]!)).toBe(true)
    expect(() => apply(g, { type: 'attach', id: host, to: b })).toThrow("can't be attached to itself")
    expect(() => apply(g, { type: 'attach', id: a, to: a })).toThrow("can't be attached to itself")
    g = apply(g, { type: 'move', ids: [a], to: { zone: 'battlefield', seat: 0, at: [{ x: 0.5, y: 0.5 }] } })
    expect(g.cards[a]!.attachedTo).toBeNull()
    g = apply(g, { type: 'attach', id: b, to: null })
    expect(g.cards[b]!.attachedTo).toBeNull()
  })

  it('makes tokens and token copies', () => {
    let g = playing()
    const id = firstCreature(g)
    g = run(g, { type: 'move', ids: [id], to: { zone: 'battlefield', seat: 0 } }, { type: 'token', seat: 1, token: cardData('Goblin'), count: 3 }, { type: 'copy', id })
    expect(g.seats[1]!.battlefield).toEqual(['t1', 't2', 't3'])
    expect(g.cards['t2']).toMatchObject({ token: true, owner: 1, controller: 1, zone: 'battlefield' })
    expect(g.data['t4']).toBe(g.data[id])
    expect(g.cards['t4']).toMatchObject({ token: true, owner: 0 })
    expect(g.nextId).toBe(5)
  })
})

describe('the stack', () => {
  it('resolves an instant to the graveyard and a permanent to its controller, newest on top', () => {
    let g = playing()
    const instant = hand(g)[0]!
    g = { ...g, data: { ...g.data, [instant]: cardData('Shock', 'spell') } }
    const creature = firstCreature(g)
    g = run(g, { type: 'move', ids: [creature], to: { zone: 'stack' } }, { type: 'move', ids: [instant], to: { zone: 'stack' } })
    expect(g.stack.map((i) => i.id)).toEqual([creature, instant])
    g = run(g, { type: 'resolve', item: instant }, { type: 'resolve', item: creature })
    expect(g.seats[0]!.graveyard).toEqual([instant])
    expect(g.seats[0]!.battlefield).toEqual([creature])
    expect(g.stack).toEqual([])
  })

  it('puts an ability marker on the stack, and resolving it removes it', () => {
    let g = apply(playing(), { type: 'ability', id: '1-c1' })
    expect(g.stack).toEqual([{ kind: 'ability', id: 'm1', source: '1-c1', controller: 0, name: 'Krenko, Mob Boss' }])
    g = apply(g, { type: 'resolve', item: 'm1' })
    expect(g.stack).toEqual([])
    expect(() => apply(g, { type: 'resolve', item: 'm1' })).toThrow('That is no longer on the stack')
    expect(() => apply(g, { type: 'ability', id: library(g)[0]! })).toThrow("A card in the library can't use an ability")
  })

  it("names a face-down card's ability marker for neither face, since both seats see the stack", () => {
    let g = playing()
    const id = firstCreature(g)
    g = run(g, { type: 'move', ids: [id], to: { zone: 'battlefield', seat: 0 } }, { type: 'faceDown', ids: [id], down: true }, { type: 'ability', id })
    expect(g.stack).toEqual([{ kind: 'ability', id: 'm1', source: id, controller: 0, name: 'A face-down card' }])
  })
})

describe('life, poison', () => {
  it('lets life go below 0 and keeps poison at 0 or more, marking a seat that would have lost', () => {
    let g = run(playing(), { type: 'life', seat: 0, delta: -41 }, { type: 'poison', seat: 1, delta: 10 }, { type: 'poison', seat: 0, delta: -2 })
    expect(g.seats[0]).toMatchObject({ life: -1, poison: 0 })
    expect(losingReasons(g.seats[0]!)).toEqual(['-1 life'])
    expect(losingReasons(g.seats[1]!)).toEqual(['10 poison'])
    g = apply(g, { type: 'life', seat: 0, delta: 5 })
    expect(losingReasons(g.seats[0]!)).toEqual([])
  })
})

describe('the library', () => {
  it('mills from the top, so the last card milled is the top of the graveyard', () => {
    const g = playing()
    const top = library(g).slice(0, 3)
    const next = apply(g, { type: 'mill', seat: 0, count: 3 })
    expect(next.seats[0]!.graveyard).toEqual(top)
    expect(library(next)).toEqual(library(g).slice(3))
  })

  it('sends the cards looked at where they were put, the first of those kept on top ending up on top', () => {
    const g = playing()
    const [a, b, c, d, e] = library(g) as [string, string, string, string, string]
    const next = apply(g, { type: 'arrange', seat: 0, top: [c, a], bottom: [b], graveyard: [d], hand: [e], exile: [] })
    expect(library(next).slice(0, 2)).toEqual([c, a])
    expect(library(next).at(-1)).toBe(b)
    expect(next.seats[0]!.graveyard).toEqual([d])
    expect(hand(next).at(-1)).toBe(e)
    expect(library(next)).toHaveLength(library(g).length - 2)
    expect(() => apply(g, { type: 'arrange', seat: 0, top: [a, c], bottom: [], graveyard: [], hand: [], exile: [] })).toThrow(
      'Those are not the top cards of the library',
    )
  })

  it('searches for cards anywhere in the library, then shuffles if asked', () => {
    const g = playing()
    const deep = library(g).slice(-2)
    const next = apply(g, { type: 'search', seat: 0, ids: deep, to: { zone: 'hand' }, shuffle: true })
    expect(hand(next).slice(-2)).toEqual(deep)
    expect(library(next)).toHaveLength(library(g).length - 2)
    expect(library(next)).not.toEqual(library(g).slice(0, -2))
    expect(() => apply(g, { type: 'search', seat: 0, ids: [hand(g)[0]!], to: { zone: 'hand' }, shuffle: false })).toThrow("isn't in that library")
  })

  it('shuffles the rest first when the cards found go back into the library, so they stay where they were put', () => {
    const g = playing()
    const [a, b] = [library(g)[20]!, library(g)[10]!]
    const rest = library(g).filter((id) => id !== a && id !== b)
    const top = apply(g, { type: 'search', seat: 0, ids: [a, b], to: { zone: 'library', at: 'top' }, shuffle: true })
    expect(library(top).slice(0, 2)).toEqual([a, b])
    expect(library(top).slice(2)).not.toEqual(rest)
    expect([...library(top).slice(2)].sort()).toEqual([...rest].sort())
    const bottom = apply(g, { type: 'search', seat: 0, ids: [a, b], to: { zone: 'library', at: 'bottom' }, shuffle: true })
    expect(library(bottom).slice(-2)).toEqual([b, a])
    expect(library(bottom).slice(0, -2)).not.toEqual(rest)
  })

  it('shuffles, and reveals without changing anything', () => {
    const g = playing()
    expect(library(apply(g, { type: 'shuffle', seat: 0 }))).not.toEqual(library(g))
    expect(apply(g, { type: 'reveal', ids: [library(g)[0]!] }).seats).toEqual(g.seats)
  })
})
