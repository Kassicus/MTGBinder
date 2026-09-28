import { describe, expect, it } from 'vitest'
import type { DeckLine } from '../../src/shared/types.ts'
import {
  buyListText,
  cardType,
  cardWarnings,
  completionPercent,
  costLabel,
  groupLines,
  manaCurve,
  scannedProgress,
  shortCards,
  statusLabel,
  typeCounts,
  warningCount,
} from '../../src/web/lib/deck-view.ts'

let nextId = 1
function line(name: string, typeLine: string, cmc: number, overrides: Partial<DeckLine> = {}): DeckLine {
  return {
    id: nextId++, oracleId: `o-${name}`, cardId: `c-${name}`, setCode: 'tst', collectorNumber: '1', preferredCardId: null, name, manaCost: '', typeLine, cmc,
    colorIdentity: '', imageSmall: null, imageNormal: null, quantity: 1, board: 'main', category: null, priceUsd: null,
    status: 'owned', short: 0, owned: 1, inOtherBuiltDecks: 0, scanned: 0, warnings: [], ...overrides,
  }
}

describe('cardType', () => {
  it('lists each card once, by its front face', () => {
    expect(['Artifact Creature — Golem', 'Land Creature — Forest Dryad', 'Artifact Land', 'Legendary Planeswalker — Jace', 'Instant // Instant', 'Sorcery', 'Legendary Enchantment — Background', 'Battle — Siege', 'Kindred Instant — Elf', 'Conspiracy'].map(cardType)).toEqual([
      'Creature', 'Creature', 'Land', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Battle', 'Instant', 'Other',
    ])
    expect(cardType('Creature — Human Wizard // Instant — Adventure')).toBe('Creature')
  })

  it('goes by whole type words before the dash, never by subtypes or longer words', () => {
    // Lander is an artifact subtype; "Land" inside it doesn't make a land.
    expect(['Artifact — Lander', 'Token Artifact — Lander', 'Creature — Lander', 'Artifact Land', 'Artifact Land — Desert'].map(cardType)).toEqual([
      'Artifact', 'Artifact', 'Creature', 'Land', 'Land',
    ])
  })
})

describe('completionPercent', () => {
  it('rounds down without reading one too low from float error', () => {
    expect([29 / 100, 57 / 100, 58 / 100, 1, 0, 99.9 / 100].map(completionPercent)).toEqual([29, 57, 58, 100, 0, 99])
  })
})

describe('groupLines', () => {
  const lines = [
    line('Forest', 'Basic Land — Forest', 0, { quantity: 10 }),
    line('Lightning Bolt', 'Instant', 1, { quantity: 4, category: 'Removal' }),
    line('Counterspell', 'Instant', 2, { category: 'Removal' }),
    line('Llanowar Elves', 'Creature — Elf Druid', 1, { quantity: 4 }),
    line('Duress', 'Sorcery', 1, { board: 'side', quantity: 2 }),
    line("Atraxa, Praetors' Voice", 'Legendary Creature', 4, { board: 'commander' }),
  ]

  it('groups by board, then by type in the deck-list order, sorted by mana value', () => {
    expect(groupLines(lines, 'type').map((s) => [s.board, s.count, s.groups.map((g) => [g.label, g.count, g.lines.map((l) => l.name)])])).toEqual([
      ['commander', 1, [['Creature', 1, ["Atraxa, Praetors' Voice"]]]],
      ['main', 19, [['Creature', 4, ['Llanowar Elves']], ['Instant', 5, ['Lightning Bolt', 'Counterspell']], ['Land', 10, ['Forest']]]],
      ['side', 2, [['Sorcery', 2, ['Duress']]]],
    ])
  })

  it('groups by category with Uncategorized last', () => {
    expect(groupLines(lines, 'category')[1]?.groups.map((g) => g.label)).toEqual(['Removal', 'Uncategorized'])
  })
})

describe('panels', () => {
  const lines = [
    line('Forest', 'Basic Land — Forest', 0, { quantity: 10 }),
    line('Lightning Bolt', 'Instant', 1, { quantity: 4 }),
    line('Emrakul, the Aeons Torn', 'Legendary Creature', 15),
    line('Ornithopter', 'Artifact Creature', 0, { quantity: 2 }),
    line('Duress', 'Sorcery', 1, { board: 'side', quantity: 2 }),
    line("Atraxa, Praetors' Voice", 'Legendary Creature', 4, { board: 'commander' }),
  ]

  it('draws the mana curve from main-deck nonland cards, with 7+ at the end', () => {
    expect(manaCurve(lines).map((b) => `${b.label}:${b.count}`)).toEqual(['0:2', '1:4', '2:0', '3:0', '4:0', '5:0', '6:0', '7+:1'])
  })

  it('leaves every card with Land among its front face types out of the curve, and lists Dryad Arbor as a Creature', () => {
    const lands = [
      line('Dryad Arbor', 'Land Creature — Forest Dryad', 0),
      line('Darksteel Citadel', 'Artifact Land', 0, { quantity: 4 }),
      line('Ornithopter', 'Artifact Creature — Thopter', 0, { quantity: 2 }),
      line("Agadeem's Awakening", 'Sorcery // Land', 3),
    ]
    expect(manaCurve(lands).map((b) => `${b.label}:${b.count}`)).toEqual(['0:2', '1:0', '2:0', '3:1', '4:0', '5:0', '6:0', '7+:0'])
    expect(typeCounts(lands)).toEqual([
      { type: 'Creature', count: 3 },
      { type: 'Sorcery', count: 1 },
      { type: 'Land', count: 4 },
    ])
  })

  it('counts types in the commander and main boards', () => {
    expect(typeCounts(lines)).toEqual([
      { type: 'Creature', count: 4 },
      { type: 'Instant', count: 4 },
      { type: 'Land', count: 10 },
    ])
  })
})

describe('buy list and short cards', () => {
  it('writes the buy list as text', () => {
    expect(buyListText([{ oracleId: 'a', cardId: 'a', name: 'Lightning Bolt', quantity: 4, priceUsd: 1, purchaseUrl: null }, { oracleId: 'b', cardId: 'b', name: 'Sol Ring', quantity: 1, priceUsd: null, purchaseUrl: null }])).toBe('4 Lightning Bolt\n1 Sol Ring')
  })

  it('lists each short card once, leaving out the maybe board', () => {
    const lines = [
      line('Lightning Bolt', 'Instant', 1, { short: 2 }),
      line('Lightning Bolt', 'Instant', 1, { board: 'side', short: 2, oracleId: 'o-Lightning Bolt' }),
      line('Fireball', 'Sorcery', 1, { board: 'maybe', short: 1 }),
      line('Counterspell', 'Instant', 2),
    ]
    expect(shortCards(lines)).toEqual([{ oracleId: 'o-Lightning Bolt', name: 'Lightning Bolt', short: 2 }])
  })

  it('lists two cards gone from the card data apart, though they share a name', () => {
    const gone = 'A card no longer in the card data'
    const lines = [
      line(gone, '', 0, { oracleId: 'gone-1', cardId: '', status: 'buy', short: 1, warnings: ['No longer in the card data'] }),
      line(gone, '', 0, { oracleId: 'gone-2', cardId: '', status: 'buy', short: 2, warnings: ['No longer in the card data'] }),
    ]
    expect(shortCards(lines).map((c) => c.oracleId)).toEqual(['gone-1', 'gone-2'])
    expect(cardWarnings(lines).map((c) => c.oracleId)).toEqual(['gone-1', 'gone-2'])
  })
})

describe('status, warnings, scanning, and cost in words', () => {
  it('says why a line is short, splitting a maybe line between other decks and this one', () => {
    const short = (board: DeckLine['board'], shortBy: number, inOtherBuiltDecks: number) =>
      statusLabel(line('Bolt', 'Instant', 1, { board, status: 'in_other_deck', short: shortBy, inOtherBuiltDecks }))
    expect(short('main', 2, 2)).toBe('2 held by other built decks')
    expect(short('maybe', 3, 2)).toBe('2 held by other built decks, 1 already used by this deck')
    expect(short('maybe', 2, 0)).toBe('2 already used by this deck')
    expect(short('maybe', 2, 5)).toBe('2 held by other built decks')
    expect(statusLabel(line('Bolt', 'Instant', 1, { status: 'buy', short: 3 }))).toBe('Buy 3')
    expect(statusLabel(line('Bolt', 'Instant', 1))).toBe('Owned')
  })

  it('counts each card\'s warnings once, even on two boards', () => {
    const lines = [
      line('Bolt', 'Instant', 1, { oracleId: 'bolt', warnings: ['Modern allows four copies; this deck has 6'] }),
      line('Bolt', 'Instant', 1, { oracleId: 'bolt', board: 'side', warnings: ['Modern allows four copies; this deck has 6'] }),
      line('Jace', 'Planeswalker', 4, { warnings: ['Banned in Modern', 'Not legal in Standard'] }),
    ]
    expect(cardWarnings(lines)).toEqual([
      { oracleId: 'bolt', name: 'Bolt', warnings: ['Modern allows four copies; this deck has 6'] },
      { oracleId: 'o-Jace', name: 'Jace', warnings: ['Banned in Modern', 'Not legal in Standard'] },
    ])
    expect(warningCount({ warnings: ['Choose a commander'], lines })).toBe(4)
  })

  it('counts scanned copies up to each line\'s quantity, leaving out maybe, once anything was scanned', () => {
    expect(scannedProgress([line('Bolt', 'Instant', 1, { quantity: 4 })])).toBeNull()
    expect(
      scannedProgress([
        line('Bolt', 'Instant', 1, { quantity: 4, scanned: 2 }),
        line('Elves', 'Creature', 1, { quantity: 1, scanned: 3 }),
        line('Forest', 'Basic Land', 0, { quantity: 10 }),
        line('Shock', 'Instant', 1, { quantity: 2, board: 'maybe' }),
      ]),
    ).toEqual({ scanned: 3, of: 15 })
  })

  it('says what finishing costs, and when some cards have no price', () => {
    expect(costLabel({ costToFinish: 12.5, unpricedToBuy: 0 })).toBe('$12.50 to finish')
    expect(costLabel({ costToFinish: 12.5, unpricedToBuy: 2 })).toBe('$12.50 to finish, and 2 cards without a price')
    expect(costLabel({ costToFinish: 0, unpricedToBuy: 1 })).toBe('1 card to buy, without a price')
    expect(costLabel({ costToFinish: 0, unpricedToBuy: 0 })).toBe('Nothing to buy')
  })
})
