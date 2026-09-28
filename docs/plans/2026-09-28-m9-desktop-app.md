# Binder.app (M9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Binder becomes a Mac app, Binder.app: its own window and a menu-bar icon, its server in the background, the
library in `~/Library/Application Support/Binder`, built and installed by `pnpm app`, with a one-time
`pnpm move-library` from the project's `data/`. `pnpm start` keeps working from the terminal.

**Architecture:** The server's startup moves out of `src/server/main.ts` into `startBinder()` (`src/server/start.ts`),
a start/stop function with one-line `StartupError`s, which `main.ts` (the terminal) and Binder.app both call. Binder.app
is an Electron 44 shell (`electron/`): the main process owns the window, the menu-bar icon, and the lifecycle, and runs
`startBinder` in Electron's utility process (`electron/server.ts`), so slow SQLite work never freezes the window.
electron-builder packages the project's files as they are (Electron's Node 24 runs Binder's TypeScript directly) with
the OCR helper built in; `scripts/app.ts` builds it and installs it in `/Applications`.

**Tech Stack:** Electron 44.4.5 (Node 24.21, Chromium 152), electron-builder 26.15.3, and Binder's Node 24 + Hono +
better-sqlite3 + React stack; Swift (the icons).

**Spec:** `docs/specs/2026-09-26-binder-design.md` (Task 5 adds §3.4 Binder.app from the design below).

## Design (the owner approved it in chat on 2026-09-28)

- **The app:** Binder.app in Applications, in the Dock with its own icon. Its window shows Binder's usual pages. A
  menu-bar icon has **Open Binder** and **Quit Binder**. Closing the window keeps Binder running (scans finish, card
  data refreshes); the Dock or menu-bar icon opens it again; Cmd+Q quits everything. Not opened at login. One copy at
  a time (opening it again brings the window forward). Web links open in the browser. While a database upgrade saves
  its backup, the window says so. Problems (a port in use, a library that won't open) are a one-line dialog. The first
  time Scan opens, macOS asks for the camera; the app declares Continuity Camera so the iPhone is listed.
- **Where things live** (the owner's choice): the library in `~/Library/Application Support/Binder/` (database,
  backups, card data, scans, the API key file). It moves there once, by `pnpm move-library`, run with the owner's OK
  after this plan (see the last section); `data/` is left as it was. The API key is typed into Settings again: `.env` is
  never read, copied, or moved.
- **Building:** `pnpm app` builds Binder.app and puts it in Applications (refusing while it runs). The icon (a 9-pocket
  binder page in stone and amber) is drawn by a script. Not signed with an Apple developer account (not needed for an
  app built on this Mac); no auto-update; no Windows or Linux.
- **Testing:** unit tests for the start/stop function, the app's paths, links, and messages, the installer, and the
  move; an end-to-end check of the packaged app on a copy of the library with Chromium's fake camera; the owner checks
  Continuity Camera and a first scan. (The owner checked Continuity Camera in the prototype's packaged app on
  2026-09-28: the iPhone was listed and its picture showed.)

## Global Constraints

- The project is a git repository, pushed to a **public** GitHub repo. The work happens in a git worktree on the
  branch the controller made (it has no `data/` and no `.env`); commit per task with the commands given. Never commit
  `.env`, `data/`, `build/`, `release/`, `dist/`, or `bin/`.
- **Never write to the project's `data/`** (`/Users/kasonsuchow/Documents/localdev/binder/data`): it holds the owner's
  real library until the move after this plan. The only allowed touch is a read-only copy, by its absolute path (a
  worktree has no `data/`):
  `sqlite3 -readonly /Users/kasonsuchow/Documents/localdev/binder/data/binder.db ".backup /tmp/<dir>/binder.db"`.
- **Never read, print, copy, move, or change `.env`**: it holds the owner's real Anthropic API key. Never run
  `pnpm start`, `pnpm dev`, `pnpm app:dev`, `node src/server/main.ts`, or Binder.app on `data/` from the project; runs
  use `BINDER_DATA_DIR` on a `/tmp` library (whose `.env` doesn't exist) and `PORT=4455`.
- **Never write `~/Library/Application Support/Binder` or `/Applications/Binder.app`** during the tasks: installing and
  moving the library are the owner's step after the plan. `pnpm app` runs as `pnpm app --no-install` here.
- Ports: 4455 for Binder, 9444 for the debugging port. Never 4321 or 5173 (the owner's). Check nothing listens on
  4455 and 9444 before starting anything, and that nothing is left afterwards.
- No real Anthropic calls, and scanning never calls Anthropic.
- Clean up: quit what you launch (Binder.app, Electron), remove `/tmp` folders you make, and leave
  `find $TMPDIR -maxdepth 1 -name 'binder-*' | wc -l` at 0 (zsh globs fail silently; use `find`).
- Node 24 runs the TypeScript directly: explicit `.ts` import extensions, erasable syntax only (no enums, namespaces,
  or parameter properties).
- Electron's entry file (`electron/main.ts`) must not `await app.whenReady()` at the top level: an ES module entry
  that does never gets there (found while prototyping).
- Messages say what happened and what to do next, in one line; comments say why.
- Code blocks are replay-verified: applying this plan's steps in order to the M8 code reproduces the tested prototype
  file for file (apart from `pnpm-lock.yaml`, whose indirect packages pnpm may resolve differently), and every command
  gives the output shown. Apply blocks verbatim; if a "Replace" block doesn't match exactly once, stop and say so.

## Review Focus

1. Binder.app opened while `pnpm start` holds port 4321: a dialog says the port is in use because Binder may already
   be running from the terminal, and Binder quits (Task 1's `port_in_use` test, Task 2's `startupFailure` test).
2. Quitting while card data is still downloading: the server stops at once and leaves the library to open again
   (Task 1: "stops at once while card data is still downloading").
3. `pnpm app` while Binder.app is open: it refuses rather than replace the app under itself (Task 3's `appRunning`
   test).
4. Moving a library whose latest changes are still in its write-ahead log, or into a folder Binder.app already made
   before the move: a whole copy, and an untouched library replaced, a used one never (Task 4's move tests).
5. A library from an older Binder: the window says it's backing up before the upgrade (Task 1's upgrade test, which
   builds the library from every migration but the newest, so it keeps working as migrations are added).

## Decisions made while prototyping (flagged for review)

1. The server runs in Electron's **utility process**, not the main process: SQLite is synchronous, and a backup before
   an upgrade, compacting, or a card-data refresh would otherwise freeze the window and the menu-bar icon.
2. **No bundling:** Electron 44's Node 24.21 runs Binder's TypeScript as Node 24 does, in the main and the utility
   process alike, so the packaged app carries the source (`"asar": false`, as the loader reads `.ts` from real files).
3. **better-sqlite3 needs no Electron build:** version 13 is built on Node-API, so the one build loads in Node (modules
   137) and Electron (modules 149) alike (`"npmRebuild": false`).
4. **The library folder also holds the app's own files:** Chromium's in `Electron/` (`app.setPath('userData')`) and the
   server's log in `Logs/`. `pnpm move-library` copies only `binder.db`, `backups/`, `bulk/`, and `scans/`.
5. **`BINDER_DATA_DIR` and `PORT` override the app's paths**, for checks, with the terminal's names. `PORT` is checked
   with the terminal's own `portProblem` line.
6. **Ad-hoc signing** (`"identity": "-"`, hardened runtime off): an app built on this Mac opens without Gatekeeper's
   warning and runs on Apple silicon. Its signature changes with each build, so macOS may ask for the camera again
   after an update; a local signing certificate would fix that (a follow-up).
7. **React, React Router, and TanStack Query move to devDependencies:** runtime dependencies are what Binder.app ships
   (the server's five packages and theirs, 55 MB); the SPA's are built into `dist/web`. Binder.app is about 344 MB,
   mostly Electron's framework.
8. **The icons are drawn at build time** by `scripts/make-icons.swift` into `build/icons/` (gitignored), not committed
   images: the app icon (`Binder.icns`) and the menu-bar template icon at 1x and 2x.
9. **`pnpm move-library` replaces a library nothing was ever added to** (Binder.app opened before the move makes one,
   with card data and a first backup), and refuses anything else.
10. **Chromium's fake camera needs no macOS permission**, so the app doesn't ask for one when it's in use (the
    end-to-end check); otherwise it asks once, through `systemPreferences.askForMediaAccess`.
11. **`pnpm start` prints one line when Binder.app keeps its own library**, so the terminal's `data/` isn't taken for
    it after the move.
12. **The end-to-end check lives in `/tmp`**, as in M7 and M8 (it needs a copy of the owner's library and card images
    from Scryfall). M8's CDP driver attached to a new tab; Electron's debugging port can't open one, so the M9 driver
    attaches to the app's own window.

## File structure

- `src/server/start.ts` (new): `startBinder()`, `StartupError`: the server's startup and shutdown, for both entries.
- `src/server/main.ts`: the terminal's entry, now a few lines around `startBinder()`.
- `src/server/config.ts`: `libraryPaths()`, and `APP_LIBRARY_DIR` (Binder.app's library).
- `src/server/startup.ts`: `appLibraryNote()`, beside the startup lines it already has.
- `electron/paths.ts`, `electron/links.ts`, `electron/messages.ts` (new): the app's pure logic (unit-tested).
- `electron/server.ts` (new): the utility process running `startBinder()`.
- `electron/main.ts` (new): the window, the menu-bar icon, the menus, camera permission, and the lifecycle.
- `scripts/make-icons.swift` (new): draws the icons. `scripts/app.ts` and `scripts/lib/install.ts` (new): `pnpm app`.
  `scripts/move-library.ts` and `scripts/lib/move.ts` (new): `pnpm move-library`.
- `package.json`: Electron and electron-builder, the packaging config, the new scripts. `tsconfig.json`: `electron/`.
- Tests: `tests/server/start.test.ts`, `tests/electron/desktop.test.ts`, `tests/scripts/install.test.ts`,
  `tests/scripts/move-library.test.ts` (new), `tests/server/startup.test.ts`.

The suite has 916 tests before Task 1; each task's checkpoint gives the new count.

---

### Task 1: Binder's server as a start/stop function

**Files:**
- Create: `src/server/start.ts`, `tests/server/start.test.ts`
- Modify: `src/server/config.ts` (whole file), `src/server/main.ts` (whole file)

**Interfaces:**
- Consumes: `openDb`, `openFailureLine` (`src/server/db/index.ts`), `createApp`, `listenFailure`, and the parts
  `main.ts` builds today (`createBulkImporter`, `createOcrClient`, `buildOcrHelper`, `createScanWorker`, …).
- Produces:
  - `libraryPaths(dataDir: string): { dbPath: string; backupDir: string; scansDir: string }` (`config.ts`)
  - `interface BinderOptions { dataDir: string; envPath: string; webDistDir?: string; ocrBinary: string;
    ocrSource?: string; port: number; host?: string; log?: (line: string) => void; onUpgradeBackup?: () => void;
    scryfall?: ScryfallClient }`
  - `interface RunningBinder { url: string; port: number; stop(): Promise<void> }`
  - `type StartupErrorCode = 'port_in_use' | 'port_denied' | 'listen' | 'library'`;
    `class StartupError extends Error { readonly code: StartupErrorCode }`
  - `startBinder(options: BinderOptions): Promise<RunningBinder>` (`start.ts`): logs `Binder running at <url>` once it
    listens; rejects with a `StartupError` (the library closed) when the library can't be opened or the port can't be
    listened on.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/start.test.ts`:

```ts
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, onTestFinished } from 'vitest'
import { migrate } from '../../src/server/db/migrate.ts'
import { type BinderOptions, startBinder, StartupError } from '../../src/server/start.ts'
import { stubScryfall } from '../helpers/app.ts'

/** A throwaway library folder with a built web app in it; removed when the test ends. */
function library(): Pick<BinderOptions, 'dataDir' | 'envPath' | 'webDistDir' | 'ocrBinary' | 'scryfall' | 'log'> & { lines: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-start-'))
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }))
  const web = path.join(dir, 'web')
  fs.mkdirSync(web)
  fs.writeFileSync(path.join(web, 'index.html'), '<title>Binder</title>')
  const lines: string[] = []
  return {
    dataDir: path.join(dir, 'library'),
    envPath: path.join(dir, 'library', '.env'),
    webDistDir: web,
    ocrBinary: path.join(dir, 'no-ocr-helper'),
    // Card data is never imported in these tests: the refresh a new library starts fails without reaching Scryfall.
    scryfall: stubScryfall(),
    log: (line) => lines.push(line),
    lines,
  }
}

/** A port nothing listens on, from the system. */
async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as net.AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

describe('startBinder (spec §6)', () => {
  it('opens the library, serves the API and the web app on the port it was given, and stops', async () => {
    const options = library()
    const port = await freePort()
    const binder = await startBinder({ ...options, port })
    expect(binder.url).toBe(`http://localhost:${port}`)
    expect(await (await fetch(`${binder.url}/api/health`)).json()).toEqual({ ok: true })
    expect(await (await fetch(`${binder.url}/decks`)).text()).toBe('<title>Binder</title>')
    expect(fs.existsSync(path.join(options.dataDir, 'binder.db'))).toBe(true)
    // A new library gets its first daily backup, said in one line.
    expect(options.lines.some((l) => l.startsWith('[backup] Saved '))).toBe(true)
    await binder.stop()
    await expect(fetch(`${binder.url}/api/health`)).rejects.toThrow()
    // Stopped for good: the library can be opened and started again.
    const again = await startBinder({ ...options, port })
    await again.stop()
  })

  it('says in one line when the port is taken, and leaves the library closed', async () => {
    const options = library()
    const taken = net.createServer()
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve))
    onTestFinished(() => new Promise<void>((resolve) => taken.close(() => resolve())))
    const { port } = taken.address() as net.AddressInfo
    const failure = await startBinder({ ...options, port }).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(StartupError)
    expect(failure).toMatchObject({
      code: 'port_in_use',
      message: `Port ${port} is already in use: Binder may already be running. Stop it, or start this one with PORT set to another port.`,
    })
    // Nothing kept the library open: another Binder starts on it.
    const binder = await startBinder({ ...options, port: await freePort() })
    await binder.stop()
  })

  it("says in one line when the library can't be opened", async () => {
    const options = library()
    fs.mkdirSync(options.dataDir, { recursive: true })
    fs.writeFileSync(path.join(options.dataDir, 'binder.db'), 'this is not a database')
    const failure = await startBinder({ ...options, port: await freePort() }).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(StartupError)
    expect(failure).toMatchObject({ code: 'library', message: '[database] file is not a database' })
  })

  it('stops at once while card data is still downloading, leaving the library to open again', async () => {
    const options = library()
    let downloading!: () => void
    const started = new Promise<void>((resolve) => (downloading = resolve))
    // Scryfall answers with its card data's address, then the download never finishes.
    const scryfall = stubScryfall({
      getJson: async () => ({ type: 'default_cards', updated_at: '2026-09-28T00:00:00.000Z', jsonl_download_uri: 'https://example.invalid/cards.jsonl' }),
      download: () => {
        downloading()
        return new Promise<Response>(() => {})
      },
    })
    const port = await freePort()
    const binder = await startBinder({ ...options, scryfall, port })
    await started
    const stopping = Date.now()
    await binder.stop()
    expect(Date.now() - stopping).toBeLessThan(2000)
    const again = await startBinder({ ...options, port })
    await again.stop()
  })

  it('says when it backs up the library before a migration upgrades it', async () => {
    const options = library()
    // A library from the version before this one: every migration but the newest.
    const migrations = path.resolve('src/server/db/migrations')
    const all = fs.readdirSync(migrations).filter((file) => /^\d{3}_.+\.sql$/.test(file)).sort()
    const older = path.join(path.dirname(options.dataDir), 'older-migrations')
    fs.mkdirSync(older)
    for (const file of all.slice(0, -1)) fs.copyFileSync(path.join(migrations, file), path.join(older, file))
    fs.mkdirSync(options.dataDir)
    const db = new Database(path.join(options.dataDir, 'binder.db'))
    migrate(db, { migrationsDir: older })
    db.close()
    let upgrading = 0
    const binder = await startBinder({ ...options, port: await freePort(), onUpgradeBackup: () => upgrading++ })
    await binder.stop()
    expect(upgrading).toBe(1)
    expect(options.lines).toContain('[backup] Backing up the database before upgrading it…')
    const newest = all.at(-1)!.slice(0, 3)
    expect(fs.readdirSync(path.join(options.dataDir, 'backups')).some((file) => file.endsWith(`-before-${newest}.db`))).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/server/start.test.ts`

Expected: FAIL, with `Error: Cannot find module '../../src/server/start.ts'` (no tests ran).

- [ ] **Step 3: Give the library's paths one home**

Replace `src/server/config.ts`:

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where a library keeps its database and files: `binder.db`, with `backups/` and `scans/` beside it. */
export function libraryPaths(dataDir: string) {
  return {
    dbPath: path.join(dataDir, 'binder.db'),
    backupDir: path.join(dataDir, 'backups'),
    /** Captured card photos waiting in the scan queue (spec §5.1.2). */
    scansDir: path.join(dataDir, 'scans'),
  }
}

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DATA_DIR = process.env.BINDER_DATA_DIR
  ? path.resolve(process.env.BINDER_DATA_DIR)
  : path.join(ROOT_DIR, 'data')
export const { dbPath: DB_PATH, backupDir: BACKUP_DIR, scansDir: SCANS_DIR } = libraryPaths(DATA_DIR)
export const WEB_DIST_DIR = path.join(ROOT_DIR, 'dist', 'web')
export const HOST = '127.0.0.1'
export const PORT = Number(process.env.PORT ?? 4321)
/** The OCR helper's Swift source and the binary built from it (spec §5.1.4). */
export const OCR_SOURCE = path.join(ROOT_DIR, 'native', 'ocr.swift')
export const OCR_BINARY = path.join(ROOT_DIR, 'bin', 'ocr')
/** Where `pnpm ocr:bench` keeps the card images it downloads (spec §5.1.6). */
export const BENCH_DIR = path.join(DATA_DIR, 'bench')
/** Holds ANTHROPIC_API_KEY, written by the Settings page (spec §3.1). */
export const ENV_PATH = path.join(ROOT_DIR, '.env')
```

- [ ] **Step 4: Write `startBinder`**

Create `src/server/start.ts`:

```ts
import fs from 'node:fs'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import { createAiClient } from './ai/client.ts'
import { createKeyStore } from './ai/key-store.ts'
import { createApp } from './app.ts'
import { backupIfDue } from './backup.ts'
import { createBulkImporter } from './bulk/import.ts'
import { ensureCardNamesCurrent } from './cards/repo.ts'
import { libraryPaths } from './config.ts'
import { type DB, openDb, openFailureLine } from './db/index.ts'
import { createCardLookups } from './scanner/lookups.ts'
import { buildOcrHelper, createOcrClient } from './scanner/ocr-client.ts'
import { createScanWorker } from './scanner/worker.ts'
import { createScryfallClient, type ScryfallClient } from './scryfall/client.ts'
import { listenFailure } from './startup.ts'

/** Where a Binder keeps its library and finds its parts, and where it listens (spec §6). */
export interface BinderOptions {
  /** The library folder: `binder.db`, with `backups/`, `bulk/`, and `scans/` beside it. */
  dataDir: string
  /** The file that keeps the Anthropic API key, which Settings writes. */
  envPath: string
  /** The built web app, served for every path outside /api. Without it (or when it isn't built), only the API. */
  webDistDir?: string
  /** The OCR helper (spec §5.1.4). */
  ocrBinary: string
  /** The helper's Swift source, to build it from when it's missing or older. Binder.app ships it built, with none. */
  ocrSource?: string
  /** 0 picks a free port. */
  port: number
  /** Default 127.0.0.1. */
  host?: string
  /** Progress, one line at a time ("[backup] Saved …"). Default console.log. */
  log?: (line: string) => void
  /** Called before a migration upgrades the library, while its backup is being saved. */
  onUpgradeBackup?: () => void
  /** Scryfall; the real one by default. */
  scryfall?: ScryfallClient
}

export interface RunningBinder {
  /** The web app's address: `http://localhost:<port>`. */
  url: string
  port: number
  /** Stops listening, then closes the OCR helper and the library. */
  stop(): Promise<void>
}

export type StartupErrorCode = 'port_in_use' | 'port_denied' | 'listen' | 'library'

/** Why Binder couldn't start, in one line to show as it is (spec §6 Startup). The library is left closed. */
export class StartupError extends Error {
  readonly code: StartupErrorCode
  constructor(code: StartupErrorCode, message: string) {
    super(message)
    this.name = 'StartupError'
    this.code = code
  }
}

/**
 * Starts Binder: opens the library (copying it to `backups/` first when a migration upgrades it), makes the daily
 * backup when one is due, and serves the app. Once it listens, it refreshes stale card data in the background and
 * picks up scans a restart interrupted. Rejects with a StartupError when the library can't be opened or the port
 * can't be listened on.
 */
export async function startBinder(options: BinderOptions): Promise<RunningBinder> {
  const log = options.log ?? ((line: string) => console.log(line))
  const paths = libraryPaths(options.dataDir)
  let db: DB
  try {
    db = openDb(paths.dbPath, {
      backupDir: paths.backupDir,
      onBackupStart: () => {
        log('[backup] Backing up the database before upgrading it…')
        options.onUpgradeBackup?.()
      },
      onBackup: (copy) => log(`[backup] Saved ${copy} before upgrading the database`),
    })
  } catch (err) {
    throw new StartupError('library', openFailureLine(err))
  }
  if (ensureCardNamesCurrent(db)) log('[card data] Rebuilt the card name index for this version')
  try {
    const backup = backupIfDue(db, paths.backupDir)
    if (backup?.status === 'saved') log(`[backup] Saved ${backup.file}`)
    if (backup?.status === 'exists') log(`[backup] Today's backup already exists: ${backup.file}`)
  } catch (err) {
    // A failed backup must not stop the app; it's retried at the next start.
    log(`[backup] Failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  const scryfall = options.scryfall ?? createScryfallClient()
  const bulk = createBulkImporter({ db, client: scryfall, dataDir: options.dataDir, log: (m) => log(`[card data] ${m}`) })
  const { ocrSource } = options
  const ocr = createOcrClient({
    command: [options.ocrBinary],
    prepare: async () => {
      if (ocrSource && (await buildOcrHelper(ocrSource, options.ocrBinary))) log('[scan] Built the OCR helper')
    },
  })
  const worker = createScanWorker({ db, scansDir: paths.scansDir, ocr, lookups: createCardLookups(db) })
  const app = createApp({
    db,
    bulk,
    scryfall,
    ai: createAiClient(createKeyStore(options.envPath)),
    scanner: { scansDir: paths.scansDir, worker },
    backupDir: paths.backupDir,
    webDistDir: options.webDistDir && fs.existsSync(options.webDistDir) ? options.webDistDir : undefined,
  })
  let server: Server
  let port: number
  try {
    ;({ server, port } = await listen(app, options.port, options.host ?? '127.0.0.1'))
  } catch (err) {
    ocr.close()
    db.close()
    throw err
  }
  const url = `http://localhost:${port}`
  log(`Binder running at ${url}`)
  const stale = bulk.staleReason()
  if (stale) {
    log(`[card data] ${stale}; refreshing in the background`)
    // start() never rejects; the catch is a backstop so a bug there can't crash the server.
    bulk.start()?.catch((err: unknown) => log(`[card data] ${err instanceof Error ? err.message : String(err)}`))
  }
  // Only the Binder that owns the port picks up scans a restart interrupted: a second one, started while Binder runs,
  // would put the running one's scans back in the queue and then fail on the port.
  worker.recover()
  return {
    url,
    port,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
        // Connections a browser keeps open would hold close() back.
        server.closeAllConnections()
      })
      ocr.close()
      db.close()
    },
  }
}

/** Listens on the port, or rejects with the StartupError that says why it can't. */
function listen(app: Hono, port: number, hostname: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => resolve({ server, port: info.port })) as Server
    server.once('error', (err: NodeJS.ErrnoException) => {
      const code = err.code === 'EADDRINUSE' ? 'port_in_use' : err.code === 'EACCES' ? 'port_denied' : 'listen'
      reject(new StartupError(code, listenFailure(err, port)))
    })
  })
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run tests/server/start.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 6: The terminal's entry calls it**

Replace `src/server/main.ts`:

```ts
import { DATA_DIR, ENV_PATH, HOST, OCR_BINARY, OCR_SOURCE, PORT, WEB_DIST_DIR } from './config.ts'
import { startBinder, StartupError } from './start.ts'
import { portProblem } from './startup.ts'

// Binder from the terminal (`pnpm start`): the library in data/ (or BINDER_DATA_DIR), the key in the project's .env.

// A PORT that isn't a port number is said in one line, before anything else happens.
const badPort = portProblem(process.env.PORT)
if (badPort) {
  console.error(badPort)
  process.exit(1)
}

try {
  await startBinder({
    dataDir: DATA_DIR,
    envPath: ENV_PATH,
    webDistDir: WEB_DIST_DIR,
    ocrBinary: OCR_BINARY,
    ocrSource: OCR_SOURCE,
    port: PORT,
    host: HOST,
  })
} catch (err) {
  // A library that can't be opened, or a port in use, is said in one line, not as a stack trace.
  if (!(err instanceof StartupError)) throw err
  console.error(err.message)
  process.exit(1)
}
```

- [ ] **Step 7: Check the terminal still says what's wrong in one line**

These don't open a library or listen: the first stops at the `PORT` check. The second uses a throwaway library and a
port something else holds, so it stops at the port (after the new library's first daily backup).

Run: `PORT=abc node src/server/main.ts`

Expected: `PORT must be a port number from 1 to 65535, not "abc".`, exit status 1.

Run: `T=$(mktemp -d $TMPDIR/binder-cli-XXXX); node -e "require('net').createServer().listen(4455, '127.0.0.1')" & HOLD=$!; sleep 0.5; BINDER_DATA_DIR=$T PORT=4455 node src/server/main.ts; echo "exit $?"; kill $HOLD; rm -rf $T`

Expected: `[backup] Saved …/binder-YYYY-MM-DD.db`, then `Port 4455 is already in use: Binder may already be running. Stop it, or start this one with PORT set to another port.`, then `exit 1`. Nothing left listening on 4455, no `$TMPDIR/binder-*` left.

- [ ] **Step 8: Checkpoint**

Run: `pnpm typecheck && pnpm test`

Expected: typecheck clean; 921 tests pass.

- [ ] **Step 9: Commit**

Commit (never `.env`, `data/`, `build/`, or `release/`; `git status --short` shows nothing else of this task left):

```bash
git add src/server/config.ts src/server/main.ts src/server/start.ts tests/server/start.test.ts && git commit -q -F - <<'EOF'
M9 Task 1: Binder's server as a start/stop function

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9gnXZcph52ErfVjYZXZbf
EOF
```

---

### Task 2: Binder.app's Electron shell

**Files:**
- Create: `electron/paths.ts`, `electron/links.ts`, `electron/messages.ts`, `electron/server.ts`, `electron/main.ts`,
  `scripts/make-icons.swift`, `tests/electron/desktop.test.ts`
- Modify: `package.json` (whole file), `tsconfig.json`, `.gitignore`

**Interfaces:**
- Consumes: `startBinder`, `StartupError`, `BinderOptions` (Task 1); `portProblem` (`src/server/startup.ts`).
- Produces:
  - `APP_PORT = 4321`; `interface AppPaths { dataDir; envPath; electronDir; logDir; webDistDir; ocrBinary;
    ocrSource?; port }`; `appPaths(input: { appData: string; appRoot: string; packaged: boolean;
    env: NodeJS.ProcessEnv }): AppPaths` (`electron/paths.ts`; throws the `portProblem` line for a bad `PORT`)
  - `isAppUrl(url: string, appUrl: string): boolean`, `externalUrl(url: string): string | null`
    (`electron/links.ts`)
  - `startupFailure(error: { code: string; message: string }, port: number): string`,
    `startingPage(status: string): string` (a `data:` URL) (`electron/messages.ts`)
  - `type ServerMessage` (`electron/server.ts`): `{ type: 'log'; line } | { type: 'upgrading' } |
    { type: 'ready'; url } | { type: 'failed'; code; message }`; the app sends it `{ type: 'stop' }`.
  - `package.json` `"main": "electron/main.ts"`; scripts `icons` and `app:dev`; `build/icons/` (Binder.icns,
    icon.png, trayTemplate.png, trayTemplate@2x.png) from `pnpm icons`.

- [ ] **Step 1: Add Electron**

Electron's install step downloads its runtime (about 130 MB, into `~/Library/Caches/electron`), so it's allowed to run
its build script, as better-sqlite3 is.

Replace `package.json`:

```json
{
  "name": "binder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "electron/main.ts",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "concurrently -k -n server,web -c blue,magenta \"node --watch src/server/main.ts\" \"vite\"",
    "build": "vite build",
    "start": "vite build && node src/server/main.ts",
    "setup": "node scripts/setup.ts",
    "fixtures": "node scripts/fetch-fixtures.ts",
    "ocr:bench": "node scripts/ocr-benchmark.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p .",
    "icons": "swift scripts/make-icons.swift build/icons",
    "app:dev": "pnpm icons && vite build && electron ."
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "better-sqlite3",
      "electron",
      "esbuild"
    ]
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.128.0",
    "@hono/node-server": "2.1.1",
    "@tanstack/react-query": "5.104.0",
    "better-sqlite3": "13.0.3",
    "hono": "4.13.9",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "react-router": "8.4.0",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@types/better-sqlite3": "9.6.0",
    "@types/node": "26.6.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "concurrently": "10.0.5",
    "electron": "44.4.5",
    "tailwindcss": "4.3.3",
    "typescript": "7.0.2",
    "vite": "8.3.1",
    "vitest": "5.0.2"
  }
}
```

Run: `pnpm install`

Expected: it adds `electron 44.4.5`; `node_modules/electron/dist/Electron.app` exists afterwards.

`.gitignore` and `tsconfig.json` take in the icons' folder and `electron/`:

In `.gitignore`:

Replace:

```
# Dependencies and build output
node_modules/
dist/
bin/

# The library, its backups, card data, and scans: personal, and large. Never committed.
```

with:

```
# Dependencies and build output (build/: Binder.app's icons, which pnpm icons draws)
node_modules/
dist/
bin/
build/

# The library, its backups, card data, and scans: personal, and large. Never committed.
```

In `tsconfig.json`:

Replace:

```json
    "types": ["node", "vite/client"]
  },
  "include": ["src", "tests", "scripts", "vite.config.ts", "vitest.config.ts"]
}
```

with:

```json
    "types": ["node", "vite/client"]
  },
  "include": ["src", "electron", "tests", "scripts", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 2: Write the failing tests for the app's paths, links, and messages**

Create `tests/electron/desktop.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { externalUrl, isAppUrl } from '../../electron/links.ts'
import { startingPage, startupFailure } from '../../electron/messages.ts'
import { appPaths } from '../../electron/paths.ts'

describe('appPaths (spec §3.2)', () => {
  const appData = '/Users/me/Library/Application Support'
  const base = { appData, appRoot: '/Applications/Binder.app/Contents/Resources/app', packaged: true, env: {} }

  it('keeps the library in Application Support, with the key file in it and the window\'s own files apart', () => {
    expect(appPaths(base)).toEqual({
      dataDir: `${appData}/Binder`,
      envPath: `${appData}/Binder/.env`,
      electronDir: `${appData}/Binder/Electron`,
      logDir: `${appData}/Binder/Logs`,
      webDistDir: '/Applications/Binder.app/Contents/Resources/app/dist/web',
      ocrBinary: '/Applications/Binder.app/Contents/Resources/app/bin/ocr',
      port: 4321,
    })
  })

  it('uses the project\'s data/ when run from the project, building the OCR helper from its source there', () => {
    const paths = appPaths({ ...base, appRoot: '/dev/binder', packaged: false })
    expect(paths).toMatchObject({ dataDir: '/dev/binder/data', envPath: '/dev/binder/data/.env', ocrSource: '/dev/binder/native/ocr.swift' })
  })

  it('takes BINDER_DATA_DIR and PORT for checks, and says when PORT is not a port number', () => {
    expect(appPaths({ ...base, env: { BINDER_DATA_DIR: 'relative/lib', PORT: '4455' } })).toMatchObject({
      dataDir: path.resolve('relative/lib'),
      envPath: path.join(path.resolve('relative/lib'), '.env'),
      port: 4455,
    })
    expect(() => appPaths({ ...base, env: { PORT: 'abc' } })).toThrow('PORT must be a port number from 1 to 65535, not "abc".')
  })
})

describe('links', () => {
  it('keeps Binder\'s own pages in the window', () => {
    expect(isAppUrl('http://localhost:4321/decks/3', 'http://localhost:4321')).toBe(true)
    expect(isAppUrl('http://localhost:4455/', 'http://localhost:4321')).toBe(false)
    expect(isAppUrl('https://scryfall.com/card/m10/146', 'http://localhost:4321')).toBe(false)
    expect(isAppUrl('not a url', 'http://localhost:4321')).toBe(false)
  })

  it('opens web links in the browser, and nothing else', () => {
    expect(externalUrl('https://scryfall.com/card/m10/146')).toBe('https://scryfall.com/card/m10/146')
    expect(externalUrl('http://example.com/')).toBe('http://example.com/')
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:me@example.com', 'nonsense']) expect(externalUrl(url)).toBeNull()
  })
})

describe('messages', () => {
  it('says what to do when the port is taken, and anything else as the server said it', () => {
    expect(startupFailure({ code: 'port_in_use', message: 'Port 4321 is already in use: …' }, 4321)).toBe(
      'Port 4321 is already in use: Binder may already be running from the terminal (pnpm start). Quit that one, then open Binder again.',
    )
    expect(startupFailure({ code: 'library', message: '[database] file is not a database' }, 4321)).toBe(
      '[database] file is not a database',
    )
  })

  it('shows what Binder is doing while it starts, escaped', () => {
    const page = startingPage('Backing up your library <before> upgrading it…')
    expect(page.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(page)).toContain('Backing up your library &lt;before&gt; upgrading it…')
  })
})
```

Run: `pnpm vitest run tests/electron`

Expected: FAIL, with `Cannot find module '../../electron/links.ts'`.

- [ ] **Step 3: Write them**

Create `electron/paths.ts`:

```ts
import path from 'node:path'
import { portProblem } from '../src/server/startup.ts'

/** Where Binder.app listens: the same address as Binder from the terminal. */
export const APP_PORT = 4321

/** Where Binder.app keeps things, and where it listens (spec §3.2). */
export interface AppPaths {
  /** The library: `binder.db`, with `backups/`, `bulk/`, and `scans/` beside it. */
  dataDir: string
  /** The Anthropic API key, which Settings writes: in the library folder. */
  envPath: string
  /** The window's own files (its storage and caches), kept apart from the library. */
  electronDir: string
  /** The server's log, one file per run. */
  logDir: string
  webDistDir: string
  ocrBinary: string
  /** The helper's Swift source, to build it from; none in the packaged app, which ships it built. */
  ocrSource?: string
  port: number
}

/**
 * Binder.app's paths. Packaged, the library is `~/Library/Application Support/Binder`; run from the project
 * (`pnpm app:dev`), it's the project's `data/`, like `pnpm start`. BINDER_DATA_DIR and PORT override both, for checks.
 * Throws the one-line message when PORT isn't a port number.
 */
export function appPaths(input: { appData: string; appRoot: string; packaged: boolean; env: NodeJS.ProcessEnv }): AppPaths {
  const { appData, appRoot, packaged, env } = input
  const badPort = portProblem(env.PORT)
  if (badPort) throw new Error(badPort)
  const dataDir = env.BINDER_DATA_DIR
    ? path.resolve(env.BINDER_DATA_DIR)
    : packaged
      ? path.join(appData, 'Binder')
      : path.join(appRoot, 'data')
  return {
    dataDir,
    envPath: path.join(dataDir, '.env'),
    electronDir: path.join(dataDir, 'Electron'),
    logDir: path.join(dataDir, 'Logs'),
    webDistDir: path.join(appRoot, 'dist', 'web'),
    ocrBinary: path.join(appRoot, 'bin', 'ocr'),
    ...(packaged ? {} : { ocrSource: path.join(appRoot, 'native', 'ocr.swift') }),
    port: env.PORT === undefined ? APP_PORT : Number(env.PORT),
  }
}
```

Create `electron/links.ts`:

```ts
/** Whether a URL is one of Binder's own pages, which stay in the window. */
export function isAppUrl(url: string, appUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(appUrl).origin
  } catch {
    return false
  }
}

/** The URL to open in the browser: a web link (Scryfall, a store, a link in Claude's answer), and nothing else. */
export function externalUrl(url: string): string | null {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? url : null
  } catch {
    return null
  }
}
```

Create `electron/messages.ts`:

```ts
/** Why Binder couldn't start, as the app's dialog says it. The server's own lines, but for a port in use. */
export function startupFailure(error: { code: string; message: string }, port: number): string {
  if (error.code === 'port_in_use') {
    return `Port ${port} is already in use: Binder may already be running from the terminal (pnpm start). Quit that one, then open Binder again.`
  }
  return error.message
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The page the window shows while Binder starts, saying what it's doing. */
export function startingPage(status: string): string {
  const html = `<!doctype html><meta charset="utf-8"><title>Binder</title>
<style>
  html, body { height: 100%; margin: 0; background: #0c0a09; color: #e7e5e4; font: 15px -apple-system, system-ui, sans-serif; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; -webkit-user-select: none; }
  h1 { margin: 0; font: 600 28px ui-serif, Georgia, serif; color: #fbbf24; }
  p { margin: 0; color: #a8a29e; }
</style>
<h1>Binder</h1>
<p id="status">${escape(status)}</p>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
```

Run: `pnpm vitest run tests/electron`

Expected: PASS, 7 tests.

- [ ] **Step 4: The server's process**

It runs `startBinder` with the paths the app passes as JSON, and answers with `ServerMessage`s. After a failed start it
doesn't exit itself (its message could be lost): the app shows it and quits, which ends this process too.

Create `electron/server.ts`:

```ts
// Binder's server inside Binder.app, in its own process (Electron's utility process), so the window and the menu-bar
// icon stay responsive while the library does slow work (a backup before an upgrade, compacting, a card data refresh).
// main.ts starts it with the paths as JSON; it answers with messages (ServerMessage) and stops when told to.
import { type RunningBinder, startBinder, StartupError } from '../src/server/start.ts'
import type { AppPaths } from './paths.ts'

/** What the server tells the app. */
export type ServerMessage =
  | { type: 'log'; line: string }
  | { type: 'upgrading' }
  | { type: 'ready'; url: string }
  | { type: 'failed'; code: string; message: string }

const port = process.parentPort
const post = (message: ServerMessage) => port.postMessage(message)
const paths = JSON.parse(process.argv[2] ?? '{}') as AppPaths
let binder: RunningBinder | null = null

port.on('message', ({ data }: { data: unknown }) => {
  if ((data as { type?: string } | null)?.type !== 'stop') return
  void (binder?.stop() ?? Promise.resolve()).finally(() => {
    post({ type: 'log', line: 'Binder stopped' })
    process.exit(0)
  })
})

startBinder({
  dataDir: paths.dataDir,
  envPath: paths.envPath,
  webDistDir: paths.webDistDir,
  ocrBinary: paths.ocrBinary,
  ocrSource: paths.ocrSource,
  port: paths.port,
  log: (line) => post({ type: 'log', line }),
  onUpgradeBackup: () => post({ type: 'upgrading' }),
}).then(
  (running) => {
    binder = running
    post({ type: 'ready', url: running.url })
  },
  (err: unknown) => {
    const failure = err instanceof StartupError ? { code: err.code, message: err.message } : { code: 'crash', message: String(err) }
    // The app shows it and quits, which ends this process too.
    post({ type: 'failed', ...failure })
  },
)
```

- [ ] **Step 5: The app**

The window, the menu-bar icon, the menus, links, camera permission, the server's process, and quitting. The
`whenReady` at the end is not awaited at the top level (see Global Constraints).

Create `electron/main.ts`:

```ts
// Binder.app (spec §3.2): one window onto Binder's pages, a menu-bar icon, and Binder's server in its own process.
// Closing the window keeps Binder running (scans finish, card data refreshes); Quit (Cmd+Q, or the menu-bar icon's
// menu) stops everything. Entry point: package.json "main".
import fs from 'node:fs'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  session,
  shell,
  systemPreferences,
  Tray,
  type UtilityProcess,
  utilityProcess,
} from 'electron'
import { externalUrl, isAppUrl } from './links.ts'
import { startingPage, startupFailure } from './messages.ts'
import { type AppPaths, appPaths } from './paths.ts'
import type { ServerMessage } from './server.ts'

app.setName('Binder')

let paths: AppPaths
try {
  paths = appPaths({ appData: app.getPath('appData'), appRoot: app.getAppPath(), packaged: app.isPackaged, env: process.env })
} catch (err) {
  dialog.showErrorBox("Binder couldn't start", err instanceof Error ? err.message : String(err))
  app.exit(1)
  throw err
}
// The window's own files (storage, caches) go beside the library, not in it. Before anything reads userData.
fs.mkdirSync(paths.electronDir, { recursive: true })
app.setPath('userData', paths.electronDir)

let server: UtilityProcess | null = null
/** The web app's address, once the server listens. */
let appUrl: string | null = null
let status = 'Starting…'
let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

/** The server's log, one file per run, the one before kept beside it. */
function openLog(): fs.WriteStream {
  fs.mkdirSync(paths.logDir, { recursive: true })
  const file = path.join(paths.logDir, 'binder.log')
  if (fs.existsSync(file)) fs.renameSync(file, path.join(paths.logDir, 'binder.previous.log'))
  return fs.createWriteStream(file)
}

/** Shows Binder's window, opening it (on Binder's pages, or what it's doing while it starts) if it's closed. */
function showWindow(): void {
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return
  }
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 820,
    minHeight: 560,
    title: 'Binder',
    backgroundColor: '#0c0a09',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  window = win
  win.once('ready-to-show', () => win.show())
  // Closing the window keeps Binder running; the page (and its camera) goes with the window.
  win.on('closed', () => {
    if (window === win) window = null
  })
  // Web links open in the browser; Binder's own pages stay in the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url)
    if (external && !(appUrl && isAppUrl(url, appUrl))) void shell.openExternal(external)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (appUrl && isAppUrl(url, appUrl)) return
    event.preventDefault()
    const external = externalUrl(url)
    if (external) void shell.openExternal(external)
  })
  void win.loadURL(appUrl ?? startingPage(status))
}

/** Says what Binder is doing in a window still waiting for it to start. */
function setStatus(text: string): void {
  status = text
  if (window && !appUrl) void window.loadURL(startingPage(text))
}

/** Stops Binder for good after a message, when it can't start or its server stops. */
function fail(message: string): void {
  quitting = true
  dialog.showErrorBox("Binder couldn't start", message)
  server?.kill()
  app.exit(1)
}

function startServer(): void {
  const log = openLog()
  const child = utilityProcess.fork(path.join(import.meta.dirname, 'server.ts'), [JSON.stringify(paths)], {
    serviceName: 'Binder server',
    stdio: 'pipe',
  })
  server = child
  child.stdout?.on('data', (chunk: Buffer) => log.write(chunk))
  child.stderr?.on('data', (chunk: Buffer) => log.write(chunk))
  child.on('message', (message: ServerMessage) => {
    if (message.type === 'log') log.write(`${message.line}\n`)
    else if (message.type === 'upgrading') setStatus('Backing up your library before upgrading it (a few seconds)…')
    else if (message.type === 'failed') fail(startupFailure(message, paths.port))
    else if (message.type === 'ready') {
      appUrl = message.url
      if (window) void window.loadURL(message.url)
    }
  })
  child.on('exit', (code) => {
    log.end()
    if (!quitting) {
      quitting = true
      dialog.showErrorBox('Binder stopped', `Binder's server stopped unexpectedly (exit ${code}). Open Binder again to restart it.`)
      app.exit(1)
    }
  })
}

/** The camera is for Binder's own pages (the Scan page), with the Mac's permission, asked for once. */
function allowCamera(): void {
  const own = (url: string | undefined) => appUrl !== null && url !== undefined && isAppUrl(url, appUrl)
  // Chromium's fake camera (the end-to-end check's) isn't the Mac's: there's nothing to ask macOS for.
  const fakeCamera = app.commandLine.hasSwitch('use-fake-device-for-media-stream')
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => permission === 'media' && own(origin))
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== 'media' || !own(details.requestingUrl ?? contents.getURL())) return callback(false)
    const video = 'mediaTypes' in details && (details.mediaTypes ?? []).includes('video')
    if (!video || fakeCamera) return callback(true)
    void systemPreferences.askForMediaAccess('camera').then(callback, () => callback(false))
  })
}

function buildMenus(): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  // Drawn by scripts/make-icons.swift (`pnpm icons`); the @2x file beside it is picked up on its own.
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icons', 'trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Binder')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Binder', click: showWindow },
      { type: 'separator' },
      { label: 'Quit Binder', click: () => app.quit() },
    ]),
  )
}

// One Binder at a time: opening it again brings its window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  // Clicking the Dock icon with the window closed opens it again.
  app.on('activate', showWindow)
  // Closing the window keeps Binder running (in the menu bar).
  app.on('window-all-closed', () => {})
  // Quitting stops the server first (it closes the library), for up to 5 seconds.
  app.on('before-quit', (event) => {
    if (quitting || !server) return
    event.preventDefault()
    quitting = true
    const child = server
    const force = setTimeout(() => child.kill(), 5000)
    child.once('exit', () => {
      clearTimeout(force)
      app.quit()
    })
    child.postMessage({ type: 'stop' })
  })
  // No top-level await on whenReady: an ES module entry that awaits it never gets there.
  void app.whenReady().then(() => {
    allowCamera()
    buildMenus()
    startServer()
    showWindow()
  })
}
```

- [ ] **Step 6: The icons**

Create `scripts/make-icons.swift`:

```swift
// Draws Binder.app's icons into a folder: the app icon (a 9-pocket binder page in Binder's stone and amber) as
// Binder.icns and icon.png, and the menu-bar icon (the same page, as a template macOS tints) at 1x and 2x.
// usage: swift scripts/make-icons.swift <out-dir>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let space = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
          blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

func image(_ size: Int, _ draw: (CGContext, CGFloat) -> Void) -> CGImage {
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  draw(ctx, CGFloat(size))
  return ctx.makeImage()!
}

func save(_ picture: CGImage, _ name: String) {
  let dest = CGImageDestinationCreateWithURL(out.appendingPathComponent(name) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, picture, nil)
  CGImageDestinationFinalize(dest)
}

func rounded(_ ctx: CGContext, _ rect: CGRect, _ radius: CGFloat) {
  ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
}

/** The 3 × 3 pockets of a binder page inside `page`, each card-shaped (63:88). */
func pockets(_ page: CGRect, gap: CGFloat) -> [CGRect] {
  let w = (page.width - gap * 4) / 3
  let h = (page.height - gap * 4) / 3
  return (0..<9).map { i in
    CGRect(x: page.minX + gap + CGFloat(i % 3) * (w + gap), y: page.minY + gap + CGFloat(i / 3) * (h + gap), width: w, height: h)
  }
}

// The app icon, on macOS's icon grid: an 824-point rounded square in a 1024 canvas.
let appIcon = image(1024) { ctx, s in
  let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, 0.45))
  rounded(ctx, tile, 185)
  ctx.setFillColor(color(0x1c1917))
  ctx.fillPath()
  ctx.restoreGState()
  ctx.saveGState()
  rounded(ctx, tile, 185)
  ctx.clip()
  let gradient = CGGradient(colorsSpace: space, colors: [color(0x292524), color(0x0c0a09)] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: tile.maxY), end: CGPoint(x: 0, y: tile.minY), options: [])
  ctx.restoreGState()
  // The page, card-shaped itself, with its pockets.
  let page = CGRect(x: s / 2 - 240, y: s / 2 - 320, width: 480, height: 640)
  rounded(ctx, page, 36)
  ctx.setFillColor(color(0x44403c))
  ctx.fillPath()
  for (i, pocket) in pockets(page, gap: 22).enumerated() {
    rounded(ctx, pocket, 14)
    // One card lit amber (the middle); the rest in deep amber, like a sleeved collection.
    ctx.setFillColor(i == 4 ? color(0xfbbf24) : color(0xb45309, i % 2 == 0 ? 0.95 : 0.75))
    ctx.fillPath()
  }
}
save(appIcon, "icon.png")

// The menu-bar icon: black pockets on clear, which macOS tints for the menu bar (a "Template" image).
for (scale, name) in [(1, "trayTemplate.png"), (2, "trayTemplate@2x.png")] {
  let icon = image(16 * scale) { ctx, s in
    let unit = s / 16
    let page = CGRect(x: 2.5 * unit, y: 0.5 * unit, width: 11 * unit, height: 15 * unit)
    ctx.setFillColor(color(0x000000))
    for pocket in pockets(page, gap: 1 * unit) {
      rounded(ctx, pocket, 0.8 * unit)
      ctx.fillPath()
    }
  }
  save(icon, name)
}

// Binder.icns, from an iconset of every size macOS asks for.
let iconset = out.appendingPathComponent("Binder.iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let px = base * scale
    let scaled = image(px) { ctx, s in
      ctx.interpolationQuality = .high
      ctx.draw(appIcon, in: CGRect(x: 0, y: 0, width: s, height: s))
    }
    let dest = CGImageDestinationCreateWithURL(
      iconset.appendingPathComponent(scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png") as CFURL,
      UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, scaled, nil)
    CGImageDestinationFinalize(dest)
  }
}
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", out.appendingPathComponent("Binder.icns").path]
try iconutil.run()
iconutil.waitUntilExit()
try? FileManager.default.removeItem(at: iconset)
guard iconutil.terminationStatus == 0 else { fatalError("iconutil failed") }
```

Run: `pnpm icons && ls build/icons`

Expected: `Binder.icns  icon.png  trayTemplate.png  trayTemplate@2x.png` (about 2 s). Open `build/icons/icon.png` to see a 9-pocket binder page on a dark rounded square, the middle card bright amber.

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`

Expected: typecheck clean; 928 tests pass.

- [ ] **Step 8: See the app run from the project, on a copy of the library**

A Binder window opens on the screen for a moment. The copy has the owner's card data (fresh, so no download starts)
and no `.env`. Check first that nothing listens on 4455 or 9444.

```bash
mkdir -p /tmp/binder-m9-smoke && sqlite3 -readonly /Users/kasonsuchow/Documents/localdev/binder/data/binder.db ".backup /tmp/binder-m9-smoke/binder.db"
pnpm vite build
(BINDER_DATA_DIR=/tmp/binder-m9-smoke PORT=4455 node_modules/.bin/electron . --remote-debugging-port=9444 > /tmp/binder-m9-smoke/electron.log 2>&1 &)
for i in $(seq 1 40); do sleep 1; curl -s http://127.0.0.1:4455/api/health >/dev/null && break; done
curl -s http://127.0.0.1:4455/api/health; echo
curl -s http://127.0.0.1:9444/json/list | grep -o '"url": *"http://localhost:4455/[^"]*"'
osascript -e 'tell application "Electron" to quit'
sleep 3; tail -1 /tmp/binder-m9-smoke/Logs/binder.log; ls /tmp/binder-m9-smoke
```

Expected: `{"ok":true}`; `"url": "http://localhost:4455/"`; after quitting, `Binder stopped`; the folder holds
`Electron`, `Logs`, `backups`, and `binder.db`, and no `binder.db-wal` (the library closed cleanly). Then
`rm -rf /tmp/binder-m9-smoke`, and check nothing listens on 4455 or 9444 and `pgrep -f node_modules/.pnpm/electron`
prints nothing.

- [ ] **Step 9: Commit**

Commit (never `.env`, `data/`, `build/`, or `release/`; `git status --short` shows nothing else of this task left):

```bash
git add package.json pnpm-lock.yaml .gitignore tsconfig.json electron scripts/make-icons.swift tests/electron/desktop.test.ts && git commit -q -F - <<'EOF'
M9 Task 2: Binder.app's Electron shell

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9gnXZcph52ErfVjYZXZbf
EOF
```

---

### Task 3: Packaging, and `pnpm app`

**Files:**
- Create: `scripts/lib/install.ts`, `scripts/app.ts`, `tests/scripts/install.test.ts`
- Modify: `package.json` (whole file), `.gitignore`

**Interfaces:**
- Consumes: `buildOcrHelper`, `OCR_BINARY`, `OCR_SOURCE`, `ROOT_DIR`; `pnpm icons` (Task 2).
- Produces:
  - `builtApp(releaseDir: string): string`, `installApp(built: string, applicationsDir: string): string`,
    `appRunning(bundle: string): boolean` (`scripts/lib/install.ts`)
  - `pnpm app` (and `pnpm app --no-install`, which leaves `release/mac-arm64/Binder.app`); the `build` section of
    `package.json` (electron-builder's config).

- [ ] **Step 1: The packaging config**

electron-builder, the `build` section (the Info.plist camera keys, ad-hoc signing, no asar, no native rebuild), the
`app` script, a description, and the SPA's packages moved to devDependencies (see Decisions 2, 3, 6, 7).

Replace `package.json`:

```json
{
  "name": "binder",
  "version": "0.1.0",
  "description": "Personal MTG collection manager: collection, decks, scanning, and a deckbuilding chat.",
  "private": true,
  "type": "module",
  "main": "electron/main.ts",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "concurrently -k -n server,web -c blue,magenta \"node --watch src/server/main.ts\" \"vite\"",
    "build": "vite build",
    "start": "vite build && node src/server/main.ts",
    "setup": "node scripts/setup.ts",
    "fixtures": "node scripts/fetch-fixtures.ts",
    "ocr:bench": "node scripts/ocr-benchmark.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p .",
    "icons": "swift scripts/make-icons.swift build/icons",
    "app:dev": "pnpm icons && vite build && electron .",
    "app": "node scripts/app.ts"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "better-sqlite3",
      "electron",
      "esbuild"
    ]
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.128.0",
    "@hono/node-server": "2.1.1",
    "better-sqlite3": "13.0.3",
    "hono": "4.13.9",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@tanstack/react-query": "5.104.0",
    "@types/better-sqlite3": "9.6.0",
    "@types/node": "26.6.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "concurrently": "10.0.5",
    "electron": "44.4.5",
    "electron-builder": "26.15.3",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "react-router": "8.4.0",
    "tailwindcss": "4.3.3",
    "typescript": "7.0.2",
    "vite": "8.3.1",
    "vitest": "5.0.2"
  },
  "build": {
    "appId": "local.binder.app",
    "productName": "Binder",
    "directories": {
      "output": "release"
    },
    "files": [
      "package.json",
      "electron/**",
      "src/server/**",
      "src/shared/**",
      "dist/web/**",
      "bin/ocr",
      "build/icons/trayTemplate*.png"
    ],
    "asar": false,
    "npmRebuild": false,
    "mac": {
      "target": "dir",
      "icon": "build/icons/Binder.icns",
      "category": "public.app-category.utilities",
      "identity": "-",
      "hardenedRuntime": false,
      "extendInfo": {
        "NSCameraUsageDescription": "Binder uses the camera to scan your cards.",
        "NSCameraUseContinuityCameraDeviceType": true
      }
    }
  }
}
```

Run: `pnpm install`

Expected: it adds `electron-builder 26.15.3` and moves the four SPA packages to devDependencies.

In `.gitignore`:

Replace:

```
# Dependencies and build output (build/: Binder.app's icons, which pnpm icons draws)
node_modules/
dist/
bin/
build/

# The library, its backups, card data, and scans: personal, and large. Never committed.
```

with:

```
# Dependencies and build output (build/: Binder.app's icons, which pnpm icons draws; release/: Binder.app, which
# pnpm app builds)
node_modules/
dist/
bin/
build/
release/

# The library, its backups, card data, and scans: personal, and large. Never committed.
```

- [ ] **Step 2: Write the failing tests for installing**

Create `tests/scripts/install.test.ts`:

```ts
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { appRunning, builtApp, installApp } from '../../scripts/lib/install.ts'

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-install-'))
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A stand-in Binder.app holding one file. */
function app(dir: string, text: string): string {
  const bundle = path.join(dir, 'Binder.app')
  fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true })
  fs.writeFileSync(path.join(bundle, 'Contents', 'version.txt'), text)
  return bundle
}

describe('builtApp', () => {
  it('finds the Binder.app electron-builder made, for this Mac\'s architecture or the other', () => {
    const release = scratch()
    fs.mkdirSync(path.join(release, 'mac-arm64'))
    const bundle = app(path.join(release, 'mac-arm64'), 'new')
    expect(builtApp(release)).toBe(bundle)
  })

  it('says so when there is none', () => {
    expect(() => builtApp(scratch())).toThrow('No Binder.app in')
  })
})

describe('installApp', () => {
  it('puts Binder.app in the folder, replacing the one there', () => {
    const dir = scratch()
    const built = app(path.join(dir, 'release'), 'new')
    const applications = path.join(dir, 'Applications')
    app(applications, 'old')
    fs.writeFileSync(path.join(applications, 'Binder.app', 'Contents', 'stale.txt'), 'from the old version')
    expect(installApp(built, applications)).toBe(path.join(applications, 'Binder.app'))
    expect(fs.readFileSync(path.join(applications, 'Binder.app', 'Contents', 'version.txt'), 'utf8')).toBe('new')
    expect(fs.existsSync(path.join(applications, 'Binder.app', 'Contents', 'stale.txt'))).toBe(false)
  })
})

describe('appRunning', () => {
  it('tells whether Binder.app is running from that path, so pnpm app never replaces it under itself', async () => {
    const dir = scratch()
    const bundle = path.join(dir, 'Binder.app')
    const binary = path.join(bundle, 'Contents', 'MacOS', 'Binder')
    fs.mkdirSync(path.dirname(binary), { recursive: true })
    // A stand-in that waits, as Binder.app would while it runs.
    fs.writeFileSync(binary, `#!${process.execPath}\nsetTimeout(() => {}, 30_000)\n`, { mode: 0o755 })
    expect(appRunning(bundle)).toBe(false)
    const app = spawn(binary, [], { stdio: 'ignore' })
    onTestFinished(() => {
      app.kill()
    })
    for (let tries = 0; !appRunning(bundle) && tries < 40; tries++) await new Promise((r) => setTimeout(r, 50))
    expect(appRunning(bundle)).toBe(true)
    expect(appRunning(path.join(dir, 'Other.app'))).toBe(false)
  })
})
```

Run: `pnpm vitest run tests/scripts/install.test.ts`

Expected: FAIL, with `Cannot find module '../../scripts/lib/install.ts'`.

- [ ] **Step 3: Write them**

Create `scripts/lib/install.ts`:

```ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** The Binder.app electron-builder made in `releaseDir`: `release/mac-arm64/`, or `release/mac/` on an Intel Mac. */
export function builtApp(releaseDir: string): string {
  const found = (fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir) : [])
    .filter((dir) => dir.startsWith('mac'))
    .map((dir) => path.join(releaseDir, dir, 'Binder.app'))
    .find((bundle) => fs.existsSync(bundle))
  if (!found) throw new Error(`No Binder.app in ${releaseDir}`)
  return found
}

/** Copies Binder.app into `applicationsDir`, replacing the one there, and returns where it is. */
export function installApp(built: string, applicationsDir: string): string {
  const target = path.join(applicationsDir, 'Binder.app')
  fs.mkdirSync(applicationsDir, { recursive: true })
  fs.rmSync(target, { recursive: true, force: true })
  // ditto keeps what a Mac app needs: its signature, extended attributes, and the frameworks' symlinks.
  execFileSync('/usr/bin/ditto', [built, target])
  return target
}

/** Whether Binder.app is running from this path (replacing it then would pull files from under it). */
export function appRunning(bundle: string): boolean {
  try {
    execFileSync('/usr/bin/pgrep', ['-f', path.join(bundle, 'Contents', 'MacOS', 'Binder')], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
```

Run: `pnpm vitest run tests/scripts/install.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 4: `pnpm app`**

Create `scripts/app.ts`:

```ts
// `pnpm app`: builds Binder.app (its icons, the web app, the OCR helper, then electron-builder) and puts it in
// /Applications, replacing the one there. `pnpm app --no-install` leaves it in release/, where the check runs it.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { OCR_BINARY, OCR_SOURCE, ROOT_DIR } from '../src/server/config.ts'
import { buildOcrHelper } from '../src/server/scanner/ocr-client.ts'
import { appRunning, builtApp, installApp } from './lib/install.ts'

const APPLICATIONS = '/Applications'
const installed = path.join(APPLICATIONS, 'Binder.app')
const install = !process.argv.includes('--no-install')
const quitFirst = 'Binder is running: quit it (Cmd+Q, or Quit Binder in its menu-bar icon), then run pnpm app again.'
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: ROOT_DIR, stdio: 'inherit' })

if (install && appRunning(installed)) {
  console.error(quitFirst)
  process.exit(1)
}
console.log('Drawing the icons…')
run('swift', ['scripts/make-icons.swift', 'build/icons'])
console.log('Building the web app…')
run('pnpm', ['exec', 'vite', 'build'])
if (await buildOcrHelper(OCR_SOURCE, OCR_BINARY)) console.log('Built the OCR helper.')
console.log('Packaging Binder.app…')
run('pnpm', ['exec', 'electron-builder', '--mac'])
const built = builtApp(path.join(ROOT_DIR, 'release'))
if (!install) {
  console.log(`Built ${built}`)
} else if (appRunning(installed)) {
  console.error(quitFirst)
  process.exitCode = 1
} else {
  console.log(`Installed ${installApp(built, APPLICATIONS)}. Open Binder from Spotlight, Launchpad, or Applications.`)
}
```

- [ ] **Step 5: Build Binder.app, without installing it**

Run: `pnpm app --no-install`

Expected: it draws the icons, builds the web app and the OCR helper, then electron-builder logs `signing … identityName=-` and the script ends with `Built …/release/mac-arm64/Binder.app` (about 15 s).

Check what it made:

```bash
A=release/mac-arm64/Binder.app
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" -c "Print :NSCameraUsageDescription" -c "Print :NSCameraUseContinuityCameraDeviceType" $A/Contents/Info.plist
ls $A/Contents/Resources/app/node_modules
ls -l $A/Contents/Resources/app/bin/ocr
codesign --verify --deep --strict $A && echo signature ok
du -sh $A
```

Expected: `local.binder.app`, `Binder uses the camera to scan your cards.`, `true`; the node_modules hold the server's
packages (`@anthropic-ai @hono better-sqlite3 hono zod` and what they need), no `react`; `bin/ocr` is executable;
`signature ok`; about 344 MB.

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test`

Expected: typecheck clean; 932 tests pass.

- [ ] **Step 7: Commit**

Commit (never `.env`, `data/`, `build/`, or `release/`; `git status --short` shows nothing else of this task left):

```bash
git add package.json pnpm-lock.yaml .gitignore scripts/app.ts scripts/lib/install.ts tests/scripts/install.test.ts && git commit -q -F - <<'EOF'
M9 Task 3: packaging, and pnpm app

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9gnXZcph52ErfVjYZXZbf
EOF
```

---

### Task 4: Moving the library to Binder.app

**Files:**
- Create: `scripts/lib/move.ts`, `scripts/move-library.ts`, `tests/scripts/move-library.test.ts`
- Modify: `package.json`, `src/server/config.ts`, `src/server/startup.ts`, `src/server/main.ts`,
  `tests/server/startup.test.ts`

**Interfaces:**
- Consumes: `libraryPaths` (Task 1), `appRunning` (Task 3), `APP_PORT` (Task 2).
- Produces:
  - `interface LibrarySummary { copies; cards; decks; scans; conversations }`; `class MoveError extends Error`;
    `librarySummary(dbPath: string): LibrarySummary`; `describeLibrary(s: LibrarySummary): string`;
    `moveLibrary(from: string, to: string): Promise<LibrarySummary>` (`scripts/lib/move.ts`)
  - `APP_LIBRARY_DIR` (`config.ts`: `~/Library/Application Support/Binder`)
  - `appLibraryNote(dataDir: string, appLibrary: string): string | null` (`startup.ts`)
  - `pnpm move-library`

- [ ] **Step 1: Write the failing tests for the move**

Create `tests/scripts/move-library.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import { openDb } from '../../src/server/db/index.ts'
import { librarySummary, moveLibrary, MoveError } from '../../scripts/lib/move.ts'
import { fixtureRows } from '../helpers/db.ts'
import { deck, own } from '../helpers/library.ts'

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-move-'))
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A library in `dir` with card data, 7 copies of 2 cards, and a deck, plus the files a library keeps beside it. */
function library(dir: string) {
  const db = openDb(path.join(dir, 'binder.db'))
  insertCardRows(db, 'cards', fixtureRows())
  rebuildCardNames(db)
  own(db, 'Lightning Bolt', 'm10', 4)
  own(db, 'Llanowar Elves', undefined, 3)
  deck(db, 'Elves', 'built')
  for (const [file, text] of [['backups/binder-2026-09-27.db', 'backup'], ['bulk/default-cards.json', '[]'], ['scans/1.jpg', 'jpeg']]) {
    fs.mkdirSync(path.dirname(path.join(dir, file!)), { recursive: true })
    fs.writeFileSync(path.join(dir, file!), text!)
  }
  // Not the library's: the key file, the window's own files, and logs stay where they are.
  fs.writeFileSync(path.join(dir, '.env'), 'ANTHROPIC_API_KEY=sk-ant-test-0000\n')
  fs.mkdirSync(path.join(dir, 'Electron'))
  fs.mkdirSync(path.join(dir, 'Logs'))
  return db
}

describe('moveLibrary (spec §3.2)', () => {
  it('copies the database whole, even with changes still in its log, with its backups, card data, and scans', async () => {
    const dir = scratch()
    const from = path.join(dir, 'data')
    const to = path.join(dir, 'Application Support', 'Binder')
    fs.mkdirSync(from)
    // Left open: its latest changes are still in the write-ahead log, not the database file.
    const open = library(from)
    onTestFinished(() => {
      open.close()
    })
    expect(await moveLibrary(from, to)).toEqual({ copies: 7, cards: 2, decks: 1, scans: 0, conversations: 0 })
    expect(librarySummary(path.join(to, 'binder.db'))).toMatchObject({ copies: 7, decks: 1 })
    for (const file of ['backups/binder-2026-09-27.db', 'bulk/default-cards.json', 'scans/1.jpg']) {
      expect(fs.readFileSync(path.join(to, file), 'utf8')).toBe(fs.readFileSync(path.join(from, file), 'utf8'))
    }
    expect(fs.readdirSync(to).sort()).toEqual(['backups', 'binder.db', 'bulk', 'scans'])
    // The original is left as it was.
    expect(librarySummary(path.join(from, 'binder.db'))).toMatchObject({ copies: 7, decks: 1 })
    expect(fs.existsSync(path.join(from, '.env'))).toBe(true)
  })

  it('leaves a library that has anything in it alone, but replaces one nothing was ever added to', async () => {
    const dir = scratch()
    const from = path.join(dir, 'data')
    const to = path.join(dir, 'Binder')
    fs.mkdirSync(from)
    library(from).close()
    // Binder.app opened before the move: a new library with card data and its first backup, and nothing else.
    fs.mkdirSync(path.join(to, 'backups'), { recursive: true })
    const fresh = openDb(path.join(to, 'binder.db'))
    insertCardRows(fresh, 'cards', fixtureRows())
    fresh.close()
    fs.writeFileSync(path.join(to, 'backups', 'binder-2026-09-28.db'), 'empty library backup')
    expect(await moveLibrary(from, to)).toMatchObject({ copies: 7, decks: 1 })
    expect(fs.existsSync(path.join(to, 'backups', 'binder-2026-09-28.db'))).toBe(false)
    // Now it holds a collection: a second move refuses, and changes nothing.
    await expect(moveLibrary(from, to)).rejects.toThrow(
      new MoveError(`${to} already has a library (7 copies of 2 cards, 1 deck): nothing was copied.`),
    )
  })

  it('says so when there is no library to move', async () => {
    const dir = scratch()
    await expect(moveLibrary(path.join(dir, 'data'), path.join(dir, 'Binder'))).rejects.toThrow(
      new MoveError(`No library in ${path.join(dir, 'data')}: nothing was copied.`),
    )
  })
})
```

Run: `pnpm vitest run tests/scripts/move-library.test.ts`

Expected: FAIL, with `Cannot find module '../../scripts/lib/move.ts'`.

- [ ] **Step 2: Write the move**

Create `scripts/lib/move.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { libraryPaths } from '../../src/server/config.ts'

/** What a library holds: owned copies and the cards they are, decks, scans waiting in the queue, and conversations. */
export interface LibrarySummary {
  copies: number
  cards: number
  decks: number
  scans: number
  conversations: number
}

/** Why the library wasn't copied, in one line; nothing was changed. */
export class MoveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoveError'
  }
}

/** The folders that go with the database. Anything else beside it (the key file, the window's files, logs) stays. */
const FOLDERS = ['backups', 'bulk', 'scans'] as const

/** What the library at `dbPath` holds. Opened for writing, so it closes cleanly: not for a library that must stay as it is. */
export function librarySummary(dbPath: string): LibrarySummary {
  const db = new Database(dbPath, { fileMustExist: true })
  try {
    const get = (sql: string) => db.prepare(sql).pluck().get() as number
    return {
      copies: get('SELECT coalesce(sum(quantity), 0) FROM collection'),
      cards: get('SELECT count(DISTINCT c.oracle_id) FROM collection co JOIN cards c ON c.id = co.card_id'),
      decks: get('SELECT count(*) FROM decks'),
      scans: get("SELECT count(*) FROM scan_items WHERE status NOT IN ('committed', 'discarded')"),
      conversations: get('SELECT count(*) FROM ai_threads'),
    }
  } finally {
    db.close()
  }
}

/** Whether nothing was ever added to a library: no copies, decks, scans (even finished ones), or conversations. */
function untouched(dbPath: string): boolean {
  const db = new Database(dbPath, { fileMustExist: true })
  try {
    const used = ['collection', 'decks', 'scan_items', 'ai_threads'].some(
      (table) => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get() !== undefined,
    )
    return !used
  } finally {
    db.close()
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "7 copies of 2 cards, 1 deck", with scans and conversations when there are any. */
export function describeLibrary(s: LibrarySummary): string {
  return [
    `${count(s.copies, 'copy', 'copies')} of ${count(s.cards, 'card')}`,
    count(s.decks, 'deck'),
    ...(s.scans > 0 ? [`${count(s.scans, 'scan')} in the queue`] : []),
    ...(s.conversations > 0 ? [count(s.conversations, 'conversation')] : []),
  ].join(', ')
}

/**
 * Copies the library in `from` (the project's data/) to `to` (Binder.app's folder, spec §3.2): the database through
 * SQLite's backup, so it's whole even while its log holds changes, checked before it's put in place; then backups/,
 * bulk/, and scans/. A library already in `to` is left alone, unless nothing was ever added to it (Binder.app opened
 * before the move), which is replaced. `from` is only read. Returns what the copy holds.
 */
export async function moveLibrary(from: string, to: string): Promise<LibrarySummary> {
  const source = libraryPaths(from).dbPath
  const target = libraryPaths(to).dbPath
  if (!fs.existsSync(source)) throw new MoveError(`No library in ${from}: nothing was copied.`)
  if (fs.existsSync(target)) {
    if (!untouched(target)) {
      throw new MoveError(`${to} already has a library (${describeLibrary(librarySummary(target))}): nothing was copied.`)
    }
    for (const leftover of [target, `${target}-wal`, `${target}-shm`]) fs.rmSync(leftover, { force: true })
    for (const folder of FOLDERS) fs.rmSync(path.join(to, folder), { recursive: true, force: true })
  }
  fs.mkdirSync(to, { recursive: true })
  const partial = `${target}.moving`
  fs.rmSync(partial, { force: true })
  const db = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await db.backup(partial)
  } finally {
    db.close()
  }
  const copy = new Database(partial, { fileMustExist: true })
  const check = copy.pragma('integrity_check', { simple: true })
  copy.close()
  if (check !== 'ok') {
    fs.rmSync(partial, { force: true })
    throw new MoveError(`The copy of the library didn't check out (${String(check)}): nothing was copied.`)
  }
  fs.renameSync(partial, target)
  for (const folder of FOLDERS) {
    const dir = path.join(from, folder)
    if (fs.existsSync(dir)) fs.cpSync(dir, path.join(to, folder), { recursive: true, preserveTimestamps: true })
  }
  return librarySummary(target)
}
```

Run: `pnpm vitest run tests/scripts/move-library.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 3: `pnpm move-library`, and where Binder.app keeps its library**

In `src/server/config.ts`:

Replace:

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
```

with:

```ts
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
```


Then replace:

```ts
/** Holds ANTHROPIC_API_KEY, written by the Settings page (spec §3.1). */
export const ENV_PATH = path.join(ROOT_DIR, '.env')
```

with:

```ts
/** Holds ANTHROPIC_API_KEY, written by the Settings page (spec §3.1). */
export const ENV_PATH = path.join(ROOT_DIR, '.env')
/** Binder.app's library (spec §3.2); `pnpm move-library` copies data/ there. */
export const APP_LIBRARY_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Binder')
```

Create `scripts/move-library.ts`:

```ts
// `pnpm move-library`: copies the library from data/ (or BINDER_DATA_DIR) to Binder.app's folder,
// ~/Library/Application Support/Binder, once (spec §3.2). Binder must not be running; data/ is left as it is, and the
// API key isn't copied (it's entered again in Binder.app's Settings).
import net from 'node:net'
import { APP_LIBRARY_DIR, DATA_DIR } from '../src/server/config.ts'
import { APP_PORT } from '../electron/paths.ts'
import { appRunning } from './lib/install.ts'
import { describeLibrary, moveLibrary, MoveError } from './lib/move.ts'

/** Whether something answers on the port: Binder from the terminal, or Binder.app. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

if (appRunning('/Applications/Binder.app') || (await answers(APP_PORT))) {
  console.error('Binder is running: quit it (Cmd+Q in Binder.app, or Ctrl+C where pnpm start runs), then run pnpm move-library again.')
  process.exit(1)
}
try {
  const summary = await moveLibrary(DATA_DIR, APP_LIBRARY_DIR)
  console.log(`Copied your library (${describeLibrary(summary)}) to ${APP_LIBRARY_DIR}.`)
  console.log('Open Binder.app to use it, and enter your Anthropic API key again in Settings → Anthropic API key.')
  console.log(`Your original is still in ${DATA_DIR}; delete it once you've checked Binder.app.`)
} catch (err) {
  if (!(err instanceof MoveError)) throw err
  console.error(err.message)
  process.exit(1)
}
```

In `package.json`:

Replace:

```json
    "icons": "swift scripts/make-icons.swift build/icons",
    "app:dev": "pnpm icons && vite build && electron .",
    "app": "node scripts/app.ts"
  },
  "pnpm": {
```

with:

```json
    "icons": "swift scripts/make-icons.swift build/icons",
    "app:dev": "pnpm icons && vite build && electron .",
    "app": "node scripts/app.ts",
    "move-library": "node scripts/move-library.ts"
  },
  "pnpm": {
```

- [ ] **Step 4: Write the failing test for `pnpm start`'s note**

In `tests/server/startup.test.ts`:

Replace:

```ts
import { describe, expect, it } from 'vitest'
import { listenFailure, portProblem } from '../../src/server/startup.ts'

const failure = (code: string, message = 'boom') => Object.assign(new Error(message), { code })
```

with:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { appLibraryNote, listenFailure, portProblem } from '../../src/server/startup.ts'

const failure = (code: string, message = 'boom') => Object.assign(new Error(message), { code })
```


Then replace:

```ts
    expect(listenFailure(failure('EOTHER', 'the network is down'), 4321)).toBe("Couldn't start the server on port 4321: the network is down")
  })
})
```

with:

```ts
    expect(listenFailure(failure('EOTHER', 'the network is down'), 4321)).toBe("Couldn't start the server on port 4321: the network is down")
  })

  it('says which library this Binder uses when Binder.app keeps its own', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-startup-'))
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }))
    const appLibrary = path.join(dir, 'Application Support', 'Binder')
    const data = path.join(dir, 'data')
    expect(appLibraryNote(data, appLibrary)).toBeNull()
    fs.mkdirSync(appLibrary, { recursive: true })
    fs.writeFileSync(path.join(appLibrary, 'binder.db'), '')
    expect(appLibraryNote(data, appLibrary)).toBe(`[library] Binder.app keeps its library in ${appLibrary}; this Binder uses ${data}.`)
    expect(appLibraryNote(appLibrary, appLibrary)).toBeNull()
  })
})
```

Run: `pnpm vitest run tests/server/startup.test.ts`

Expected: FAIL: 1 of 3, with `TypeError: appLibraryNote is not a function`.

- [ ] **Step 5: Write it, and have `pnpm start` print it**

In `src/server/startup.ts`:

Replace:

```ts
/** Startup checks and messages for the server (`main.ts`): one clear line each, instead of a stack trace. */

```

with:

```ts
import fs from 'node:fs'
import path from 'node:path'

/** Startup checks and messages for the server (`main.ts`): one clear line each, instead of a stack trace. */

```


Then replace:

```ts
  return `Couldn't start the server on port ${port}: ${err.message}`
}
```

with:

```ts
  return `Couldn't start the server on port ${port}: ${err.message}`
}

/**
 * The line `pnpm start` prints when Binder.app keeps its own library (`appLibrary`) and this Binder uses another, so
 * the two aren't taken for one. Null when there's no Binder.app library, or it's the one in use.
 */
export function appLibraryNote(dataDir: string, appLibrary: string): string | null {
  if (path.resolve(dataDir) === path.resolve(appLibrary)) return null
  if (!fs.existsSync(path.join(appLibrary, 'binder.db'))) return null
  return `[library] Binder.app keeps its library in ${appLibrary}; this Binder uses ${dataDir}.`
}
```

In `src/server/main.ts`:

Replace:

```ts
import { DATA_DIR, ENV_PATH, HOST, OCR_BINARY, OCR_SOURCE, PORT, WEB_DIST_DIR } from './config.ts'
import { startBinder, StartupError } from './start.ts'
import { portProblem } from './startup.ts'

// Binder from the terminal (`pnpm start`): the library in data/ (or BINDER_DATA_DIR), the key in the project's .env.
```

with:

```ts
import { APP_LIBRARY_DIR, DATA_DIR, ENV_PATH, HOST, OCR_BINARY, OCR_SOURCE, PORT, WEB_DIST_DIR } from './config.ts'
import { startBinder, StartupError } from './start.ts'
import { appLibraryNote, portProblem } from './startup.ts'

// Binder from the terminal (`pnpm start`): the library in data/ (or BINDER_DATA_DIR), the key in the project's .env.
```


Then replace:

```ts
  process.exit(1)
}

try {
```

with:

```ts
  process.exit(1)
}

const note = appLibraryNote(DATA_DIR, APP_LIBRARY_DIR)
if (note) console.log(note)

try {
```

Run: `pnpm vitest run tests/server/startup.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 6: Move a copy of the library into a scratch home**

`pnpm move-library` writes `~/Library/Application Support/Binder`, so here `HOME` points into `/tmp` and the source is a
read-only copy of the library:

Run: `mkdir -p /tmp/binder-m9-move/data /tmp/binder-m9-move/home && sqlite3 -readonly /Users/kasonsuchow/Documents/localdev/binder/data/binder.db ".backup /tmp/binder-m9-move/data/binder.db" && HOME=/tmp/binder-m9-move/home BINDER_DATA_DIR=/tmp/binder-m9-move/data node scripts/move-library.ts && HOME=/tmp/binder-m9-move/home BINDER_DATA_DIR=/tmp/binder-m9-move/data node scripts/move-library.ts; echo "exit $?"; rm -rf /tmp/binder-m9-move`

Expected: `Copied your library (N copies of N cards, N decks…) to /tmp/binder-m9-move/home/Library/Application Support/Binder.` and the two lines after it; then the second run: `…/Binder already has a library (…): nothing was copied.` and `exit 1`. `ls ~/Library/Application\ Support | grep -c "^Binder$"` still prints 0.

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`

Expected: typecheck clean; 936 tests pass.

- [ ] **Step 8: Commit**

Commit (never `.env`, `data/`, `build/`, or `release/`; `git status --short` shows nothing else of this task left):

```bash
git add package.json src/server/config.ts src/server/main.ts src/server/startup.ts scripts/move-library.ts scripts/lib/move.ts tests/scripts/move-library.test.ts tests/server/startup.test.ts && git commit -q -F - <<'EOF'
M9 Task 4: moving the library to Binder.app

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9gnXZcph52ErfVjYZXZbf
EOF
```

---

### Task 5: The packaged app, end to end; and the docs

The packaged Binder.app on a `/tmp` copy of the library, with Chromium's fake camera playing real card images, driven
over its debugging port: its window, auto mode through the OCR helper inside the app, a non-web link, closing and
opening it again, and quitting. Then the spec and README.

**Files:**
- Scripts in `/tmp/binder-m9-e2e-scripts/` (not in the project; deleted at the end)
- Modify: `docs/specs/2026-09-26-binder-design.md`, `README.md`

**Interfaces:**
- Consumes: `pnpm app --no-install` (Task 3), `BINDER_DATA_DIR` and `PORT` (Task 2), the Scan page's capture-mode
  radio group and status line (M8's auto mode).

- [ ] **Step 1: Write the scripts**

`/tmp/binder-m9-e2e-scripts/make-frames.swift` builds the fake camera's feed (M8's, with three seconds of mat and of
each card, so auto mode learns the empty mat first):

```swift
// Builds a Motion JPEG "camera feed" for Chromium's fake camera: three seconds of bare mat, then a card in the Scan
// page's guide for three seconds, the mat again, the next card, and so on, then a long stretch of bare mat so the loop
// doesn't start over while the check works. usage: make-frames <out.mjpeg> <card.jpg>...
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let out = args[1]
let cards = args.dropFirst(2).map { URL(fileURLWithPath: $0) }
let width = 1280, height = 960
let space = CGColorSpace(name: CGColorSpace.sRGB)!

func frame(_ card: CGImage?) -> Data {
  let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 0.22, green: 0.2, blue: 0.18, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
  if let card {
    // A little inside the Scan page's guide, which is card-shaped, centered, and 82% of the frame's height.
    let h = Double(height) * 0.8, w = h * 63 / 88
    ctx.draw(card, in: CGRect(x: (Double(width) - w) / 2, y: (Double(height) - h) / 2, width: w, height: h))
  }
  let data = NSMutableData()
  let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
  CGImageDestinationFinalize(dest)
  return data as Data
}

let empty = frame(nil)
var video = Data()
for url in cards {
  let source = CGImageSourceCreateWithURL(url as CFURL, nil)!
  let card = frame(CGImageSourceCreateImageAtIndex(source, 0, nil)!)
  // Three seconds of bare mat at 30 fps: auto mode learns it first (or sees it again: the card was lifted).
  for _ in 0..<90 { video.append(empty) }
  for _ in 0..<90 { video.append(card) }  // three seconds of the card
}
for _ in 0..<600 { video.append(empty) }  // twenty seconds of bare mat before the feed starts over
try video.write(to: URL(fileURLWithPath: out))
print("wrote \(video.count) bytes")
```

`/tmp/binder-m9-e2e-scripts/cdp.ts`, a minimal Chrome DevTools Protocol driver that attaches to the app's window:

```ts
// Minimal Chrome DevTools Protocol driver (Node 24's global WebSocket, no dependencies) for Binder.app's window:
// attaches to the page already open on Binder's address.
import fs from 'node:fs'

export interface Page {
  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>
  on(method: string, handler: (params: any) => void): void
  eval<T = any>(expression: string): Promise<T>
  waitFor(expression: string, timeoutMs?: number): Promise<any>
  goto(url: string): Promise<void>
  click(selector: string): Promise<void>
  shot(file: string): Promise<void>
  detach(): void
}

interface Target {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl: string
}

/** The debugging port's page targets: the app's windows. */
export async function pages(port: number): Promise<Target[]> {
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Target[]
  return targets.filter((t) => t.type === 'page')
}

/** Closes a window by its page target, as its close button does. */
export async function closeTarget(port: number, id: string): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/json/close/${id}`)
}

/** Attaches to the window showing a page under `origin`, waiting up to `timeoutMs` for one. */
export async function attach(port: number, origin: string, timeoutMs = 60000): Promise<Page & { id: string }> {
  const start = Date.now()
  let target: Target | undefined
  while (!(target = (await pages(port).catch(() => [])).find((t) => t.url.startsWith(origin)))) {
    if (Date.now() - start > timeoutMs) throw new Error(`no window on ${origin}`)
    await new Promise((r) => setTimeout(r, 250))
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let nextId = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  const handlers = new Map<string, Array<(params: any) => void>>()
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${msg.error.message}`))
      else p.resolve(msg.result)
    } else if (msg.method) {
      for (const handler of handlers.get(msg.method) ?? []) handler(msg.params)
    }
  }
  const send = <T,>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression: string) => {
    const r = await send<any>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${expression}`)
    return r.result.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  const page = {
    id: target.id,
    send,
    on(method: string, handler: (params: any) => void) {
      handlers.set(method, [...(handlers.get(method) ?? []), handler])
    },
    eval: evaluate,
    async waitFor(expression: string, timeoutMs = 8000) {
      const start = Date.now()
      for (;;) {
        const v = await evaluate(`Promise.resolve(${expression}).then((v) => !!v)`).catch(() => undefined)
        if (v) return v
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${expression}`)
        await new Promise((r) => setTimeout(r, 100))
      }
    },
    async goto(url: string) {
      await send('Page.navigate', { url })
      await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('#root > *')`)
    },
    async click(selector: string) {
      const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2} })()`)
      if (!box) throw new Error(`no element ${selector}`)
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
      }
    },
    async shot(file: string) {
      const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
    },
    detach() {
      ws.close()
    },
  }
  return page
}
```

`/tmp/binder-m9-e2e-scripts/check-app.ts`:

```ts
// The M9 check: the packaged Binder.app on a /tmp copy of the library, with Chromium's fake camera playing a feed of
// real card images, driven over its debugging port. It starts the app itself, so it can close the window, open Binder
// again, and quit it. No API key is in the copy, so nothing can reach Anthropic.
// usage: node check-app.ts <Binder.app> <library dir under /tmp> <feed.mjpeg> <shots dir>
import assert from 'node:assert/strict'
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { attach, closeTarget, type Page, pages } from './cdp.ts'

const [bundle, library, feed, shots] = process.argv.slice(2) as [string, string, string, string]
if (!library.startsWith('/tmp/')) throw new Error('the library must be a /tmp copy')
const PORT = 4455
const DEBUG = 9444
const B = `http://localhost:${PORT}`
const binary = path.join(bundle, 'Contents', 'MacOS', 'Binder')
const launch = (): ChildProcess =>
  spawn(binary, [`--remote-debugging-port=${DEBUG}`, '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${feed}`], {
    env: { ...process.env, BINDER_DATA_DIR: library, PORT: String(PORT) },
    stdio: 'ignore',
  })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(what: string, test: () => Promise<boolean> | boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (!(await test())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${what}`)
    await sleep(250)
  }
}
const healthy = () => fetch(`${B}/api/health`).then((r) => r.ok, () => false)
const running = () => {
  try {
    return execFileSync('/usr/bin/pgrep', ['-f', bundle]).toString().trim().split('\n').length
  } catch {
    return 0
  }
}

/** Console errors a page logs; the check fails on any. */
const errors: string[] = []
function watch(page: Page): void {
  page.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error' || type === 'assert') errors.push(`console.${type}: ${args.map((a: any) => a.value ?? a.description).join(' ')}`)
  })
  page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => errors.push(`exception: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`))
}

// 1. Binder.app starts on the library and its window shows Binder's pages.
const app = launch()
let exitCode: number | null = null
app.on('exit', (code) => (exitCode = code))
await until('the server answers', healthy, 60000)
let page = await attach(DEBUG, B)
watch(page)
await page.waitFor(`document.title === 'Binder' && !!document.querySelector('header nav')`, 20000)
await page.shot(`${shots}/1-window.png`)
console.log('--- window: Binder at', await page.eval('location.href'))

// 2. Scan with the fake camera in auto mode: it learns the empty mat, then captures each card once, and Binder reads
// them with the OCR helper inside the app.
await page.goto(`${B}/scan`)
const mode = `[...document.querySelectorAll('[role="radiogroup"][aria-label="Capture mode"] [role="radio"]')]`
await page.waitFor(`${mode}.length === 2`, 20000)
await page.eval(`${mode}.find((b) => b.textContent.trim() === 'Auto').click()`)
await page.waitFor(`document.body.textContent.includes('Auto: ready. Place a card in the guide.')`, 20000)
const items = () => page.eval<any[]>(`fetch('/api/scan/items').then((r) => r.json()).then((q) => q.items)`)
await until('two scans read', async () => (await items()).filter((i) => i.card).length >= 2, 60000)
const scanned = await items()
console.log('--- scans:', scanned.map((i) => `${i.card?.name} (${i.status}${i.sameCardAsBefore ? ', same card' : ''})`).join('; '))
assert.equal(scanned.length, 2, 'one capture per card, none of the empty mat')
await page.shot(`${shots}/2-scan.png`)

// 3. Only web links leave the window (for the browser); anything else opens nothing.
const windowsBefore = (await pages(DEBUG)).length
assert.equal(await page.eval(`window.open('file:///etc/hosts') === null`), true)
await sleep(500)
assert.equal((await pages(DEBUG)).length, windowsBefore)

// 4. Closing the window keeps Binder running; opening Binder again brings a window back on its pages.
page.detach()
await closeTarget(DEBUG, page.id)
await until('the window closed', async () => (await pages(DEBUG)).length === 0, 10000)
await sleep(1000)
assert.equal(await healthy(), true, 'Binder keeps running with its window closed')
assert.equal(exitCode, null)
const again = launch()
const againExit = await new Promise<number | null>((resolve) => again.on('exit', resolve))
assert.equal(againExit, 0, 'a second Binder hands over to the first and quits')
page = await attach(DEBUG, B, 15000)
watch(page)
await page.waitFor(`!!document.querySelector('header nav')`, 20000)
await page.shot(`${shots}/3-reopened.png`)
console.log('--- reopened: one Binder, window back on', await page.eval('location.href'))
page.detach()

// 5. Quitting stops everything: the app, its server and OCR helper, the port, and the library closes cleanly.
execFileSync('/usr/bin/osascript', ['-e', `tell application "${bundle}" to quit`])
await until('Binder quit', () => exitCode !== null, 20000)
await until('every Binder process ended', () => running() === 0, 10000)
assert.equal(await healthy(), false)
assert.equal(fs.existsSync(path.join(library, 'binder.db-wal')), false, 'the library closed cleanly')
const log = fs.readFileSync(path.join(library, 'Logs', 'binder.log'), 'utf8').trim().split('\n')
assert.equal(log.at(-1), 'Binder stopped')
console.log('--- quit: exit', exitCode, '· log ends', JSON.stringify(log.at(-1)))

if (errors.length > 0) {
  console.log(`console errors:\n${errors.join('\n')}`)
  process.exit(1)
}
console.log('app check passed')
```

- [ ] **Step 2: Build the app, copy the library, fetch two cards, and build the feed**

Check first that nothing listens on 4455 or 9444, and that Binder.app isn't running from `release/`.

```bash
pnpm app --no-install
mkdir -p /tmp/binder-m9-e2e/lib /tmp/binder-m9-e2e/shots /tmp/binder-m9-e2e-scripts/cards
sqlite3 -readonly /Users/kasonsuchow/Documents/localdev/binder/data/binder.db ".backup /tmp/binder-m9-e2e/lib/binder.db"
cd /tmp/binder-m9-e2e-scripts/cards
for card in m15/145 woe/201; do
  curl -sL -A 'Binder/0.1 (personal)' -o "${card/\//-}.jpg" "https://api.scryfall.com/cards/$card?format=image&version=large"
  sleep 0.2
done
cd .. && swiftc -O make-frames.swift -o make-frames && ./make-frames /tmp/binder-m9-e2e/feed.mjpeg cards/m15-145.jpg cards/woe-201.jpg
cd -
```

Expected: `Built …/release/mac-arm64/Binder.app`; two JPEGs (Goblin Rabblemaster, Ash, Party Crasher);
`wrote 61884630 bytes` (about 62 MB).

- [ ] **Step 3: Run the check**

A Binder window shows on the screen for about a minute.

Run: `node /tmp/binder-m9-e2e-scripts/check-app.ts "$PWD/release/mac-arm64/Binder.app" /tmp/binder-m9-e2e/lib /tmp/binder-m9-e2e/feed.mjpeg /tmp/binder-m9-e2e/shots | tee /tmp/binder-m9-e2e/check.log`

Expected (the prototype's run):

```
--- window: Binder at http://localhost:4455/
--- scans: Goblin Rabblemaster (confident); Ash, Party Crasher (confident)
--- reopened: one Binder, window back on http://localhost:4455/
--- quit: exit 0 · log ends "Binder stopped"
app check passed
```

Look at the screenshots and describe them in the report: `1-window` (Look up in the app's window), `2-scan` (Scan in
Auto with the fake camera: "Auto: captured. Lift the card for the next one.", the two cards in the queue, no capture of
the empty mat), `3-reopened` (the window back on Binder's pages).

- [ ] **Step 4: Clean up**

Confirm that `pgrep -f release/mac-arm64/Binder.app` prints nothing and nothing listens on 4455 or 9444; copy
`check.log` and the screenshots to wherever your brief asks for evidence; then
`rm -rf /tmp/binder-m9-e2e /tmp/binder-m9-e2e-scripts` and check `find $TMPDIR -maxdepth 1 -name 'binder-*' | wc -l` is 0.

- [ ] **Step 5: The spec**

In `docs/specs/2026-09-26-binder-design.md`, §2 Decisions: replace

```markdown
| Port | `127.0.0.1:4321` (localhost only). |
```

with:

```markdown
| Port | `127.0.0.1:4321` (localhost only), for Binder.app and `pnpm start` alike. |
| Desktop app | **Binder.app**, an Electron 44 app built on this Mac (`pnpm app`): its own window and a menu-bar icon, the server in Electron's utility process, the library in `~/Library/Application Support/Binder` (the owner's choices, 2026-09-28). `pnpm start` still runs Binder from the terminal on the project's `data/`. |
```

In `docs/specs/2026-09-26-binder-design.md`, §3 Architecture (the diagram): replace

```markdown
iPhone ──USB (Continuity Camera)──► Mac camera ──► Browser (React SPA)
                                                      │  HTTP + SSE
                                                      ▼
                        Hono server (Node 24) ── SQLite  data/binder.db
```

with:

```markdown
iPhone ──USB (Continuity Camera)──► Mac camera ──► Binder.app's window, or a browser (React SPA)
                                                      │  HTTP + SSE
                                                      ▼
                        Hono server (Node 24) ── SQLite  binder.db (§3.4: Binder.app's, or the project's data/)
```

In `docs/specs/2026-09-26-binder-design.md`, §3.1 Project layout: replace

```markdown
  scripts/                ocr-benchmark, fixture fetcher
```

with:

```markdown
  electron/               Binder.app (§3.4): its main process (window, menu-bar icon), the server's process, paths
  scripts/                ocr-benchmark, fixture fetcher, `pnpm app`, `pnpm move-library`, make-icons.swift
  build/, release/        the drawn icons, and the packaged Binder.app (generated)
```

In `docs/specs/2026-09-26-binder-design.md`, §3.2 Commands: replace

```markdown
- `pnpm start`: build the SPA, then serve it and the API from the Hono server at `http://localhost:4321`.
```

with:

```markdown
- `pnpm start`: build the SPA, then serve it and the API from the Hono server at `http://localhost:4321`, on the project's `data/` (saying so when Binder.app keeps its own library).
- `pnpm app`: build Binder.app and put it in `/Applications` (§3.4); `pnpm app --no-install` leaves it in `release/`.
- `pnpm app:dev`: Binder.app's window run from the project, on `data/`, without packaging it.
- `pnpm move-library`: copy the library from `data/` to Binder.app's folder, once (§3.4).
- `pnpm icons`: draw the app and menu-bar icons into `build/icons/`.
```

In `docs/specs/2026-09-26-binder-design.md`, §3.3 Key dependencies, and a new §3.4 Binder.app: replace

```markdown
`hono`, `@hono/node-server`, `better-sqlite3`, `@anthropic-ai/sdk`, `zod`, `react`, `react-router`, `@tanstack/react-query`, `tailwindcss` v4, `vitest`.
```

with:

```markdown
`hono`, `@hono/node-server`, `better-sqlite3`, `@anthropic-ai/sdk`, `zod`, `react`, `react-router`, `@tanstack/react-query`, `tailwindcss` v4, `vitest`, and for Binder.app `electron` and `electron-builder`. Only the server's packages are runtime dependencies (they're what Binder.app ships); the SPA's are built into it.

### 3.4 Binder.app
- **The app** (`electron/`): one window onto Binder's pages (at `http://localhost:4321`, as from the terminal), a menu-bar icon (Open Binder, Quit Binder), and Binder's server (`startBinder`, `src/server/start.ts`) in Electron's utility process, so the window and the icon stay responsive while the library does slow work. Closing the window keeps Binder running (scans finish, card data refreshes) and lets go of the camera; the Dock or menu-bar icon opens it again. Cmd+Q or Quit Binder stops the server first (it closes the library; 5 s at most), then the app. One Binder at a time: opening it again brings its window forward. Web links (`http:`, `https:`) open in the browser and other links nowhere; Binder's own pages stay in the window. The menus are Binder, Edit, View (reload, zoom, full screen), and Window.
- **Starting**: until the server listens, the window says "Starting…", or "Backing up your library before upgrading it (a few seconds)…" while a migration's backup is saved (§6 Backups). A library that can't be opened, a port in use, or a `PORT` that isn't a port number is said in a dialog, in the server's one line, and Binder quits; for a port in use, the dialog says Binder may already be running from the terminal. A server that stops unexpectedly is said in a dialog too.
- **Where things are**: the library is `~/Library/Application Support/Binder` (`binder.db`, `backups/`, `bulk/`, `scans/`, and the API key's `.env`), with the window's own files in its `Electron/` and the server's log in `Logs/binder.log` (the run before in `binder.previous.log`). Run from the project (`pnpm app:dev`), it's the project's `data/`. `BINDER_DATA_DIR` and `PORT` override both, for checks.
- **Camera**: only Binder's own pages may use it, with the Mac's permission, asked for once (`NSCameraUsageDescription`). The app declares Continuity Camera (`NSCameraUseContinuityCameraDeviceType`), which macOS requires before it lists an iPhone to an app. Chromium's fake camera (the end-to-end check's) needs no permission.
- **Building**: `pnpm app` draws the icons (`scripts/make-icons.swift`: a 9-pocket binder page in stone and amber), builds the SPA and the OCR helper, packages Binder.app with electron-builder (the files as they are, no asar; ad-hoc signed; the OCR helper built in, so the app never needs Xcode's tools; the server's runtime packages only), and replaces `/Applications/Binder.app`, refusing while it runs.
- **Moving the library** (once): `pnpm move-library` copies `data/` to Binder.app's folder: the database through SQLite's backup (whole even while its log holds changes), checked before it's put in place, then `backups/`, `bulk/`, and `scans/`. It refuses while Binder runs, when there's no library to move, or when the folder already holds a library with anything added to it (one Binder.app made before the move, with nothing added, is replaced). `data/` is left as it was, and the key isn't copied: it's entered again in Settings.
```

In `docs/specs/2026-09-26-binder-design.md`, §6 Startup: replace

```markdown
- **Startup**: a port already in use, or a `PORT` that isn't a port number, prints one line saying so and exits with status 1. Scans a restart interrupted are picked up again only once the server is listening, so a second Binder started while one runs leaves the running one's scans alone.
```

with:

```markdown
- **Startup**: a port already in use, or a `PORT` that isn't a port number, prints one line saying so and exits with status 1 (Binder.app says it in a dialog and quits, §3.4). A library that can't be opened is said the same way, the library left as it was. Scans a restart interrupted are picked up again only once the server is listening, so a second Binder started while one runs leaves the running one's scans alone.
```

In `docs/specs/2026-09-26-binder-design.md`, §7 Testing: replace

```markdown
- **Manual**: the scanner end-to-end with the iPhone, and brainstorm with a real key.
```

with:

```markdown
- **Binder.app**: its paths, links, and messages are unit-tested, as are `startBinder` and the library move; the packaged app is checked end to end on a copy of the library with Chromium's fake camera (the M9 plan's Task 5): its window, auto mode through the OCR helper inside it, closing and opening it again, and quitting.
- **Manual**: the scanner end-to-end with the iPhone (in Binder.app too), and brainstorm with a real key.
```

In `docs/specs/2026-09-26-binder-design.md`, §8 Build milestones: replace

```markdown
8. **Polish**: the follow-ups left in `docs/plans/m*-followups.md`, empty states, keyboard shortcuts.
```

with:

```markdown
8. **Polish**: the follow-ups left in `docs/plans/m*-followups.md`, empty states, keyboard shortcuts.
9. **Binder.app**: a Mac app with its own window and menu-bar icon, and the library in Application Support (§3.4).
```

- [ ] **Step 6: The README**

In `README.md`, the opening line: replace

```markdown
Personal MTG collection manager. Runs locally at http://localhost:4321.
```

with:

```markdown
Personal MTG collection manager for this Mac: open Binder.app, or run `pnpm start` in a terminal. Either way it's at
http://localhost:4321.
```

In `README.md`, after First run, a new Binder.app section: replace

```markdown
deck. Press `?` (anywhere but a text box or dropdown) for the keyboard shortcuts.
```

with:

````markdown
deck. Press `?` (anywhere but a text box or dropdown) for the keyboard shortcuts.

## Binder.app

Binder also comes as a Mac app, with its own window and a menu-bar icon. Build it and put it in Applications with:

```bash
pnpm app            # draws the icons, builds the UI and the OCR helper, packages Binder.app, installs it
```

The first time, move your library into it, with Binder quit:

```bash
pnpm move-library   # copies data/ to ~/Library/Application Support/Binder; data/ is left as it was
```

Then open Binder from Spotlight, Launchpad, or Applications, and enter your Anthropic API key again in Settings (it
isn't copied). Closing the window keeps Binder running in the menu bar, so scans finish and card data refreshes;
click the menu-bar icon (or the Dock icon) to open it again, and **Quit Binder** there, or Cmd+Q, to stop it. Opening
Binder again while it runs brings its window forward, and links to Scryfall and other sites open in your browser.
The first time you open Scan, macOS asks whether Binder may use the camera; your iPhone appears through Continuity
Camera as it does in a browser. Binder.app is signed on this Mac, not by a developer account, so macOS may ask
again after an update.

Binder.app keeps everything in `~/Library/Application Support/Binder`: the library, its backups and card data, the
key, its window's own files (`Electron/`), and the server's log (`Logs/binder.log`, the run before in
`binder.previous.log`). To update it, quit Binder and run `pnpm app` again. `pnpm start` still runs Binder from the
terminal on the project's `data/`, and says so when Binder.app keeps its own library.
````

In `README.md`, Development: replace

```markdown
pnpm dev            # API on :4321 (auto-restarts) + Vite on http://localhost:5173
```

with:

```markdown
pnpm dev            # API on :4321 (auto-restarts) + Vite on http://localhost:5173
pnpm app:dev        # Binder.app's window, run from the project on data/ (no packaging)
pnpm app --no-install   # packages Binder.app into release/ without installing it
```

In `README.md`, restoring a backup: replace

```markdown
To restore a backup, stop Binder and copy it over `data/binder.db` (deleting `binder.db-wal` and
`binder.db-shm`). Set `BINDER_DATA_DIR` to use a different folder.
```

with:

```markdown
To restore a backup, stop Binder and copy it over `data/binder.db` (Binder.app's is
`~/Library/Application Support/Binder/binder.db`), deleting `binder.db-wal` and `binder.db-shm`. Set
`BINDER_DATA_DIR` to use a different folder.
```

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm build`

Expected: typecheck clean; 936 tests pass; the build has no warning.

- [ ] **Step 8: Commit**

Commit (never `.env`, `data/`, `build/`, or `release/`; `git status --short` shows nothing else of this task left):

```bash
git add docs/specs/2026-09-26-binder-design.md README.md && git commit -q -F - <<'EOF'
M9 Task 5: Binder.app in the spec and README

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9gnXZcph52ErfVjYZXZbf
EOF
```

---

## After the plan: installing Binder.app and moving the library (with the owner)

After the final review and its fix wave, and only with the owner's OK at that moment:

1. The owner quits Binder in the terminal if it runs (nothing on port 4321).
2. `pnpm install` (the main checkout doesn't have Electron or electron-builder yet), then `pnpm app` builds Binder.app
   and puts it in `/Applications`.
3. With the owner's OK: `pnpm move-library`. Report its summary line (copies, cards, decks).
4. The owner opens Binder from Spotlight, allows the camera on Scan, picks the iPhone, enters the API key again in
   Settings → Anthropic API key, and checks the collection and decks are all there.
5. `data/` stays as it was until the owner says it can go.
