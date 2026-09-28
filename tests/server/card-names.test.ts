import { beforeAll, describe, expect, it } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { cardNameIndex, type CardNameIndex } from '../../src/server/cards/names.ts'
import { findCardByName, insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import type { DB } from '../../src/server/db/index.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'

let index: CardNameIndex
// A joke card whose name matches Lightning Bolt once punctuation is ignored (like "Rampant, Growth"). It sorts before
// "Lightning Bolt" by name, so only the regular-set preference keeps the real card ahead.
const joke = syntheticCard({ name: 'LIGHTNING BOLT!', set: 'unk', set_type: 'funny' })

beforeAll(() => {
  const db = createTestDb()
  insertCardRows(db, 'cards', [scryfallToRow(joke) as CardRow])
  rebuildCardNames(db)
  index = cardNameIndex(db)
})

const oracle = (name: string) => fixtureCard(name).oracle_id ?? ''

describe('cardNameIndex', () => {
  it('finds full names in any case, ignoring punctuation and accents', () => {
    expect(index.find('LIGHTNING BOLT')).toEqual({ oracleId: oracle('Lightning Bolt'), match: 'exact' })
    expect(index.find('Atraxa Praetors Voice')).toEqual({ oracleId: oracle("Atraxa, Praetors' Voice"), match: 'exact' })
  })

  it('prefers the exact name, then a card from a regular set, when names collide without punctuation', () => {
    expect(index.find('Lightning Bolt')?.oracleId).toBe(oracle('Lightning Bolt'))
    expect(index.find('Lightning, Bolt')?.oracleId).toBe(oracle('Lightning Bolt'))
    expect(index.find('lightning bolt!')?.oracleId).toBe(joke.oracle_id)
  })

  it('finds face names of multi-face cards, and the front half of "A // B"', () => {
    expect(index.find('Insectile Aberration')).toEqual({ oracleId: oracle('Delver of Secrets // Insectile Aberration'), match: 'face' })
    expect(index.find('Lightning Bolt // Lightning Bolt')).toEqual({ oracleId: oracle('Lightning Bolt'), match: 'exact' })
    expect(index.find('Nope')).toBeNull()
  })

  it('names each card and lists every name once for fuzzy matching', () => {
    expect(index.name(oracle('Fire // Ice'))).toBe('Fire // Ice')
    const keys = index.keys.map((k) => k.key)
    expect(keys.filter((k) => k === 'lightning bolt')).toHaveLength(1)
    expect(keys).toContain('insectile aberration')
  })
})

describe('findCardByName', () => {
  let db: DB
  // A single-faced card named like the front half of Fire // Ice.
  const fire = syntheticCard({ name: 'Fire' })
  // A joke two-faced card whose faces match Delver's once punctuation is ignored.
  const delver = fixtureCard('Delver of Secrets // Insectile Aberration')
  const jokeDelver = syntheticCard({
    name: 'Delver of Secrets! // Insectile Aberration!',
    layout: delver.layout,
    set: 'unk',
    set_type: 'funny',
    card_faces: delver.card_faces?.map((face) => ({ ...face, name: `${face.name}!` })),
  })
  const written = ['Lightning Bolt', 'Lightning, Bolt', 'lightning bolt!', 'Fire // Ice', 'Fire', 'Agadeem, the Undercrypt', 'Insectile Aberration']

  beforeAll(() => {
    db = createTestDb()
    insertCardRows(db, 'cards', [joke, fire, jokeDelver].map((card) => scryfallToRow(card) as CardRow))
    rebuildCardNames(db)
  })

  const found = (name: string) => findCardByName(db, name)?.oracleId

  it('prefers the exact name, then a card from a regular set, when names collide without punctuation', () => {
    // The joke card comes first by oracle id, so it would win if nothing ranked the candidates.
    expect((joke.oracle_id ?? '') < oracle('Lightning Bolt')).toBe(true)
    expect(found('Lightning Bolt')).toBe(oracle('Lightning Bolt'))
    expect(found('Lightning, Bolt')).toBe(oracle('Lightning Bolt'))
    expect(found('lightning bolt!')).toBe(joke.oracle_id)
  })

  it('prefers the whole written name to its front half, then finds a face of a multi-face card', () => {
    expect(found('Fire // Ice')).toBe(oracle('Fire // Ice'))
    expect(found('Fire')).toBe(fire.oracle_id)
    expect(found('Agadeem, the Undercrypt')).toBe(oracle("Agadeem's Awakening // Agadeem, the Undercrypt"))
    expect(findCardByName(db, 'Lightning Bolt')).toMatchObject({ name: 'Lightning Bolt', cardId: fixtureCard('Lightning Bolt', 'm11').id })
  })

  it('prefers a card from a regular set when face names collide without punctuation', () => {
    expect((jokeDelver.oracle_id ?? '') < (delver.oracle_id ?? '')).toBe(true)
    expect(found('Insectile Aberration')).toBe(delver.oracle_id)
  })

  it('means the same card as cardNameIndex', () => {
    const index = cardNameIndex(db)
    for (const name of written) expect(found(name)).toBe(index.find(name)?.oracleId)
  })
})
