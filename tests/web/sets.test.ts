import { describe, expect, it } from 'vitest'
import type { SetProgress } from '../../src/shared/types.ts'
import {
  filterSets,
  isComplete,
  percentLabel,
  readSetSort,
  releaseDate,
  releaseMonth,
  setPercent,
  setTypeLabel,
  sortSets,
} from '../../src/web/lib/sets.ts'

function set(code: string, name: string, releasedAt: string, owned: number, total: number): SetProgress {
  return { code, name, setType: 'expansion', releasedAt, owned, total }
}

describe('percentages', () => {
  it('round down, so only a complete set shows 100%', () => {
    expect([setPercent(85, 276), setPercent(275, 276), setPercent(276, 276), setPercent(29, 100)]).toEqual([30, 99, 100, 29])
    expect([percentLabel(85, 276), percentLabel(275, 276), percentLabel(276, 276)]).toEqual(['30%', '99%', '100%'])
  })

  it('say "<1%" for a set with cards owned but under 1%, and 0% for none', () => {
    expect([percentLabel(1, 1746), percentLabel(17, 1746), percentLabel(18, 1746)]).toEqual(['<1%', '<1%', '1%'])
    expect([percentLabel(0, 276), setPercent(0, 0), percentLabel(0, 0)]).toEqual(['0%', 0, '0%'])
  })

  it('call a set complete only with every card owned', () => {
    expect([isComplete(set('a', 'A', '2024-01-01', 6, 6)), isComplete(set('a', 'A', '2024-01-01', 5, 6))]).toEqual([true, false])
    expect(isComplete(set('a', 'A', '2024-01-01', 0, 0))).toBe(false)
  })
})

describe('sortSets', () => {
  const sets = [
    set('dsk', 'Duskmourn: House of Horror', '2024-09-27', 85, 276),
    set('woc', 'Wilds of Eldraine Commander', '2023-09-08', 69, 143),
    set('one', 'Phyrexia: All Will Be One', '2023-02-03', 78, 271),
    set('sld', 'Secret Lair Drop', '2019-12-02', 1, 1746),
    set('m21', 'Core Set 2021', '2020-07-03', 69, 143),
    set('dom', 'Dominaria', '2018-04-27', 27, 265),
  ]
  const codes = (sort: Parameters<typeof sortSets>[1]) => sortSets(sets, sort).map((s) => s.code)

  it('sorts by completion, highest first, by the exact fraction; ties go to the newer set', () => {
    // woc and m21 are both 69 / 143 (48%): the newer set first. dsk (30.8%) is above one (28.8%).
    expect(codes('completion')).toEqual(['woc', 'm21', 'dsk', 'one', 'dom', 'sld'])
  })

  it('sorts by release date (newest first), name, or cards owned (most first; ties to the newer set)', () => {
    expect(codes('released')).toEqual(['dsk', 'woc', 'one', 'm21', 'sld', 'dom'])
    expect(codes('name')).toEqual(['m21', 'dom', 'dsk', 'one', 'sld', 'woc'])
    expect(codes('owned')).toEqual(['dsk', 'one', 'woc', 'm21', 'dom', 'sld'])
  })

  it('leaves the list it was given as it was', () => {
    const before = sets.map((s) => s.code)
    sortSets(sets, 'name')
    expect(sets.map((s) => s.code)).toEqual(before)
  })

  it('reads a sort from the address, completion when it names none', () => {
    expect(['completion', 'released', 'name', 'owned', 'price', null].map(readSetSort)).toEqual([
      'completion', 'released', 'name', 'owned', 'completion', 'completion',
    ])
  })
})

describe('filterSets', () => {
  const sets = [set('dsk', 'Duskmourn: House of Horror', '2024-09-27', 1, 276), set('dsc', 'Duskmourn Commander', '2024-09-27', 1, 400), set('woe', 'Wilds of Eldraine', '2023-09-08', 1, 281)]
  const codes = (text: string) => filterSets(sets, text).map((s) => s.code)

  it("matches a set's name or code, in any case, ignoring spaces around it", () => {
    expect(codes('dusk')).toEqual(['dsk', 'dsc'])
    expect(codes('  WOE ')).toEqual(['woe'])
    expect(codes('commander')).toEqual(['dsc'])
    expect(codes('')).toEqual(['dsk', 'dsc', 'woe'])
    expect(codes('zzz')).toEqual([])
  })
})

describe('labels', () => {
  it("names a set's type in words", () => {
    expect(['expansion', 'draft_innovation', 'from_the_vault', ''].map(setTypeLabel)).toEqual(['Expansion', 'Draft innovation', 'From the vault', ''])
  })

  it('gives the release month, whatever the time zone', () => {
    expect(['2024-09-27', '2019-12-02', '2025-01-01'].map(releaseMonth)).toEqual(['Sep 2024', 'Dec 2019', 'Jan 2025'])
    expect(releaseMonth('soon')).toBe('soon')
  })

  it("gives the set page's release date, whatever the time zone", () => {
    expect(['2024-09-27', '2019-12-02', '2025-01-01'].map(releaseDate)).toEqual(['Sep 27, 2024', 'Dec 2, 2019', 'Jan 1, 2025'])
    expect([releaseDate('soon'), releaseDate('2024-13-01')]).toEqual(['soon', '2024-13-01'])
  })
})
