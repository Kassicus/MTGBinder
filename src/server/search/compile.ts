import { WUBRG } from '../../shared/colors.ts'
import { normalizeName } from '../../shared/normalize.ts'
import { RARITIES, type CompareOp, type SearchKey, type SearchNode, type Span } from '../../shared/search/ast.ts'
import { parseColorValue } from '../../shared/search/colors.ts'
import type { DB } from '../db/index.ts'

/** Which rows a query runs over: the owner's collection, or every printing in the local card data. */
export type SearchScope = 'library' | 'cards'

/** A query the user can fix: a syntax error or a key that doesn't apply to the chosen scope. */
export class SearchQueryError extends Error {
  span: Span
  constructor(message: string, span: Span) {
    super(message)
    this.name = 'SearchQueryError'
    this.span = span
  }
}

export interface CompiledFilter {
  /**
   * A boolean SQL expression over `c` (cards); in library scope also `co` (collection), plus `own` and `alloc` when
   * `ownership` is true.
   */
  sql: string
  params: Record<string, string | number>
  /** True when the expression uses `own`/`alloc` (free, qty, is:wanted), so the query must join them. */
  ownership: boolean
}

/** Owned copies of the row's card identity. Valid only where the library query joins `own` and `alloc`. */
export const OWNED_SQL = 'COALESCE(own.owned, 0)'
/** Owned copies not committed to built decks (spec §4.3). Valid only where the library query joins `own` and `alloc`. */
export const FREE_SQL = '(COALESCE(own.owned, 0) - COALESCE(alloc.allocated, 0))'
/** Rarity as a number (common 0 … bonus 5) for comparisons and sorting; takes the column to rank. */
export const rarityRankSql = (column: string) =>
  `CASE ${column} ${RARITIES.map((r, i) => `WHEN '${r}' THEN ${i}`).join(' ')} END`

/**
 * Registers the SQL functions compiled filters call: `faces_include(face_names, name)` is 1 when a face's normalized
 * name is `name`. openDb registers them on every connection, so a compiled filter runs wherever the database is open.
 */
export function registerSearchFunctions(db: DB): void {
  db.function('faces_include', { deterministic: true }, (faceNames: unknown, normalized: unknown) =>
    typeof faceNames === 'string' && faceNames.split('\n').some((face) => normalizeName(face) === normalized) ? 1 : 0,
  )
}

const FIRST_FACE_NAME = 'substr(c.face_names, 1, instr(c.face_names || char(10), char(10)) - 1)'
const FRONT_TYPE_LINE = "substr(c.type_line, 1, instr(c.type_line || ' // ', ' // ') - 1)"
const PERMANENT_TYPES = ['Artifact', 'Creature', 'Enchantment', 'Land', 'Planeswalker', 'Battle']
const LIBRARY_KEYS: ReadonlySet<SearchKey> = new Set(['in', 'free', 'qty'])
const LIBRARY_IS = new Set(['foil', 'nonfoil', 'etched', 'wanted'])

const sqlOp = (op: CompareOp) => (op === ':' ? '=' : op)

/**
 * Compiles a parsed query to a parameterized SQL condition. Library-only keys (`in:`, `free`, `qty`, `is:foil`,
 * `is:nonfoil`, `is:etched`, `is:wanted`) throw SearchQueryError outside library scope. Only fixed SQL fragments are
 * inlined; every user-supplied value is a bound parameter.
 */
export function compileFilter(ast: SearchNode, scope: SearchScope): CompiledFilter {
  const params: Record<string, string | number> = {}
  let count = 0
  let ownership = false
  const param = (value: string | number): string => {
    const name = `p${count++}`
    params[name] = value
    return `@${name}`
  }

  function colorSql(column: string, key: 'color' | 'identity', op: CompareOp, raw: string): string {
    const value = parseColorValue(raw)
    if (!value) throw new Error(`unparsed color "${raw}"`) // the parser rejects these
    if (value.kind === 'multicolor') return op === '!=' ? `(length(${column}) < 2)` : `(length(${column}) >= 2)`
    const set = value.colors
    // c: means "including these colors" (c:c means colorless); id: means "fits within this identity".
    const effective = op === ':' ? (key === 'identity' ? '<=' : set === '' ? '=' : '>=') : op
    const has = WUBRG.filter((l) => set.includes(l)).map((l) => `instr(${column}, '${l}') > 0`)
    const lacks = WUBRG.filter((l) => !set.includes(l)).map((l) => `instr(${column}, '${l}') = 0`)
    const superset = has.length > 0 ? has.join(' AND ') : '1'
    const subset = lacks.length > 0 ? lacks.join(' AND ') : '1'
    switch (effective) {
      case '>=':
        return `(${superset})`
      case '<=':
        return `(${subset})`
      case '>':
        return `(${superset} AND length(${column}) > ${set.length})`
      case '<':
        return `(${subset} AND length(${column}) < ${set.length})`
      case '!=':
        return `(NOT (${superset} AND ${subset}))`
      default:
        return `(${superset} AND ${subset})`
    }
  }

  function inDeckSql(value: string): string {
    const base =
      'EXISTS (SELECT 1 FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id ' +
      "WHERE dc.oracle_id = c.oracle_id AND dc.board != 'maybe'"
    const lower = value.toLowerCase()
    if (lower === 'deck') return `(${base}))`
    if (lower === 'built' || lower === 'prospective') return `(${base} AND d.status = '${lower}'))`
    return `(${base} AND lower(d.name) = lower(${param(value)})))`
  }

  function isSql(value: string): string {
    switch (value) {
      case 'commander':
        // Judged on the front face: a legendary creature back face (Westvale Abbey) doesn't make a commander.
        return (
          `(instr(${FRONT_TYPE_LINE}, 'Legendary') > 0 AND ` +
          `(instr(${FRONT_TYPE_LINE}, 'Creature') > 0 OR instr(lower(c.oracle_text), 'can be your commander') > 0))`
        )
      case 'permanent':
        return `(${PERMANENT_TYPES.map((t) => `instr(c.type_line, '${t}') > 0`).join(' OR ')})`
      case 'spell':
        return "(instr(c.type_line, 'Land') = 0)"
      case 'dfc':
        return "(c.layout IN ('transform', 'modal_dfc', 'reversible_card'))"
      case 'split':
        return "(c.layout = 'split')"
      case 'promo':
        return '(c.is_promo = 1)'
      case 'foil':
      case 'nonfoil':
      case 'etched':
        return `(co.finish = '${value}')`
      case 'wanted':
        ownership = true
        return (
          '(EXISTS (SELECT 1 FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id ' +
          "WHERE dc.oracle_id = c.oracle_id AND d.status = 'prospective' AND dc.board != 'maybe' " +
          `GROUP BY dc.deck_id HAVING SUM(dc.quantity) > MAX(0, ${FREE_SQL})))`
        )
      default:
        throw new Error(`unparsed is: value "${value}"`) // the parser rejects these
    }
  }

  function fieldSql(node: Extract<SearchNode, { kind: 'field' }>): string {
    const { key, op, value, span } = node
    if (scope !== 'library' && (LIBRARY_KEYS.has(key) || (key === 'is' && LIBRARY_IS.has(value)))) {
      const label = key === 'is' ? `is:${value}` : key === 'in' ? 'in:' : key
      throw new SearchQueryError(`${label} only works when searching My library`, span)
    }
    switch (key) {
      case 'oracle':
        return `(instr(lower(c.oracle_text), lower(replace(${param(value)}, '~', ${FIRST_FACE_NAME}))) > 0)`
      case 'type':
        return `(instr(lower(c.type_line), lower(${param(value)})) > 0)`
      case 'artist':
        return `(instr(lower(coalesce(c.artist, '')), lower(${param(value)})) > 0)`
      case 'flavor':
        return `(instr(lower(coalesce(c.flavor_text, '')), lower(${param(value)})) > 0)`
      case 'keyword':
        return `(EXISTS (SELECT 1 FROM json_each(c.keywords) WHERE lower(value) = lower(${param(value)})))`
      case 'color':
        return colorSql('c.colors', 'color', op, value)
      case 'identity':
        return colorSql('c.color_identity', 'identity', op, value)
      case 'mana': {
        if (op === '=') return `(c.mana_cost = ${param(value)})`
        const counts = new Map<string, number>()
        for (const symbol of value.match(/\{[^}]+\}/g) ?? []) counts.set(symbol, (counts.get(symbol) ?? 0) + 1)
        const parts = [...counts].map(([symbol, n]) => {
          const p = param(symbol)
          return `length(c.mana_cost) - length(replace(c.mana_cost, ${p}, '')) >= ${n} * length(${p})`
        })
        return `(${parts.join(' AND ')})`
      }
      case 'mv':
        return `(c.cmc ${sqlOp(op)} ${param(Number(value))})`
      case 'power':
        return `(c.power_num ${sqlOp(op)} ${param(Number(value))})`
      case 'toughness':
        return `(c.toughness_num ${sqlOp(op)} ${param(Number(value))})`
      case 'loyalty':
        return `(c.loyalty_num ${sqlOp(op)} ${param(Number(value))})`
      case 'usd':
        return `(CAST(json_extract(c.prices, '$.usd') AS REAL) ${sqlOp(op)} ${param(Number(value))})`
      case 'rarity':
        return `(${rarityRankSql('c.rarity')} ${sqlOp(op)} ${param(RARITIES.indexOf(value as (typeof RARITIES)[number]))})`
      case 'set':
        return `(c.set_code = ${param(value)})`
      case 'format':
        return `(json_extract(c.legalities, ${param(`$.${value}`)}) IN ('legal', 'restricted'))`
      case 'banned':
        return `(json_extract(c.legalities, ${param(`$.${value}`)}) = 'banned')`
      case 'restricted':
        return `(json_extract(c.legalities, ${param(`$.${value}`)}) = 'restricted')`
      case 'is':
        return isSql(value)
      case 'in':
        return inDeckSql(value)
      case 'free':
        ownership = true
        return `(${FREE_SQL} ${sqlOp(op)} ${param(Number(value))})`
      case 'qty':
        ownership = true
        return `(${OWNED_SQL} ${sqlOp(op)} ${param(Number(value))})`
    }
  }

  function compile(node: SearchNode): string {
    switch (node.kind) {
      case 'and':
        return node.children.length === 0 ? '(1)' : `(${node.children.map(compile).join(' AND ')})`
      case 'or':
        return `(${node.children.map(compile).join(' OR ')})`
      case 'not':
        // COALESCE: a NULL comparison (e.g. power on a non-creature) counts as "doesn't match", so -pow>3 keeps it.
        return `(NOT COALESCE(${compile(node.child)}, 0))`
      case 'name': {
        const v = normalizeName(node.value)
        if (v === '') return '(0)' // no letters or digits: no card name can match
        const p = param(v)
        return node.exact ? `(c.search_name = ${p} OR faces_include(c.face_names, ${p}))` : `(instr(c.search_name, ${p}) > 0)`
      }
      case 'field':
        return fieldSql(node)
    }
  }

  const sql = compile(ast) // sets `ownership` as it goes
  return { sql, params, ownership }
}
