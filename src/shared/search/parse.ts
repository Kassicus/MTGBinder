import { IS_VALUES, RARITIES, type CompareOp, type ParseResult, type SearchKey, type SearchNode, type Span } from './ast.ts'
import { parseColorValue } from './colors.ts'
import { parseManaSymbols } from './mana.ts'

const KEYS = new Map<string, SearchKey>([
  ['o', 'oracle'], ['oracle', 'oracle'],
  ['t', 'type'], ['type', 'type'],
  ['c', 'color'], ['color', 'color'], ['colors', 'color'],
  ['id', 'identity'], ['identity', 'identity'], ['ci', 'identity'],
  ['m', 'mana'], ['mana', 'mana'],
  ['mv', 'mv'], ['cmc', 'mv'], ['manavalue', 'mv'],
  ['pow', 'power'], ['power', 'power'],
  ['tou', 'toughness'], ['toughness', 'toughness'],
  ['loy', 'loyalty'], ['loyalty', 'loyalty'],
  ['r', 'rarity'], ['rarity', 'rarity'],
  ['s', 'set'], ['set', 'set'], ['e', 'set'], ['edition', 'set'],
  ['f', 'format'], ['format', 'format'], ['legal', 'format'],
  ['banned', 'banned'], ['restricted', 'restricted'],
  ['a', 'artist'], ['artist', 'artist'],
  ['ft', 'flavor'], ['flavor', 'flavor'],
  ['kw', 'keyword'], ['keyword', 'keyword'],
  ['usd', 'usd'],
  ['is', 'is'],
  ['in', 'in'],
  ['free', 'free'],
  ['qty', 'qty'], ['own', 'qty'],
])

const RARITY_LETTERS = new Map([['c', 'common'], ['u', 'uncommon'], ['r', 'rare'], ['m', 'mythic'], ['s', 'special'], ['b', 'bonus']])
const OPS: readonly CompareOp[] = ['<=', '>=', '!=', ':', '=', '<', '>']
const NUMBER = /^-?\d+(\.\d+)?$/
/** Deeper nesting is never a real query and would overflow the recursive parser or SQLite's expression-depth limit. */
const MAX_DEPTH = 50

interface TermToken {
  t: 'term'
  exact: boolean
  key: string | null
  keySpan: Span | null
  op: CompareOp | null
  value: string
  span: Span
}
type Token = { t: 'lparen' | 'rparen' | 'or' | 'and' | 'not'; span: Span } | TermToken

class ParseFailure extends Error {
  span: Span
  constructor(message: string, span: Span) {
    super(message)
    this.span = span
  }
}

function lex(input: string): Token[] {
  const tokens: Token[] = []
  const n = input.length
  const isBreak = (ch: string | undefined) => ch === undefined || /[\s()]/.test(ch)
  const readBare = (from: number): number => {
    let i = from
    while (!isBreak(input[i])) i++
    return i
  }
  const readQuoted = (quoteAt: number): { value: string; end: number } => {
    const close = input.indexOf('"', quoteAt + 1)
    if (close === -1) throw new ParseFailure('This quote is never closed', { start: quoteAt, end: n })
    return { value: input.slice(quoteAt + 1, close), end: close + 1 }
  }
  const term = (fields: Omit<TermToken, 't'>): TermToken => ({ t: 'term', ...fields })

  let i = 0
  while (i < n) {
    const ch = input[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const start = i
    if (ch === '(' || ch === ')') {
      tokens.push({ t: ch === '(' ? 'lparen' : 'rparen', span: { start, end: i + 1 } })
      i++
      continue
    }
    if (ch === '-') {
      const next = input[i + 1]
      if (next === undefined || next === ')' || /\s/.test(next)) {
        throw new ParseFailure('Nothing to exclude after "-"', { start, end: i + 1 })
      }
      tokens.push({ t: 'not', span: { start, end: i + 1 } })
      i++
      continue
    }
    if (ch === '!') {
      if (input[i + 1] === '"') {
        const quoted = readQuoted(i + 1)
        tokens.push(term({ exact: true, key: null, keySpan: null, op: null, value: quoted.value, span: { start, end: quoted.end } }))
        i = quoted.end
        continue
      }
      const end = readBare(i + 1)
      if (end === i + 1) throw new ParseFailure('"!" needs a card name after it', { start, end: i + 1 })
      tokens.push(term({ exact: true, key: null, keySpan: null, op: null, value: input.slice(i + 1, end), span: { start, end } }))
      i = end
      continue
    }
    if (ch === '"') {
      const quoted = readQuoted(i)
      tokens.push(term({ exact: false, key: null, keySpan: null, op: null, value: quoted.value, span: { start, end: quoted.end } }))
      i = quoted.end
      continue
    }
    const keyMatch = /^[a-zA-Z]+/.exec(input.slice(i))
    const keyEnd = i + (keyMatch?.[0].length ?? 0)
    const op = keyMatch ? OPS.find((o) => input.startsWith(o, keyEnd)) : undefined
    if (keyMatch && op) {
      const valueStart = keyEnd + op.length
      let value: string
      let end: number
      if (input[valueStart] === '"') {
        const quoted = readQuoted(valueStart)
        value = quoted.value
        end = quoted.end
      } else {
        end = readBare(valueStart)
        value = input.slice(valueStart, end)
      }
      tokens.push(term({ exact: false, key: keyMatch[0], keySpan: { start, end: keyEnd }, op, value, span: { start, end } }))
      i = end
      continue
    }
    const end = readBare(i)
    const word = input.slice(i, end)
    const lower = word.toLowerCase()
    if (lower === 'or' || lower === 'and') tokens.push({ t: lower, span: { start, end } })
    else tokens.push(term({ exact: false, key: null, keySpan: null, op: null, value: word, span: { start, end } }))
    i = end
  }
  return tokens
}

function requireOps(tok: TermToken, allowed: readonly CompareOp[]): void {
  if (!allowed.includes(tok.op!)) {
    throw new ParseFailure(`"${tok.key}${tok.op}" isn't supported; use ${tok.key}:`, tok.span)
  }
}

function toNode(tok: TermToken): SearchNode {
  if (tok.key === null) return { kind: 'name', value: tok.value, exact: tok.exact, span: tok.span }
  const key = KEYS.get(tok.key.toLowerCase())
  if (!key) throw new ParseFailure(`Unknown search key "${tok.key}"`, tok.keySpan ?? tok.span)
  const op = tok.op!
  const raw = tok.value
  if (raw === '') throw new ParseFailure(`"${tok.key}${op}" needs a value`, tok.span)
  const lower = raw.toLowerCase()
  const field = (value: string, fieldOp: CompareOp = op): SearchNode => ({ kind: 'field', key, op: fieldOp, value, span: tok.span })

  switch (key) {
    case 'oracle':
    case 'type':
    case 'artist':
    case 'flavor':
    case 'keyword':
    case 'in':
      requireOps(tok, [':', '='])
      return field(raw, ':')
    case 'mv':
    case 'power':
    case 'toughness':
    case 'loyalty':
    case 'usd':
    case 'free':
    case 'qty':
      if (!NUMBER.test(raw)) throw new ParseFailure(`${tok.key} needs a number, like ${tok.key}>=3`, tok.span)
      return field(raw, op === ':' ? '=' : op)
    case 'color':
    case 'identity': {
      const color = parseColorValue(raw)
      if (!color) {
        throw new ParseFailure(
          `"${raw}" isn't a color; use letters like wu, a name like esper, c for colorless, or m for multicolor`,
          tok.span,
        )
      }
      if (color.kind === 'multicolor') requireOps(tok, [':', '=', '!='])
      return field(lower)
    }
    case 'mana': {
      requireOps(tok, [':', '='])
      const symbols = parseManaSymbols(raw)
      if (!symbols) throw new ParseFailure(`Can't read the mana cost "${raw}"; try m:{2}{W}{W} or m:2WW`, tok.span)
      return field(symbols.join(''), op === '=' ? '=' : ':')
    }
    case 'rarity': {
      const rarity = RARITY_LETTERS.get(lower) ?? ((RARITIES as readonly string[]).includes(lower) ? lower : null)
      if (!rarity) throw new ParseFailure(`Unknown rarity "${raw}"; use common, uncommon, rare, mythic, special, or bonus`, tok.span)
      return field(rarity, op === ':' ? '=' : op)
    }
    case 'set':
      requireOps(tok, [':', '='])
      if (!/^[a-z0-9]{2,8}$/.test(lower)) throw new ParseFailure(`"${raw}" isn't a set code; codes look like dmu or m21`, tok.span)
      return field(lower, ':')
    case 'format':
    case 'banned':
    case 'restricted':
      requireOps(tok, [':', '='])
      if (!/^[a-z]+$/.test(lower)) throw new ParseFailure(`"${raw}" isn't a format name, like modern or commander`, tok.span)
      return field(lower, ':')
    case 'is':
      requireOps(tok, [':', '='])
      if (!(IS_VALUES as readonly string[]).includes(lower)) {
        throw new ParseFailure(`Unknown is: value "${raw}"; try ${IS_VALUES.join(', ')}`, tok.span)
      }
      return field(lower, ':')
  }
}

const startsTerm = (tok: Token | undefined): boolean =>
  tok !== undefined && (tok.t === 'term' || tok.t === 'not' || tok.t === 'lparen')

/**
 * Parses the Scryfall-style query language (spec §5.2.2). Terms are ANDed; `or` binds looser than AND; `-` negates;
 * parentheses group. An empty query parses to an empty AND (matches everything).
 */
export function parseSearch(input: string): ParseResult {
  try {
    return { ok: true, ast: parseTokens(input, lex(input)) }
  } catch (err) {
    if (err instanceof ParseFailure) return { ok: false, error: { message: err.message, span: err.span } }
    throw err
  }
}

/** Parses the tokens of `input`, throwing a ParseFailure at the first mistake. */
function parseTokens(input: string, tokens: readonly Token[]): SearchNode {
  let pos = 0
  let depth = 0
  const peek = () => tokens[pos]
  const endSpan: Span = { start: input.length, end: input.length }
  const text = (span: Span) => input.slice(span.start, span.end)

  function parseOr(): SearchNode {
    const children = [parseAnd()]
    while (peek()?.t === 'or') {
      const orTok = tokens[pos++]!
      if (!startsTerm(peek())) throw new ParseFailure('Nothing after "or"', orTok.span)
      children.push(parseAnd())
    }
    return children.length === 1 ? children[0]! : { kind: 'or', children }
  }

  function parseAnd(): SearchNode {
    const children: SearchNode[] = []
    for (;;) {
      const tok = peek()
      if (tok === undefined || tok.t === 'rparen' || tok.t === 'or') break
      if (tok.t === 'and') {
        pos++
        if (children.length === 0) throw new ParseFailure('Nothing before "and"', tok.span)
        if (!startsTerm(peek())) throw new ParseFailure('Nothing after "and"', tok.span)
        continue
      }
      children.push(parseUnary())
    }
    if (children.length === 0) {
      const tok = peek()
      if (tok?.t === 'or') throw new ParseFailure('Nothing before "or"', tok.span)
      if (tok?.t === 'rparen') throw new ParseFailure('This parenthesis has no matching "("', tok.span)
      throw new ParseFailure('Expected a search term', endSpan)
    }
    return children.length === 1 ? children[0]! : { kind: 'and', children }
  }

  function parseUnary(): SearchNode {
    const tok = tokens[pos++]!
    if (tok.t === 'not') {
      if (!startsTerm(peek())) throw new ParseFailure('Nothing to exclude after "-"', tok.span)
      if (++depth > MAX_DEPTH) throw new ParseFailure('This query nests too deeply', tok.span)
      const child = parseUnary()
      depth--
      return { kind: 'not', child }
    }
    if (tok.t === 'lparen') {
      const next = peek()
      if (next === undefined) throw new ParseFailure('This parenthesis is never closed', tok.span)
      if (next.t === 'rparen') throw new ParseFailure('Empty parentheses', { start: tok.span.start, end: next.span.end })
      if (++depth > MAX_DEPTH) throw new ParseFailure('This query nests too deeply', tok.span)
      const inner = parseOr()
      depth--
      if (peek()?.t !== 'rparen') throw new ParseFailure('This parenthesis is never closed', tok.span)
      pos++
      return inner
    }
    if (tok.t === 'term') return toNode(tok)
    throw new ParseFailure(`Unexpected "${text(tok.span)}"`, tok.span)
  }

  if (tokens.length === 0) return { kind: 'and', children: [] }
  const ast = parseOr()
  const extra = peek()
  if (extra) {
    throw new ParseFailure(
      extra.t === 'rparen' ? 'This parenthesis has no matching "("' : `Unexpected "${text(extra.span)}"`,
      extra.span,
    )
  }
  return ast
}
