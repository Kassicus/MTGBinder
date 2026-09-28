import { describe, expect, it } from 'vitest'
import { EMPTY_FORM, type AdvancedForm } from '../../src/shared/search/advanced.ts'
import { composeQuery, formSync, type FormScope } from '../../src/web/lib/advanced-sync.ts'

const form = (overrides: Partial<AdvancedForm>): AdvancedForm => ({ ...EMPTY_FORM, ...overrides })
const green = form({ colors: { mode: 'including', colors: 'G' } })
const libraryFields = form({ free: { op: '>=', value: '1' }, finish: 'foil' })

describe('composeQuery', () => {
  it('is empty for an empty base and an empty form', () => {
    expect(composeQuery('', EMPTY_FORM, 'cards')).toBe('')
    expect(composeQuery('   ', EMPTY_FORM, 'library')).toBe('')
  })

  it('keeps the base when the form adds nothing', () => {
    expect(composeQuery('t:elf', EMPTY_FORM, 'cards')).toBe('t:elf')
  })

  it("appends the form's terms to the base", () => {
    expect(composeQuery('t:elf', green, 'cards')).toBe('t:elf c>=g')
    expect(composeQuery('', green, 'cards')).toBe('c>=g')
  })

  it('trims the base', () => {
    expect(composeQuery('  t:elf  ', form({ name: 'bolt' }), 'cards')).toBe('t:elf bolt')
  })

  it('does not erase the base on a mode-only change (no colors picked)', () => {
    expect(composeQuery('t:elf', form({ colors: { mode: 'exactly', colors: '' } }), 'cards')).toBe('t:elf')
  })

  it('includes library-only fields only for the library scope', () => {
    expect(composeQuery('t:elf', libraryFields, 'library')).toBe('t:elf free>=1 is:foil')
    expect(composeQuery('t:elf', libraryFields, 'cards')).toBe('t:elf')
  })
})

describe('formSync', () => {
  it('is idle until the form is used', () => {
    expect(formSync(null, EMPTY_FORM, 'cards', '')).toBe('idle')
    expect(formSync(null, green, 'cards', 't:elf')).toBe('idle')
  })

  it('is driving while the search text says exactly base + form', () => {
    expect(formSync('t:elf', green, 'cards', composeQuery('t:elf', green, 'cards'))).toBe('driving')
    expect(formSync('t:elf', green, 'cards', 't:elf c>=g   ')).toBe('driving')
    expect(formSync('', EMPTY_FORM, 'cards', '')).toBe('driving')
  })

  it('is paused once the search text is edited by hand', () => {
    expect(formSync('t:elf', green, 'cards', 't:elf c>=g mv<=2')).toBe('paused')
    expect(formSync('t:elf', green, 'cards', 't:elf')).toBe('paused')
  })

  it('is paused when navigation changes the search text', () => {
    expect(formSync('t:elf', green, 'cards', 'o:"draw a card"')).toBe('paused')
  })
})

describe('the search bar handlers, scripted', () => {
  interface State {
    base: string | null
    form: AdvancedForm
    scope: FormScope
    draft: string
  }
  // Mirrors SearchBar's changeForm and changeScope.
  const changeForm = (s: State, next: AdvancedForm): State => {
    const b = s.base ?? s.draft.trim()
    return { ...s, base: b, form: next, draft: composeQuery(b, next, s.scope) }
  }
  const changeScope = (s: State, next: FormScope): State => {
    const driving = formSync(s.base, s.form, s.scope, s.draft) === 'driving'
    const text = driving ? composeQuery(s.base ?? '', s.form, next) : s.draft
    return { ...s, scope: next, draft: text }
  }
  const sync = (s: State) => formSync(s.base, s.form, s.scope, s.draft)

  it('keeps typed text, follows the scope, and pauses on a hand edit', () => {
    let s: State = { base: null, form: EMPTY_FORM, scope: 'cards', draft: 't:elf' }
    expect(sync(s)).toBe('idle')

    s = changeForm(s, green)
    expect(s.base).toBe('t:elf')
    expect(s.draft).toBe('t:elf c>=g')
    expect(sync(s)).toBe('driving')

    s = changeForm(s, { ...s.form, free: { op: '>=', value: '1' } })
    expect(s.base).toBe('t:elf')
    expect(s.draft).toBe('t:elf c>=g')
    expect(sync(s)).toBe('driving')

    s = changeScope(s, 'library')
    expect(s.draft).toBe('t:elf c>=g free>=1')
    expect(sync(s)).toBe('driving')

    s = { ...s, draft: `${s.draft} r:rare` }
    expect(sync(s)).toBe('paused')

    const kept = s.draft
    s = changeScope(s, 'cards')
    expect(s.draft).toBe(kept)
    expect(sync(s)).toBe('paused')
  })
})
