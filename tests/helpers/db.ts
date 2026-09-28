import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import { openDb, type DB } from '../../src/server/db/index.ts'
import { loadFixtureCards } from './fixtures.ts'

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
