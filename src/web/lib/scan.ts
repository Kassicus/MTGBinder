import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { FORMATS } from '../../shared/formats.ts'
import type { DeckSummary, Finish, FormatId, ScanBoard, ScanCommitResult, ScanItem, ScanQueue, ScanTarget } from '../../shared/types.ts'
import { apiGet, apiSend, apiUpload } from './api.ts'
import { invalidateCollection } from './collection.ts'
import { useDecks } from './decks.ts'
import { autoAddedToast, commitInChunks, commitToast, sentAllToast } from './scan-queue.ts'
import { useToast } from './toast.tsx'

/** How often the queue is fetched while the Scan page is open (spec §5.1.1). */
export const SCAN_POLL_MS = 1000

/** The queue, refreshed every second: one request serves every hook that reads it. */
const scanQueue = {
  queryKey: ['scan-items'],
  queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<ScanQueue>('/api/scan/items', signal),
  refetchInterval: SCAN_POLL_MS,
} as const

/** The scans in the queue. */
export function useScanItems() {
  return useQuery({ ...scanQueue, select: (queue: ScanQueue) => queue.items })
}

/** How many auto captures with no text (the bare mat) were skipped in the last minute. */
export function useSkippedCaptures() {
  return useQuery({ ...scanQueue, select: (queue: ScanQueue) => queue.skipped }).data ?? 0
}

/**
 * Announces what auto-commit adds while the page is open (spec §5.1.3), in one toast per look at the queue, and
 * refetches what it changed. What it added before the page opened is old news: counting starts from the first queue
 * fetched after the page opened, not one cached from an earlier visit (which a failed first poll leaves in place).
 */
export function useAnnounceAutoAdded() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: added, dataUpdatedAt } = useQuery({ ...scanQueue, select: (queue: ScanQueue) => queue.added })
  const [openedAt] = useState(() => Date.now())
  const seen = useRef<Set<number> | null>(null)
  useEffect(() => {
    if (!added || dataUpdatedAt < openedAt) return
    if (seen.current === null) {
      seen.current = new Set(added.map((a) => a.id))
      return
    }
    const fresh = added.filter((a) => !seen.current!.has(a.id))
    if (fresh.length === 0) return
    for (const a of fresh) seen.current.add(a.id)
    toast.success(autoAddedToast(fresh))
    invalidateCollection(queryClient)
  }, [added, dataUpdatedAt, openedAt, queryClient, toast])
}

/** A change to the queue: refetches it afterwards; failures show as a toast starting with `failure`. */
function useScanChange<Input, Result>(send: (input: Input) => Promise<Result>, failure: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: send,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scan-items'] }),
    onError: (err) => toast.error(`${failure}: ${err.message}`),
  })
}

/**
 * A capture's query: `auto=1` from auto mode (`lifted=1` when it saw the empty mat since its last capture), and the deck
 * and board it goes to.
 */
export function captureQuery(auto: boolean, target: ScanTarget | null, lifted = false): string {
  const params = new URLSearchParams()
  if (auto) params.set('auto', '1')
  if (auto && lifted) params.set('lifted', '1')
  if (target) {
    params.set('deck', String(target.deckId))
    params.set('board', target.board)
  }
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/**
 * Sends a capture to be identified. `auto`: taken by auto mode; `lifted`: auto mode saw the empty mat since its last
 * capture; `target`: the deck it goes to as well.
 */
export function useCapture() {
  return useScanChange(
    ({ jpeg, auto, lifted, target }: { jpeg: Blob; auto: boolean; lifted: boolean; target: ScanTarget | null }) =>
      apiUpload<ScanItem>(`/api/scan${captureQuery(auto, target, lifted)}`, jpeg),
    "Couldn't save the capture",
  )
}

export interface ScanEdit {
  cardId?: string
  finish?: Finish
  quantity?: number
  confirm?: true
  target?: ScanTarget | null
}

export function useEditScan(id: number) {
  return useScanChange((edit: ScanEdit) => apiSend<ScanItem>('PATCH', `/api/scan/items/${id}`, edit), "Couldn't change the scan")
}

export function useDiscardScan(id: number) {
  return useScanChange(() => apiSend<void>('DELETE', `/api/scan/items/${id}`), "Couldn't discard the scan")
}

export function useRetryScan(id: number) {
  return useScanChange(() => apiSend<ScanItem>('POST', `/api/scan/items/${id}/retry`), "Couldn't identify it again")
}

/** Sends every scan in the queue to one deck's board, or to the collection only (null), with a toast saying so. */
export function useTargetAllScans() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (target: ScanTarget | null) => apiSend<{ scans: number }>('PUT', '/api/scan/target', { target }),
    onSuccess: ({ scans }, target) => {
      const deck = target && queryClient.getQueryData<DeckSummary[]>(['decks'])?.find((d) => d.id === target.deckId)
      // A deck missing from the cached list is still a deck, not the collection only.
      toast.success(sentAllToast(scans, target && { deckName: deck?.name ?? 'the deck', board: target.board }))
      // Stays pending until the queue shows it.
      return queryClient.invalidateQueries({ queryKey: ['scan-items'] })
    },
    onError: (err) => toast.error(`Couldn't send the scans: ${err.message}`),
  })
}

/**
 * Adds ready scans to the collection, and to their decks (spec §5.1.3): the ones with these ids, which the Add button
 * counted. A scan that became ready after the count waits for the next commit. More than the server takes in one
 * request go in several, one after another, with one toast for them all; a failed request stops the rest, which stay
 * ready.
 */
export function useCommitScans() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (ids: number[]) => commitInChunks(ids, (chunk) => apiSend<ScanCommitResult>('POST', '/api/scan/commit', { ids: chunk })),
    onSuccess: (outcome) => {
      const { tone, message } = commitToast(outcome)
      toast[tone](message)
      if (outcome.items > 0) invalidateCollection(queryClient)
      // Stays pending until the queue has refetched, so a second click can't commit (and toast) nothing.
      return queryClient.invalidateQueries({ queryKey: ['scan-items'] })
    },
    onError: (err) => toast.error(`Couldn't add the scans: ${err.message}`),
  })
}

const TARGET_KEY = 'binder.scan.target'
const BOARDS: readonly ScanBoard[] = ['commander', 'main', 'side']
/**
 * How long a "Scanning into" choice is remembered: one scanning session (spec §5.1.3), so a later session, days on,
 * doesn't start by putting every card into the deck chosen last time.
 */
export const TARGET_TTL_MS = 8 * 60 * 60 * 1000

/**
 * A target as the Scan page remembers it: with the deck's creation time, which tells the deck from a later one given
 * the same id (SQLite reuses a deleted deck's id when it was the highest). A link has only the id.
 */
export interface StoredTarget extends ScanTarget {
  createdAt?: string
}

/** A stored or linked target, if it's well formed. */
export function parseTarget(value: unknown): StoredTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const { deckId, board, createdAt } = value as Record<string, unknown>
  if (typeof deckId !== 'number' || !Number.isInteger(deckId) || deckId < 1) return null
  const target: StoredTarget = { deckId, board: BOARDS.includes(board as ScanBoard) ? (board as ScanBoard) : 'main' }
  if (typeof createdAt === 'string') target.createdAt = createdAt
  return target
}

/**
 * A remembered target, if it was saved (`savedAt`, in ms) less than TARGET_TTL_MS before `now`. One saved longer ago,
 * one saved with no time (before choices were dated), and one dated after `now` (the clock was set back) are forgotten.
 */
export function freshTarget(value: unknown, now: number): StoredTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const { savedAt } = value as Record<string, unknown>
  if (typeof savedAt !== 'number' || !(now - savedAt >= 0 && now - savedAt < TARGET_TTL_MS)) return null
  return parseTarget(value)
}

/**
 * The deck a remembered target names, or null: the deck with its id and, once the target knows it, its creation time.
 * Null too while the decks haven't loaded.
 */
export function chosenDeck<Deck extends Pick<DeckSummary, 'id' | 'createdAt'>>(
  target: StoredTarget | null,
  decks: readonly Deck[] | undefined,
): Deck | null {
  if (!target || !decks) return null
  return decks.find((d) => d.id === target.deckId && (target.createdAt === undefined || d.createdAt === target.createdAt)) ?? null
}

/** Whether a deck of this format has a commander board to scan into: commander, and casual (where it's optional). */
export function hasCommanderBoard(format: FormatId): boolean {
  return FORMATS[format].commanders !== 'none'
}

/** The board a target keeps when it moves to a deck of this format: main instead of a commander board it hasn't got. */
export function boardOnDeck(board: ScanBoard, format: FormatId | undefined): ScanBoard {
  return board === 'commander' && (format === undefined || !hasCommanderBoard(format)) ? 'main' : board
}

function storedTarget(): StoredTarget | null {
  try {
    const target = freshTarget(JSON.parse(localStorage.getItem(TARGET_KEY) ?? 'null'), Date.now())
    // A choice from an earlier session is forgotten for good: a clock set back can't bring it back later.
    if (!target) localStorage.removeItem(TARGET_KEY)
    return target
  } catch {
    return null
  }
}

/** Remembers the choice, dated now: each time it's stored, it's remembered for another session's length. */
function storeTarget(target: StoredTarget | null) {
  try {
    if (target) localStorage.setItem(TARGET_KEY, JSON.stringify({ ...target, savedAt: Date.now() }))
    else localStorage.removeItem(TARGET_KEY)
  } catch {
    // Private windows can refuse storage; the choice just isn't remembered.
  }
}

/**
 * Where the Scan page's captures go (spec §5.1.3): the collection only (null), or a deck's board as well. It starts
 * from `?deck=` (the deck editor's "Scan cards into this deck"), else the last choice, if it was stored within
 * TARGET_TTL_MS (a scanning session; it's stored again, and so dated again, whenever it's chosen or pinned).
 *
 * The choice names its deck by id and creation time (see chosenDeck), so a deck made later with a deleted deck's id is
 * never chosen by mistake. Until a decks list shows the deck, the target is the collection only. A list fetched after
 * the choice was made (the page fetches one when it opens) settles it: a deck that's gone is forgotten, and one known
 * only by its id gets its creation time.
 */
export function useScanTarget(): { target: ScanTarget | null; setTarget: (target: ScanTarget | null) => void } {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  // The choice, and when it was made: a decks list cached before then can't say its deck is gone.
  const [choice, setChoice] = useState<{ target: StoredTarget | null; at: number }>(() => {
    const linked = Number(params.get('deck'))
    const target: StoredTarget | null = Number.isInteger(linked) && linked > 0 ? { deckId: linked, board: 'main' } : storedTarget()
    return { target, at: Date.now() }
  })
  const chosen = choice.target
  const { data: decks, dataUpdatedAt, refetch } = useDecks()
  const deck = chosenDeck(chosen, decks)
  const settled = decks !== undefined && dataUpdatedAt >= choice.at

  // A list fetched now, even when a cached one is recent, so the remembered deck is checked while the page is open.
  useEffect(() => {
    void refetch({ cancelRefetch: false })
  }, [refetch])
  // Remember a linked deck, and drop it from the address so a reload keeps later choices.
  useEffect(() => {
    if (!params.has('deck')) return
    storeTarget(chosen)
    setParams({}, { replace: true })
  }, [params, setParams, chosen])
  useEffect(() => {
    if (!chosen || !settled) return
    if (!deck) {
      setChoice((c) => ({ ...c, target: null }))
      storeTarget(null)
    } else if (chosen.createdAt === undefined) {
      const pinned = { ...chosen, createdAt: deck.createdAt }
      setChoice((c) => ({ ...c, target: pinned }))
      storeTarget(pinned)
    }
  }, [chosen, deck, settled])

  return {
    target: chosen && deck ? { deckId: chosen.deckId, board: chosen.board } : null,
    setTarget: (target) => {
      // The deck comes from the list the picker showed (a new deck is added to it before it's chosen).
      const picked = target && chosenDeck(target, queryClient.getQueryData<DeckSummary[]>(['decks']))
      const next: StoredTarget | null = target && (picked ? { ...target, createdAt: picked.createdAt } : { ...target })
      setChoice({ target: next, at: Date.now() })
      storeTarget(next)
    },
  }
}
