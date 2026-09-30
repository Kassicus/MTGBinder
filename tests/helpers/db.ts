import { scryfallToRow, shouldImport, shouldImportToken, tokenParts, type CardRow } from '../../src/server/cards/map.ts'
import { insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import { createTokenStaging, dropTokenStaging, insertTokenLinks, replaceTokens } from '../../src/server/cards/tokens.ts'
import { openDb, type DB } from '../../src/server/db/index.ts'
import { loadFixtureCards, loadTokenFixtures } from './fixtures.ts'

export function fixtureRows(): CardRow[] {
  return loadFixtureCards()
    .map((card) => scryfallToRow(card))
    .filter((row): row is CardRow => row !== null)
}

/** In-memory database with all 61 fixture printings and the name index built. */
export function createTestDb(): DB {
  const db = openDb(':memory:')
  insertCardRows(db, 'cards', fixtureRows())
  rebuildCardNames(db)
  return db
}

/**
 * Fills `tokens` and `card_tokens` from the token fixture, the way an import does: the fixture cards' tokens (Treasure,
 * Beast, Insect, Human Cleric), Elspeth's emblem, Witch's Mark's Role, and Incubator // Phyrexian.
 */
export function addTokens(db: DB): void {
  const lines = [...loadFixtureCards(), ...loadTokenFixtures()]
  createTokenStaging(db)
  insertCardRows(db, 'tokens_staging', lines.filter(shouldImportToken).map((c) => scryfallToRow(c)!))
  insertTokenLinks(db, lines.filter(shouldImport).flatMap((c) => tokenParts(c).map((t) => [c.oracle_id!, t] as const)))
  db.transaction(() => replaceTokens(db))()
  dropTokenStaging(db)
}

export function count(db: DB, table: string): number {
  return db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number
}

/** True when the table exists in the main schema or in this connection's temp schema. */
export function tableExists(db: DB, name: string): boolean {
  return (
    db
      .prepare('SELECT 1 FROM sqlite_master WHERE name = @name UNION ALL SELECT 1 FROM sqlite_temp_master WHERE name = @name')
      .get({ name }) !== undefined
  )
}
