import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { BulkStatus, SearchPage } from '../../src/shared/types.ts'
import { SearchResults } from '../../src/web/components/search/SearchResults.tsx'
import { DEFAULT_SEARCH, type SearchState } from '../../src/web/lib/search-state.ts'

const EMPTY: SearchPage = { total: 0, estimated: false, page: 1, pageSize: 175, hasMore: false, cards: [], warnings: [] }

/** SearchResults rendered to HTML, and its text; `cardCount` is the card data's size, as the card-data status says. */
function render(page: Partial<SearchPage>, state: Partial<SearchState>, libraryPage = false, cardCount = 102_606) {
  const client = new QueryClient()
  const status: BulkStatus = { state: 'idle', processed: 0, error: null, updatedAt: null, sourceUpdatedAt: null, cardCount }
  client.setQueryData(['bulk-status'], status)
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
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
    ),
  )
  return { html, text: html.replace(/<[^>]*>/g, '') }
}

describe('SearchResults', () => {
  it('shows Getting started for an empty library on the Library page, and points to the Library page from Search', () => {
    const onLibraryPage = render({}, { scope: 'library' }, true)
    expect(onLibraryPage.text).toContain('Getting started')
    expect(onLibraryPage.text).toMatch(/Scan your cards.*Import a CSV.*Scan or build a deck/)
    expect(onLibraryPage.text).not.toContain('Your library is empty')
    expect(onLibraryPage.html).toMatch(/<a [^>]*href="\/library"[^>]*>.*Import a CSV/)
    // A search that matches nothing in the library isn't an empty library.
    expect(render({}, { scope: 'library', q: 't:elf' }, true).text).toContain('No cards match.')
    const onSearchPage = render({}, { scope: 'library' })
    expect(onSearchPage.text).not.toContain('Getting started')
    expect(onSearchPage.text).not.toContain('Import CSV above')
    expect(onSearchPage.text).toContain('Your library is empty. Scan your cards on the Scan page, import a CSV on the Library page')
    expect(onSearchPage.html).toMatch(/<a [^>]*href="\/library"[^>]*>import a CSV on the Library page<\/a>/)
  })

  it("leaves Getting started out before there's card data, which its steps need", () => {
    const noCardData = render({}, { scope: 'library' }, true, 0)
    expect(noCardData.text).not.toContain('Getting started')
    expect(noCardData.text).not.toContain('Your library is empty')
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
