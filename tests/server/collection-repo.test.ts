import { beforeEach, describe, expect, it } from 'vitest'
import { addCopies, adjustCopies, collectionStats, exportRows, getCopies } from '../../src/server/collection/repo.ts'
import type { DB } from '../../src/server/db/index.ts'
import { count, createTestDb } from '../helpers/db.ts'
import { fixtureCard } from '../helpers/fixtures.ts'
import { own } from '../helpers/library.ts'

let db: DB
beforeEach(() => {
  db = createTestDb()
})

const bolt = (set: string) => fixtureCard('Lightning Bolt', set)
const quantity = (cardId: string, finish: string) =>
  db.prepare('SELECT quantity FROM collection WHERE card_id = ? AND finish = ?').pluck().get(cardId, finish) as number | undefined

describe('adjustCopies', () => {
  it('adds a new row, then increases and decreases it; adding (not removing) counts as the date added', () => {
    const row = () => db.prepare('SELECT quantity, added_at, updated_at FROM collection').get()
    expect(adjustCopies(db, bolt('m10').id, 'foil', 1, new Date('2026-09-26T10:00:00Z'))).toBe(1)
    expect(row()).toEqual({ quantity: 1, added_at: '2026-09-26T10:00:00.000Z', updated_at: '2026-09-26T10:00:00.000Z' })
    expect(adjustCopies(db, bolt('m10').id, 'foil', 2, new Date('2026-09-27T10:00:00Z'))).toBe(3)
    expect(row()).toEqual({ quantity: 3, added_at: '2026-09-27T10:00:00.000Z', updated_at: '2026-09-27T10:00:00.000Z' })
    expect(adjustCopies(db, bolt('m10').id, 'foil', -1, new Date('2026-09-28T10:00:00Z'))).toBe(2)
    expect(row()).toEqual({ quantity: 2, added_at: '2026-09-27T10:00:00.000Z', updated_at: '2026-09-28T10:00:00.000Z' })
  })

  it('deletes the row at zero, and treats removing more than owned (or none) as removing all', () => {
    adjustCopies(db, bolt('m10').id, 'nonfoil', 2)
    expect(adjustCopies(db, bolt('m10').id, 'nonfoil', -5)).toBe(0)
    expect(count(db, 'collection')).toBe(0)
    expect(adjustCopies(db, bolt('m10').id, 'nonfoil', -1)).toBe(0)
    expect(count(db, 'collection')).toBe(0)
  })

  it('keeps finishes of one printing apart', () => {
    adjustCopies(db, bolt('sta').id, 'foil', 1)
    adjustCopies(db, bolt('sta').id, 'etched', 2)
    expect([quantity(bolt('sta').id, 'foil'), quantity(bolt('sta').id, 'etched')]).toEqual([1, 2])
  })
})

describe('getCopies', () => {
  it('lists every copy of the card identity, newest printing first, priced by finish', () => {
    own(db, 'Lightning Bolt', 'm10', 2, 'nonfoil', '2026-01-01T00:00:00.000Z')
    own(db, 'Lightning Bolt', 'sta', 1, 'etched', '2026-01-02T00:00:00.000Z')
    own(db, 'Lightning Bolt', 'sta', 1, 'nonfoil', '2026-01-03T00:00:00.000Z')
    own(db, 'Sol Ring', 'cmr', 1)
    expect(getCopies(db, bolt('m10').oracle_id!)).toEqual([
      { cardId: bolt('sta').id, setCode: 'sta', setName: 'Strixhaven Mystical Archive', collectorNumber: '42', finish: 'nonfoil', quantity: 1, priceUsd: 4.13, addedAt: '2026-01-03T00:00:00.000Z' },
      { cardId: bolt('sta').id, setCode: 'sta', setName: 'Strixhaven Mystical Archive', collectorNumber: '42', finish: 'etched', quantity: 1, priceUsd: 5.54, addedAt: '2026-01-02T00:00:00.000Z' },
      { cardId: bolt('m10').id, setCode: 'm10', setName: 'Magic 2010', collectorNumber: '146', finish: 'nonfoil', quantity: 2, priceUsd: 1.89, addedAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(getCopies(db, fixtureCard('Counterspell').oracle_id!)).toEqual([])
  })
})

describe('collectionStats', () => {
  it('is all zeros for an empty collection', () => {
    expect(collectionStats(db)).toEqual({ totalCards: 0, uniqueCards: 0, valueUsd: 0, unpricedCards: 0, lastAddedAt: null })
  })

  it('totals copies, card identities, value by finish, unpriced copies, and the last addition', () => {
    own(db, 'Lightning Bolt', 'm10', 2, 'nonfoil', '2026-01-01T00:00:00.000Z') // 2 × 1.89
    own(db, 'Lightning Bolt', 'm10', 1, 'foil', '2026-01-05T00:00:00.000Z') // 12.69
    own(db, 'Sol Ring', 'cmr', 3, 'nonfoil', '2026-01-02T00:00:00.000Z') // 3 × 1.66
    own(db, 'Command Tower', undefined, 2, 'nonfoil', '2026-01-03T00:00:00.000Z') // no price
    expect(collectionStats(db)).toEqual({
      totalCards: 8,
      uniqueCards: 3,
      valueUsd: 21.45,
      unpricedCards: 2,
      lastAddedAt: '2026-01-05T00:00:00.000Z',
    })
  })
})

describe('addCopies', () => {
  it('adds every item in one go, summing repeats and adding to rows already owned', () => {
    own(db, 'Lightning Bolt', 'm10', 1)
    const result = addCopies(db, [
      { cardId: bolt('m10').id, finish: 'nonfoil', quantity: 2 },
      { cardId: bolt('m10').id, finish: 'nonfoil', quantity: 1 },
      { cardId: bolt('m11').id, finish: 'foil', quantity: 4 },
    ])
    expect(result).toEqual({ rows: 2, copies: 7 })
    expect(quantity(bolt('m10').id, 'nonfoil')).toBe(4)
    expect(quantity(bolt('m11').id, 'foil')).toBe(4)
  })

  it('counts every row it touches as added now', () => {
    own(db, 'Lightning Bolt', 'm10', 1, 'nonfoil', '2026-01-01T00:00:00.000Z')
    addCopies(db, [{ cardId: bolt('m10').id, finish: 'nonfoil', quantity: 1 }], new Date('2026-09-26T10:00:00Z'))
    expect(db.prepare('SELECT added_at FROM collection').pluck().get()).toBe('2026-09-26T10:00:00.000Z')
  })

  it('adds nothing when any item fails', () => {
    expect(() =>
      addCopies(db, [
        { cardId: bolt('m10').id, finish: 'nonfoil', quantity: 2 },
        { cardId: 'missing', finish: 'nonfoil', quantity: 1 },
      ]),
    ).toThrow(/FOREIGN KEY/)
    expect(count(db, 'collection')).toBe(0)
  })
})

describe('exportRows', () => {
  it('lists each row by name, set, number, and finish', () => {
    own(db, 'Sol Ring', 'cmr', 1)
    own(db, 'Lightning Bolt', 'm10', 1, 'foil')
    own(db, 'Lightning Bolt', 'm10', 2, 'nonfoil')
    expect(exportRows(db)).toEqual([
      { quantity: 2, name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146', finish: 'nonfoil' },
      { quantity: 1, name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146', finish: 'foil' },
      { quantity: 1, name: 'Sol Ring', setCode: 'cmr', collectorNumber: '472', finish: 'nonfoil' },
    ])
  })
})
