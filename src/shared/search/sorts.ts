import type { SearchSort } from '../types.ts'

/** The sorts My library has and card searches don't: when a copy was added, and how many copies. */
export const LIBRARY_ONLY_SORTS = ['added', 'quantity'] as const satisfies readonly SearchSort[]

/** The sorts every search has. */
export type CardSort = Exclude<SearchSort, (typeof LIBRARY_ONLY_SORTS)[number]>

/** Whether a sort exists outside My library too. */
export function isCardSort(sort: SearchSort): sort is CardSort {
  return !(LIBRARY_ONLY_SORTS as readonly SearchSort[]).includes(sort)
}
