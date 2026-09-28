import { describe, expect, it } from 'vitest'
import { SearchQueryError } from '../../src/server/search/compile.ts'
import { LOCAL_PAGE_SIZE, searchLocal } from '../../src/server/search/run.ts'
import type { SearchSort, SortDir } from '../../src/shared/types.ts'
import { createTestDb } from '../helpers/db.ts'

const db = createTestDb()

/** Card names (front face only, for readability) matching a query over the 61 fixture printings, sorted by name. */
function names(q: string, sort: SearchSort = 'name', dir: SortDir = 'asc'): string[] {
  return searchLocal(db, { q, sort, dir, page: 1 }).cards.map((c) => c.name.split(' // ')[0]!)
}

describe('searchLocal: names', () => {
  it.each([
    ['bolt', ['Lightning Bolt']],
    ['LIGHTNING', ['Lightning Bolt', 'Lightning Helix']],
    ['"lightning bolt"', ['Lightning Bolt']],
    ['-bolt light', ['Lightning Helix']],
    ['!fire', ['Fire']],
    ['!"fire // ice"', ['Fire']],
    ['!"insectile aberration"', ['Delver of Secrets']],
    ['bolt or (c:g t:elf mv=1)', ['Elvish Mystic', 'Lightning Bolt', 'Llanowar Elves']],
  ])('%s', (q, expected) => {
    expect(names(q)).toEqual(expected)
  })
})

describe('searchLocal: colors follow Scryfall semantics', () => {
  it.each([
    ['c:wu', ["Atraxa, Praetors' Voice", 'Omnath, Locus of Creation', 'Teferi, Time Raveler']],
    ['c=wu', ['Teferi, Time Raveler']],
    ['c:boros', ['Lightning Helix', 'Omnath, Locus of Creation', 'Wear']],
    ['c>=r c<=rw', ['Fireball', 'Lightning Bolt', 'Lightning Helix', 'Wear']],
    ['c>w', ["Atraxa, Praetors' Voice", 'Kitchen Finks', 'Lightning Helix', 'Lurrus of the Dream-Den', 'Omnath, Locus of Creation', 'Teferi, Time Raveler', 'Tymna the Weaver', 'Wear']],
    ['c:rg', ['Omnath, Locus of Creation']],
    ['c=c t:creature', ['Emrakul, the Aeons Torn', 'Ornithopter']],
    ['id>=wug', ["Atraxa, Praetors' Voice", 'Omnath, Locus of Creation']],
    ['id:c', ['Arcane Signet', 'Black Lotus', 'Command Tower', 'Emrakul, the Aeons Torn', 'Mox Opal', 'Ornithopter', 'Sol Ring', 'Ugin, the Spirit Dragon']],
    ['id<=rg t:land', ['Command Tower', 'Dryad Arbor', 'Forest', 'Mountain', 'Stomping Ground']],
  ])('%s', (q, expected) => {
    expect(names(q)).toEqual(expected)
  })

  it('c: means "including", id: means "fits within"', () => {
    expect(names('c:wu')).not.toContain('Island')
    expect(names('id:wu')).toContain('Island')
    expect(names('id:wu')).not.toContain('Forest')
  })

  it('c:c is colorless and c:m is multicolor', () => {
    expect(names('c:c')).toHaveLength(14)
    expect(names('c:c')).toContain('Stomping Ground')
    expect(names('c:m')).toEqual(['Atraxa, Praetors\' Voice', 'Fire', 'Grist, the Hunger Tide', 'Kitchen Finks', 'Lightning Helix', 'Lurrus of the Dream-Den', 'Niv-Mizzet, Parun', 'Omnath, Locus of Creation', 'Teferi, Time Raveler', 'Thrasios, Triton Hero', 'Tymna the Weaver', 'Wear'])
    expect(names('c!=m')).toHaveLength(58 - 12)
  })
})

describe('searchLocal: other keys', () => {
  it.each([
    ['m:2WW', ['Wrath of God']],
    ['m={2}{W}{W}', ['Wrath of God']],
    ['m:{G/W}', ['Kitchen Finks']],
    ['m:{U/P}', ['Gitaxian Probe']],
    ['m:x', ["Agadeem's Awakening", 'Fireball']],
    ['mv>=6', ['Colossal Dreadmaw', 'Emrakul, the Aeons Torn', 'Niv-Mizzet, Parun', 'Ugin, the Spirit Dragon']],
    ['loy>=4', ['Teferi, Time Raveler', 'Ugin, the Spirit Dragon']],
    ['tou<=1', ['Birds of Paradise', 'Brazen Borrower', 'Bushi Tenderfoot', 'Delver of Secrets', 'Dryad Arbor', 'Elvish Mystic', 'Esper Sentinel', 'Llanowar Elves']],
    ['s:m21', ['Colossal Dreadmaw', 'Forest', 'Island', 'Mountain', 'Plains', 'Swamp', 'Ugin, the Spirit Dragon']],
    ['banned:commander', ['Ancestral Recall', 'Black Lotus', 'Emrakul, the Aeons Torn']],
    ['restricted:vintage', ['Ancestral Recall', 'Black Lotus', 'Gitaxian Probe', 'Sol Ring']],
    ['t:land -t:basic f:commander', ["Agadeem's Awakening", 'Command Tower', 'Dryad Arbor', 'Stomping Ground', 'Westvale Abbey']],
    ['o:~', ['Fire', 'Fireball', 'Lightning Bolt', 'Lightning Helix', 'Relentless Rats', 'Tarmogoyf']],
    ['a:"christopher moeller"', ['Lightning Bolt']],
    ['is:commander', ["Atraxa, Praetors' Voice", 'Emrakul, the Aeons Torn', 'Lurrus of the Dream-Den', 'Niv-Mizzet, Parun', 'Omnath, Locus of Creation', 'Thrasios, Triton Hero', 'Tymna the Weaver']],
    ['is:dfc', ["Agadeem's Awakening", 'Delver of Secrets', 'Invasion of Zendikar', 'Westvale Abbey']],
    ['is:split', ['Fire', 'Wear']],
    ['is:permanent t:artifact', ['Arcane Signet', 'Black Lotus', 'Esper Sentinel', 'Mox Opal', 'Ornithopter', 'Sol Ring']],
    ['-t:creature -t:land mv<=1', ['Ancestral Recall', 'Black Lotus', 'Dark Ritual', 'Fireball', 'Gitaxian Probe', 'Lightning Bolt', 'Mox Opal', 'Sol Ring', 'Swords to Plowshares', 'Thoughtseize']],
    ['(t:elf or t:bird) c:g', ['Birds of Paradise', 'Elvish Mystic', 'Llanowar Elves']],
    ['r<uncommon t:instant', ['Lightning Bolt']],
  ])('%s', (q, expected) => {
    expect(names(q)).toEqual(expected)
  })

  it('counts keywords and rules text on either face', () => {
    expect(names('kw:flying')).toContain('Westvale Abbey')
    expect(names('o:"draw a card"')).toHaveLength(8)
  })

  it('treats a missing value as not matching, so negation keeps it', () => {
    expect(names('pow>=0')).not.toContain('Sol Ring')
    expect(names('-pow>=0')).toContain('Sol Ring')
  })
})

describe('searchLocal: results', () => {
  it('returns one result per card identity, preferring the default printing', () => {
    const page = searchLocal(db, { q: 'bolt', sort: 'name', dir: 'asc', page: 1 })
    expect(page.total).toBe(1)
    expect(page.cards[0]).toMatchObject({ name: 'Lightning Bolt', setCode: 'm11', manaCost: '{R}', finish: null, quantity: null })
  })

  it('shows the matching printing the default-printing rule prefers when the default one does not match', () => {
    // Not the newer Mystical Archive printing (sta, a special product): the regular M10 one.
    expect(searchLocal(db, { q: 'bolt -s:m11', sort: 'name', dir: 'asc', page: 1 }).cards[0]?.setCode).toBe('m10')
  })

  it('sorts, with missing values last in either direction', () => {
    expect(names('mv>=6', 'mv', 'desc')).toEqual(['Emrakul, the Aeons Torn', 'Ugin, the Spirit Dragon', 'Colossal Dreadmaw', 'Niv-Mizzet, Parun'])
    // Scryfall color order: W, U, B, R, G, multicolor, colorless (Westvale Abbey counts as black via its back face).
    expect(names('t:creature pow>=5', 'color')).toEqual(['Westvale Abbey', 'Colossal Dreadmaw', 'Niv-Mizzet, Parun', 'Emrakul, the Aeons Torn'])
    const byPrice = searchLocal(db, { q: 't:basic', sort: 'price', dir: 'desc', page: 1 }).cards
    const prices = byPrice.map((c) => c.priceUsd)
    const known = prices.filter((p) => p !== null)
    expect(prices.slice(0, known.length)).toEqual(known)
    expect([...known].sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual(known)
  })

  it('pages results and still reports the total past the last page', () => {
    const first = searchLocal(db, { q: '', sort: 'name', dir: 'asc', page: 1 })
    expect(first).toMatchObject({ total: 58, page: 1, pageSize: LOCAL_PAGE_SIZE, hasMore: false })
    expect(first.cards).toHaveLength(58)
    expect(searchLocal(db, { q: '', sort: 'name', dir: 'asc', page: 2 })).toMatchObject({ total: 58, cards: [], hasMore: false })
    expect(searchLocal(db, { q: 'zzzz', sort: 'name', dir: 'asc', page: 1 })).toMatchObject({ total: 0, cards: [] })
  })

  it('attaches ownership (none in an empty collection)', () => {
    expect(searchLocal(db, { q: 'bolt', sort: 'name', dir: 'asc', page: 1 }).cards[0]?.ownership).toEqual({ owned: 0, free: 0, decks: [] })
  })
})

describe('searchLocal: errors', () => {
  it('reports syntax errors with their position', () => {
    const err = (() => {
      try {
        searchLocal(db, { q: 't:elf foo:bar', sort: 'name', dir: 'asc', page: 1 })
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(SearchQueryError)
    expect(err).toMatchObject({ message: 'Unknown search key "foo"', span: { start: 6, end: 9 } })
  })

  it.each([
    ['in:deck', 'in: only works when searching My library'],
    ['t:elf free>0', 'free only works when searching My library'],
    ['qty>1', 'qty only works when searching My library'],
    ['is:foil', 'is:foil only works when searching My library'],
    ['is:wanted', 'is:wanted only works when searching My library'],
  ])('rejects the library-only key in %s', (q, message) => {
    expect(() => searchLocal(db, { q, sort: 'name', dir: 'asc', page: 1 })).toThrow(message)
  })

  it('treats search syntax inside values as plain text', () => {
    expect(names('o:"\'; DROP TABLE cards; --"')).toEqual([])
    expect(names('t:%')).toEqual([])
    expect(names('"_"')).toEqual([])
  })
})
