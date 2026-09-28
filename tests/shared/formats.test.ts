import { describe, expect, it } from 'vitest'
import { scryfallToRow } from '../../src/server/cards/map.ts'
import { checkDeck, type RuleCard } from '../../src/shared/formats.ts'
import type { Board } from '../../src/shared/types.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'
import type { ScryfallCard } from '../../src/server/scryfall/types.ts'

function rule(card: ScryfallCard, boards: Partial<Record<Board, number>>): RuleCard {
  const row = scryfallToRow(card)
  if (!row) throw new Error('unmappable card')
  return {
    oracleId: row.oracle_id,
    name: row.name,
    typeLine: row.type_line,
    oracleText: row.oracle_text,
    keywords: JSON.parse(row.keywords) as string[],
    colorIdentity: row.color_identity,
    legalities: JSON.parse(row.legalities) as Record<string, string>,
    boards,
  }
}
const card = (name: string, boards: Partial<Record<Board, number>>) => rule(fixtureCard(name), boards)
/** Filler: n different commander-legal colorless cards on the main board. */
const filler = (n: number, board: Board = 'main') =>
  Array.from({ length: n }, (_, i) => rule(syntheticCard({ name: `Filler ${i}`, color_identity: [], type_line: 'Artifact' }), { [board]: 1 }))
const warningsFor = (check: ReturnType<typeof checkDeck>, c: RuleCard) => check.cards.get(c.oracleId) ?? []

describe('commander', () => {
  it('accepts a legal 100-card deck', () => {
    const atraxa = card("Atraxa, Praetors' Voice", { commander: 1 })
    const check = checkDeck('commander', [atraxa, card('Sol Ring', { main: 1 }), ...filler(98)])
    expect(check.deck).toEqual([])
    expect([...check.cards.values()].flat()).toEqual([])
  })

  it('counts exactly 100 including commanders, and no sideboard', () => {
    const check = checkDeck('commander', [card("Atraxa, Praetors' Voice", { commander: 1 }), ...filler(97), ...filler(2, 'side')])
    expect(check.deck).toEqual([
      'Commander decks have exactly 100 cards, counting commanders (this one has 98)',
      'Commander decks have no sideboard (this one has 2 cards)',
    ])
  })

  it('needs a commander, at most two, that can command and pair', () => {
    expect(checkDeck('commander', filler(100)).deck).toContain('Choose a commander')
    const bolt = card('Lightning Bolt', { commander: 1 })
    expect(warningsFor(checkDeck('commander', [bolt, ...filler(99)]), bolt)).toContain("Can't be a commander")
    const pair = checkDeck('commander', [card('Thrasios, Triton Hero', { commander: 1 }), card('Tymna the Weaver', { commander: 1 }), ...filler(98)])
    expect(pair.deck).toEqual([])
    const bad = checkDeck('commander', [card("Atraxa, Praetors' Voice", { commander: 1 }), card('Thrasios, Triton Hero', { commander: 1 }), ...filler(98)])
    expect(bad.deck).toEqual([
      "Atraxa, Praetors' Voice and Thrasios, Triton Hero can't share the command zone (they need Partner, a Background, or Doctor's companion)",
    ])
  })

  it('accepts a planeswalker that says it can be your commander', () => {
    const grist = card('Grist, the Hunger Tide', { commander: 1 })
    expect(warningsFor(checkDeck('commander', [grist, ...filler(99)]), grist)).toEqual([])
  })

  it('pairs "Partner with" commanders only with each other, and Backgrounds with "Choose a Background"', () => {
    const pir = rule(syntheticCard({ name: 'Pir, Imaginative Rascal', type_line: 'Legendary Creature — Human', oracle_text: 'Partner with Toothy, Imaginary Friend (When this creature enters, ...)', keywords: ['Partner with', 'Partner'] }), { commander: 1 })
    const toothy = rule(syntheticCard({ name: 'Toothy, Imaginary Friend', type_line: 'Legendary Creature — Illusion', oracle_text: 'Partner with Pir, Imaginative Rascal (When this creature enters, ...)', keywords: ['Partner with', 'Partner'] }), { commander: 1 })
    const thrasios = card('Thrasios, Triton Hero', { commander: 1 })
    expect(checkDeck('commander', [pir, toothy, ...filler(98)]).deck).toEqual([])
    expect(checkDeck('commander', [pir, thrasios, ...filler(98)]).deck).toHaveLength(1)
    const wilson = rule(syntheticCard({ name: 'Wilson, Refined Grizzly', type_line: 'Legendary Creature — Bear Warrior', keywords: ['Choose a background'] }), { commander: 1 })
    const background = rule(syntheticCard({ name: 'Raised by Giants', type_line: 'Legendary Enchantment — Background', oracle_text: 'Commander creatures you own have base power and toughness 10/10.' }), { commander: 1 })
    expect(checkDeck('commander', [wilson, background, ...filler(98)]).deck).toEqual([])
  })

  it('warns about cards outside the commanders\' color identity, banned cards, and extra copies', () => {
    const niv = card('Niv-Mizzet, Parun', { commander: 1 })
    const elves = card('Llanowar Elves', { main: 2 })
    const lotus = card('Black Lotus', { main: 1 })
    const check = checkDeck('commander', [niv, elves, lotus, ...filler(96)])
    expect(warningsFor(check, elves)).toEqual(['Commander allows 1 copy; this deck has 2', "Outside the commander's color identity (G)"])
    expect(warningsFor(check, lotus)).toEqual(['Banned in Commander'])
  })

  it('lets basic lands and "any number" cards exceed the copy limit', () => {
    const forest = card('Forest', { main: 30 })
    const rats = card('Relentless Rats', { main: 20 })
    const check = checkDeck('commander', [card("Atraxa, Praetors' Voice", { commander: 1 }), forest, rats, ...filler(49)])
    expect(warningsFor(check, forest)).toEqual([])
    expect(warningsFor(check, rats)).toEqual([])
  })

  it('honors "up to seven" cards', () => {
    const dwarves = rule(syntheticCard({ name: 'Seven Dwarves', oracle_text: 'A deck can have up to seven cards named Seven Dwarves.', legalities: { modern: 'legal' } }), { main: 8 })
    expect(warningsFor(checkDeck('modern', [dwarves, ...filler(52)]), dwarves)).toEqual(['Modern allows 7 copies; this deck has 8'])
  })
})

describe('constructed formats', () => {
  it('needs 60 main-deck cards, allows 4 copies across main and sideboard, and 15 sideboard cards', () => {
    const bolt = card('Lightning Bolt', { main: 4, side: 1 })
    const check = checkDeck('modern', [bolt, ...filler(50), ...filler(16, 'side')])
    expect(check.deck).toEqual([
      'Modern decks need at least 60 main-deck cards (this one has 54)',
      'Sideboards hold at most 15 cards (this one has 17)',
    ])
    expect(warningsFor(check, bolt)).toEqual(['Modern allows 4 copies; this deck has 5'])
  })

  it('reports legality in the deck\'s format, and restricts vintage restricted cards to one', () => {
    const lotus = card('Black Lotus', { main: 2 })
    const lurrus = card('Lurrus of the Dream-Den', { main: 1 })
    expect(warningsFor(checkDeck('legacy', [lotus, ...filler(60)]), lotus)).toEqual(['Banned in Legacy'])
    expect(warningsFor(checkDeck('vintage', [lotus, ...filler(60)]), lotus)).toEqual(['Vintage allows 1 copy (restricted); this deck has 2'])
    expect(warningsFor(checkDeck('pauper', [lurrus, ...filler(60)]), lurrus)).toEqual(['Not legal in Pauper'])
  })

  it('says a constructed deck has no commander', () => {
    expect(checkDeck('modern', [card('Niv-Mizzet, Parun', { commander: 1 }), ...filler(60)]).deck).toEqual([
      'Modern decks have no commander; move 1 card to the main deck',
    ])
  })

  it('ignores the maybe board when counting', () => {
    const bolt = card('Lightning Bolt', { main: 4, maybe: 3 })
    const check = checkDeck('modern', [bolt, ...filler(56), ...filler(20, 'maybe')])
    expect(check.deck).toEqual([])
    expect(warningsFor(check, bolt)).toEqual([])
  })
})

describe('casual', () => {
  it('has no rules', () => {
    const check = checkDeck('casual', [card('Black Lotus', { main: 9 }), card('Lightning Bolt', { commander: 1 })])
    expect(check).toEqual({ deck: [], cards: new Map() })
  })
})
