import { canonColors } from '../colors.ts'

export type NumericOp = '=' | '!=' | '<' | '<=' | '>' | '>='

/** A numeric filter; an empty value means "not used". */
export interface NumericField {
  op: NumericOp
  value: string
}

export type ColorMode = 'exactly' | 'including' | 'atMost'

/** Selected colors as WUBRG letters, or 'C' alone for colorless. */
export interface ColorField {
  mode: ColorMode
  colors: string
}

export type FormatStatus = 'legal' | 'banned' | 'restricted'

/** The Gatherer-style advanced search form (spec §5.2.3). Library fields apply only when searching My library. */
export interface AdvancedForm {
  name: string
  oracle: string
  types: string[]
  colors: ColorField
  identity: ColorField
  mana: string
  mv: NumericField
  power: NumericField
  toughness: NumericField
  loyalty: NumericField
  rarities: string[]
  set: string
  format: string
  formatStatus: FormatStatus
  artist: string
  flavor: string
  /** Comma-separated. */
  keywords: string
  /** '' (any), 'deck' (any deck), 'built', 'prospective', or a deck name. */
  inDeck: string
  free: NumericField
  qty: NumericField
  finish: '' | 'nonfoil' | 'foil' | 'etched'
}

const noNumber: NumericField = { op: '>=', value: '' }

/** Freezes an object and everything in it. */
function deepFreeze<T extends object>(value: T): T {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner as object)
  return Object.freeze(value)
}

/** The empty form. It's frozen, all the way down, since its fields are shared by every copy made from it. */
export const EMPTY_FORM: AdvancedForm = deepFreeze({
  name: '',
  oracle: '',
  types: [],
  colors: { mode: 'including', colors: '' },
  identity: { mode: 'atMost', colors: '' },
  mana: '',
  mv: noNumber,
  power: noNumber,
  toughness: noNumber,
  loyalty: noNumber,
  rarities: [],
  set: '',
  format: '',
  formatStatus: 'legal',
  artist: '',
  flavor: '',
  keywords: '',
  inDeck: '',
  free: noNumber,
  qty: noNumber,
  finish: '',
})

/**
 * Quotes a value when it would read as something else: when it contains spaces, parentheses, a colon, or a
 * comparison (`<`, `>`, `=`), starts with `-` or `!`, or is `or`/`and`. Drops `"` (the query language can't escape
 * it), so a value of only quotes becomes ''.
 */
export function quoteValue(value: string): string {
  const v = value.replace(/"/g, '').trim()
  return /[\s():<>=]/.test(v) || /^[-!]/.test(v) || /^(or|and)$/i.test(v) ? `"${v}"` : v
}

const COLOR_OPS: Record<ColorMode, string> = { exactly: '=', including: '>=', atMost: '<=' }

function colorTerm(key: 'c' | 'id', field: ColorField): string | null {
  const selected = field.colors.toUpperCase()
  if (selected === '') return null
  if (selected.includes('C')) return `${key}=c`
  return `${key}${COLOR_OPS[field.mode]}${canonColors(selected).toLowerCase()}`
}

function numberTerm(key: string, field: NumericField): string | null {
  const v = field.value.trim()
  return /^-?\d+(\.\d+)?$/.test(v) ? `${key}${field.op}${v}` : null
}

/**
 * Turns the advanced form into query-language text. Library-only fields are included only when searching My library.
 * Every term produced parses with parseSearch, except values the parser itself rejects (such as a set name typed where a set code belongs), which fail with a positioned error instead of becoming a different search.
 */
export function serializeAdvanced(form: AdvancedForm, scope: 'library' | 'cards'): string {
  const terms: Array<string | null> = []
  const text = (key: string, value: string) => {
    const quoted = quoteValue(value)
    return quoted === '' ? null : `${key}:${quoted}`
  }

  for (const word of form.name.trim().split(/\s+/)) terms.push(quoteValue(word) || null)
  terms.push(text('o', form.oracle))
  for (const type of form.types) terms.push(text('t', type))
  terms.push(colorTerm('c', form.colors))
  terms.push(colorTerm('id', form.identity))
  const mana = form.mana.replace(/[\s"]+/g, '')
  terms.push(mana === '' ? null : `m:${mana}`)
  terms.push(numberTerm('mv', form.mv))
  terms.push(numberTerm('pow', form.power))
  terms.push(numberTerm('tou', form.toughness))
  terms.push(numberTerm('loy', form.loyalty))
  if (form.rarities.length === 1) terms.push(`r:${form.rarities[0]}`)
  if (form.rarities.length > 1) terms.push(`(${form.rarities.map((r) => `r:${r}`).join(' or ')})`)
  terms.push(text('s', form.set.toLowerCase()))
  terms.push(text(form.formatStatus === 'legal' ? 'f' : form.formatStatus, form.format.toLowerCase()))
  terms.push(text('a', form.artist))
  terms.push(text('ft', form.flavor))
  for (const keyword of form.keywords.split(',')) terms.push(text('kw', keyword))

  if (scope === 'library') {
    const deck = form.inDeck.trim()
    if (deck !== '') terms.push(text('in', deck))
    terms.push(numberTerm('free', form.free))
    terms.push(numberTerm('qty', form.qty))
    if (form.finish !== '') terms.push(`is:${form.finish}`)
  }
  return terms.filter((t): t is string => t !== null).join(' ')
}
