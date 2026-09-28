import { serializeAdvanced, type AdvancedForm } from '../../shared/search/advanced.ts'

export type FormScope = 'library' | 'cards'

/** The query the form writes: the text that was in the search box when the form was first used (the base), then the form's terms. */
export function composeQuery(base: string, form: AdvancedForm, scope: FormScope): string {
  return [base.trim(), serializeAdvanced(form, scope)].filter((part) => part !== '').join(' ')
}

/**
 * idle: the form hasn't been used (base null) · driving: the search text says exactly base + form ·
 * paused: the search text changed since the form last wrote it (typed by hand, or back/forward navigation).
 */
export type FormSync = 'idle' | 'driving' | 'paused'

export function formSync(base: string | null, form: AdvancedForm, scope: FormScope, draft: string): FormSync {
  if (base === null) return 'idle'
  return composeQuery(base, form, scope) === draft.trim() ? 'driving' : 'paused'
}
