import { describe, expect, it } from 'vitest'
import { clampPos, defaultSpot, kindOf } from '../../src/shared/playtest/placement.ts'

describe('default spots', () => {
  it('starts each row at its left, lands by the edge and creatures by the middle', () => {
    expect(defaultSpot('land', [])).toEqual({ x: 0.06, y: 0.2 })
    expect(defaultSpot('creature', [])).toEqual({ x: 0.06, y: 0.8 })
    expect(defaultSpot('other', [{ x: 0.5, y: 0.8 }])).toEqual({ x: 0.06, y: 0.5 })
  })

  it('goes right of the rightmost card in the row, then to the first free spot once the row is full', () => {
    expect(defaultSpot('creature', [{ x: 0.3, y: 0.78 }, { x: 0.1, y: 0.82 }])).toEqual({ x: 0.37, y: 0.8 })
    expect(defaultSpot('creature', [{ x: 0.06, y: 0.8 }, { x: 0.94, y: 0.8 }])).toEqual({ x: 0.13, y: 0.8 })
    const fullRow = Array.from({ length: 13 }, (_, i) => ({ x: Math.round((0.06 + 0.07 * i) * 100) / 100, y: 0.8 }))
    expect(defaultSpot('creature', fullRow)).toEqual({ x: 0.06, y: 0.85 })
  })

  it('keeps a dropped spot on the battlefield', () => {
    expect(clampPos({ x: -1, y: 2 })).toEqual({ x: 0.03, y: 0.97 })
    expect(clampPos({ x: 0.123456, y: 0.5 })).toEqual({ x: 0.1235, y: 0.5 })
  })
})

describe('kindOf', () => {
  it('reads where a card goes from its type line', () => {
    expect(kindOf('Basic Land — Forest')).toBe('land')
    expect(kindOf('Land Creature — Forest Dryad')).toBe('land')
    expect(kindOf('Legendary Creature — Goblin')).toBe('creature')
    expect(kindOf('Artifact Creature — Thopter')).toBe('creature')
    expect(kindOf('Instant')).toBe('spell')
    expect(kindOf('Sorcery')).toBe('spell')
    expect(kindOf('Legendary Planeswalker — Jace')).toBe('other')
    expect(kindOf('Enchantment — Aura')).toBe('other')
  })
})
