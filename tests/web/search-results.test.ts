import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { SearchPage } from '../../src/shared/types.ts'
import { SearchResults } from '../../src/web/components/search/SearchResults.tsx'
import { DEFAULT_SEARCH, type SearchState } from '../../src/web/lib/search-state.ts'

const EMPTY: SearchPage = { total: 0, estimated: false, page: 1, pageSize: 175, hasMore: false, cards: [], warnings: [] }

/** SearchResults rendered to HTML, and its text. */
function render(page: Partial<SearchPage>, state: Partial<SearchState>, libraryPage = false) {
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(SearchResults, {
        page: { ...EMPTY, ...page },
        state: { ...DEFAULT_SEARCH, ...state },
        fetching: false,
        onChange: () => {},
        libraryPage,
      }),
    ),
  )
  return { html, text: html.replace(/<[^>]*>/g, '') }
}

describe('SearchResults', () => {
  it('points an empty library to Import CSV above on the Library page, and to the Library page from Search', () => {
    const onLibraryPage = render({}, { scope: 'library' }, true)
    expect(onLibraryPage.text).toContain('Your library is empty. Scan your cards on the Scan page, use Import CSV above')
    const onSearchPage = render({}, { scope: 'library' })
    expect(onSearchPage.text).not.toContain('Import CSV above')
    expect(onSearchPage.text).toContain('Your library is empty. Scan your cards on the Scan page, import a CSV on the Library page')
    expect(onSearchPage.html).toMatch(/<a [^>]*href="\/library"[^>]*>import a CSV on the Library page<\/a>/)
  })

  it('says a page past the last has no cards, without a count of none', () => {
    const past = render({ page: 99, total: 0, estimated: true }, { q: 't:elf', page: 99 })
    expect(past.text).toContain('This search has no page 99.')
    expect(past.text).not.toMatch(/\d+ cards/)
  })

  it("doesn't say there's no such page when Scryfall has more after it", () => {
    // A real Scryfall page whose cards were all digital-only: there's a next page.
    const skipped = render({ page: 3, total: 800, estimated: true, hasMore: true }, { q: 't:elf', page: 3 })
    expect(skipped.text).not.toContain('This search has no page 3.')
  })
})
