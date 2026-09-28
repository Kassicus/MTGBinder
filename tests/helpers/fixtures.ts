import fs from 'node:fs'
import type { ScryfallCard } from '../../src/server/scryfall/types.ts'

let cache: ScryfallCard[] | null = null

/** The 61 pinned fixture printings (fresh deep copy on every call). */
export function loadFixtureCards(): ScryfallCard[] {
  cache ??= JSON.parse(fs.readFileSync(new URL('../fixtures/cards.json', import.meta.url), 'utf8')) as ScryfallCard[]
  return structuredClone(cache)
}

export function fixtureCard(name: string, set?: string): ScryfallCard {
  const card = loadFixtureCards().find((c) => c.name === name && (set === undefined || c.set === set))
  if (!card) throw new Error(`No fixture card named ${name}${set ? ` in ${set}` : ''}`)
  return card
}

let syntheticCount = 0

/** A fake importable card based on Grizzly Bears, with unique ids, plus any overrides. */
export function syntheticCard(overrides: Partial<ScryfallCard>): ScryfallCard {
  syntheticCount++
  const suffix = String(syntheticCount).padStart(12, '0')
  return {
    ...fixtureCard('Grizzly Bears'),
    id: `00000000-0000-4000-8000-${suffix}`,
    oracle_id: `11111111-0000-4000-8000-${suffix}`,
    ...overrides,
  }
}
