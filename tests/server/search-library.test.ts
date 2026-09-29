import { beforeAll, describe, expect, it } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { insertCardRows } from '../../src/server/cards/repo.ts'
import { collectionStats } from '../../src/server/collection/repo.ts'
import type { DB } from '../../src/server/db/index.ts'
import { getOwnership } from '../../src/server/ownership/repo.ts'
import { compileFilter } from '../../src/server/search/compile.ts'
import { searchLibrary, type LibrarySearchParams } from '../../src/server/search/run.ts'
import { freeCopies } from '../../src/shared/ownership.ts'
import { parseSearch } from '../../src/shared/search/parse.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'
import { deck, inDeck, own } from '../helpers/library.ts'

let db: DB

// Collection: Bolt 2 nonfoil (m10) + 1 foil (m11), Sol Ring 1, Counterspell 4, Llanowar Elves 3, Atraxa 1 foil.
// Decks: Burn (built) 4 Bolt; Elves (built) 2 Llanowar main + 1 maybe; Atraxa Superfriends (prospective)
// Atraxa commander + 1 each of Sol Ring, Counterspell, Doubling Season, Lightning Bolt.
beforeAll(() => {
  db = createTestDb()
  own(db, 'Lightning Bolt', 'm10', 2, 'nonfoil', '2026-01-01T00:00:00.000Z')
  own(db, 'Lightning Bolt', 'm11', 1, 'foil', '2026-01-05T00:00:00.000Z')
  own(db, 'Sol Ring', 'cmr', 1, 'nonfoil', '2026-01-02T00:00:00.000Z')
  own(db, 'Counterspell', undefined, 4, 'nonfoil', '2026-01-03T00:00:00.000Z')
  own(db, 'Llanowar Elves', undefined, 3, 'nonfoil', '2026-01-04T00:00:00.000Z')
  own(db, "Atraxa, Praetors' Voice", undefined, 1, 'foil', '2026-01-06T00:00:00.000Z')
  const burn = deck(db, 'Burn', 'built', 'modern')
  inDeck(db, burn, 'Lightning Bolt', 4)
  const elves = deck(db, 'Elves', 'built', 'pauper')
  inDeck(db, elves, 'Llanowar Elves', 2)
  inDeck(db, elves, 'Llanowar Elves', 1, 'maybe')
  const atraxa = deck(db, 'Atraxa Superfriends', 'prospective')
  inDeck(db, atraxa, "Atraxa, Praetors' Voice", 1, 'commander')
  for (const name of ['Sol Ring', 'Counterspell', 'Doubling Season', 'Lightning Bolt']) inDeck(db, atraxa, name, 1)
})

function search(q: string, overrides: Partial<LibrarySearchParams> = {}) {
  return searchLibrary(db, { q, view: 'cards', sort: 'name', dir: 'asc', page: 1, ...overrides })
}
const names = (q: string, overrides: Partial<LibrarySearchParams> = {}) => search(q, overrides).cards.map((c) => c.name)

describe('ownership', () => {
  it('counts owned copies across printings and finishes, and subtracts built decks only', () => {
    const bolt = fixtureCard('Lightning Bolt').oracle_id!
    const elves = fixtureCard('Llanowar Elves').oracle_id!
    const season = fixtureCard('Doubling Season').oracle_id!
    // A built deck with Bolt only on its maybe board is listed, but claims no copies.
    inDeck(db, deck(db, 'Burn Ideas', 'built', 'modern'), 'Lightning Bolt', 3, 'maybe')
    const ownership = getOwnership(db, [bolt, elves, season, bolt])
    expect(ownership.size).toBe(3)
    expect(ownership.get(bolt)).toEqual({
      owned: 3,
      free: -1,
      decks: [
        { id: expect.any(Number), name: 'Atraxa Superfriends', status: 'prospective', quantity: 1, maybe: 0 },
        { id: expect.any(Number), name: 'Burn', status: 'built', quantity: 4, maybe: 0 },
        { id: expect.any(Number), name: 'Burn Ideas', status: 'built', quantity: 0, maybe: 3 },
      ],
    })
    expect(ownership.get(elves)).toMatchObject({ owned: 3, free: 1, decks: [{ name: 'Elves', status: 'built', quantity: 2, maybe: 1 }] })
    expect(ownership.get(season)).toMatchObject({ owned: 0, free: 0, decks: [{ name: 'Atraxa Superfriends' }] })
  })

  it('returns an empty map for no ids', () => {
    expect(getOwnership(db, []).size).toBe(0)
  })

  it('freeCopies ignores prospective decks', () => {
    expect(freeCopies(3, [{ id: 1, name: 'a', status: 'built', quantity: 4, maybe: 0 }, { id: 2, name: 'b', status: 'prospective', quantity: 9, maybe: 0 }])).toBe(-1)
  })
})

describe('searchLibrary', () => {
  it('lists the whole collection for an empty query, one row per card with total copies', () => {
    const page = search('')
    expect(page.total).toBe(5)
    // Each row also names the finish of the collection row it shows (and is priced by).
    expect(page.cards.map((c) => [c.name, c.quantity, c.finish])).toEqual([
      ["Atraxa, Praetors' Voice", 1, 'foil'],
      ['Counterspell', 4, 'nonfoil'],
      ['Lightning Bolt', 3, 'nonfoil'],
      ['Llanowar Elves', 3, 'nonfoil'],
      ['Sol Ring', 1, 'nonfoil'],
    ])
    expect(page.cards[2]?.ownership).toMatchObject({ owned: 3, free: -1 })
  })

  it('lists each owned printing and finish in the printings view', () => {
    const page = search('', { view: 'printings' })
    expect(page.total).toBe(6)
    expect(page.cards.filter((c) => c.name === 'Lightning Bolt').map((c) => [c.setCode, c.finish, c.quantity])).toEqual([
      ['m10', 'nonfoil', 2],
      ['m11', 'foil', 1],
    ])
  })

  it.each([
    ['is:foil', ["Atraxa, Praetors' Voice", 'Lightning Bolt']],
    ['free>0', ["Atraxa, Praetors' Voice", 'Counterspell', 'Llanowar Elves', 'Sol Ring']],
    ['free<0', ['Lightning Bolt']],
    ['qty>=3', ['Counterspell', 'Lightning Bolt', 'Llanowar Elves']],
    ['in:deck', ["Atraxa, Praetors' Voice", 'Counterspell', 'Lightning Bolt', 'Llanowar Elves', 'Sol Ring']],
    ['in:built', ['Lightning Bolt', 'Llanowar Elves']],
    ['in:prospective', ["Atraxa, Praetors' Voice", 'Counterspell', 'Lightning Bolt', 'Sol Ring']],
    ['in:"atraxa superfriends"', ["Atraxa, Praetors' Voice", 'Counterspell', 'Lightning Bolt', 'Sol Ring']],
    ['in:nothing', []],
    ['is:wanted', ['Lightning Bolt']],
    ['t:instant', ['Counterspell', 'Lightning Bolt']],
    ['-is:foil t:creature', ['Llanowar Elves']],
  ])('%s', (q, expected) => {
    expect(names(q)).toEqual(expected)
  })

  it('sums only the copies that match the filter', () => {
    expect(search('is:foil').cards.find((c) => c.name === 'Lightning Bolt')?.quantity).toBe(1)
    expect(search('s:m11').cards.map((c) => [c.name, c.setCode, c.quantity])).toEqual([['Lightning Bolt', 'm11', 1]])
  })

  it('sorts by date added (latest copy per card, or per row in the printings view)', () => {
    expect(names('', { sort: 'added', dir: 'desc' })).toEqual(["Atraxa, Praetors' Voice", 'Lightning Bolt', 'Llanowar Elves', 'Counterspell', 'Sol Ring'])
    expect(search('', { view: 'printings', sort: 'added' }).cards.map((c) => `${c.name}/${c.finish}`)).toEqual([
      'Lightning Bolt/nonfoil', 'Sol Ring/nonfoil', 'Counterspell/nonfoil', 'Llanowar Elves/nonfoil', 'Lightning Bolt/foil', "Atraxa, Praetors' Voice/foil",
    ])
  })

  it('sorts by quantity: every matching copy of a card, or each row in the printings view, with name as the tiebreak', () => {
    expect(names('', { sort: 'quantity', dir: 'desc' })).toEqual(['Counterspell', 'Lightning Bolt', 'Llanowar Elves', "Atraxa, Praetors' Voice", 'Sol Ring'])
    expect(names('', { sort: 'quantity', dir: 'asc' })).toEqual(["Atraxa, Praetors' Voice", 'Sol Ring', 'Lightning Bolt', 'Llanowar Elves', 'Counterspell'])
    // Only the copies that match count: the foil Bolt alone is 1.
    expect(search('is:foil', { sort: 'quantity', dir: 'desc' }).cards.map((c) => [c.name, c.quantity])).toEqual([
      ["Atraxa, Praetors' Voice", 1], ['Lightning Bolt', 1],
    ])
    expect(search('', { view: 'printings', sort: 'quantity', dir: 'desc' }).cards.map((c) => `${c.name}/${c.finish} ${c.quantity}`)).toEqual([
      'Counterspell/nonfoil 4', 'Llanowar Elves/nonfoil 3', 'Lightning Bolt/nonfoil 2', "Atraxa, Praetors' Voice/foil 1", 'Lightning Bolt/foil 1', 'Sol Ring/nonfoil 1',
    ])
  })

  it('sorts by mana value with name as the tiebreak', () => {
    expect(names('', { sort: 'mv', dir: 'desc' })).toEqual(["Atraxa, Praetors' Voice", 'Counterspell', 'Lightning Bolt', 'Llanowar Elves', 'Sol Ring'])
  })

  it('prices each row by its finish, and the cards view by the row it shows', () => {
    const printings = search('bolt', { view: 'printings' }).cards.map((c) => [c.setCode, c.finish, c.priceUsd])
    expect(printings).toEqual([
      ['m10', 'nonfoil', 1.89],
      ['m11', 'foil', 6.68],
    ])
    // The cards view shows the row with the most copies: 2 nonfoil m10 over 1 foil m11.
    expect(search('bolt').cards.map((c) => [c.setCode, c.finish, c.priceUsd, c.quantity])).toEqual([
      ['m10', 'nonfoil', 1.89, 3],
    ])
    expect(search('is:foil bolt').cards.map((c) => [c.setCode, c.finish, c.priceUsd])).toEqual([['m11', 'foil', 6.68]])
  })

  it('sorts by the finish price', () => {
    const byPrice = search('t:instant', { view: 'printings', sort: 'price', dir: 'desc' }).cards
    expect(byPrice.map((c) => [c.name, c.setCode, c.finish])).toEqual([
      ['Lightning Bolt', 'm11', 'foil'],
      ['Counterspell', 'dsc', 'nonfoil'],
      ['Lightning Bolt', 'm10', 'nonfoil'],
    ])
  })

  it('sorts the cards view by the price of the row each card shows', () => {
    // Atraxa is a foil copy (33.53, not the nonfoil 27.99); Bolt shows its 2 nonfoil m10 copies (1.89), so the
    // 1 foil m11 copy (6.68) doesn't lift it above Counterspell.
    const byPrice = search('', { sort: 'price', dir: 'desc' }).cards
    expect(byPrice.map((c) => [c.name, c.setCode, c.finish, c.priceUsd])).toEqual([
      ["Atraxa, Praetors' Voice", '2xm', 'foil', 33.53],
      ['Counterspell', 'dsc', 'nonfoil', 3.59],
      ['Lightning Bolt', 'm10', 'nonfoil', 1.89],
      ['Sol Ring', 'cmr', 'nonfoil', 1.66],
      ['Llanowar Elves', 'fdn', 'nonfoil', 0.35],
    ])
  })

  it('orders two finishes of one printing nonfoil first, then foil, then etched', () => {
    const own3 = createTestDb()
    own(own3, 'Lightning Bolt', 'sta', 1, 'etched')
    own(own3, 'Lightning Bolt', 'sta', 1, 'foil')
    own(own3, 'Lightning Bolt', 'sta', 1, 'nonfoil')
    const page = searchLibrary(own3, { q: '', view: 'printings', sort: 'name', dir: 'asc', page: 1 })
    expect(page.cards.map((c) => [c.finish, c.priceUsd])).toEqual([
      ['nonfoil', 4.13],
      ['foil', 6.09],
      ['etched', 5.54],
    ])
  })

  it('pages results and reports the total on every page, including past the end', () => {
    const everything = createTestDb()
    everything.exec("INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) SELECT id, 'nonfoil', 1, 't', 't' FROM cards")
    const at = (page: number) => searchLibrary(everything, { q: '', view: 'printings', sort: 'name', dir: 'asc', page })
    expect([at(1).total, at(1).cards.length, at(1).hasMore]).toEqual([61, 60, true])
    expect([at(2).total, at(2).cards.length, at(2).hasMore]).toEqual([61, 1, false])
    expect([at(3).total, at(3).cards.length, at(3).hasMore]).toEqual([61, 0, false])
    const cards = searchLibrary(everything, { q: '', view: 'cards', sort: 'name', dir: 'asc', page: 2 })
    expect([cards.total, cards.cards.length]).toEqual([58, 0])
    const names1 = at(1).cards.map((c) => c.cardId)
    expect(new Set([...names1, ...at(2).cards.map((c) => c.cardId)]).size).toBe(61)
  })

  it('marks only queries that use free, qty, or is:wanted as needing the ownership totals', () => {
    const uses = (q: string) => {
      const parsed = parseSearch(q)
      if (!parsed.ok) throw new Error(parsed.error.message)
      return compileFilter(parsed.ast, 'library').ownership
    }
    expect(['free>0', 'qty>=2', 'is:wanted', 't:elf or -own<1'].map(uses)).toEqual([true, true, true, true])
    expect(['', 't:elf', 'in:built', 'is:foil', 'usd>1'].map(uses)).toEqual([false, false, false, false, false])
  })

  it('combines ownership keys with other terms', () => {
    expect(names('free<0 or t:creature')).toEqual(["Atraxa, Praetors' Voice", 'Lightning Bolt', 'Llanowar Elves'])
    expect(names('-qty>=3')).toEqual(["Atraxa, Praetors' Voice", 'Sol Ring'])
  })

  it('is:unpriced finds the copies whose own finish has no price, the ones the library value counts as unpriced', () => {
    const lib = createTestDb()
    const prices = fixtureCard('Grizzly Bears').prices
    // No foil price, like a printing Scryfall prices only in nonfoil; and no price at all.
    const noFoilPrice = scryfallToRow(syntheticCard({ name: 'Foilless Bear', finishes: ['nonfoil', 'foil'], prices: { ...prices, usd: '0.20', usd_foil: null } })) as CardRow
    const noPrice = scryfallToRow(syntheticCard({ name: 'Priceless Bear', prices: { ...prices, usd: null, usd_foil: null, usd_etched: null } })) as CardRow
    insertCardRows(lib, 'cards', [noFoilPrice, noPrice])
    const add = lib.prepare("INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (?, ?, ?, 't', 't')")
    add.run(noFoilPrice.id, 'foil', 2)
    add.run(noFoilPrice.id, 'nonfoil', 3)
    add.run(noPrice.id, 'nonfoil', 1)
    own(lib, 'Counterspell', undefined, 1)
    const page = searchLibrary(lib, { q: 'is:unpriced', view: 'printings', sort: 'name', dir: 'asc', page: 1 })
    expect(page.cards.map((c) => [c.name, c.finish, c.quantity, c.priceUsd])).toEqual([
      ['Foilless Bear', 'foil', 2, null],
      ['Priceless Bear', 'nonfoil', 1, null],
    ])
    expect(collectionStats(lib).unpricedCards).toBe(3)
    // The cards view shows the unpriced row, not the bear's nonfoil row with more copies.
    expect(searchLibrary(lib, { q: 'is:unpriced', view: 'cards', sort: 'name', dir: 'asc', page: 1 }).cards.map((c) => [c.name, c.finish, c.quantity])).toEqual([
      ['Foilless Bear', 'foil', 2],
      ['Priceless Bear', 'nonfoil', 1],
    ])
    expect(searchLibrary(lib, { q: '-is:unpriced', view: 'printings', sort: 'name', dir: 'asc', page: 1 }).cards.map((c) => [c.name, c.finish])).toEqual([
      ['Counterspell', 'nonfoil'],
      ['Foilless Bear', 'nonfoil'],
    ])
  })

  it('sorts names without regard to letter case', () => {
    const mixed = createTestDb()
    const lower = scryfallToRow(syntheticCard({ name: 'b-side bear' })) as CardRow
    insertCardRows(mixed, 'cards', [lower])
    mixed.prepare("INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (?, 'nonfoil', 1, 't', 't')").run(lower.id)
    own(mixed, 'Counterspell', undefined, 1)
    own(mixed, 'Atraxa, Praetors\' Voice', undefined, 1)
    for (const view of ['cards', 'printings'] as const) {
      const page = searchLibrary(mixed, { q: '', view, sort: 'name', dir: 'asc', page: 1 })
      expect(page.cards.map((c) => c.name)).toEqual(["Atraxa, Praetors' Voice", 'b-side bear', 'Counterspell'])
    }
  })
})
