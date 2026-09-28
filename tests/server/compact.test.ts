import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { autocomplete, insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import { compactLibrary, librarySize } from '../../src/server/compact.ts'
import { openDb, type DB } from '../../src/server/db/index.ts'
import type { ApiErrorBody, LibrarySize } from '../../src/shared/types.ts'
import { body, makeApp } from '../helpers/app.ts'
import { fixtureRows } from '../helpers/db.ts'

let tmp: string
let db: DB
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-compact-'))
  db = openDb(path.join(tmp, 'binder.db'))
  insertCardRows(db, 'cards', fixtureRows())
  rebuildCardNames(db)
  // About 8 MB of free space, as an old card data import left.
  db.exec('CREATE TABLE junk (b BLOB)')
  const insert = db.prepare('INSERT INTO junk VALUES (zeroblob(4096))')
  db.transaction(() => {
    for (let i = 0; i < 2000; i++) insert.run()
  })()
  db.exec('DROP TABLE junk')
})
afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const backups = () => path.join(tmp, 'backups')
const ftsIntact = () => {
  // FTS5's own check that the index matches the card names it is built from; it throws when they differ.
  db.prepare(`INSERT INTO card_names_fts (card_names_fts, rank) VALUES ('integrity-check', 1)`).run()
  return true
}

describe('compacting the library', () => {
  it('says how much of the file is free space', () => {
    const size = librarySize(db)
    expect(size.freeBytes).toBeGreaterThan(7_000_000)
    expect(size.bytes).toBeGreaterThan(size.freeBytes)
  })

  it('backs up first, gives back the free space, and keeps card-name search working', () => {
    const { before, after, backup } = compactLibrary(db, backups(), new Date(2026, 8, 28, 9))
    expect(backup).toBe(path.join(backups(), 'binder-2026-09-28.db'))
    expect(fs.existsSync(backup)).toBe(true)
    expect(after.freeBytes).toBeLessThan(64 * 1024) // rebuilding the index can leave a page or two
    expect(after.bytes).toBeLessThan(before.bytes - 7_000_000)
    expect(after.logBytes).toBe(0)
    expect(ftsIntact()).toBe(true)
    expect(autocomplete(db, 'lightning b').map((c) => c.name)).toContain('Lightning Bolt')
  })
})

describe('the library routes', () => {
  it('report the size, compact after a backup, and say why compacting failed', async () => {
    const app = makeApp({ db, backupDir: backups() })
    const size = await body<LibrarySize>(await app.request('/api/settings/library'))
    expect(size.freeBytes).toBeGreaterThan(7_000_000)
    const res = await app.request('/api/settings/library/compact', { method: 'POST' })
    expect(res.status).toBe(200)
    const done = await body<{ before: LibrarySize; after: LibrarySize; backup: string }>(res)
    expect(done.after.freeBytes).toBeLessThan(64 * 1024)
    expect(done.backup).toMatch(/^binder-\d{4}-\d{2}-\d{2}\.db$/)
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device')
    })
    onTestFinished(() => rename.mockRestore())
    const failed = await app.request('/api/settings/library/compact', { method: 'POST' })
    expect(failed.status).toBe(500)
    // The reason as it is, then what to do next.
    expect((await body<ApiErrorBody>(failed)).error).toEqual({
      code: 'compact_failed',
      message: "Couldn't compact the library: ENOSPC: no space left on device. Free up disk space and try again; the library is unchanged.",
    })
    expect((await makeApp({ db }).request('/api/settings/library/compact', { method: 'POST' })).status).toBe(404)
  })
})
