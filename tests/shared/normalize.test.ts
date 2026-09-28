import { expect, it } from 'vitest'
import { normalizeName } from '../../src/shared/normalize.ts'

it.each([
  ['Lightning Bolt', 'lightning bolt'],
  ['Æther Vial', 'aether vial'],
  ["Lim-Dûl's Vault", 'lim duls vault'],
  ["Atraxa, Praetors' Voice", 'atraxa praetors voice'],
  ['Fire // Ice', 'fire ice'],
  ['  Jötun   Grunt ', 'jotun grunt'],
  ['"*"', ''],
])('normalizes %j to %j', (input, expected) => {
  expect(normalizeName(input)).toBe(expected)
})
