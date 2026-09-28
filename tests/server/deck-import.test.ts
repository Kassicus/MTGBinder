import { beforeAll, describe, expect, it } from 'vitest'
import { cardNameIndex } from '../../src/server/cards/names.ts'
import { FUZZY_THRESHOLD, previewDeckImport } from '../../src/server/decks/import.ts'
import type { DB } from '../../src/server/db/index.ts'
import { normalizeName } from '../../src/shared/normalize.ts'
import { jaroWinkler } from '../../src/shared/similarity.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard } from '../helpers/fixtures.ts'

let db: DB
beforeAll(() => {
  db = createTestDb()
})

const rows = (text: string) => previewDeckImport(db, text).rows.map((r) => [r.name, r.match, r.card?.name ?? null, r.card?.cardId ?? null, r.board])

describe('previewDeckImport (spec §5.4.2 resolution order)', () => {
  it('matches exact names first, ignoring case and punctuation', () => {
    expect(rows('1 lightning bolt\n1 Atraxa Praetors Voice')).toEqual([
      ['lightning bolt', 'exact', 'Lightning Bolt', null, 'main'],
      ['Atraxa Praetors Voice', 'exact', "Atraxa, Praetors' Voice", null, 'main'],
    ])
  })

  it('then face names, including the front half of "A // B" names', () => {
    expect(rows('1 Insectile Aberration\n1 Fire\n1 Lightning Bolt // Lightning Bolt')).toEqual([
      ['Insectile Aberration', 'face', 'Delver of Secrets // Insectile Aberration', null, 'main'],
      ['Fire', 'face', 'Fire // Ice', null, 'main'],
      ['Lightning Bolt // Lightning Bolt', 'exact', 'Lightning Bolt', null, 'main'],
    ])
  })

  it('then the closest name scoring at least 0.92, with its score', () => {
    const [typo] = previewDeckImport(db, '4 Lightnig Bolt').rows
    expect(typo).toMatchObject({ match: 'fuzzy', card: { name: 'Lightning Bolt' } })
    expect(typo?.score).toBeGreaterThanOrEqual(0.92)
  })

  it('leaves everything else unresolved', () => {
    expect(rows('1 Not A Real Card\n1 Bolt')).toEqual([
      ['Not A Real Card', 'unresolved', null, null, 'main'],
      ['Bolt', 'unresolved', null, null, 'main'],
    ])
  })

  it('keeps a named printing only when it is a printing of the matched card', () => {
    expect(rows('1 Lightning Bolt (STA) 42\n1 Lightning Bolt (M10) 1\n1 Sol Ring (M10) 146')).toEqual([
      ['Lightning Bolt', 'exact', 'Lightning Bolt', fixtureCard('Lightning Bolt', 'sta').id, 'main'],
      ['Lightning Bolt', 'exact', 'Lightning Bolt', null, 'main'],
      ['Sol Ring', 'exact', 'Sol Ring', null, 'main'],
    ])
  })

  it('counts matches and passes through skipped lines and boards', () => {
    const preview = previewDeckImport(db, 'Commander\n1 Atraxa, Praetors\' Voice\nDeck\n1 Lightnig Bolt\n1 Nope\n(CMR) 472')
    expect(preview.counts).toEqual({ exact: 1, face: 0, fuzzy: 1, unresolved: 1 })
    expect(preview.skipped).toEqual([{ line: 6, text: '(CMR) 472' }])
    expect(preview.rows[0]?.board).toBe('commander')
  })
})

describe('previewDeckImport fuzzy search', () => {
  it('finds a close name whatever its first letter or length', () => {
    expect(previewDeckImport(db, '1 Kightning Bolt\n1 Swords to Plow').rows.map((r) => [r.name, r.match, r.card?.name ?? null, r.score])).toEqual([
      ['Kightning Bolt', 'fuzzy', 'Lightning Bolt', 0.952],
      ['Swords to Plow', 'fuzzy', 'Swords to Plowshares', 0.94],
    ])
  })

  it('finds exactly what a brute-force search of every name finds', () => {
    const keys = cardNameIndex(db).keys
    // Typos of every name: another first letter, cut to 60%, a letter dropped, two letters swapped.
    const typos = keys.flatMap(({ key }) => {
      const mid = Math.floor(key.length / 2)
      return [
        `${key[0] === 'k' ? 'x' : 'k'}${key.slice(1)}`,
        key.slice(0, Math.ceil(key.length * 0.6)),
        key.slice(0, mid) + key.slice(mid + 1),
        key.slice(0, mid - 1) + key.slice(mid, mid + 1) + key.slice(mid - 1, mid) + key.slice(mid + 1),
      ]
    })
    const picked = ['Swords to Plow', 'Lightnig Helix', 'Serra Angle', 'Thoughtsieze', 'Omnath Locus of Creatoin', 'Zzyzx Road', 'Ligthning']
    const rows = previewDeckImport(db, [...picked, ...typos].map((name) => `1 ${name}`).join('\n'), { fuzzyLimit: Infinity }).rows
    const compared = rows.filter((row) => row.match === 'fuzzy' || row.match === 'unresolved')
    for (const row of compared) {
      const key = normalizeName(row.name)
      let best: { oracleId: string; score: number } | null = null
      for (const candidate of keys) {
        const score = jaroWinkler(key, candidate.key)
        if (score >= FUZZY_THRESHOLD && (best === null || score > best.score)) best = { oracleId: candidate.oracleId, score }
      }
      const expected = best ? ['fuzzy', best.oracleId, Math.round(best.score * 1000) / 1000] : ['unresolved', null, null]
      expect([row.match, row.card?.oracleId ?? null, row.score], row.name).toEqual(expected)
    }
    expect(compared.filter((row) => row.match === 'fuzzy').length).toBeGreaterThan(100)
    expect(compared.filter((row) => row.match === 'unresolved').length).toBeGreaterThan(20)
  })

  it('sends at most fuzzyLimit distinct names through the fuzzy search, looking each up once', () => {
    const preview = previewDeckImport(db, '1 Lightnig Bolt\n1 Swords to Plowshare\n1 lightnig bolt\n1 Sol Ring', { fuzzyLimit: 1 })
    expect(preview.rows.map((r) => [r.name, r.match, r.card?.name ?? null])).toEqual([
      ['Lightnig Bolt', 'fuzzy', 'Lightning Bolt'],
      ['Swords to Plowshare', 'unresolved', null],
      ['lightnig bolt', 'fuzzy', 'Lightning Bolt'],
      ['Sol Ring', 'exact', 'Sol Ring'],
    ])
  })
})
