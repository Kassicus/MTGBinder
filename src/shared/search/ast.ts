/** Character range in the query text, for pointing at the part of a query that's wrong. */
export interface Span {
  start: number
  end: number
}

export type CompareOp = ':' | '=' | '!=' | '<' | '<=' | '>' | '>='

export type SearchKey =
  | 'oracle' | 'type' | 'color' | 'identity' | 'mana' | 'mv' | 'power' | 'toughness' | 'loyalty' | 'rarity'
  | 'set' | 'format' | 'banned' | 'restricted' | 'artist' | 'flavor' | 'keyword' | 'usd' | 'is' | 'in' | 'free' | 'qty'

/**
 * Parsed query. Field values are normalized by the parser: numbers are validated and `:` becomes `=` for numeric
 * keys; rarity is a full name; set, format, and `is:` values are lowercase; mana is canonical symbols (`{2}{W}{W}`).
 */
export type SearchNode =
  | { kind: 'and'; children: SearchNode[] }
  | { kind: 'or'; children: SearchNode[] }
  | { kind: 'not'; child: SearchNode }
  | { kind: 'name'; value: string; exact: boolean; span: Span }
  | { kind: 'field'; key: SearchKey; op: CompareOp; value: string; span: Span }

export interface SearchSyntaxError {
  message: string
  span: Span
}

export type ParseResult = { ok: true; ast: SearchNode } | { ok: false; error: SearchSyntaxError }

export const RARITIES = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'] as const

export const IS_VALUES = ['commander', 'permanent', 'spell', 'dfc', 'split', 'promo', 'foil', 'nonfoil', 'etched', 'wanted', 'unpriced'] as const
