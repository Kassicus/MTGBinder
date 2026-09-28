import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { BulkState, BulkStatus } from '../../shared/types.ts'
import { apiGet } from './api.ts'

const RUNNING: readonly BulkState[] = ['downloading', 'importing']

export function isBulkRunning(status: BulkStatus | undefined): boolean {
  return status !== undefined && RUNNING.includes(status.state)
}

const bulkStatus = {
  queryKey: ['bulk-status'],
  queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<BulkStatus>('/api/bulk/status', signal),
} as const

/** Card-data status, for a page to show. It's kept fresh by useBulkRefresh, in Layout. */
export function useBulkStatus() {
  return useQuery(bulkStatus)
}

/**
 * Keeps the card-data status fresh, polling every second while a refresh runs. When a run finishes, cached lookups,
 * searches, library stats, set/type lists, and decks are refetched so the new data (names, images, prices) shows up,
 * and so is the library file's size (Settings). Layout calls this, once for every page.
 */
export function useBulkRefresh() {
  const queryClient = useQueryClient()
  const query = useQuery({ ...bulkStatus, refetchInterval: (q) => (isBulkRunning(q.state.data) ? 1000 : false) })
  const running = isBulkRunning(query.data)
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries({ queryKey: ['autocomplete'] })
      void queryClient.invalidateQueries({ queryKey: ['card'] })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
      void queryClient.invalidateQueries({ queryKey: ['collection'] })
      void queryClient.invalidateQueries({ queryKey: ['catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['decks'] })
      void queryClient.invalidateQueries({ queryKey: ['deck'] })
      void queryClient.invalidateQueries({ queryKey: ['library-size'] })
    }
    wasRunning.current = running
  }, [running, queryClient])
}
