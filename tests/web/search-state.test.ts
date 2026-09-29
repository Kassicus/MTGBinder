import { describe, expect, it } from 'vitest'
import { parseSearch } from '../../src/shared/search/parse.ts'
import {
  canSearch,
  DEFAULT_SEARCH,
  libraryOnlyTerms,
  readSearchState,
  SEARCH_EXAMPLES,
  searchApiUrl,
  writeSearchState,
} from '../../src/web/lib/search-state.ts'

const read = (query: string) => readSearchState(new URLSearchParams(query))

describe('search state in the URL', () => {
  it('defaults everything', () => {
    expect(read('')).toEqual(DEFAULT_SEARCH)
  })

  it('reads valid values and ignores invalid ones', () => {
    expect(read('q=t%3Aelf&scope=library&sort=added&dir=desc&page=3&view=printings&layout=list')).toEqual({
      q: 't:elf', scope: 'library', sort: 'added', dir: 'desc', page: 3, view: 'printings', layout: 'list',
    })
    expect(read('scope=moon&sort=weight&dir=up&page=-4&view=x&layout=y')).toEqual(DEFAULT_SEARCH)
    expect(read('page=99999').page).toBe(1000)
    expect(read('page=abc').page).toBe(1)
  })

  it('only allows sorting by date added or quantity in My library', () => {
    expect(read('sort=added').sort).toBe('name')
    expect(read('scope=local&sort=added').sort).toBe('name')
    expect(read('sort=quantity').sort).toBe('name')
    expect(read('scope=library&sort=quantity&dir=desc')).toMatchObject({ sort: 'quantity', dir: 'desc' })
  })

  it('writes only non-default values and round-trips', () => {
    expect(writeSearchState(DEFAULT_SEARCH).toString()).toBe('')
    const state = { ...DEFAULT_SEARCH, q: 'c:wu mv<=3', scope: 'local' as const, page: 2 }
    expect(writeSearchState(state).toString()).toBe('q=c%3Awu+mv%3C%3D3&scope=local&page=2')
    expect(readSearchState(writeSearchState(state))).toEqual(state)
  })
})

describe('a locked scope (the Library page)', () => {
  it('reads the locked scope whatever the URL says, and leaves it out of the URL', () => {
    const state = readSearchState(new URLSearchParams('scope=all&sort=added&q=bolt'), 'library')
    expect(state).toMatchObject({ scope: 'library', sort: 'added', q: 'bolt' })
    expect(writeSearchState(state, 'library').toString()).toBe('q=bolt&sort=added')
    expect(readSearchState(writeSearchState(state, 'library'), 'library')).toEqual(state)
  })
})

describe('searchApiUrl and canSearch', () => {
  it('targets the endpoint for each scope', () => {
    expect(searchApiUrl({ ...DEFAULT_SEARCH, q: 'bolt' })).toBe('/api/search/scryfall?q=bolt&sort=name&dir=asc&page=1')
    expect(searchApiUrl({ ...DEFAULT_SEARCH, q: 'bolt', scope: 'local', sort: 'mv', dir: 'desc' })).toBe('/api/search/local?q=bolt&sort=mv&dir=desc&page=1')
    expect(searchApiUrl({ ...DEFAULT_SEARCH, scope: 'library', view: 'printings', page: 2 })).toBe('/api/search/library?q=&sort=name&dir=asc&page=2&view=printings')
  })

  it('needs text except in My library', () => {
    expect(canSearch({ ...DEFAULT_SEARCH, q: '  ' })).toBe(false)
    expect(canSearch({ ...DEFAULT_SEARCH, q: 'bolt' })).toBe(true)
    expect(canSearch({ ...DEFAULT_SEARCH, scope: 'library' })).toBe(true)
  })
})

describe('search examples', () => {
  it('are all queries the local card data understands', () => {
    for (const { q } of SEARCH_EXAMPLES) expect([q, parseSearch(q).ok]).toEqual([q, true])
  })
})

describe('library-only terms', () => {
  it('finds each one once, wherever it is in the query', () => {
    expect(libraryOnlyTerms('t:elf in:deck free>0 -(qty>=2 or is:wanted) in:built')).toEqual(['in:', 'free', 'qty', 'is:wanted'])
    expect(libraryOnlyTerms('is:unpriced or is:unpriced t:elf')).toEqual(['is:unpriced'])
    expect(libraryOnlyTerms('t:elf is:commander')).toEqual([])
    expect(libraryOnlyTerms('in:deck (')).toEqual([])
  })
})
