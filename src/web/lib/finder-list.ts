/** What the finder knows at one moment: the field, the debounced query, and that query's lookup. */
export interface FinderState<T> {
  /** The field's text, trimmed. */
  typed: string
  /** The debounced text the lookup is for; lags `typed` while the user types. */
  query: string
  /** The lookup's results. While a new query loads, the last results that arrived (React Query's placeholder). */
  data: T[] | undefined
  isFetching: boolean
  /** `data` is an earlier query's results, shown while this one loads. */
  isPlaceholderData: boolean
  error: Error | null
}

/** What the finder's list should show. */
export interface FinderList<T> {
  results: T[]
  /** Keyboard selection may act on `results`: they're final for exactly what's typed, and not an error. */
  selectable: boolean
  /** Whether the list is up (while the field has focus). */
  show: boolean
  /** The list shows an earlier "No matches" while the lookup for what's typed is still pending. */
  dimmed: boolean
  /** For the live region; only settled results are announced. */
  announcement: string
}

/**
 * Decides what the finder's list shows. Results for a previous query stay up (not selectable) while a new one loads,
 * and so does "No matches" (dimmed): typing on from a name with no matches must not blink the row off and on at every
 * keystroke. Before any lookup has returned, nothing shows until it settles.
 */
export function finderList<T>({ typed, query, data, isFetching, isPlaceholderData, error }: FinderState<T>): FinderList<T> {
  const results = query.length > 0 ? (data ?? []) : []
  const selectable = typed === query && !isPlaceholderData && error === null
  // The results are final for what's typed, so "No matches" is true (not a guess between keystrokes).
  const settled = selectable && !isFetching
  // The last lookup found nothing and the one for what's typed hasn't settled: keep that "No matches" up, dimmed.
  const pendingEmpty = !settled && error === null && typed.length > 0 && data !== undefined && data.length === 0
  const show = query.length > 0 && (results.length > 0 || error !== null || settled || pendingEmpty)
  const announcement =
    query.length === 0 ? '' : error ? error.message : settled ? (results.length === 0 ? 'No matches' : `${results.length} matches`) : ''
  return { results, selectable, show, dimmed: show && pendingEmpty, announcement }
}
