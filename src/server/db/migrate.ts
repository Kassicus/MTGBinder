import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupBeforeUpgrade } from '../backup.ts'
import type { DB } from './index.ts'

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url))

export interface MigrateOptions {
  /**
   * Where to save a copy of an existing database before upgrading it (backupBeforeUpgrade). Without one (tests,
   * in-memory databases) no copy is made.
   */
  backupDir?: string
  /** Told that the copy is starting: it takes several seconds on a large library. */
  onBackupStart?: () => void
  /** Told where that copy was saved. */
  onBackup?: (file: string) => void
  /** The folder of `NNN_name.sql` files; Binder's own migrations by default. */
  migrationsDir?: string
  /** Dates the copy's name. */
  now?: Date
}

/** The copy before an upgrade failed, so the database was not changed (the reason is the `cause`). */
export class UpgradeBackupError extends Error {
  constructor(reason: unknown) {
    const detail = reason instanceof Error ? reason.message : String(reason)
    super(`Couldn't back up the database before upgrading it, so it was not changed: ${detail}`, { cause: reason })
    this.name = 'UpgradeBackupError'
  }
}

/**
 * Applies every `NNN_name.sql` file in migrations/ that hasn't run yet, each in its own transaction. Before upgrading
 * a database that already has migrations applied, it saves a copy to `backupDir`. If that copy fails, it throws
 * UpgradeBackupError without changing the database: Binder refuses to start rather than upgrade a library it couldn't
 * back up. A new, empty database is migrated without a copy.
 */
export function migrate(db: DB, options: MigrateOptions = {}): void {
  const dir = options.migrationsDir ?? MIGRATIONS_DIR
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  )
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all() as number[])
  const pending = fs
    .readdirSync(dir)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file) && !applied.has(Number(file.slice(0, 3))))
    .sort()
  const [first] = pending
  if (first !== undefined && applied.size > 0 && options.backupDir !== undefined) {
    options.onBackupStart?.()
    let copy: string
    try {
      copy = backupBeforeUpgrade(db, options.backupDir, first.slice(0, 3), options.now)
    } catch (err) {
      throw new UpgradeBackupError(err)
    }
    options.onBackup?.(copy)
  }
  for (const file of pending) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        Number(file.slice(0, 3)),
        file,
        new Date().toISOString(),
      )
    })()
  }
}
