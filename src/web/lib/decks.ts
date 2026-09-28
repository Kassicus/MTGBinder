import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Board, DeckDetail, DeckSummary } from '../../shared/types.ts'
import { ApiRequestError, apiGet, apiSend } from './api.ts'
import { invalidateCollection } from './collection.ts'
import { useToast } from './toast.tsx'

export const BOARD_LABEL: Record<Board, string> = { commander: 'Commander', main: 'Main', side: 'Sideboard', maybe: 'Maybe' }
export const BOARD_ORDER: readonly Board[] = ['commander', 'main', 'side', 'maybe']

export function useDecks() {
  return useQuery({ queryKey: ['decks'], queryFn: ({ signal }) => apiGet<DeckSummary[]>('/api/decks', signal) })
}

/** Whether an error says the deck isn't there (deleted, perhaps in another window). */
export const isDeckGone = (err: unknown) => err instanceof ApiRequestError && err.status === 404

export function useDeck(id: number) {
  return useQuery({
    queryKey: ['deck', id],
    queryFn: ({ signal }) => apiGet<DeckDetail>(`/api/decks/${id}`, signal),
    // A deck that isn't there won't be there on a second try either.
    retry: (failures, err) => !isDeckGone(err) && failures < 1,
  })
}

/**
 * A change to decks: sends it, then refetches everything decks affect (deck lists and details, card details, and
 * searches, whose ownership badges name decks). Searches answered by Scryfall aren't refetched, so each "+" doesn't
 * query Scryfall again; their badges update on the next search. It stays pending until the deck on screen has
 * refetched, so a button it disables can't act on a line the change removed. Failures show as a toast starting with
 * `failure`.
 */
export function useDeckChange<Input, Result = unknown>(send: (input: Input) => Promise<Result>, failure: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: send,
    onSuccess: () => {
      invalidateCollection(queryClient, { keepScryfallSearches: true })
      // Joins the refetch the invalidation started rather than starting another.
      return queryClient.refetchQueries({ queryKey: ['deck'], type: 'active' }, { cancelRefetch: false })
    },
    onError: (err) => {
      toast.error(`${failure}: ${err.message}`)
      // The deck, or the line, is gone (deleted in another window, say): show what's there now, on a deck's page and
      // on the Decks page.
      if (isDeckGone(err)) {
        void queryClient.invalidateQueries({ queryKey: ['deck'] })
        void queryClient.invalidateQueries({ queryKey: ['decks'] })
      }
    },
  })
}

export interface AddToDeckInput {
  deckId: number
  cardId: string
  board: Board
  delta: number
}

export function useAddToDeck() {
  return useDeckChange(
    ({ deckId, ...body }: AddToDeckInput) => apiSend<{ quantity: number }>('POST', `/api/decks/${deckId}/cards`, body),
    "Couldn't change the deck",
  )
}
