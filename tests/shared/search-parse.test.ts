import { describe, expect, it } from 'vitest'
import type { SearchNode } from '../../src/shared/search/ast.ts'
import { parseColorValue } from '../../src/shared/search/colors.ts'
import { parseManaSymbols } from '../../src/shared/search/mana.ts'
import { parseSearch } from '../../src/shared/search/parse.ts'

/** Parses and strips spans so expectations stay readable. */
function ast(query: string): unknown {
  const result = parseSearch(query)
  if (!result.ok) throw new Error(`parse failed: ${result.error.message}`)
  const strip = (node: SearchNode): unknown => {
    switch (node.kind) {
      case 'and':
      case 'or':
        return { [node.kind]: node.children.map(strip) }
      case 'not':
        return { not: strip(node.child) }
      case 'name':
        return node.exact ? { exact: node.value } : { name: node.value }
      case 'field':
        return [node.key, node.op, node.value]
    }
  }
  return strip(result.ast)
}

function failure(query: string) {
  const result = parseSearch(query)
  if (result.ok) throw new Error(`expected "${query}" to fail`)
  return { message: result.error.message, at: query.slice(result.error.span.start, result.error.span.end) }
}

describe('parseSearch: structure', () => {
  it('parses an empty query as match-everything', () => {
    expect(ast('')).toEqual({ and: [] })
    expect(ast('   ')).toEqual({ and: [] })
  })

  it('treats bare words and quoted phrases as name terms', () => {
    expect(ast('lightning')).toEqual({ name: 'lightning' })
    expect(ast('lightning bolt')).toEqual({ and: [{ name: 'lightning' }, { name: 'bolt' }] })
    expect(ast('"lightning bolt"')).toEqual({ name: 'lightning bolt' })
    expect(ast("Lim-Dûl's")).toEqual({ name: "Lim-Dûl's" })
  })

  it('reads exact names', () => {
    expect(ast('!fire')).toEqual({ exact: 'fire' })
    expect(ast('!"Fire // Ice"')).toEqual({ exact: 'Fire // Ice' })
  })

  it('makes AND bind tighter than OR', () => {
    expect(ast('a b or c')).toEqual({ or: [{ and: [{ name: 'a' }, { name: 'b' }] }, { name: 'c' }] })
    expect(ast('a OR b and c')).toEqual({ or: [{ name: 'a' }, { and: [{ name: 'b' }, { name: 'c' }] }] })
  })

  it('groups with parentheses and negates with -', () => {
    expect(ast('(t:elf or t:goblin) -c:r')).toEqual({
      and: [{ or: [['type', ':', 'elf'], ['type', ':', 'goblin']] }, { not: ['color', ':', 'r'] }],
    })
    expect(ast('-(a b)')).toEqual({ not: { and: [{ name: 'a' }, { name: 'b' }] } })
    expect(ast('--bolt')).toEqual({ not: { not: { name: 'bolt' } } })
  })

  it('reads quoted field values', () => {
    expect(ast('o:"draw a card"')).toEqual(['oracle', ':', 'draw a card'])
    expect(ast('a:"rebecca guay" t:enchantment')).toEqual({
      and: [['artist', ':', 'rebecca guay'], ['type', ':', 'enchantment']],
    })
  })
})

describe('parseSearch: keys and values', () => {
  it.each([
    ['o:flying', ['oracle', ':', 'flying']],
    ['oracle=flying', ['oracle', ':', 'flying']],
    ['t:Creature', ['type', ':', 'Creature']],
    ['type:elf', ['type', ':', 'elf']],
    ['c:wu', ['color', ':', 'wu']],
    ['color>=UW', ['color', '>=', 'uw']],
    ['c=esper', ['color', '=', 'esper']],
    ['id:g', ['identity', ':', 'g']],
    ['ci<=bg', ['identity', '<=', 'bg']],
    ['c:m', ['color', ':', 'm']],
    ['m:2WW', ['mana', ':', '{2}{W}{W}']],
    ['mana={G}{G}', ['mana', '=', '{G}{G}']],
    ['m:{w/u}', ['mana', ':', '{W/U}']],
    ['mv>=3', ['mv', '>=', '3']],
    ['cmc:2', ['mv', '=', '2']],
    ['pow>4', ['power', '>', '4']],
    ['tou<=1', ['toughness', '<=', '1']],
    ['loy=3', ['loyalty', '=', '3']],
    ['usd<1.5', ['usd', '<', '1.5']],
    ['r:m', ['rarity', '=', 'mythic']],
    ['rarity>=rare', ['rarity', '>=', 'rare']],
    ['s:M21', ['set', ':', 'm21']],
    ['e:2xm', ['set', ':', '2xm']],
    ['f:Modern', ['format', ':', 'modern']],
    ['legal:commander', ['format', ':', 'commander']],
    ['banned:legacy', ['banned', ':', 'legacy']],
    ['restricted:vintage', ['restricted', ':', 'vintage']],
    ['a:guay', ['artist', ':', 'guay']],
    ['ft:"the spark"', ['flavor', ':', 'the spark']],
    ['kw:flying', ['keyword', ':', 'flying']],
    ['is:Commander', ['is', ':', 'commander']],
    ['is:foil', ['is', ':', 'foil']],
    ['in:deck', ['in', ':', 'deck']],
    ['in:"Atraxa Superfriends"', ['in', ':', 'Atraxa Superfriends']],
    ['free>0', ['free', '>', '0']],
    ['qty>=2', ['qty', '>=', '2']],
    ['own:4', ['qty', '=', '4']],
  ])('parses %s', (query, expected) => {
    expect(ast(query)).toEqual(expected)
  })
})

describe('parseSearch: errors point at the problem', () => {
  it.each([
    ['foo:bar lightning', 'Unknown search key "foo"', 'foo'],
    ['t:elf "unclosed', 'This quote is never closed', '"unclosed'],
    ['(t:elf', 'This parenthesis is never closed', '('],
    ['t:elf)', 'This parenthesis has no matching "("', ')'],
    ['()', 'Empty parentheses', '()'],
    ['bolt or', 'Nothing after "or"', 'or'],
    ['or bolt', 'Nothing before "or"', 'or'],
    ['bolt -', 'Nothing to exclude after "-"', '-'],
    ['o:', '"o:" needs a value', 'o:'],
    ['mv>=three', 'mv needs a number, like mv>=3', 'mv>=three'],
    ['c:purple', '"purple" isn\'t a color; use letters like wu, a name like esper, c for colorless, or m for multicolor', 'c:purple'],
    ['c>m', '"c>" isn\'t supported; use c:', 'c>m'],
    ['m:hello', 'Can\'t read the mana cost "hello"; try m:{2}{W}{W} or m:2WW', 'm:hello'],
    ['r:ultra', 'Unknown rarity "ultra"; use common, uncommon, rare, mythic, special, or bonus', 'r:ultra'],
    ['t:elf (', 'This parenthesis is never closed', '('],
    ['(', 'This parenthesis is never closed', '('],
    ['m:{foo}', 'Can\'t read the mana cost "{foo}"; try m:{2}{W}{W} or m:2WW', 'm:{foo}'],
    ['s:!!', '"!!" isn\'t a set code; codes look like dmu or m21', 's:!!'],
    ['o<flying', '"o<" isn\'t supported; use o:', 'o<flying'],
    ['is:shiny', 'Unknown is: value "shiny"; try commander, permanent, spell, dfc, split, promo, foil, nonfoil, etched, wanted', 'is:shiny'],
    ['!', '"!" needs a card name after it', '!'],
  ])('rejects %s', (query, message, at) => {
    expect(failure(query)).toEqual({ message, at })
  })
})

describe('parseColorValue', () => {
  it.each([
    ['wu', 'WU'], ['uw', 'WU'], ['GRUBW', 'WUBRG'], ['esper', 'WUB'], ['boros', 'WR'], ['temur', 'URG'],
    ['blue', 'U'], ['c', ''], ['colorless', ''],
  ])('%s → %s', (input, colors) => {
    expect(parseColorValue(input)).toEqual({ kind: 'colors', colors })
  })

  it('reads multicolor and rejects non-colors', () => {
    expect(parseColorValue('m')).toEqual({ kind: 'multicolor' })
    expect(parseColorValue('multicolor')).toEqual({ kind: 'multicolor' })
    expect(parseColorValue('purple')).toBeNull()
    expect(parseColorValue('constructor')).toBeNull()
  })
})

describe('parseManaSymbols', () => {
  it.each([
    ['2WW', ['{2}', '{W}', '{W}']],
    ['{2}{W}{W}', ['{2}', '{W}', '{W}']],
    ['xrr', ['{X}', '{R}', '{R}']],
    ['10{G/U}', ['{10}', '{G/U}']],
    ['{u/p}', ['{U/P}']],
    ['{2/W}{G/U/P}{C/W}', ['{2/W}', '{G/U/P}', '{C/W}']],
    ['{½}{∞}{HW}', ['{½}', '{∞}', '{HW}']],
  ])('%s', (input, symbols) => {
    expect(parseManaSymbols(input)).toEqual(symbols)
  })

  it('rejects non-mana text', () => {
    expect(parseManaSymbols('hello')).toBeNull()
    expect(parseManaSymbols('')).toBeNull()
    expect(parseManaSymbols('2W W')).toBeNull()
    expect(parseManaSymbols('{foo}')).toBeNull()
    expect(parseManaSymbols('{W/U/B}')).toBeNull()
  })
})

describe('parseSearch: nesting limit', () => {
  it('parses 50 nested parentheses', () => {
    expect(ast('('.repeat(50) + 'bolt' + ')'.repeat(50))).toEqual({ name: 'bolt' })
  })

  it('parses 50 negations', () => {
    expect(parseSearch('-'.repeat(50) + 'bolt').ok).toBe(true)
  })

  it.each([
    ['parentheses', '('.repeat(51) + 'bolt' + ')'.repeat(51), '('],
    ['negations', '-'.repeat(51) + 'bolt', '-'],
  ])('rejects a 51st level of %s at the token that crosses the limit', (_label, query, at) => {
    expect(failure(query)).toEqual({ message: 'This query nests too deeply', at })
    const result = parseSearch(query)
    expect(result.ok ? null : result.error.span).toEqual({ start: 50, end: 51 })
  })

  it.each([
    ['parentheses', '('.repeat(5000) + 'a' + ')'.repeat(5000)],
    ['negations', '-'.repeat(20000) + 'a'],
  ])('returns an error instead of throwing for huge nesting of %s', (_label, query) => {
    let result: ReturnType<typeof parseSearch> | undefined
    expect(() => {
      result = parseSearch(query)
    }).not.toThrow()
    expect(result?.ok).toBe(false)
  })
})
