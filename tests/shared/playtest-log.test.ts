import { describe, expect, it } from 'vitest'
import { apply, startGame } from '../../src/shared/playtest/game.ts'
import { gameLog, lineFor, list } from '../../src/shared/playtest/log.ts'
import { visibleTo } from '../../src/shared/playtest/status.ts'
import type { Action, GameState } from '../../src/shared/playtest/types.ts'
import { cardData, deck, setup } from '../helpers/playtest.ts'

/** Seat 1 is "Krenko Goblins" and seat 2 "Meren Aristocrats"; both have kept. */
function playing(): GameState {
  let g = startGame(
    setup({
      seats: [
        deck(1, 30, { name: 'Krenko Goblins', prefix: 'Goblin', commanders: ['Krenko, Mob Boss'] }),
        deck(2, 30, { name: 'Meren Aristocrats', prefix: 'Zombie', commanders: ['Meren of Clan Nel Toth'] }),
      ],
    }),
  )
  while (g.phase === 'mulligan') g = apply(g, { type: 'keep', seat: g.choosing, bottom: g.seats[g.choosing]!.hand.slice(7) })
  return g
}

/** The line each seat reads for an action, and the game after it. */
function lines(g: GameState, action: Action): [[string, string] | null, GameState] {
  const after = apply(g, action)
  return [lineFor(g, action, after), after]
}

const name = (g: GameState, id: string) => g.data[id]!.name

describe('the log', () => {
  it('names a drawn card only to its own seat', () => {
    const g = playing()
    const top = g.seats[0]!.library[0]!
    const [text] = lines(g, { type: 'draw', seat: 0, count: 1 })
    expect(text).toEqual([`Krenko Goblins drew ${name(g, top)}`, 'Krenko Goblins drew a card'])
    const [many] = lines(g, { type: 'draw', seat: 1, count: 2 })
    expect(many![0]).toBe('Meren Aristocrats drew 2 cards')
  })

  it('names a card cast or played, a discard, and a card put into a graveyard from a hidden zone', () => {
    const g = playing()
    const [a, b] = g.seats[0]!.hand as [string, string]
    expect(lines(g, { type: 'move', ids: [a], to: { zone: 'battlefield', seat: 0 } })[0]).toEqual([
      `Krenko Goblins played ${name(g, a)}`,
      `Krenko Goblins played ${name(g, a)}`,
    ])
    expect(lines(g, { type: 'move', ids: [b], to: { zone: 'stack' } })[0]![1]).toBe(`Krenko Goblins cast ${name(g, b)}`)
    expect(lines(g, { type: 'move', ids: [b], to: { zone: 'graveyard' } })[0]![1]).toBe(`Krenko Goblins discarded ${name(g, b)}`)
    expect(lines(g, { type: 'move', ids: ['1-c1'], to: { zone: 'stack' } })[0]![0]).toBe('Krenko Goblins cast Krenko, Mob Boss')
  })

  it("keeps a card going from a hand to a library hidden from the other seat, and counts what it can't name", () => {
    const g = playing()
    const [a, b] = g.seats[0]!.hand as [string, string]
    const [text] = lines(g, { type: 'move', ids: [a, b], to: { zone: 'library', at: 'top' } })
    expect(text![0]).toBe(`Krenko Goblins put ${name(g, a)} and ${name(g, b)} on top of the library`)
    expect(text![1]).toBe('Krenko Goblins put 2 cards on top of the library')
  })

  it("leaves out a card moved around its own side, and says who gained control of one", () => {
    let g = playing()
    const a = g.seats[0]!.hand[0]!
    g = apply(g, { type: 'move', ids: [a], to: { zone: 'battlefield', seat: 0 } })
    expect(lines(g, { type: 'move', ids: [a], to: { zone: 'battlefield', seat: 0, at: [{ x: 0.5, y: 0.5 }] } })[0]).toBeNull()
    expect(lines(g, { type: 'move', ids: [a], to: { zone: 'battlefield', seat: 1 } })[0]![0]).toBe(`Meren Aristocrats gained control of ${name(g, a)}`)
  })

  it('hides a face-down card from the other seat, and reveals to both', () => {
    let g = playing()
    const a = g.seats[0]!.hand[0]!
    g = apply(g, { type: 'move', ids: [a], to: { zone: 'battlefield', seat: 0 } })
    g = apply(g, { type: 'faceDown', ids: [a], down: true })
    expect(visibleTo(g.cards[a]!, 0)).toBe(true)
    expect(visibleTo(g.cards[a]!, 1)).toBe(false)
    expect(lines(g, { type: 'tap', ids: [a], tapped: true })[0]).toEqual([`Krenko Goblins tapped ${name(g, a)}`, 'Krenko Goblins tapped a card'])
    const inHand = g.seats[0]!.hand[0]!
    expect(lines(g, { type: 'reveal', ids: [inHand] })[0]![1]).toBe(`Krenko Goblins revealed ${name(g, inHand)}`)
  })

  it('words counters, tokens, life, poison, and commander damage', () => {
    let g = playing()
    const a = g.seats[0]!.hand[0]!
    g = apply(g, { type: 'move', ids: [a], to: { zone: 'battlefield', seat: 0 } })
    const n = name(g, a)
    expect(lines(g, { type: 'counter', ids: [a], name: '+1/+1', delta: 2 })[0]![0]).toBe(`Krenko Goblins put 2 +1/+1 counters on ${n}`)
    expect(lines(g, { type: 'counter', ids: [a], name: '+1/+1', delta: -1 })[0]![0]).toBe(`Krenko Goblins removed 1 +1/+1 counter from ${n}`)
    const [made, withGoblins] = lines(g, { type: 'token', seat: 0, token: cardData('Goblin'), count: 4 })
    expect(made![1]).toBe('Krenko Goblins created 4 Goblin tokens')
    expect(lines(withGoblins, { type: 'tap', ids: ['t1', 't2', 't3', a], tapped: true })[0]![1]).toBe(`Krenko Goblins tapped Goblin ×3 and ${n}`)
    expect(lines(g, { type: 'token', seat: 0, token: cardData('Treasure', 'other'), count: 1 })[0]![1]).toBe('Krenko Goblins created a Treasure token')
    expect(lines(g, { type: 'life', seat: 1, delta: -3 })[0]![0]).toBe('Meren Aristocrats lost 3 life (37)')
    expect(lines(g, { type: 'poison', seat: 1, delta: 1 })[0]![0]).toBe('Meren Aristocrats got 1 poison counter (1)')
    expect(lines(g, { type: 'commanderDamage', seat: 1, commander: '1-c1', delta: 5 })[0]![0]).toBe(
      'Meren Aristocrats took 5 damage from Krenko, Mob Boss (5 in all)',
    )
  })

  it('names milled cards and cards looked at that go to a public zone', () => {
    const g = playing()
    const [a, b, c] = g.seats[0]!.library as [string, string, string]
    expect(lines(g, { type: 'mill', seat: 0, count: 2 })[0]![1]).toBe(`Krenko Goblins milled ${name(g, a)} and ${name(g, b)}`)
    const [text] = lines(g, { type: 'arrange', seat: 0, top: [a], bottom: [], graveyard: [b], hand: [c], exile: [] })
    expect(text![0]).toBe(`Krenko Goblins looked at the top 3 cards: 1 on top, ${name(g, b)} into the graveyard, and ${name(g, c)} into their hand`)
    expect(text![1]).toBe(`Krenko Goblins looked at the top 3 cards: 1 on top, ${name(g, b)} into the graveyard, and a card into their hand`)
  })

  it('starts each turn with who untapped and what they drew', () => {
    const g = playing()
    const top = g.seats[1]!.library[0]!
    const [text] = lines(g, { type: 'nextTurn' })
    expect(text).toEqual(['Turn 2: Meren Aristocrats untapped and drew a card', `Turn 2: Meren Aristocrats untapped and drew ${name(g, top)}`])
  })

  it('logs a whole game by turn, from the mulligans on', () => {
    const s = setup({ seats: [deck(1, 20, { name: 'Solo' })] })
    const g = startGame(s)
    const actions: Action[] = [
      { type: 'mulligan', seat: 0 },
      { type: 'keep', seat: 0, bottom: [] },
      { type: 'nextTurn' },
      { type: 'shuffle', seat: 0 },
    ]
    // The mulligan's hand, not the first one, is the one kept.
    actions[1] = { type: 'keep', seat: 0, bottom: apply(g, actions[0]!).seats[0]!.hand.slice(7) }
    const log = gameLog(s, actions)
    expect(log.map((e) => [e.turn, e.text?.[0]])).toEqual([
      [0, 'Solo took a mulligan (1 so far)'],
      [0, 'Solo kept 7 and put 3 on the bottom'],
      [1, expect.stringMatching(/^Turn 2: Solo untapped and drew S1 \d+$/)],
      [2, 'Solo shuffled their library'],
    ])
  })

  it('lists names in plain English', () => {
    expect(list(['A'])).toBe('A')
    expect(list(['A', 'B'])).toBe('A and B')
    expect(list(['A', 'B', 'C'])).toBe('A, B, and C')
    expect(list(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B, C, and 3 more')
  })
})
