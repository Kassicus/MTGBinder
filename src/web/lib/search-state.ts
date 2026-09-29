import type { SearchNode } from '../../shared/search/ast.ts'
import { parseSearch } from '../../shared/search/parse.ts'
import { isCardSort } from '../../shared/search/sorts.ts'
import type { SearchSort, SortDir } from '../../shared/types.ts'

/** `all` = Scryfall, `library` = my collection, `local` = the local card data (offline stand-in for Scryfall). */
export type SearchScope = 'all' | 'library' | 'local'
export type ResultLayout = 'grid' | 'list'
export type LibraryView = 'cards' | 'printings'

export interface SearchState {
  q: string
  scope: SearchScope
  sort: SearchSort
  dir: SortDir
  page: number
  view: LibraryView
  layout: ResultLayout
}

export const DEFAULT_SEARCH: SearchState = { q: '', scope: 'all', sort: 'name', dir: 'asc', page: 1, view: 'cards', layout: 'grid' }

const SCOPES: readonly SearchScope[] = ['all', 'library', 'local']
const SORTS: readonly SearchSort[] = ['name', 'mv', 'price', 'color', 'rarity', 'added', 'quantity']
const DIRS: readonly SortDir[] = ['asc', 'desc']
const VIEWS: readonly LibraryView[] = ['cards', 'printings']
const LAYOUTS: readonly ResultLayout[] = ['grid', 'list']

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * Reads search state from the page URL, ignoring anything invalid. Sorting by `added` or `quantity` exists only in My
 * library.
 * `locked` fixes the scope (the Library page), whatever the URL says.
 */
export function readSearchState(params: URLSearchParams, locked?: SearchScope): SearchState {
  const scope = locked ?? pick(params.get('scope'), SCOPES, DEFAULT_SEARCH.scope)
  const sort = pick(params.get('sort'), SORTS, DEFAULT_SEARCH.sort)
  const page = Number.parseInt(params.get('page') ?? '', 10)
  return {
    q: params.get('q') ?? '',
    scope,
    sort: scope !== 'library' && !isCardSort(sort) ? 'name' : sort,
    dir: pick(params.get('dir'), DIRS, DEFAULT_SEARCH.dir),
    page: Number.isFinite(page) ? Math.min(Math.max(page, 1), 1000) : 1,
    view: pick(params.get('view'), VIEWS, DEFAULT_SEARCH.view),
    layout: pick(params.get('layout'), LAYOUTS, DEFAULT_SEARCH.layout),
  }
}

/** Writes search state to URL params, leaving out defaults (and a locked scope) so links stay short. */
export function writeSearchState(state: SearchState, locked?: SearchScope): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of Object.keys(DEFAULT_SEARCH) as Array<keyof SearchState>) {
    if (key === 'scope' && locked) continue
    if (state[key] !== DEFAULT_SEARCH[key]) params.set(key, String(state[key]))
  }
  return params
}

/**
 * The library-only terms in a query (`in:`, `free`, `qty`, `is:wanted`, `is:unpriced`), once each, for the hint that
 * All cards (Scryfall) reads them its own way. None for a query the local parser can't read.
 */
export function libraryOnlyTerms(q: string): string[] {
  const parsed = parseSearch(q)
  if (!parsed.ok) return []
  const found = new Set<string>()
  const walk = (node: SearchNode) => {
    if (node.kind === 'and' || node.kind === 'or') node.children.forEach(walk)
    else if (node.kind === 'not') walk(node.child)
    else if (node.kind === 'field' && (node.key === 'in' || node.key === 'free' || node.key === 'qty')) found.add(node.key === 'in' ? 'in:' : node.key)
    else if (node.kind === 'field' && node.key === 'is' && (node.value === 'wanted' || node.value === 'unpriced')) found.add(`is:${node.value}`)
  }
  walk(parsed.ast)
  return [...found]
}

/** Queries the Search page offers before anything is typed: each one works on Scryfall and on the local card data. */
export const SEARCH_EXAMPLES: ReadonlyArray<{ q: string; means: string }> = [
  { q: 't:elf c:g', means: 'green elves' },
  { q: 'o:"draw a card" mv<=2', means: 'card draw for two mana or less' },
  { q: 'is:commander id:bg', means: 'black-green commanders' },
  { q: 'pow>=5 mv<=4', means: 'big creatures for four or less' },
]

/** Whether there's anything to run: My library lists everything for an empty query; the other scopes need text. */
export function canSearch(state: SearchState): boolean {
  return state.scope === 'library' || state.q.trim() !== ''
}

/** The API URL that runs this search. */
export function searchApiUrl(state: SearchState): string {
  const params = new URLSearchParams({ q: state.q, sort: state.sort, dir: state.dir, page: String(state.page) })
  if (state.scope === 'library') params.set('view', state.view)
  const endpoint = state.scope === 'all' ? 'scryfall' : state.scope
  return `/api/search/${endpoint}?${params}`
}
