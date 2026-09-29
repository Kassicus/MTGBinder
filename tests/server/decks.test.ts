import { beforeEach, describe, expect, it } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import { deckDetail, deckSummaries, deckSummary, MISSING_CARD_WARNING } from '../../src/server/decks/analysis.ts'
import {
  addToDeck,
  deleteDeck,
  duplicateDeck,
  getLineRows,
  importIntoDeck,
  MISSING_CARD_NAME,
  removeLine,
  updateLine,
} from '../../src/server/decks/repo.ts'
import type { DB } from '../../src/server/db/index.ts'
import type { ScryfallCard } from '../../src/server/scryfall/types.ts'
import { updateSettings } from '../../src/server/settings.ts'
import type { DeckDetail } from '../../src/shared/types.ts'
import { count, createTestDb } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'
import { deck, inDeck, own } from '../helpers/library.ts'

let db: DB
let burn: number
let idea: number

// Own 3 Lightning Bolt and 1 Sol Ring. Burn (built, modern) runs 4 Bolt. Idea (prospective, commander) runs Atraxa
// as commander, 1 each of Sol Ring, Lightning Bolt, and Doubling Season, and 2 Bolt on the maybe board.
beforeEach(() => {
  db = createTestDb()
  own(db, 'Lightning Bolt', 'm10', 3)
  own(db, 'Sol Ring', 'cmr', 1)
  burn = deck(db, 'Burn', 'built', 'modern')
  inDeck(db, burn, 'Lightning Bolt', 4)
  idea = deck(db, 'Idea', 'prospective', 'commander')
  inDeck(db, idea, "Atraxa, Praetors' Voice", 1, 'commander')
  for (const name of ['Sol Ring', 'Lightning Bolt', 'Doubling Season']) inDeck(db, idea, name, 1)
  inDeck(db, idea, 'Lightning Bolt', 2, 'maybe')
})

const detail = (id: number) => deckDetail(db, id) as DeckDetail
const line = (d: DeckDetail, name: string, board = 'main') => d.lines.find((l) => l.name === name && l.board === board)

describe('deck lines (spec §4.3)', () => {
  it('a built deck counts its own copies: 3 owned of 4 is 1 short, and the status is buy', () => {
    expect(line(detail(burn), 'Lightning Bolt')).toMatchObject({ quantity: 4, owned: 3, short: 1, status: 'buy', inOtherBuiltDecks: 0 })
  })

  it('a prospective deck sees copies held by built decks as in another deck', () => {
    const d = detail(idea)
    expect(line(d, 'Lightning Bolt')).toMatchObject({ owned: 3, short: 1, status: 'in_other_deck', inOtherBuiltDecks: 4 })
    expect(line(d, 'Sol Ring')).toMatchObject({ owned: 1, short: 0, status: 'owned' })
    expect(line(d, 'Doubling Season')).toMatchObject({ owned: 0, short: 1, status: 'buy' })
  })

  it('judges a maybe line on its own quantity, as if prospective', () => {
    expect(line(detail(idea), 'Lightning Bolt', 'maybe')).toMatchObject({ quantity: 2, short: 2, status: 'in_other_deck' })
  })

  it('prices lines at the cheapest printing and shows the default printing', () => {
    const bolt = line(detail(burn), 'Lightning Bolt')
    expect(bolt?.priceUsd).toBe(1.04) // M11 is the cheapest of M10 (1.89), M11 (1.04), and STA (4.13)
    expect(bolt?.cardId).toBe(fixtureCard('Lightning Bolt', 'm11').id)
  })

  it("doesn't count a built deck's own copies as held by other built decks on its maybe line", () => {
    // 1 owned Sol Ring; the built deck Rings has 1 on main and 1 on maybe.
    const rings = deck(db, 'Rings', 'built', 'casual')
    inDeck(db, rings, 'Sol Ring', 1)
    inDeck(db, rings, 'Sol Ring', 1, 'maybe')
    expect(line(detail(rings), 'Sol Ring')).toMatchObject({ owned: 1, short: 0, status: 'owned', inOtherBuiltDecks: 0 })
    // Judged as if prospective, the maybe copy is still 1 short, but no other built deck holds the copy.
    expect(line(detail(rings), 'Sol Ring', 'maybe')).toMatchObject({ owned: 1, short: 1, status: 'in_other_deck', inOtherBuiltDecks: 0 })
    // Another built deck's copy still counts.
    inDeck(db, burn, 'Sol Ring', 1)
    expect(line(detail(rings), 'Sol Ring', 'maybe')).toMatchObject({ owned: 1, short: 1, status: 'in_other_deck', inOtherBuiltDecks: 1 })
  })

  it('gives every line of a card in a deck the same status and short, and buys the combined shortfall once', () => {
    inDeck(db, burn, 'Lightning Bolt', 2, 'side')
    const d = detail(burn)
    // 3 owned, 6 used (4 main, 2 side): 3 short, and there aren't 6 copies.
    expect(line(d, 'Lightning Bolt')).toMatchObject({ quantity: 4, owned: 3, short: 3, status: 'buy' })
    expect(line(d, 'Lightning Bolt', 'side')).toMatchObject({ quantity: 2, owned: 3, short: 3, status: 'buy' })
    expect(d.buyList.items).toEqual([expect.objectContaining({ name: 'Lightning Bolt', quantity: 3 })])
  })

  it('makes each built deck that over-claims a card short of it (free goes negative)', () => {
    own(db, 'Counterspell', undefined, 2)
    const a = deck(db, 'A', 'built', 'casual')
    const b = deck(db, 'B', 'built', 'casual')
    inDeck(db, a, 'Counterspell', 2)
    inDeck(db, b, 'Counterspell', 2)
    // owned 2, allocated 4, free −2: each deck has −2 + 2 = 0 available, so it is 2 short, though 2 copies exist.
    for (const id of [a, b]) {
      expect(line(detail(id), 'Counterspell')).toMatchObject({ owned: 2, short: 2, status: 'in_other_deck', inOtherBuiltDecks: 2 })
    }
    // A prospective deck has nothing free.
    inDeck(db, idea, 'Counterspell', 1)
    expect(line(detail(idea), 'Counterspell')).toMatchObject({ owned: 2, short: 1, status: 'in_other_deck', inOtherBuiltDecks: 4 })
    // A needing 3 of the 2 owned must buy; B, needing 2, is still waiting on copies A holds.
    db.prepare('UPDATE deck_cards SET quantity = 3 WHERE deck_id = ?').run(a)
    expect(line(detail(a), 'Counterspell')).toMatchObject({ owned: 2, short: 3, status: 'buy', inOtherBuiltDecks: 2 })
    expect(line(detail(b), 'Counterspell')).toMatchObject({ owned: 2, short: 2, status: 'in_other_deck', inOtherBuiltDecks: 3 })
  })

  it("counts the copies scanning into the deck added, per board: added scans only", () => {
    const scanned = (cardId: string, quantity: number, board: string | null, status = 'committed') =>
      db
        .prepare("INSERT INTO scan_items (status, card_id, quantity, deck_id, board, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '', '')")
        .run(status, cardId, quantity, idea, board)
    scanned(fixtureCard('Lightning Bolt', 'm10').id, 1, 'main')
    scanned(fixtureCard('Lightning Bolt', 'sta').id, 2, null) // no board: main
    scanned(fixtureCard('Lightning Bolt', 'm11').id, 1, 'side') // a board with no line of it
    scanned(fixtureCard('Sol Ring', 'cmr').id, 1, 'main', 'confident') // still in the queue
    scanned(fixtureCard('Doubling Season').id, 1, 'main')
    // Into another deck.
    db.prepare('UPDATE scan_items SET deck_id = ? WHERE card_id = ?').run(burn, fixtureCard('Doubling Season').id)
    const d = detail(idea)
    expect(d.lines.map((l) => [l.name, l.board, l.scanned])).toEqual([
      ["Atraxa, Praetors' Voice", 'commander', 0],
      ['Doubling Season', 'main', 0],
      ['Lightning Bolt', 'main', 3],
      ['Lightning Bolt', 'maybe', 0],
      ['Sol Ring', 'main', 0],
    ])
  })

  it('attaches format warnings to the deck and its cards', () => {
    const d = detail(idea)
    expect(d.warnings).toEqual(['Commander decks have exactly 100 cards, counting commanders (this one has 4)'])
    expect(line(d, 'Lightning Bolt')?.warnings).toEqual(["Outside the commander's color identity (R)"])
  })
})

describe('deck summary and buy list', () => {
  it('counts boards, completion, cost to finish, and color identity', () => {
    expect(deckSummary(db, idea)).toMatchObject({
      name: 'Idea',
      format: 'commander',
      status: 'prospective',
      boards: { commander: 1, main: 3, side: 0, maybe: 2 },
      cardCount: 4,
      completion: 0.25, // only Sol Ring is available: Atraxa, Bolt, and Doubling Season are short
      costToFinish: 61.38, // Atraxa 27.99 + Bolt 1.04 + Doubling Season 32.35
      unpricedToBuy: 0,
      colorIdentity: 'WUBG', // a commander deck shows its commander's identity
    })
    expect(deckSummary(db, burn)).toMatchObject({ cardCount: 4, completion: 0.75, costToFinish: 1.04, colorIdentity: 'R' })
  })

  it('values the whole deck, owned or not, at each line\'s price, leaving out the maybe board', () => {
    expect(deckSummary(db, idea)).toMatchObject({
      valueUsd: 63.04, // Atraxa 27.99 + Sol Ring 1.66 (owned) + Bolt 1.04 + Doubling Season 32.35; not the 2 maybe Bolts
      unpricedCards: 0,
    })
    expect(deckSummary(db, burn)).toMatchObject({ valueUsd: 4.16, unpricedCards: 0 }) // 4 Bolt at 1.04, all owned
  })

  it('values basic lands even while the buy list leaves them out, every board\'s copies, and counts copies with no price separately', () => {
    inDeck(db, idea, 'Forest', 10)
    inDeck(db, idea, 'Command Tower', 2, 'side')
    inDeck(db, idea, 'Command Tower', 1, 'maybe')
    inDeck(db, idea, 'Sol Ring', 1, 'side')
    // 63.04 + 10 Forest at 0.19 + a second Sol Ring, on the sideboard, at 1.66
    expect(deckSummary(db, idea)).toMatchObject({ valueUsd: 66.6, unpricedCards: 2 })
  })

  it('lists what to buy, cheapest printing first, leaving out the maybe board', () => {
    expect(detail(idea).buyList).toEqual({
      items: [
        { oracleId: fixtureCard("Atraxa, Praetors' Voice").oracle_id, cardId: fixtureCard("Atraxa, Praetors' Voice").id, name: "Atraxa, Praetors' Voice", quantity: 1, priceUsd: 27.99, purchaseUrl: expect.stringMatching(/tcgplayer/) },
        { oracleId: fixtureCard('Doubling Season').oracle_id, cardId: fixtureCard('Doubling Season').id, name: 'Doubling Season', quantity: 1, priceUsd: 32.35, purchaseUrl: expect.stringMatching(/tcgplayer/) },
        { oracleId: fixtureCard('Lightning Bolt').oracle_id, cardId: fixtureCard('Lightning Bolt', 'm11').id, name: 'Lightning Bolt', quantity: 1, priceUsd: 1.04, purchaseUrl: expect.stringMatching(/tcgplayer/) },
      ],
      totalUsd: 61.38,
      unpriced: 0,
      ignoreBasics: true,
    })
  })

  it('leaves basic lands out of the buy list and completion unless told otherwise', () => {
    inDeck(db, idea, 'Forest', 10)
    expect(detail(idea).buyList.items.map((i) => i.name)).not.toContain('Forest')
    expect(deckSummary(db, idea)?.completion).toBe(0.25)
    updateSettings(db, { buylistIgnoreBasics: false })
    const withBasics = detail(idea)
    expect(withBasics.buyList.items.find((i) => i.name === 'Forest')).toMatchObject({ quantity: 10, priceUsd: 0.19 })
    expect(withBasics.completion).toBeCloseTo(1 / 14)
    expect(withBasics.costToFinish).toBe(63.28)
  })

  it('counts copies with no price separately', () => {
    inDeck(db, idea, 'Command Tower', 1)
    expect(detail(idea).buyList).toMatchObject({ totalUsd: 61.38, unpriced: 1 })
  })

  it('keeps a line whose card is gone from the card data: it counts toward the size, has no price, and can be removed', () => {
    // Scryfall re-keyed the card: the line's identity is in no card any more.
    db.prepare("UPDATE deck_cards SET oracle_id = 'gone-from-the-card-data' WHERE deck_id = ?").run(burn)
    const d = detail(burn)
    expect(d.lines).toMatchObject([{ name: MISSING_CARD_NAME, cardId: '', quantity: 4, priceUsd: null, warnings: [MISSING_CARD_WARNING] }])
    expect([d.cardCount, d.completion, d.buyList.items, d.costToFinish, d.valueUsd, d.unpricedCards]).toEqual([4, 1, [], 0, 0, 4])
    expect(deckSummaries(db).find((s) => s.id === burn)?.cardCount).toBe(4)
    expect(removeLine(db, burn, d.lines[0]!.id)).toBe(true)
    expect(detail(burn).lines).toEqual([])
  })

  it('an empty deck is complete and costs nothing', () => {
    expect(deckSummary(db, deck(db, 'Empty', 'prospective', 'casual'))).toMatchObject({ cardCount: 0, completion: 1, costToFinish: 0, valueUsd: 0, unpricedCards: 0, colorIdentity: '' })
  })

  it('summarizes every deck the same way as one at a time, by name', () => {
    expect(deckSummaries(db)).toEqual([deckSummary(db, burn), deckSummary(db, idea)])
  })
})

describe('prices (spec §4.3)', () => {
  const addPrinting = (card: ScryfallCard) => {
    insertCardRows(db, 'cards', [scryfallToRow(card) as CardRow])
    rebuildCardNames(db)
  }
  const unpriced = { usd: null, usd_foil: null, usd_etched: null }

  it('leaves out a cheaper memorabilia printing (gold border, Collectors\' Edition) when a playable one has a price', () => {
    const m11 = fixtureCard('Lightning Bolt', 'm11')
    addPrinting(
      syntheticCard({
        oracle_id: m11.oracle_id,
        name: 'Lightning Bolt',
        set: 'wc97',
        set_type: 'memorabilia',
        prices: { ...unpriced, usd: '0.10' },
        purchase_uris: { tcgplayer: 'https://www.tcgplayer.com/product/wc97-bolt' },
      }),
    )
    const d = detail(idea)
    expect(line(d, 'Lightning Bolt')?.priceUsd).toBe(1.04)
    expect(d.buyList.items.find((i) => i.name === 'Lightning Bolt')).toEqual({
      oracleId: m11.oracle_id,
      cardId: m11.id,
      name: 'Lightning Bolt',
      quantity: 1,
      priceUsd: 1.04,
      purchaseUrl: m11.purchase_uris?.tcgplayer,
    })
  })

  it('breaks a price tie the same way every time: a printing with a TCGplayer link, then the lowest id', () => {
    const { oracle_id: oracleId } = fixtureCard('Doubling Season')
    const at = (id: string, link: boolean) =>
      syntheticCard({ id, oracle_id: oracleId, name: 'Doubling Season', prices: { ...unpriced, usd: '0.25' }, purchase_uris: link ? { tcgplayer: `https://www.tcgplayer.com/product/${id}` } : undefined })
    // Added out of id order, so the table's own order can't pick the right one by chance.
    addPrinting(at('00000000-0000-4000-8000-00000000000b', false))
    addPrinting(at('00000000-0000-4000-8000-00000000000d', true))
    addPrinting(at('00000000-0000-4000-8000-00000000000c', true))
    expect(detail(idea).buyList.items.find((i) => i.name === 'Doubling Season')).toMatchObject({
      cardId: '00000000-0000-4000-8000-00000000000c',
      priceUsd: 0.25,
    })
  })

  it('uses a memorabilia price when no other printing has one', () => {
    const tower = fixtureCard('Command Tower') // its only regular printing has no price
    const gold = syntheticCard({
      oracle_id: tower.oracle_id,
      name: 'Command Tower',
      type_line: tower.type_line,
      set: 'ced',
      set_type: 'memorabilia',
      prices: { ...unpriced, usd_foil: '0.50' },
      purchase_uris: { tcgplayer: 'https://www.tcgplayer.com/product/ced-tower' },
    })
    addPrinting(gold)
    inDeck(db, idea, 'Command Tower', 1)
    const d = detail(idea)
    expect(line(d, 'Command Tower')?.priceUsd).toBe(0.5)
    expect(d.buyList.items.find((i) => i.name === 'Command Tower')).toMatchObject({ cardId: gold.id, priceUsd: 0.5, purchaseUrl: 'https://www.tcgplayer.com/product/ced-tower' })
  })
})

describe('editing decks', () => {
  const bolt = (set = 'm10') => fixtureCard('Lightning Bolt', set).id

  it('adds and removes copies, remembering a non-default printing on a new line', () => {
    expect(addToDeck(db, burn, bolt('sta'), 'side', 2)).toBe(2)
    expect(getLineRows(db, burn).find((l) => l.board === 'side')?.preferred_card_id).toBe(bolt('sta'))
    expect(addToDeck(db, burn, bolt(), 'side', -5)).toBe(0)
    expect(getLineRows(db, burn).map((l) => l.board)).toEqual(['main'])
    addToDeck(db, burn, bolt('m11'), 'maybe', 1) // M11 is the default printing, so nothing is remembered
    expect(getLineRows(db, burn).find((l) => l.board === 'maybe')?.preferred_card_id).toBeNull()
  })

  it('moves a line to another board, merging with a line already there', () => {
    const maybe = getLineRows(db, idea).find((l) => l.board === 'maybe')!
    expect(updateLine(db, idea, maybe.id, { board: 'main' })).toBe('updated')
    expect(getLineRows(db, idea).filter((l) => l.name === 'Lightning Bolt').map((l) => [l.board, l.quantity])).toEqual([['main', 3]])
  })

  it('caps a line merged by a move at 999 copies', () => {
    addToDeck(db, burn, bolt(), 'main', 995) // Burn already runs 4: 999 now
    addToDeck(db, burn, bolt(), 'side', 5)
    const side = getLineRows(db, burn).find((l) => l.board === 'side')!
    expect(updateLine(db, burn, side.id, { board: 'main' })).toBe('updated')
    expect(getLineRows(db, burn).map((l) => [l.board, l.quantity])).toEqual([['main', 999]])
  })

  it('sets quantity, category, and printing, refusing a printing of another card', () => {
    const main = getLineRows(db, burn)[0]!
    expect(updateLine(db, burn, main.id, { quantity: 3, category: '  Burn spells ', preferredCardId: bolt('sta') })).toBe('updated')
    expect(getLineRows(db, burn)[0]).toMatchObject({ quantity: 3, category: 'Burn spells', preferred_card_id: bolt('sta'), set_code: 'sta' })
    expect(updateLine(db, burn, main.id, { category: '', preferredCardId: null })).toBe('updated')
    expect(getLineRows(db, burn)[0]).toMatchObject({ category: null, preferred_card_id: null })
    expect(updateLine(db, burn, main.id, { preferredCardId: fixtureCard('Sol Ring').id })).toBe('wrong_card')
    expect(updateLine(db, idea, main.id, { quantity: 1 })).toBe('no_line')
  })

  it('caps a line at 999 copies, and removing copies a deck hasn\'t got changes nothing', () => {
    expect(addToDeck(db, burn, bolt(), 'main', 1000)).toBe(999)
    const boltOracle = fixtureCard('Lightning Bolt').oracle_id!
    importIntoDeck(db, burn, [{ oracleId: boltOracle, cardId: null, quantity: 5, board: 'main' }], false)
    expect(getLineRows(db, burn).map((l) => l.quantity)).toEqual([999])
    const updatedAt = () => db.prepare('SELECT updated_at FROM decks WHERE id = ?').pluck().get(idea)
    const before = updatedAt()
    expect(addToDeck(db, idea, bolt(), 'side', -1)).toBe(0)
    expect(updatedAt()).toBe(before)
  })

  it('duplicates a deck as a prospective copy and deletes decks with their lines', () => {
    const copy = duplicateDeck(db, burn)!
    expect(deckSummary(db, copy)).toMatchObject({ name: 'Burn (copy)', status: 'prospective', cardCount: 4 })
    // A copy of a deck with the longest name keeps within it.
    db.prepare('UPDATE decks SET name = ? WHERE id = ?').run(`${'x'.repeat(95)} tail`, burn)
    const long = deckSummary(db, duplicateDeck(db, burn)!)!.name
    expect([long.length, long.endsWith('x (copy)')]).toEqual([100, true])
    expect(deleteDeck(db, burn)).toBe(true)
    expect(deleteDeck(db, burn)).toBe(false)
    expect(count(db, 'deck_cards')).toBe(7) // Idea's 5 lines and the copies' 1 each
  })

  it('imports decklist lines, adding to or replacing what is there', () => {
    const boltOracle = fixtureCard('Lightning Bolt').oracle_id!
    expect(importIntoDeck(db, burn, [{ oracleId: boltOracle, cardId: null, quantity: 2, board: 'main' }, { oracleId: boltOracle, cardId: bolt('sta'), quantity: 1, board: 'side' }], false)).toEqual({ lines: 2, copies: 3 })
    expect(getLineRows(db, burn).map((l) => [l.board, l.quantity, l.set_code])).toEqual([['main', 6, 'm11'], ['side', 1, 'sta']])
    importIntoDeck(db, burn, [{ oracleId: boltOracle, cardId: null, quantity: 4, board: 'main' }], true)
    expect(getLineRows(db, burn).map((l) => [l.board, l.quantity])).toEqual([['main', 4]])
  })

  it("sets an imported line's category, and keeps a line's category when the import gives none", () => {
    const boltOracle = fixtureCard('Lightning Bolt').oracle_id!
    importIntoDeck(db, burn, [{ oracleId: boltOracle, cardId: null, quantity: 1, board: 'side', category: 'Removal' }], false)
    importIntoDeck(db, burn, [{ oracleId: boltOracle, cardId: null, quantity: 1, board: 'side' }], false)
    expect(getLineRows(db, burn).filter((l) => l.board === 'side').map((l) => [l.quantity, l.category])).toEqual([[2, 'Removal']])
  })

  it('trims an imported category, ignores a blank one, and replaces a different one', () => {
    const boltOracle = fixtureCard('Lightning Bolt').oracle_id!
    const importSide = (category: string) =>
      importIntoDeck(db, burn, [{ oracleId: boltOracle, cardId: null, quantity: 1, board: 'side', category }], false)
    const sideCategory = () => getLineRows(db, burn).find((l) => l.board === 'side')?.category
    importSide('  Ramp  ')
    expect(sideCategory()).toBe('Ramp')
    importSide('')
    expect(sideCategory()).toBe('Ramp')
    importSide('   ')
    expect(sideCategory()).toBe('Ramp')
    importSide('Removal')
    expect(sideCategory()).toBe('Removal')
  })
})
