import { describe, expect, it } from 'vitest'
import { EMPTY_FORM, quoteValue, serializeAdvanced, type AdvancedForm } from '../../src/shared/search/advanced.ts'
import { parseSearch } from '../../src/shared/search/parse.ts'

const form = (overrides: Partial<AdvancedForm>): AdvancedForm => ({ ...EMPTY_FORM, ...overrides })

describe('serializeAdvanced', () => {
  it('produces nothing for an empty form', () => {
    expect(serializeAdvanced(EMPTY_FORM, 'cards')).toBe('')
  })

  it.each<[Partial<AdvancedForm>, string]>([
    [{ name: '  lightning   bolt ' }, 'lightning bolt'],
    [{ name: 'Circle of Protection: Red' }, 'Circle of "Protection:" Red'],
    [{ oracle: 'draw a card' }, 'o:"draw a card"'],
    [{ oracle: 'flying' }, 'o:flying'],
    [{ types: ['Legendary', 'Creature', 'Elf'] }, 't:Legendary t:Creature t:Elf'],
    [{ colors: { mode: 'including', colors: 'UW' } }, 'c>=wu'],
    [{ colors: { mode: 'exactly', colors: 'GBW' } }, 'c=wbg'],
    [{ colors: { mode: 'atMost', colors: 'R' } }, 'c<=r'],
    [{ colors: { mode: 'including', colors: 'C' } }, 'c=c'],
    [{ identity: { mode: 'atMost', colors: 'BG' } }, 'id<=bg'],
    [{ mana: '{2} {W}{W}' }, 'm:{2}{W}{W}'],
    [{ mv: { op: '<=', value: '3' } }, 'mv<=3'],
    [{ power: { op: '>', value: '4' }, toughness: { op: '<', value: '2' } }, 'pow>4 tou<2'],
    [{ loyalty: { op: '=', value: '' } }, ''],
    [{ loyalty: { op: '=', value: 'x' } }, ''],
    [{ rarities: ['mythic'] }, 'r:mythic'],
    [{ rarities: ['rare', 'mythic'] }, '(r:rare or r:mythic)'],
    [{ set: ' DMU ' }, 's:dmu'],
    [{ set: 'Ice Age' }, 's:"ice age"'],
    [{ format: 'Modern' }, 'f:modern'],
    [{ format: 'Old School' }, 'f:"old school"'],
    [{ format: 'legacy', formatStatus: 'banned' }, 'banned:legacy'],
    [{ format: 'vintage', formatStatus: 'restricted' }, 'restricted:vintage'],
    [{ artist: 'Rebecca Guay' }, 'a:"Rebecca Guay"'],
    [{ flavor: 'the spark' }, 'ft:"the spark"'],
    [{ keywords: 'flying, first strike,' }, 'kw:flying kw:"first strike"'],
    // A value of only quotes, or only spaces, is no value.
    [{ name: 'bolt "" ""', oracle: '""', types: ['"'], mana: '"', set: '""', format: '" "', artist: '  ' }, 'bolt'],
    // Name words that would read as a key, an exclusion, or an exact name are quoted.
    [{ name: 'a<b -foo !bar x=y' }, '"a<b" "-foo" "!bar" "x=y"'],
  ])('%j → %s', (overrides, expected) => {
    expect(serializeAdvanced(form(overrides), 'cards')).toBe(expected)
  })

  it('keeps the empty form as it is: it is frozen', () => {
    expect([Object.isFrozen(EMPTY_FORM), Object.isFrozen(EMPTY_FORM.mv), Object.isFrozen(EMPTY_FORM.types)]).toEqual([true, true, true])
    expect(() => {
      ;(EMPTY_FORM.mv as { value: string }).value = '3'
    }).toThrow(TypeError)
  })

  it('includes library fields only for My library', () => {
    const library = form({ inDeck: 'Atraxa Superfriends', free: { op: '>', value: '0' }, qty: { op: '>=', value: '2' }, finish: 'foil' })
    expect(serializeAdvanced(library, 'library')).toBe('in:"Atraxa Superfriends" free>0 qty>=2 is:foil')
    expect(serializeAdvanced(library, 'cards')).toBe('')
    expect(serializeAdvanced(form({ inDeck: 'built' }), 'library')).toBe('in:built')
  })

  it('combines fields in form order', () => {
    const full = form({ name: 'elf', types: ['Creature'], colors: { mode: 'including', colors: 'G' }, mv: { op: '<=', value: '2' }, format: 'pauper' })
    expect(serializeAdvanced(full, 'cards')).toBe('elf t:Creature c>=g mv<=2 f:pauper')
  })

  it('always produces text the parser accepts', () => {
    const tricky = form({
      name: 'or "and" x:y (paren)',
      oracle: 'deals 3 damage (to any target)',
      types: ['or'],
      colors: { mode: 'exactly', colors: 'WUBRG' },
      identity: { mode: 'including', colors: 'C' },
      mana: '2{G/U}{G/U}',
      mv: { op: '!=', value: '3' },
      rarities: ['common', 'uncommon', 'rare'],
      set: 'm21',
      format: 'commander',
      formatStatus: 'banned',
      artist: 'a "quoted" name',
      keywords: 'or, and',
      inDeck: 'My (weird): deck',
      free: { op: '<', value: '0' },
      qty: { op: '=', value: '1.5' },
      finish: 'etched',
    })
    for (const scope of ['cards', 'library'] as const) {
      const result = parseSearch(serializeAdvanced(tricky, scope))
      expect(result.ok, JSON.stringify(result)).toBe(true)
    }
  })

  it('turns a set name into a positioned parse error instead of a different search', () => {
    const result = parseSearch(serializeAdvanced(form({ set: 'Ice Age' }), 'cards'))
    expect(result).toMatchObject({ ok: false, error: { message: `"ice age" isn't a set code; codes look like dmu or m21` } })
  })
})

describe('quoteValue', () => {
  it.each([
    ['bolt', 'bolt'],
    ['two words', '"two words"'],
    ['a:b', '"a:b"'],
    ['OR', '"OR"'],
    ['say "hi"', '"say hi"'],
    ['pow>3', '"pow>3"'],
    ['-x', '"-x"'],
    ['!x', '"!x"'],
    ['""', ''],
  ])('%s → %s', (input, expected) => {
    expect(quoteValue(input)).toBe(expected)
  })
})
