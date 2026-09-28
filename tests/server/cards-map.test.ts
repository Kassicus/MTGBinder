import { describe, expect, it } from 'vitest'
import { CARD_COLUMNS, canonColors, scryfallToRow, shouldImport, toNum } from '../../src/server/cards/map.ts'
import { openDb } from '../../src/server/db/index.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'

function row(name: string, set?: string) {
  const r = scryfallToRow(fixtureCard(name, set))
  if (!r) throw new Error(`no row for ${name}`)
  return r
}

describe('scryfallToRow', () => {
  it('maps a normal card', () => {
    const r = row('Lightning Bolt', 'm10')
    expect(r).toMatchObject({
      id: '435589bb-27c6-4a6d-9d63-394d5092b9d8',
      name: 'Lightning Bolt',
      face_names: 'Lightning Bolt',
      search_name: 'lightning bolt',
      set_code: 'm10',
      collector_number: '146',
      mana_cost: '{R}',
      cmc: 1,
      colors: 'R',
      color_identity: 'R',
      power: null,
      power_num: null,
      card_faces: null,
      is_promo: 0,
      is_digital: 0,
    })
    expect(r.oracle_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.image_normal).toMatch(/^https:\/\/cards\.scryfall\.io\//)
    expect(Object.keys(JSON.parse(r.prices)).sort()).toEqual(['usd', 'usd_etched', 'usd_foil'])
    expect(JSON.parse(r.legalities).modern).toBe('legal')
  })

  it('produces exactly the table columns, listed in table order', () => {
    expect(Object.keys(row('Lightning Bolt', 'm10')).sort()).toEqual([...CARD_COLUMNS].sort())
    const db = openDb(':memory:')
    const columns = db.pragma('table_info(cards)') as Array<{ name: string }>
    db.close()
    expect(columns.map((c) => c.name)).toEqual([...CARD_COLUMNS])
  })

  it('stores the set type, or an empty string when Scryfall leaves it out', () => {
    expect(row('Lightning Bolt', 'sta').set_type).toBe('masterpiece')
    expect(scryfallToRow({ ...fixtureCard('Lightning Bolt', 'm10'), set_type: undefined })?.set_type).toBe('')
  })

  it('reads faces for transform cards', () => {
    const r = row('Delver of Secrets // Insectile Aberration')
    expect(r.face_names).toBe('Delver of Secrets\nInsectile Aberration')
    expect(r.search_name).toBe('delver of secrets insectile aberration')
    expect(r.mana_cost).toBe('{U}')
    expect(r.colors).toBe('U')
    expect(r.power).toBe('1')
    expect(r.oracle_text).toContain('\n//\n')
    expect(r.image_normal).toMatch(/^https:/)
    expect(JSON.parse(r.card_faces ?? '[]')).toHaveLength(2)
  })

  it('uses the union of face colors when the card has none at the top level', () => {
    expect(row('Westvale Abbey // Ormendahl, Profane Prince').colors).toBe('B')
  })

  it('keeps top-level colors and costs for split cards', () => {
    const r = row('Fire // Ice')
    expect(r.colors).toBe('UR')
    expect(r.mana_cost).toBe('{1}{R} // {1}{U}')
    expect(r.oracle_text).toContain('\n//\n')
  })

  it('keeps non-numeric power and toughness as text', () => {
    const r = row('Tarmogoyf')
    expect([r.power, r.toughness, r.power_num, r.toughness_num]).toEqual(['*', '1+*', null, null])
  })

  it('parses loyalty', () => {
    expect(row('Jace, the Mind Sculptor')).toMatchObject({ loyalty: '3', loyalty_num: 3 })
  })

  it('orders colors WUBRG', () => {
    expect(row("Atraxa, Praetors' Voice").color_identity).toBe('WUBG')
  })

  it('falls back to the first face oracle id (reversible cards)', () => {
    const faceOracle = '99999999-0000-4000-8000-000000000001'
    const face = { name: 'Grizzly Bears', oracle_id: faceOracle, mana_cost: '{1}{G}', type_line: 'Creature — Bear', oracle_text: '', colors: ['G'] }
    const card = syntheticCard({ oracle_id: undefined, layout: 'reversible_card', card_faces: [face, face] })
    expect(scryfallToRow(card)?.oracle_id).toBe(faceOracle)
  })

  it('returns null when no oracle id exists anywhere', () => {
    expect(scryfallToRow(syntheticCard({ oracle_id: undefined }))).toBeNull()
  })
})

describe('helpers', () => {
  it('canonColors sorts into WUBRG order', () => {
    expect(canonColors(['G', 'W'])).toBe('WG')
    expect(canonColors([])).toBe('')
  })

  it.each<[string | null | undefined, number | null]>([
    ['3', 3], ['-1', -1], ['+1', 1], ['3.5', 3.5], ['1+*', null], ['*', null], ['X', null], [null, null], [undefined, null],
  ])('toNum(%j) = %j', (input, expected) => {
    expect(toNum(input)).toBe(expected)
  })
})

describe('shouldImport', () => {
  it('accepts paper cards', () => {
    expect(shouldImport(fixtureCard('Lightning Bolt', 'm10'))).toBe(true)
  })

  it('rejects digital, non-paper, oversized, token, emblem, and art-series cards', () => {
    expect(shouldImport(syntheticCard({ digital: true }))).toBe(false)
    expect(shouldImport(syntheticCard({ games: ['mtgo', 'arena'] }))).toBe(false)
    expect(shouldImport(syntheticCard({ oversized: true }))).toBe(false)
    expect(shouldImport(syntheticCard({ layout: 'token' }))).toBe(false)
    expect(shouldImport(syntheticCard({ layout: 'double_faced_token' }))).toBe(false)
    expect(shouldImport(syntheticCard({ layout: 'emblem' }))).toBe(false)
    expect(shouldImport(syntheticCard({ layout: 'art_series' }))).toBe(false)
  })
})
