import { useQuery } from '@tanstack/react-query'
import type { SetDetail, SetProgress } from '../../shared/types.ts'
import { ApiRequestError, apiGet } from './api.ts'

/** The Sets page's sorts (spec §5.8), in the order its dropdown lists them. */
export const SET_SORTS = [
  { value: 'completion', label: 'Completion' },
  { value: 'released', label: 'Release date' },
  { value: 'name', label: 'Name' },
  { value: 'owned', label: 'Cards owned' },
] as const

export type SetSort = (typeof SET_SORTS)[number]['value']

/** The sort named in the address, or completion when it names none. */
export function readSetSort(value: string | null): SetSort {
  return SET_SORTS.find((s) => s.value === value)?.value ?? 'completion'
}

/**
 * How much of a set is owned, in whole percent, rounded down: only a complete set is 100 (275 / 276 is 99). The
 * division is of whole numbers, so a whole result is exact (unlike 29 / 100 × 100, which is 28.999999999999996).
 */
export function setPercent(owned: number, total: number): number {
  return total === 0 ? 0 : Math.floor((owned * 100) / total)
}

/** The percentage as shown: "<1%" for a set with cards owned but under 1% (1 / 1,746), so it doesn't read as none. */
export function percentLabel(owned: number, total: number): string {
  const percent = setPercent(owned, total)
  return percent === 0 && owned > 0 ? '<1%' : `${percent}%`
}

export const isComplete = (set: Pick<SetProgress, 'owned' | 'total'>) => set.total > 0 && set.owned === set.total

/** Newer set first (the tie-break of every sort), then by name and code, so the order never depends on the input's. */
function newerFirst(a: SetProgress, b: SetProgress): number {
  return b.releasedAt.localeCompare(a.releasedAt) || a.name.localeCompare(b.name) || a.code.localeCompare(b.code)
}

const ORDER: Record<SetSort, (a: SetProgress, b: SetProgress) => number> = {
  // By the exact fraction, compared crosswise: 275 / 276 ranks above 270 / 276 though both show 99%.
  completion: (a, b) => b.owned * a.total - a.owned * b.total,
  released: () => 0,
  name: (a, b) => a.name.localeCompare(b.name),
  owned: (a, b) => b.owned - a.owned,
}

/** The sets in a new list, in the sort's order; ties go to the newer set. */
export function sortSets(sets: readonly SetProgress[], sort: SetSort): SetProgress[] {
  return [...sets].sort((a, b) => ORDER[sort](a, b) || newerFirst(a, b))
}

/** The sets whose name or code contains the text, in any case; all of them for none. */
export function filterSets(sets: readonly SetProgress[], text: string): SetProgress[] {
  const wanted = text.trim().toLowerCase()
  if (wanted === '') return [...sets]
  return sets.filter((s) => s.name.toLowerCase().includes(wanted) || s.code.toLowerCase().includes(wanted))
}

/** Scryfall's set type in words: `draft_innovation` is "Draft innovation". */
export function setTypeLabel(type: string): string {
  const words = type.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 2024" for 2024-09-27, read from the text itself (a Date would move it a day in time zones west of UTC). */
export function releaseMonth(date: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date)
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined
  return match && month ? `${month} ${match[1]}` : date
}

/** The sets with a copy owned (refetched with the collection: see invalidateCollection). */
export function useSets() {
  return useQuery({ queryKey: ['sets'], queryFn: ({ signal }) => apiGet<SetProgress[]>('/api/sets', signal) })
}

/** Whether an error says there's no such set. */
export const isNoSet = (err: unknown) => err instanceof ApiRequestError && err.status === 404

/** One set with its cards. */
export function useSet(code: string) {
  return useQuery({
    queryKey: ['sets', code.toLowerCase()],
    queryFn: ({ signal }) => apiGet<SetDetail>(`/api/sets/${encodeURIComponent(code)}`, signal),
    // A set that isn't there won't be there on a second try either.
    retry: (failures, err) => !isNoSet(err) && failures < 1,
  })
}
