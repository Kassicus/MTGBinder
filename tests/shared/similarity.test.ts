import { describe, expect, it } from 'vitest'
import { jaroWinkler } from '../../src/shared/similarity.ts'

describe('jaroWinkler', () => {
  it('scores identical strings 1 and unrelated ones low', () => {
    expect(jaroWinkler('lightning bolt', 'lightning bolt')).toBe(1)
    expect(jaroWinkler('', 'x')).toBe(0)
    expect(jaroWinkler('sol ring', 'counterspell')).toBeLessThan(0.6)
  })

  it('matches the textbook values', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3)
    expect(jaroWinkler('dwayne', 'duane')).toBeCloseTo(0.84, 2)
  })

  it('scores a typo in a card name above 0.92', () => {
    expect(jaroWinkler('lightnig bolt', 'lightning bolt')).toBeGreaterThan(0.92)
    expect(jaroWinkler('councilors judgment', 'councils judgment')).toBeGreaterThan(0.92)
  })
})
