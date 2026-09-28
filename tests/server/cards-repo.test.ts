import { beforeEach, describe, expect, it } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { autocomplete, CARD_NAMES_VERSION, ensureCardNamesCurrent, getCard, getPrintings, insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import { openDb, type DB } from '../../src/server/db/index.ts'
import { getMeta, setMeta } from '../../src/server/db/meta.ts'
import type { ScryfallCard } from '../../src/server/scryfall/types.ts'
import { count, createTestDb, fixtureRows } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'

const BOLT_M10 = '435589bb-27c6-4a6d-9d63-394d5092b9d8'

let db: DB
beforeEach(() => {
  db = createTestDb()
})

describe('card repository', () => {
  it('gets a card by id', () => {
    const card = getCard(db, BOLT_M10)
    expect(card).toMatchObject({ name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146', manaCost: '{R}', colors: 'R', faces: [] })
    expect(card?.prices.usd === null || typeof card?.prices.usd === 'number').toBe(true)
    expect(card?.legalities.modern).toBe('legal')
  })

  it('returns null for unknown ids', () => {
    expect(getCard(db, 'nope')).toBeNull()
  })

  it('maps faces for double-faced cards', () => {
    const card = getCard(db, fixtureCard('Delver of Secrets // Insectile Aberration').id)
    expect(card?.faces.map((f) => f.name)).toEqual(['Delver of Secrets', 'Insectile Aberration'])
    expect(card?.faceNames).toEqual(['Delver of Secrets', 'Insectile Aberration'])
    expect(card?.faces[0]?.imageNormal).toMatch(/^https:/)
  })

  it('lists printings newest first', () => {
    const card = getCard(db, BOLT_M10)
    expect(getPrintings(db, card?.oracleId ?? '').map((p) => p.setCode)).toEqual(['sta', 'm11', 'm10'])
  })

  it('builds one name row per card identity, defaulting to the newest regular printing', () => {
    expect(count(db, 'card_names')).toBe(new Set(fixtureRows().map((r) => r.oracle_id)).size)
    // Strixhaven Mystical Archive (sta, a masterpiece set) is newer than M11 but a special product.
    expect(autocomplete(db, 'lightning bolt')[0]?.cardId).toBe(fixtureCard('Lightning Bolt', 'm11').id)
  })
})

describe('autocomplete', () => {
  const names = (q: string, limit?: number) => autocomplete(db, q, limit).map((c) => c.name)

  it('returns summaries with the default printing', () => {
    expect(autocomplete(db, 'sol ring')[0]).toMatchObject({
      name: 'Sol Ring',
      cardId: fixtureCard('Sol Ring', 'c21').id,
      manaCost: '{1}',
      typeLine: 'Artifact',
    })
  })

  it('ranks prefix matches first, then shorter names', () => {
    expect(names('light').slice(0, 2)).toEqual(['Lightning Bolt', 'Lightning Helix'])
  })

  it('matches words inside names', () => {
    expect(names('bolt')).toContain('Lightning Bolt')
  })

  it('matches back-face names', () => {
    expect(names('insectile')).toEqual(['Delver of Secrets // Insectile Aberration'])
  })

  it('matches each word independently, in any order', () => {
    expect(names('jace mind')).toContain('Jace, the Mind Sculptor')
    expect(names('mind jace')).toContain('Jace, the Mind Sculptor')
    expect(names('bolt lightning')).toEqual(['Lightning Bolt'])
  })

  it('matches short words alongside longer ones', () => {
    expect(names('delver of')).toEqual(['Delver of Secrets // Insectile Aberration'])
  })

  it('uses prefix matching for 1–2 character queries', () => {
    expect(names('so')).toContain('Sol Ring')
  })

  it('respects the limit', () => {
    expect(names('e', 3)).toHaveLength(3)
  })

  it('ignores diacritics, ligatures, and punctuation', () => {
    const extra = [syntheticCard({ name: 'Æther Vial' }), syntheticCard({ name: "Lim-Dûl's Vault" })]
      .map((c) => scryfallToRow(c))
      .filter((r): r is CardRow => r !== null)
    insertCardRows(db, 'cards', extra)
    rebuildCardNames(db)
    expect(names('aether vial')).toEqual(['Æther Vial'])
    expect(names("lim-dul's")).toEqual(["Lim-Dûl's Vault"])
    expect(names('lim dul')).toEqual(["Lim-Dûl's Vault"])
  })

  it('never throws on search-syntax characters', () => {
    expect(names('bolt"')).toContain('Lightning Bolt')
    expect(() => names('OR')).not.toThrow()
    expect(() => names('NEAR(')).not.toThrow()
    expect(names('*')).toEqual([])
    expect(names('"')).toEqual([])
    expect(names('')).toEqual([])
  })
})

describe('default printing', () => {
  const addPrintings = (...cards: ScryfallCard[]) => {
    insertCardRows(db, 'cards', cards.map((c) => scryfallToRow(c)).filter((r): r is CardRow => r !== null))
    rebuildCardNames(db)
  }
  const defaultBolt = () => autocomplete(db, 'lightning bolt')[0]?.cardId

  it('passes over promos, future-dated printings, and special products while a regular printing exists', () => {
    const later = { ...fixtureCard('Lightning Bolt', 'm11'), released_at: '2025-06-01' }
    addPrintings(
      { ...later, id: '00000000-0000-4000-8000-0000000promo', set: 'pbolt', promo: true },
      { ...later, id: '00000000-0000-4000-8000-00000future', set: 'fut', released_at: '2999-01-01' },
      { ...later, id: '00000000-0000-4000-8000-00000000plst', set: 'plst', set_type: 'masters' },
      { ...later, id: '00000000-0000-4000-8000-000000000slz', set: 'slz', set_type: 'box' },
      { ...later, id: '00000000-0000-4000-8000-000000000unf', set: 'unf', set_type: 'funny' },
      { ...later, id: '00000000-0000-4000-8000-000000000p30', set: 'p30a', set_type: 'memorabilia' },
    )
    expect(defaultBolt()).toBe(fixtureCard('Lightning Bolt', 'm11').id)
    addPrintings({ ...later, id: '00000000-0000-4000-8000-00000000new', set: 'new', set_type: 'expansion' })
    expect(defaultBolt()).toBe('00000000-0000-4000-8000-00000000new')
  })

  it('passes over printings in other languages while an English one exists (Rinascimento, Renaissance)', () => {
    const later = { ...fixtureCard('Lightning Bolt', 'm11'), released_at: '2025-06-01', set_type: 'expansion' }
    addPrintings({ ...later, id: '00000000-0000-4000-8000-000000000rin', set: 'rin', lang: 'it' })
    expect(defaultBolt()).toBe(fixtureCard('Lightning Bolt', 'm11').id)
    const italianOnly = syntheticCard({ name: 'Solo Italiano', set: 'rin', lang: 'it' })
    addPrintings(italianOnly)
    expect(autocomplete(db, 'solo italiano')[0]?.cardId).toBe(italianOnly.id)
  })

  it('falls back to the newest special product when a card has nothing else', () => {
    const only = syntheticCard({ name: 'Only Special', set: 'sld', set_type: 'box', released_at: '2021-01-01' })
    addPrintings(only, { ...only, id: '00000000-0000-4000-8000-0000000newer', set: 'sld2', released_at: '2022-01-01' })
    expect(autocomplete(db, 'only special')[0]?.cardId).toBe('00000000-0000-4000-8000-0000000newer')
  })

  it('still passes over Secret Lair, The List, and Unknown Event in data imported before set types', () => {
    const later = { ...fixtureCard('Lightning Bolt', 'm11'), released_at: '2025-06-01', set_type: undefined }
    addPrintings(
      { ...later, id: '00000000-0000-4000-8000-000000000sld', set: 'sld' },
      { ...later, id: '00000000-0000-4000-8000-00000000plst', set: 'plst' },
      { ...later, id: '00000000-0000-4000-8000-000000000unk', set: 'unk' },
    )
    expect(defaultBolt()).toBe(fixtureCard('Lightning Bolt', 'm11').id)
  })

  it('records the rule version and rebuilds databases built by an older rule', () => {
    expect(getMeta(db, 'card_names_version')).toBe(String(CARD_NAMES_VERSION))
    expect(ensureCardNamesCurrent(db)).toBe(false)
    setMeta(db, 'card_names_version', '1')
    db.exec('DELETE FROM card_names')
    expect(ensureCardNamesCurrent(db)).toBe(true)
    expect(count(db, 'card_names')).toBe(58)
    expect(getMeta(db, 'card_names_version')).toBe(String(CARD_NAMES_VERSION))
  })

  it('does nothing for an empty database', () => {
    expect(ensureCardNamesCurrent(openDb(':memory:'))).toBe(false)
  })
})
