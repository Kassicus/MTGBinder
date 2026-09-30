import type { DB } from '../db/index.ts'

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

/** `tokens` columns in table order. A test asserts this matches TokenRow's keys exactly. */
export const TOKEN_COLUMNS = [
  'oracle_id', 'name', 'layout', 'type_line', 'oracle_text', 'power', 'toughness', 'colors', 'image_small',
  'image_normal', 'card_faces',
] as const satisfies readonly (keyof TokenRow)[]

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
