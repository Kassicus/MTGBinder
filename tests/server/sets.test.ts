import { beforeEach, describe, expect, it } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { insertCardRows } from '../../src/server/cards/repo.ts'
import type { DB } from '../../src/server/db/index.ts'
import { getSetDetail, listOwnedSets } from '../../src/server/sets/repo.ts'
import type { ScryfallCard } from '../../src/server/scryfall/types.ts'
import type { Finish, SetDetail, SetProgress } from '../../src/shared/types.ts'
import { body, makeApp } from '../helpers/app.ts'
import { createTestDb } from '../helpers/db.ts'
import { syntheticCard } from '../helpers/fixtures.ts'

/**
 * A made-up set, "Test Set" (tst), beside the fixture printings: Alpha (#1, and a showcase version, #300), Beta (#2),
 * Gamma (#10), Delta (#7a), Epsilon (#7), and Forest twice (#280, #281), which is 6 cards in 8 printings. Alpha is
 * reprinted in "Other Set" (oth).
 */
const ALPHA = { oracle_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Alpha' }
const FOREST = { oracle_id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Forest' }
const TST = { set: 'tst', set_name: 'Test Set', set_type: 'expansion', released_at: '2024-09-27' }

let db: DB
const ids: Record<string, string> = {}

function add(key: string, card: Partial<ScryfallCard>): void {
  const scryfall = syntheticCard(card)
  ids[key] = scryfall.id
  insertCardRows(db, 'cards', [scryfallToRow(scryfall) as CardRow])
}

function own(key: string, quantity: number, finish: Finish = 'nonfoil'): void {
  db.prepare("INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (?, ?, ?, 't', 't')").run(
    ids[key],
    finish,
    quantity,
  )
}

beforeEach(() => {
  db = createTestDb()
  add('alpha', { ...TST, ...ALPHA, collector_number: '1', mana_cost: '{1}{G}', rarity: 'common' })
  add('alphaShowcase', { ...TST, ...ALPHA, collector_number: '300', mana_cost: '{1}{G}', rarity: 'common' })
  add('beta', { ...TST, name: 'Beta', collector_number: '2', mana_cost: '{U}', rarity: 'rare' })
  add('gamma', { ...TST, name: 'Gamma', collector_number: '10', mana_cost: '{2}{B}', rarity: 'uncommon' })
  add('delta', { ...TST, name: 'Delta', collector_number: '7a', mana_cost: '{R}', rarity: 'mythic' })
  // The set's prerelease printing came out first: the set's release date is its earliest printing's.
  add('epsilon', { ...TST, name: 'Epsilon', collector_number: '7', mana_cost: '{W}', rarity: 'common', released_at: '2024-09-20' })
  add('forest', { ...TST, ...FOREST, collector_number: '280', mana_cost: '', rarity: 'common' })
  add('forest2', { ...TST, ...FOREST, collector_number: '281', mana_cost: '', rarity: 'common' })
  add('alphaReprint', { ...ALPHA, set: 'oth', set_name: 'Other Set', set_type: 'masters', released_at: '2025-03-01', collector_number: '5' })
})

const tst = () => listOwnedSets(db).find((s) => s.code === 'tst')

describe('listOwnedSets', () => {
  it('is empty for an empty collection', () => {
    expect(listOwnedSets(db)).toEqual([])
  })

  it('counts a card once whichever of its printings in the set is owned, in any finish', () => {
    own('alphaShowcase', 2, 'foil')
    own('forest', 3)
    own('forest2', 1)
    own('beta', 1, 'etched')
    expect(listOwnedSets(db)).toEqual<SetProgress[]>([
      { code: 'tst', name: 'Test Set', setType: 'expansion', releasedAt: '2024-09-20', owned: 3, total: 6 },
    ])
  })

  it("doesn't count a reprint from another set, which shows that set instead, newest set first", () => {
    own('alphaReprint', 1)
    own('gamma', 1)
    expect(listOwnedSets(db)).toEqual<SetProgress[]>([
      { code: 'oth', name: 'Other Set', setType: 'masters', releasedAt: '2025-03-01', owned: 1, total: 1 },
      { code: 'tst', name: 'Test Set', setType: 'expansion', releasedAt: '2024-09-20', owned: 1, total: 6 },
    ])
  })

  it('shows a complete set as every card owned', () => {
    for (const key of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'forest2']) own(key, 1)
    expect(tst()).toMatchObject({ owned: 6, total: 6 })
  })
})

describe('getSetDetail', () => {
  it('lists each card once, at its lowest collector number, in number order, with the copies owned from the set', () => {
    own('alphaShowcase', 2, 'foil')
    own('alpha', 1)
    own('alphaReprint', 4)
    own('forest2', 3)
    const detail = getSetDetail(db, 'tst')
    expect(detail).toMatchObject({ code: 'tst', name: 'Test Set', setType: 'expansion', releasedAt: '2024-09-20', owned: 2, total: 6 })
    expect(detail?.cards).toEqual([
      { cardId: ids.alpha, oracleId: ALPHA.oracle_id, name: 'Alpha', collectorNumber: '1', manaCost: '{1}{G}', rarity: 'common', copies: 3 },
      { cardId: ids.beta, oracleId: expect.any(String), name: 'Beta', collectorNumber: '2', manaCost: '{U}', rarity: 'rare', copies: 0 },
      { cardId: ids.epsilon, oracleId: expect.any(String), name: 'Epsilon', collectorNumber: '7', manaCost: '{W}', rarity: 'common', copies: 0 },
      { cardId: ids.delta, oracleId: expect.any(String), name: 'Delta', collectorNumber: '7a', manaCost: '{R}', rarity: 'mythic', copies: 0 },
      { cardId: ids.gamma, oracleId: expect.any(String), name: 'Gamma', collectorNumber: '10', manaCost: '{2}{B}', rarity: 'uncommon', copies: 0 },
      { cardId: ids.forest, oracleId: FOREST.oracle_id, name: 'Forest', collectorNumber: '280', manaCost: '', rarity: 'common', copies: 3 },
    ])
  })

  it('orders collector numbers by their digits as numbers: 2 before 10, A25-99 before A25-101', () => {
    for (const number of ['10', 'A25-101', '2', '7a', 'A25-99', '7', '1★']) {
      add(`num ${number}`, { set: 'num', set_name: 'Numbers', released_at: '2020-01-01', name: `Card ${number}`, collector_number: number })
    }
    expect(getSetDetail(db, 'num')?.cards.map((card) => card.collectorNumber)).toEqual(['1★', '2', '7', '7a', '10', 'A25-99', 'A25-101'])
  })

  it('shows a set with nothing owned, and matches the code in any case', () => {
    const detail = getSetDetail(db, 'TsT')
    expect(detail).toMatchObject({ code: 'tst', owned: 0, total: 6 })
    expect(detail?.cards.every((card) => card.copies === 0)).toBe(true)
  })

  it('is null for a code that names no set', () => {
    expect(getSetDetail(db, 'nope')).toBeNull()
    expect(getSetDetail(db, '')).toBeNull()
  })
})

describe('sets routes', () => {
  it('lists the owned sets, and a set by its code, in any case', async () => {
    own('beta', 1)
    const app = makeApp({ db })
    const list = await app.request('/api/sets')
    expect(list.status).toBe(200)
    expect(await body<SetProgress[]>(list)).toEqual([
      { code: 'tst', name: 'Test Set', setType: 'expansion', releasedAt: '2024-09-20', owned: 1, total: 6 },
    ])
    const set = await app.request('/api/sets/TST')
    expect(set.status).toBe(200)
    const detail = await body<SetDetail>(set)
    expect(detail).toMatchObject({ code: 'tst', owned: 1, total: 6 })
    expect(detail.cards.map((card) => `${card.collectorNumber} ${card.copies}`)).toEqual(['1 0', '2 1', '7 0', '7a 0', '10 0', '280 0'])
  })

  it('answers 404 for a code that names no set', async () => {
    const res = await makeApp({ db }).request('/api/sets/nope')
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: { code: 'not_found', message: 'No set with that code' } })
  })
})
