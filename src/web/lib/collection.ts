import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { CopyCount, Finish } from '../../shared/types.ts'
import { apiPost } from './api.ts'
import { useToast } from './toast.tsx'

export interface CopyChange {
  cardId: string
  finish: Finish
  delta: number
}

/** A search query whose results come from Scryfall (its key is ['search', '/api/search/scryfall?…']). */
const isScryfallSearch = (queryKey: readonly unknown[]) => String(queryKey[1] ?? '').startsWith('/api/search/scryfall')

/**
 * Refetches everything that shows what I own or what decks use: card details, searches, library stats, and decks
 * (whose statuses and buy lists depend on both). With `keepScryfallSearches`, searches answered by Scryfall aren't
 * refetched, so a deck edit doesn't send another request to Scryfall; their deck badges catch up on the next search.
 */
export function invalidateCollection(queryClient: QueryClient, { keepScryfallSearches = false } = {}): void {
  for (const key of ['card', 'search', 'collection', 'decks', 'deck']) {
    void queryClient.invalidateQueries({
      queryKey: [key],
      predicate: (query) => !(keepScryfallSearches && key === 'search' && isScryfallSearch(query.queryKey)),
    })
  }
}

/** Adds or removes copies of one printing and finish. Failures show as a toast. */
export function useAdjustCopies() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (change: CopyChange) => apiPost<CopyCount>('/api/collection/adjust', change),
    onSuccess: () => invalidateCollection(queryClient),
    onError: (err) => toast.error(`Couldn't change your copies: ${err.message}`),
  })
}
