import type { DB } from '../db/index.ts'
import type { CardRow } from './map.ts'

/** One row of `tokens` (spec §4.1): a token or emblem, from its newest paper printing. JSON columns are strings. */
export interface TokenRow {
  oracle_id: string
  name: string
  /** token, double_faced_token, emblem, or the layout of a token printed another way (a Role's flip card). */
  layout: string
  type_line: string
  oracle_text: string
  power: string | null
  toughness: string | null
  colors: string
  image_small: string | null
  image_normal: string | null
  /** StoredFace[] as JSON (map.ts), or null for a one-faced token. */
  card_faces: string | null
}

/**
 * `tokens` columns in table order. The typecheck ties each one to a TokenRow key and a CardRow column (they're copied
 * from `tokens_staging`, a copy of `cards`), and a test checks the table's column order.
 */
export const TOKEN_COLUMNS = [
  'oracle_id', 'name', 'layout', 'type_line', 'oracle_text', 'power', 'toughness', 'colors', 'image_small',
  'image_normal', 'card_faces',
] as const satisfies readonly (keyof TokenRow & keyof CardRow)[]

/** Which printing of a token `tokens` keeps (best first): not dated in the future, in English, newest. */
const TOKEN_PRINTING_ORDER = `released_at > date('now') ASC, lang <> 'en' ASC, released_at DESC, id ASC`

/**
 * Creates the import's staging tables (TEMP, private to this connection): `tokens_staging` holds every token printing
 * as a `cards` row, and `card_tokens_staging` each card's link to a token printing, by the card's oracle id.
 */
export function createTokenStaging(db: DB): void {
  dropTokenStaging(db)
  db.exec(`CREATE TEMP TABLE tokens_staging AS SELECT * FROM main.cards WHERE 0;
           CREATE TEMP TABLE card_tokens_staging (oracle_id TEXT NOT NULL, token_id TEXT NOT NULL)`)
}

export function dropTokenStaging(db: DB): void {
  db.exec('DROP TABLE IF EXISTS temp.tokens_staging; DROP TABLE IF EXISTS temp.card_tokens_staging')
}

/** Stages links from cards (by oracle id) to the token printings they make. */
export function insertTokenLinks(db: DB, links: ReadonlyArray<readonly [oracleId: string, tokenId: string]>): void {
  const stmt = db.prepare('INSERT INTO card_tokens_staging (oracle_id, token_id) VALUES (?, ?)')
  db.transaction(() => {
    for (const [oracleId, tokenId] of links) stmt.run(oracleId, tokenId)
  })()
}

/**
 * Replaces `tokens` and `card_tokens` with the staged ones (spec §4.2), inside the import's merge transaction: one row
 * per token from its best printing (TOKEN_PRINTING_ORDER), and each card's links by token identity. A link to a
 * printing that isn't in the data (digital-only, or another language) is dropped.
 */
export function replaceTokens(db: DB): void {
  const columns = TOKEN_COLUMNS.join(', ')
  db.exec('DELETE FROM card_tokens; DELETE FROM tokens')
  db.exec(`INSERT INTO tokens (${columns})
           SELECT ${columns} FROM (
             SELECT *, ROW_NUMBER() OVER (PARTITION BY oracle_id ORDER BY ${TOKEN_PRINTING_ORDER}) AS pick
             FROM tokens_staging
           ) WHERE pick = 1`)
  db.exec(`INSERT OR IGNORE INTO card_tokens (oracle_id, token_oracle_id)
           SELECT l.oracle_id, t.oracle_id FROM card_tokens_staging l JOIN tokens_staging t ON t.id = l.token_id`)
}

/**
 * The tokens each of these cards makes, by the card's oracle id, each card's in name order. Scryfall's Copy stand-in
 * (a blank token that hundreds of cards list) is left out: a copy is made from the permanent copied (Copy, spec §5.9.8).
 */
export function tokensMadeBy(db: DB, oracleIds: readonly string[]): Map<string, TokenRow[]> {
  const made = new Map<string, TokenRow[]>()
  if (oracleIds.length === 0) return made
  const rows = db
    .prepare(
      `SELECT ct.oracle_id AS maker, t.* FROM card_tokens ct JOIN tokens t ON t.oracle_id = ct.token_oracle_id
       WHERE ct.oracle_id IN (SELECT value FROM json_each(?)) AND NOT (t.name = 'Copy' AND t.type_line = 'Token')
       ORDER BY t.name COLLATE NOCASE, t.type_line, t.oracle_id`,
    )
    .all(JSON.stringify(oracleIds)) as Array<TokenRow & { maker: string }>
  for (const { maker, ...token } of rows) {
    const list = made.get(maker)
    if (list) list.push(token)
    else made.set(maker, [token])
  }
  return made
}

/**
 * Tokens and emblems whose name holds the query, ignoring case (spec §5.9.8): the whole name first, then names that
 * start with it, then the rest, each in name order. At most `limit`; none for a blank query.
 */
export function searchTokens(db: DB, query: string, limit = 50): TokenRow[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  return db
    .prepare(
      `SELECT * FROM tokens WHERE instr(lower(name), @q) > 0
       ORDER BY lower(name) = @q DESC, instr(lower(name), @q) = 1 DESC, name COLLATE NOCASE, type_line, oracle_id
       LIMIT @limit`,
    )
    .all({ q, limit }) as TokenRow[]
}
