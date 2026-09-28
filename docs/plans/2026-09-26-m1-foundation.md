# Binder M1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally running Binder app that mirrors Scryfall's card data into SQLite, keeps it fresh, and lets me look up any card (autocomplete → detail drawer with faces, legalities, prices, printings), with a Settings page to watch and trigger card-data refreshes.

**Architecture:** A single pnpm package. A Hono API server runs TypeScript directly on Node 24 (built-in type stripping, no build step for the server). SQLite via `better-sqlite3` holds a mirror of Scryfall's `default_cards` bulk data, imported by streaming gzipped JSONL into a staging table and upserting in one transaction. A Vite + React SPA talks to `/api/*`. In dev, Vite proxies to the server. With `pnpm start`, the server serves the built SPA.

**Tech Stack:** Node 24, TypeScript 7, Hono 4 + @hono/node-server 2, better-sqlite3 13 (SQLite 3.53, FTS5 trigram), zod 4, React 19, React Router 8, TanStack Query 5, Tailwind 4, Vite 8, Vitest 5.

**Spec:** `docs/specs/2026-09-26-binder-design.md` (this plan covers milestone 1 of §8).

**Spec deviations (intentional, flagged for review):**
1. The trigram FTS index covers a per-card-identity `card_names` table (normalized name including face names), not every printing's oracle text. Autocomplete and later OCR matching want unique names. `o:` rules-text search (M2) uses `LIKE`, which is fast enough at this data size.
2. The import also skips `oversized` cards and the `token`, `double_faced_token`, `emblem`, and `art_series` layouts. None of these are real deck cards.
3. The setup script runs as `pnpm run setup`, because `pnpm setup` is a pnpm built-in command.
4. Double-faced cards with no top-level `colors` get the union of their faces' colors.

## Global Constraints

- The server listens on `127.0.0.1:4321` only (`PORT` env var may override the port; the host is fixed).
- Node `>=24`. Server TypeScript runs directly under Node's type stripping, so every relative import uses an explicit `.ts`/`.tsx` extension. Code must be erasable syntax only: no `enum`, no `namespace`, no constructor parameter properties (enforced by `erasableSyntaxOnly`).
- Exact dependency versions:
  - hono 4.13.9, @hono/node-server 2.1.1, better-sqlite3 13.0.3, zod 4.6.5
  - react / react-dom 19.3.0, react-router 8.4.0, @tanstack/react-query 5.104.0
  - vite 8.3.1, @vitejs/plugin-react 6.1.1, tailwindcss / @tailwindcss/vite 4.3.3, vitest 5.0.2, typescript 7.0.2
  - @types/node 26.6.3, @types/better-sqlite3 9.6.0, @types/react / @types/react-dom 19.3.0, concurrently 10.0.5
- pnpm 10 blocks install scripts, so `package.json` must contain `"pnpm": { "onlyBuiltDependencies": ["better-sqlite3", "esbuild"] }`.
- Every Scryfall request sends `User-Agent: Binder/0.1 (personal)` and `Accept: application/json` (`*/*` for file downloads). Request starts are spaced at least 100 ms apart. A 429 is retried after 1 s, 2 s, then 4 s; the 4th consecutive 429 fails.
- Bulk source is `GET https://api.scryfall.com/bulk-data/default-cards`, then `jsonl_download_uri` (gzipped JSONL, one card per line). Data is stale when `meta.bulk_updated_at` is missing or older than 7 days.
- API errors are always JSON: `{ "error": { "code": string, "message": string } }`.
- SQLite runs with `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- Colors are stored as letter strings in WUBRG order (`''` = colorless).
- Runtime data lives in `<project>/data/` (override with `BINDER_DATA_DIR`).
- **This project is not a git repository.** Every task ends with a checkpoint step (`pnpm typecheck && pnpm test` green) instead of a commit. Do not run `git init`.
- UI: dark `stone` palette, `amber` accent, Tailwind utility classes only (no component library).

## Review Focus

1. **Accents, ligatures, apostrophes, hyphens in card names.** Typing `aether vial` must find "Æther Vial", and `lim dul` or `lim-dul's` must find "Lim-Dûl's Vault". *Test: Task 3, "ignores diacritics, ligatures, and punctuation".*
2. **Search-syntax characters in the lookup box.** Input like `bolt"`, `OR`, `NEAR(`, `*`, or a lone `"` must never cause a 500. Punctuation-only input returns no results. *Tests: Task 3, "never throws on search-syntax characters"; Task 6, "tolerates search syntax in autocomplete".*
3. **One- and two-letter queries.** The trigram index needs 3 characters, so shorter queries must fall back to prefix matching instead of returning nothing. *Test: Task 3, "uses prefix matching for 1–2 character queries".*
4. **Interrupted or corrupted card-data downloads.** A truncated gzip, a malformed line, or a file with no importable cards must fail with a clear message and leave the previous card data fully usable. *Tests: Task 5, the three "rejects…" cases.*
5. **Overlapping refreshes.** A refresh requested while one is running (auto-refresh at startup plus a click in Settings) is refused with a 409, never run twice. *Tests: Task 5, "refuses to start a second import while one is running"; Task 6, "refuses a second refresh while one runs".*

---

## File map

```
package.json, tsconfig.json, vitest.config.ts, vite.config.ts
scripts/
  fetch-fixtures.ts        one-off: pinned Scryfall printings → tests/fixtures/cards.json
  setup.ts                 `pnpm run setup`: create DB + first card-data import
  seed-dev.ts              seed a throwaway DB with fixtures for UI work
src/shared/
  normalize.ts             normalizeName(): matching key for card names
  types.ts                 API types shared by server and web
src/server/
  config.ts                paths, host, port
  http.ts                  ApiError, parseWith (zod → 400)
  app.ts                   createApp(deps): Hono app, error handling, route mounting, SPA serving
  main.ts                  entry: open DB, build app, listen, auto-refresh stale data
  db/index.ts              openDb(): pragmas + migrations; DB type
  db/migrate.ts            numbered .sql migrations
  db/migrations/001_init.sql   every table from spec §4.1
  db/meta.ts               getMeta / setMeta
  scryfall/types.ts        Scryfall JSON shapes we read
  scryfall/client.ts       rate-limited, retrying Scryfall HTTP client
  cards/map.ts             Scryfall card → CardRow (pure)
  cards/repo.ts            insert, name index, getCard, getPrintings, autocomplete
  cards/routes.ts          /api/cards/*
  bulk/import.ts           importCardsFile() + createBulkImporter()
  bulk/routes.ts           /api/bulk/*
src/web/
  index.html, index.css, main.tsx, routes.tsx
  lib/api.ts, lib/card-drawer.tsx, lib/use-debounced.ts, lib/format.ts
  components/Layout.tsx, QuickFind.tsx, CardDrawer.tsx, ManaText.tsx
  pages/HomePage.tsx, pages/SettingsPage.tsx
tests/
  fixtures/cards.json      61 real Scryfall printings (generated by Task 2)
  helpers/fixtures.ts      loadFixtureCards, fixtureCard, syntheticCard
  helpers/db.ts            createTestDb, fixtureRows, count, tableExists
  shared/normalize.test.ts
  server/db.test.ts, cards-map.test.ts, cards-repo.test.ts, scryfall-client.test.ts, bulk-import.test.ts, api.test.ts
```

---

### Task 1: Project scaffold and database layer

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/server/config.ts`, `src/server/db/index.ts`, `src/server/db/migrate.ts`, `src/server/db/migrations/001_init.sql`, `src/server/db/meta.ts`
- Test: `tests/server/db.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type DB = Database.Database`
  - `openDb(file: string): DB` (`':memory:'` allowed; creates parent dirs; applies pragmas and migrations)
  - `migrate(db: DB): void`
  - `getMeta(db: DB, key: string): string | null`
  - `setMeta(db: DB, key: string, value: string | null): void` (`null` deletes)
  - `ROOT_DIR`, `DATA_DIR`, `DB_PATH`, `WEB_DIST_DIR`, `HOST`, `PORT` from `config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "binder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "concurrently -k -n server,web -c blue,magenta \"node --watch src/server/main.ts\" \"vite\"",
    "build": "vite build",
    "start": "vite build && node src/server/main.ts",
    "setup": "node scripts/setup.ts",
    "fixtures": "node scripts/fetch-fixtures.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p ."
  },
  "pnpm": { "onlyBuiltDependencies": ["better-sqlite3", "esbuild"] }
}
```

- [ ] **Step 2: Install pinned dependencies**

Run:
```bash
pnpm add --save-exact hono@4.13.9 @hono/node-server@2.1.1 better-sqlite3@13.0.3 zod@4.6.5 react@19.3.0 react-dom@19.3.0 react-router@8.4.0 @tanstack/react-query@5.104.0
pnpm add --save-exact -D vite@8.3.1 @vitejs/plugin-react@6.1.1 tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 vitest@5.0.2 typescript@7.0.2 @types/node@26.6.3 @types/better-sqlite3@9.6.0 @types/react@19.3.0 @types/react-dom@19.3.0 concurrently@10.0.5
node -e "const D=require('better-sqlite3'); console.log(new D(':memory:').prepare('select sqlite_version() v').get())"
```
Expected: the last command prints `{ v: '3.53.4' }` (or newer). If it throws "Could not locate the bindings file", the `onlyBuiltDependencies` field is missing. Fix it and run `pnpm rebuild better-sqlite3`.

- [ ] **Step 3: Create `tsconfig.json` and `vitest.config.ts`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "types": ["node", "vite/client"]
  },
  "include": ["src", "tests", "scripts", "vite.config.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Write the failing database tests**

`tests/server/db.test.ts`:
```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../../src/server/db/index.ts'
import { migrate } from '../../src/server/db/migrate.ts'
import { getMeta, setMeta } from '../../src/server/db/meta.ts'

describe('database', () => {
  it('creates every table from the spec', () => {
    const db = openDb(':memory:')
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[]
    for (const table of [
      'cards', 'card_names', 'card_names_fts', 'collection', 'decks', 'deck_cards',
      'scan_items', 'ai_threads', 'ai_messages', 'meta', 'schema_migrations',
    ]) {
      expect(names).toContain(table)
    }
  })

  it('applies each migration only once', () => {
    const db = openDb(':memory:')
    const before = db.prepare('SELECT count(*) FROM schema_migrations').pluck().get()
    migrate(db)
    expect(db.prepare('SELECT count(*) FROM schema_migrations').pluck().get()).toBe(before)
  })

  it('enforces foreign keys', () => {
    const db = openDb(':memory:')
    expect(() =>
      db.prepare(
        "INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES ('missing', 'nonfoil', 1, 't', 't')",
      ).run(),
    ).toThrow(/FOREIGN KEY/)
  })

  it('creates parent directories and uses WAL for file databases', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-db-'))
    const db = openDb(path.join(dir, 'nested', 'test.db'))
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    db.close()
  })

  it('reads, overwrites, and deletes meta values', () => {
    const db = openDb(':memory:')
    expect(getMeta(db, 'k')).toBeNull()
    setMeta(db, 'k', 'v1')
    setMeta(db, 'k', 'v2')
    expect(getMeta(db, 'k')).toBe('v2')
    setMeta(db, 'k', null)
    expect(getMeta(db, 'k')).toBeNull()
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm test tests/server/db.test.ts`
Expected: FAIL, because `../../src/server/db/index.ts` cannot be resolved.

- [ ] **Step 6: Implement config, openDb, migrations, and meta**

`src/server/config.ts`:
```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DATA_DIR = process.env.BINDER_DATA_DIR
  ? path.resolve(process.env.BINDER_DATA_DIR)
  : path.join(ROOT_DIR, 'data')
export const DB_PATH = path.join(DATA_DIR, 'binder.db')
export const WEB_DIST_DIR = path.join(ROOT_DIR, 'dist', 'web')
export const HOST = '127.0.0.1'
export const PORT = Number(process.env.PORT ?? 4321)
```

`src/server/db/index.ts`:
```ts
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from './migrate.ts'

export type DB = Database.Database

/** Opens (creating if needed) the SQLite database, applies pragmas, and runs pending migrations. */
export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}
```

`src/server/db/migrate.ts`:
```ts
import fs from 'node:fs'
import type { DB } from './index.ts'

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url)

/** Applies every `NNN_name.sql` file in migrations/ that hasn't run yet, each in its own transaction. */
export function migrate(db: DB): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  )
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all() as number[])
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort()
  for (const file of files) {
    const version = Number(file.slice(0, 3))
    if (applied.has(version)) continue
    const sql = fs.readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        file,
        new Date().toISOString(),
      )
    })()
  }
}
```

`src/server/db/migrations/001_init.sql`:
```sql
-- Scryfall mirror: one row per paper printing.
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  oracle_id TEXT NOT NULL,
  name TEXT NOT NULL,
  face_names TEXT NOT NULL,
  search_name TEXT NOT NULL,
  lang TEXT NOT NULL,
  layout TEXT NOT NULL,
  released_at TEXT NOT NULL,
  set_code TEXT NOT NULL,
  set_name TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  rarity TEXT NOT NULL,
  mana_cost TEXT NOT NULL,
  cmc REAL NOT NULL,
  type_line TEXT NOT NULL,
  oracle_text TEXT NOT NULL,
  flavor_text TEXT,
  power TEXT,
  toughness TEXT,
  loyalty TEXT,
  power_num REAL,
  toughness_num REAL,
  loyalty_num REAL,
  colors TEXT NOT NULL,
  color_identity TEXT NOT NULL,
  keywords TEXT NOT NULL,
  legalities TEXT NOT NULL,
  games TEXT NOT NULL,
  finishes TEXT NOT NULL,
  artist TEXT,
  prices TEXT NOT NULL,
  image_normal TEXT,
  image_small TEXT,
  image_art_crop TEXT,
  card_faces TEXT,
  purchase_uris TEXT,
  scryfall_uri TEXT NOT NULL,
  is_promo INTEGER NOT NULL DEFAULT 0,
  is_digital INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cards_oracle ON cards (oracle_id);
CREATE INDEX cards_set_number ON cards (set_code, collector_number);
CREATE INDEX cards_name ON cards (name COLLATE NOCASE);

-- One row per card identity (oracle_id) for autocomplete and OCR matching.
CREATE TABLE card_names (
  oracle_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  face_names TEXT NOT NULL,
  search_name TEXT NOT NULL,
  default_card_id TEXT NOT NULL
);
CREATE INDEX card_names_search ON card_names (search_name);
CREATE VIRTUAL TABLE card_names_fts USING fts5 (
  search_name,
  content = 'card_names',
  content_rowid = 'rowid',
  tokenize = 'trigram'
);

CREATE TABLE collection (
  id INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards (id),
  finish TEXT NOT NULL CHECK (finish IN ('nonfoil', 'foil', 'etched')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (card_id, finish)
);

CREATE TABLE decks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prospective', 'built')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE deck_cards (
  id INTEGER PRIMARY KEY,
  deck_id INTEGER NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  oracle_id TEXT NOT NULL,
  preferred_card_id TEXT REFERENCES cards (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  board TEXT NOT NULL CHECK (board IN ('commander', 'main', 'side', 'maybe')),
  category TEXT,
  UNIQUE (deck_id, oracle_id, board)
);
CREATE INDEX deck_cards_oracle ON deck_cards (oracle_id);

CREATE TABLE scan_items (
  id INTEGER PRIMARY KEY,
  image_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'identifying', 'confident', 'review', 'committed', 'discarded')),
  method TEXT CHECK (method IN ('ocr', 'claude', 'manual')),
  ocr_json TEXT,
  candidates TEXT NOT NULL DEFAULT '[]',
  card_id TEXT REFERENCES cards (id),
  finish TEXT NOT NULL DEFAULT 'nonfoil' CHECK (finish IN ('nonfoil', 'foil', 'etched')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  confidence REAL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX scan_items_status ON scan_items (status);

CREATE TABLE ai_threads (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  deck_id INTEGER REFERENCES decks (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES ai_threads (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

`src/server/db/meta.ts`:
```ts
import type { DB } from './index.ts'

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

/** Sets a meta value; `null` deletes the key. */
export function setMeta(db: DB, key: string, value: string | null): void {
  if (value === null) {
    db.prepare('DELETE FROM meta WHERE key = ?').run(key)
    return
  }
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test tests/server/db.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

---

### Task 2: Test fixtures and Scryfall → row mapping

**Files:**
- Create: `scripts/fetch-fixtures.ts`, `tests/fixtures/cards.json` (generated)
- Create: `src/server/scryfall/types.ts`, `src/shared/normalize.ts`, `src/server/cards/map.ts`
- Create: `tests/helpers/fixtures.ts`
- Test: `tests/shared/normalize.test.ts`, `tests/server/cards-map.test.ts`

**Interfaces:**
- Consumes: Task 1's tsconfig/vitest setup
- Produces:
  - `normalizeName(name: string): string`
  - Types: `ScryfallCard`, `ScryfallCardFace`, `ScryfallImageUris`, `ScryfallBulkData`, `ScryfallErrorBody`
  - `interface CardRow` (39 columns, see code), `interface StoredFace`, `CARD_COLUMNS` (readonly tuple of CardRow keys in table order)
  - `canonColors(colors: readonly string[]): string`
  - `toNum(value: string | null | undefined): number | null`
  - `shouldImport(card: ScryfallCard): boolean`
  - `scryfallToRow(card: ScryfallCard): CardRow | null`
  - Test helpers: `loadFixtureCards(): ScryfallCard[]`, `fixtureCard(name: string, set?: string): ScryfallCard`, `syntheticCard(overrides: Partial<ScryfallCard>): ScryfallCard`

- [ ] **Step 1: Write and run the fixture fetcher**

`scripts/fetch-fixtures.ts`:
```ts
// Fetches the pinned fixture printings from Scryfall into tests/fixtures/cards.json.
// Run once with `pnpm fixtures`. Tests only ever read the saved file.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// [set, collector number]: each pin covers an edge case (DFC, split, adventure, flip, X/hybrid/Phyrexian
// costs, colorless, basics, "any number", partners, planeswalkers, multiple printings of one card).
const FIXTURES: Array<[set: string, collectorNumber: string]> = [
  ['m10', '146'], ['m11', '149'], ['sta', '42'], // Lightning Bolt x3
  ['cmr', '472'], ['c21', '263'], // Sol Ring x2
  ['fdn', '227'], ['fdn', '740'], ['fra', '116'], ['inr', '60'], ['soc', '190'],
  ['dmr', '215'], ['chk', '2'], ['znr', '90'], ['clb', '175'], ['uma', '216'],
  ['nph', '35'], ['m21', '272'], ['m21', '263'], ['m21', '260'], ['m21', '266'],
  ['m21', '269'], ['frc', '22'], ['a25', '105'], ['c16', '46'], ['c16', '48'],
  ['2xm', '190'], ['2xm', '56'], ['leb', '233'], ['dsc', '114'], ['cmm', '70'],
  ['msc', '170'], ['znr', '232'], ['otc', '235'], ['dsc', '273'], ['dmr', '233'],
  ['2x2', '1'], ['fdn', '216'], ['iko', '226'], ['dsc', '220'], ['2xm', '275'],
  ['frc', '20'], ['frc', '37'], ['msc', '793'], ['2xm', '109'], ['m21', '1'],
  ['m21', '176'], ['10e', '268'], ['leb', '48'], ['moc', '343'], ['mkm', '218'],
  ['rvr', '232'], ['msc', '169'], ['msc', '172'], ['j22', '114'], ['cmm', '57'],
  ['trk', '299'], ['mom', '194'], ['cmd', '157'], ['mh2', '12'], ['hoc', '205'],
  ['inr', '287'],
]

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/cards.json')
const res = await fetch('https://api.scryfall.com/cards/collection', {
  method: 'POST',
  headers: { 'User-Agent': 'Binder/0.1 (personal)', Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifiers: FIXTURES.map(([set, collector_number]) => ({ set, collector_number })) }),
})
if (!res.ok) throw new Error(`Scryfall returned ${res.status}: ${await res.text()}`)
const body = (await res.json()) as { data: unknown[]; not_found: unknown[] }
if (body.not_found.length > 0) throw new Error(`Fixtures not found: ${JSON.stringify(body.not_found)}`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, `${JSON.stringify(body.data, null, 1)}\n`)
console.log(`Wrote ${body.data.length} cards to ${out}`)
```

Run: `pnpm fixtures`
Expected: `Wrote 61 cards to …/tests/fixtures/cards.json`

- [ ] **Step 2: Create the Scryfall types and test helpers**

`src/server/scryfall/types.ts`:
```ts
// The subset of Scryfall's JSON that Binder reads. https://scryfall.com/docs/api/cards

export interface ScryfallImageUris {
  small?: string
  normal?: string
  large?: string
  art_crop?: string
}

export interface ScryfallCardFace {
  name: string
  oracle_id?: string
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  flavor_text?: string
  colors?: string[]
  power?: string
  toughness?: string
  loyalty?: string
  artist?: string
  image_uris?: ScryfallImageUris
}

export interface ScryfallCard {
  id: string
  oracle_id?: string
  name: string
  lang: string
  layout: string
  released_at: string
  set: string
  set_name: string
  collector_number: string
  rarity: string
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  flavor_text?: string
  power?: string
  toughness?: string
  loyalty?: string
  colors?: string[]
  color_identity: string[]
  keywords?: string[]
  legalities: Record<string, string>
  games: string[]
  finishes: string[]
  artist?: string
  prices: Record<string, string | null>
  image_uris?: ScryfallImageUris
  card_faces?: ScryfallCardFace[]
  purchase_uris?: Record<string, string>
  scryfall_uri: string
  promo: boolean
  digital: boolean
  oversized?: boolean
}

export interface ScryfallBulkData {
  type: string
  updated_at: string
  jsonl_download_uri?: string
  [key: string]: unknown
}

export interface ScryfallErrorBody {
  object: 'error'
  status: number
  code: string
  details: string
}
```

`tests/helpers/fixtures.ts`:
```ts
import fs from 'node:fs'
import type { ScryfallCard } from '../../src/server/scryfall/types.ts'

let cache: ScryfallCard[] | null = null

/** The 61 pinned fixture printings (fresh deep copy on every call). */
export function loadFixtureCards(): ScryfallCard[] {
  cache ??= JSON.parse(fs.readFileSync(new URL('../fixtures/cards.json', import.meta.url), 'utf8')) as ScryfallCard[]
  return structuredClone(cache)
}

export function fixtureCard(name: string, set?: string): ScryfallCard {
  const card = loadFixtureCards().find((c) => c.name === name && (set === undefined || c.set === set))
  if (!card) throw new Error(`No fixture card named ${name}${set ? ` in ${set}` : ''}`)
  return card
}

let syntheticCount = 0

/** A fake importable card based on Grizzly Bears, with unique ids, plus any overrides. */
export function syntheticCard(overrides: Partial<ScryfallCard>): ScryfallCard {
  syntheticCount++
  const suffix = String(syntheticCount).padStart(12, '0')
  return {
    ...fixtureCard('Grizzly Bears'),
    id: `00000000-0000-4000-8000-${suffix}`,
    oracle_id: `11111111-0000-4000-8000-${suffix}`,
    ...overrides,
  }
}
```

- [ ] **Step 3: Write the failing normalize and mapping tests**

`tests/shared/normalize.test.ts`:
```ts
import { expect, it } from 'vitest'
import { normalizeName } from '../../src/shared/normalize.ts'

it.each([
  ['Lightning Bolt', 'lightning bolt'],
  ['Æther Vial', 'aether vial'],
  ["Lim-Dûl's Vault", 'lim duls vault'],
  ["Atraxa, Praetors' Voice", 'atraxa praetors voice'],
  ['Fire // Ice', 'fire ice'],
  ['  Jötun   Grunt ', 'jotun grunt'],
  ['"*"', ''],
])('normalizes %j to %j', (input, expected) => {
  expect(normalizeName(input)).toBe(expected)
})
```

`tests/server/cards-map.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CARD_COLUMNS, canonColors, scryfallToRow, shouldImport, toNum } from '../../src/server/cards/map.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'

function row(name: string, set?: string) {
  const r = scryfallToRow(fixtureCard(name, set))
  if (!r) throw new Error(`no row for ${name}`)
  return r
}

describe('scryfallToRow', () => {
  it('maps a normal card', () => {
    const r = row('Lightning Bolt', 'm10')
    expect(r).toMatchObject({
      id: '435589bb-27c6-4a6d-9d63-394d5092b9d8',
      name: 'Lightning Bolt',
      face_names: 'Lightning Bolt',
      search_name: 'lightning bolt',
      set_code: 'm10',
      collector_number: '146',
      mana_cost: '{R}',
      cmc: 1,
      colors: 'R',
      color_identity: 'R',
      power: null,
      power_num: null,
      card_faces: null,
      is_promo: 0,
      is_digital: 0,
    })
    expect(r.oracle_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.image_normal).toMatch(/^https:\/\/cards\.scryfall\.io\//)
    expect(Object.keys(JSON.parse(r.prices)).sort()).toEqual(['usd', 'usd_etched', 'usd_foil'])
    expect(JSON.parse(r.legalities).modern).toBe('legal')
  })

  it('produces exactly the table columns', () => {
    expect(Object.keys(row('Lightning Bolt', 'm10')).sort()).toEqual([...CARD_COLUMNS].sort())
  })

  it('reads faces for transform cards', () => {
    const r = row('Delver of Secrets // Insectile Aberration')
    expect(r.face_names).toBe('Delver of Secrets\nInsectile Aberration')
    expect(r.search_name).toBe('delver of secrets insectile aberration')
    expect(r.mana_cost).toBe('{U}')
    expect(r.colors).toBe('U')
    expect(r.power).toBe('1')
    expect(r.oracle_text).toContain('\n//\n')
    expect(r.image_normal).toMatch(/^https:/)
    expect(JSON.parse(r.card_faces ?? '[]')).toHaveLength(2)
  })

  it('uses the union of face colors when the card has none at the top level', () => {
    expect(row('Westvale Abbey // Ormendahl, Profane Prince').colors).toBe('B')
  })

  it('keeps top-level colors and costs for split cards', () => {
    const r = row('Fire // Ice')
    expect(r.colors).toBe('UR')
    expect(r.mana_cost).toBe('{1}{R} // {1}{U}')
    expect(r.oracle_text).toContain('\n//\n')
  })

  it('keeps non-numeric power and toughness as text', () => {
    const r = row('Tarmogoyf')
    expect([r.power, r.toughness, r.power_num, r.toughness_num]).toEqual(['*', '1+*', null, null])
  })

  it('parses loyalty', () => {
    expect(row('Jace, the Mind Sculptor')).toMatchObject({ loyalty: '3', loyalty_num: 3 })
  })

  it('orders colors WUBRG', () => {
    expect(row("Atraxa, Praetors' Voice").color_identity).toBe('WUBG')
  })

  it('falls back to the first face oracle id (reversible cards)', () => {
    const faceOracle = '99999999-0000-4000-8000-000000000001'
    const face = { name: 'Grizzly Bears', oracle_id: faceOracle, mana_cost: '{1}{G}', type_line: 'Creature — Bear', oracle_text: '', colors: ['G'] }
    const card = syntheticCard({ oracle_id: undefined, layout: 'reversible_card', card_faces: [face, face] })
    expect(scryfallToRow(card)?.oracle_id).toBe(faceOracle)
  })

  it('returns null when no oracle id exists anywhere', () => {
    expect(scryfallToRow(syntheticCard({ oracle_id: undefined }))).toBeNull()
  })
})

describe('helpers', () => {
  it('canonColors sorts into WUBRG order', () => {
    expect(canonColors(['G', 'W'])).toBe('WG')
    expect(canonColors([])).toBe('')
  })

  it.each<[string | null | undefined, number | null]>([
    ['3', 3], ['-1', -1], ['+1', 1], ['3.5', 3.5], ['1+*', null], ['*', null], ['X', null], [null, null], [undefined, null],
  ])('toNum(%j) = %j', (input, expected) => {
    expect(toNum(input)).toBe(expected)
  })
})

describe('shouldImport', () => {
  it('accepts paper cards', () => {
    expect(shouldImport(fixtureCard('Lightning Bolt', 'm10'))).toBe(true)
  })

  it('rejects digital, non-paper, oversized, token, emblem, and art-series cards', () => {
    expect(shouldImport(syntheticCard({ digital: true }))).toBe(false)
    expect(shouldImport(syntheticCard({ games: ['mtgo', 'arena'] }))).toBe(false)
    expect(shouldImport(syntheticCard({ oversized: true }))).toBe(false)
    expect(shouldImport(syntheticCard({ layout: 'token' }))).toBe(false)
    expect(shouldImport(syntheticCard({ layout: 'double_faced_token' }))).toBe(false)
    expect(shouldImport(syntheticCard({ layout: 'emblem' }))).toBe(false)
    expect(shouldImport(syntheticCard({ layout: 'art_series' }))).toBe(false)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm test tests/shared tests/server/cards-map.test.ts`
Expected: FAIL, because `src/shared/normalize.ts` and `src/server/cards/map.ts` don't exist.

- [ ] **Step 5: Implement normalize and map**

`src/shared/normalize.ts`:
```ts
/**
 * Canonical form of a card name for matching: lowercase ASCII letters and digits separated by single spaces.
 * Folds ligatures (Æ → ae) and accents (û → u), drops apostrophes, and turns other punctuation into spaces.
 */
export function normalizeName(name: string): string {
  return name
    .replace(/[Ææ]/g, 'ae')
    .replace(/[Œœ]/g, 'oe')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
```

`src/server/cards/map.ts`:
```ts
import { normalizeName } from '../../shared/normalize.ts'
import type { ScryfallCard } from '../scryfall/types.ts'

/** One row of the `cards` table (one Scryfall printing). JSON columns are stored as strings. */
export interface CardRow {
  id: string
  oracle_id: string
  name: string
  face_names: string
  search_name: string
  lang: string
  layout: string
  released_at: string
  set_code: string
  set_name: string
  collector_number: string
  rarity: string
  mana_cost: string
  cmc: number
  type_line: string
  oracle_text: string
  flavor_text: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  power_num: number | null
  toughness_num: number | null
  loyalty_num: number | null
  colors: string
  color_identity: string
  keywords: string
  legalities: string
  games: string
  finishes: string
  artist: string | null
  prices: string
  image_normal: string | null
  image_small: string | null
  image_art_crop: string | null
  card_faces: string | null
  purchase_uris: string | null
  scryfall_uri: string
  is_promo: number
  is_digital: number
}

/** Shape of each element in the `card_faces` JSON column. */
export interface StoredFace {
  name: string
  mana_cost: string
  type_line: string
  oracle_text: string
  power: string | null
  toughness: string | null
  loyalty: string | null
  image_normal: string | null
}

/** `cards` columns in table order. A test asserts this matches CardRow's keys exactly. */
export const CARD_COLUMNS = [
  'id', 'oracle_id', 'name', 'face_names', 'search_name', 'lang', 'layout', 'released_at',
  'set_code', 'set_name', 'collector_number', 'rarity', 'mana_cost', 'cmc', 'type_line',
  'oracle_text', 'flavor_text', 'power', 'toughness', 'loyalty', 'power_num', 'toughness_num',
  'loyalty_num', 'colors', 'color_identity', 'keywords', 'legalities', 'games', 'finishes',
  'artist', 'prices', 'image_normal', 'image_small', 'image_art_crop', 'card_faces',
  'purchase_uris', 'scryfall_uri', 'is_promo', 'is_digital',
] as const satisfies readonly (keyof CardRow)[]

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const
const SKIPPED_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series'])

/** Color letters in canonical WUBRG order; '' means colorless. */
export function canonColors(colors: readonly string[]): string {
  return WUBRG.filter((c) => colors.includes(c)).join('')
}

/** Numeric value of a power/toughness/loyalty string, or null when it isn't a plain number ("*", "1+*", "X"). */
export function toNum(value: string | null | undefined): number | null {
  if (value == null || !/^[+-]?\d+(\.\d+)?$/.test(value)) return null
  return Number(value)
}

/** Whether a bulk-data card belongs in the local mirror (real paper cards only). */
export function shouldImport(card: ScryfallCard): boolean {
  return !card.digital && card.games.includes('paper') && card.oversized !== true && !SKIPPED_LAYOUTS.has(card.layout)
}

/** Flattens a Scryfall card into a `cards` row. Returns null if the card has no oracle id anywhere. */
export function scryfallToRow(card: ScryfallCard): CardRow | null {
  const faces = card.card_faces ?? []
  const front = faces[0]
  const oracleId = card.oracle_id ?? front?.oracle_id
  if (!oracleId) return null

  const fromFaces = (key: 'power' | 'toughness' | 'loyalty'): string | null =>
    card[key] ?? faces.find((f) => f[key] != null)?.[key] ?? null
  const power = fromFaces('power')
  const toughness = fromFaces('toughness')
  const loyalty = fromFaces('loyalty')
  const images = card.image_uris ?? front?.image_uris
  const storedFaces: StoredFace[] = faces.map((f) => ({
    name: f.name,
    mana_cost: f.mana_cost ?? '',
    type_line: f.type_line ?? '',
    oracle_text: f.oracle_text ?? '',
    power: f.power ?? null,
    toughness: f.toughness ?? null,
    loyalty: f.loyalty ?? null,
    image_normal: f.image_uris?.normal ?? null,
  }))

  return {
    id: card.id,
    oracle_id: oracleId,
    name: card.name,
    face_names: faces.length > 0 ? faces.map((f) => f.name).join('\n') : card.name,
    search_name: normalizeName(card.name),
    lang: card.lang,
    layout: card.layout,
    released_at: card.released_at,
    set_code: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    rarity: card.rarity,
    mana_cost: card.mana_cost ?? faces.map((f) => f.mana_cost ?? '').filter((m) => m !== '').join(' // '),
    cmc: card.cmc ?? front?.cmc ?? 0,
    type_line: card.type_line ?? faces.map((f) => f.type_line ?? '').join(' // '),
    oracle_text: card.oracle_text ?? faces.map((f) => f.oracle_text ?? '').join('\n//\n'),
    flavor_text: card.flavor_text ?? (faces.map((f) => f.flavor_text ?? '').filter((t) => t !== '').join('\n') || null),
    power,
    toughness,
    loyalty,
    power_num: toNum(power),
    toughness_num: toNum(toughness),
    loyalty_num: toNum(loyalty),
    colors: canonColors(card.colors ?? faces.flatMap((f) => f.colors ?? [])),
    color_identity: canonColors(card.color_identity),
    keywords: JSON.stringify(card.keywords ?? []),
    legalities: JSON.stringify(card.legalities),
    games: JSON.stringify(card.games),
    finishes: JSON.stringify(card.finishes),
    artist: card.artist ?? front?.artist ?? null,
    prices: JSON.stringify({
      usd: card.prices.usd ?? null,
      usd_foil: card.prices.usd_foil ?? null,
      usd_etched: card.prices.usd_etched ?? null,
    }),
    image_normal: images?.normal ?? null,
    image_small: images?.small ?? null,
    image_art_crop: images?.art_crop ?? null,
    card_faces: faces.length > 0 ? JSON.stringify(storedFaces) : null,
    purchase_uris: card.purchase_uris ? JSON.stringify(card.purchase_uris) : null,
    scryfall_uri: card.scryfall_uri,
    is_promo: card.promo ? 1 : 0,
    is_digital: card.digital ? 1 : 0,
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test tests/shared tests/server/cards-map.test.ts`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

---

### Task 3: Card repository and name index

**Files:**
- Create: `src/shared/types.ts`, `src/server/cards/repo.ts`, `tests/helpers/db.ts`
- Test: `tests/server/cards-repo.test.ts`

**Interfaces:**
- Consumes: `openDb`, `DB` (Task 1); `CardRow`, `StoredFace`, `CARD_COLUMNS`, `scryfallToRow` (Task 2); `normalizeName` (Task 2); `loadFixtureCards`, `fixtureCard`, `syntheticCard` (Task 2)
- Produces:
  - Shared types: `Finish`, `Prices`, `CardFace`, `Card`, `Printing`, `CardDetail`, `CardSummary`, `BulkState`, `BulkStatus`, `ApiErrorBody`
  - `insertCardRows(db: DB, table: 'cards' | 'cards_staging', rows: readonly CardRow[]): void`
  - `rebuildCardNames(db: DB): void`
  - `rowToCard(row: CardRow): Card`
  - `getCard(db: DB, id: string): Card | null`
  - `getPrintings(db: DB, oracleId: string): Printing[]` (newest first)
  - `autocomplete(db: DB, query: string, limit?: number): CardSummary[]` (default limit 10)
  - Test helpers: `fixtureRows(): CardRow[]`, `createTestDb(): DB` (in-memory, fixtures loaded, names built), `count(db: DB, table: string): number`, `tableExists(db: DB, name: string): boolean`

- [ ] **Step 1: Create shared types and the DB test helper**

`src/shared/types.ts`:
```ts
export type Finish = 'nonfoil' | 'foil' | 'etched'

export interface Prices {
  usd: number | null
  usdFoil: number | null
  usdEtched: number | null
}

export interface CardFace {
  name: string
  manaCost: string
  typeLine: string
  oracleText: string
  power: string | null
  toughness: string | null
  loyalty: string | null
  imageNormal: string | null
}

/** One printing, as returned by the API. */
export interface Card {
  id: string
  oracleId: string
  name: string
  faceNames: string[]
  layout: string
  releasedAt: string
  setCode: string
  setName: string
  collectorNumber: string
  rarity: string
  manaCost: string
  cmc: number
  typeLine: string
  oracleText: string
  flavorText: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  colors: string
  colorIdentity: string
  keywords: string[]
  legalities: Record<string, string>
  finishes: Finish[]
  artist: string | null
  prices: Prices
  imageNormal: string | null
  imageSmall: string | null
  imageArtCrop: string | null
  /** Empty for single-faced cards. */
  faces: CardFace[]
  purchaseUris: Record<string, string>
  scryfallUri: string
  isPromo: boolean
}

export interface Printing {
  id: string
  setCode: string
  setName: string
  collectorNumber: string
  releasedAt: string
  rarity: string
  finishes: Finish[]
  prices: Prices
  imageSmall: string | null
  isPromo: boolean
}

export interface CardDetail {
  card: Card
  printings: Printing[]
}

/** Autocomplete result: one per card identity, pointing at its default printing. */
export interface CardSummary {
  oracleId: string
  cardId: string
  name: string
  manaCost: string
  typeLine: string
  imageSmall: string | null
}

export type BulkState = 'idle' | 'downloading' | 'importing' | 'error'

export interface BulkStatus {
  state: BulkState
  /** Printings imported so far in the current run. */
  processed: number
  /** Message from the most recent failed refresh; cleared by a successful one. */
  error: string | null
  updatedAt: string | null
  sourceUpdatedAt: string | null
  cardCount: number
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}
```

`tests/helpers/db.ts`:
```ts
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

export function tableExists(db: DB, name: string): boolean {
  return db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(name) !== undefined
}
```

- [ ] **Step 2: Write the failing repository tests**

`tests/server/cards-repo.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { autocomplete, getCard, getPrintings, insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import type { DB } from '../../src/server/db/index.ts'
import { count, createTestDb, fixtureRows } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'

const BOLT_M10 = '435589bb-27c6-4a6d-9d63-394d5092b9d8'

let db: DB
beforeEach(() => {
  db = createTestDb()
})

describe('card repository', () => {
  it('gets a card by id', () => {
    const card = getCard(db, BOLT_M10)
    expect(card).toMatchObject({ name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146', manaCost: '{R}', colors: 'R', faces: [] })
    expect(card?.prices.usd === null || typeof card?.prices.usd === 'number').toBe(true)
    expect(card?.legalities.modern).toBe('legal')
  })

  it('returns null for unknown ids', () => {
    expect(getCard(db, 'nope')).toBeNull()
  })

  it('maps faces for double-faced cards', () => {
    const card = getCard(db, fixtureCard('Delver of Secrets // Insectile Aberration').id)
    expect(card?.faces.map((f) => f.name)).toEqual(['Delver of Secrets', 'Insectile Aberration'])
    expect(card?.faceNames).toEqual(['Delver of Secrets', 'Insectile Aberration'])
    expect(card?.faces[0]?.imageNormal).toMatch(/^https:/)
  })

  it('lists printings newest first', () => {
    const card = getCard(db, BOLT_M10)
    expect(getPrintings(db, card?.oracleId ?? '').map((p) => p.setCode)).toEqual(['sta', 'm11', 'm10'])
  })

  it('builds one name row per card identity, defaulting to the newest printing', () => {
    expect(count(db, 'card_names')).toBe(new Set(fixtureRows().map((r) => r.oracle_id)).size)
    expect(autocomplete(db, 'lightning bolt')[0]?.cardId).toBe(fixtureCard('Lightning Bolt', 'sta').id)
  })
})

describe('autocomplete', () => {
  const names = (q: string, limit?: number) => autocomplete(db, q, limit).map((c) => c.name)

  it('returns summaries with the default printing', () => {
    expect(autocomplete(db, 'sol ring')[0]).toMatchObject({
      name: 'Sol Ring',
      cardId: fixtureCard('Sol Ring', 'c21').id,
      manaCost: '{1}',
      typeLine: 'Artifact',
    })
  })

  it('ranks prefix matches first, then shorter names', () => {
    expect(names('light').slice(0, 2)).toEqual(['Lightning Bolt', 'Lightning Helix'])
  })

  it('matches words inside names', () => {
    expect(names('bolt')).toContain('Lightning Bolt')
  })

  it('matches back-face names', () => {
    expect(names('insectile')).toEqual(['Delver of Secrets // Insectile Aberration'])
  })

  it('uses prefix matching for 1–2 character queries', () => {
    expect(names('so')).toContain('Sol Ring')
  })

  it('respects the limit', () => {
    expect(names('e', 3)).toHaveLength(3)
  })

  it('ignores diacritics, ligatures, and punctuation', () => {
    const extra = [syntheticCard({ name: 'Æther Vial' }), syntheticCard({ name: "Lim-Dûl's Vault" })]
      .map((c) => scryfallToRow(c))
      .filter((r): r is CardRow => r !== null)
    insertCardRows(db, 'cards', extra)
    rebuildCardNames(db)
    expect(names('aether vial')).toEqual(['Æther Vial'])
    expect(names("lim-dul's")).toEqual(["Lim-Dûl's Vault"])
    expect(names('lim dul')).toEqual(["Lim-Dûl's Vault"])
  })

  it('never throws on search-syntax characters', () => {
    expect(names('bolt"')).toContain('Lightning Bolt')
    expect(() => names('OR')).not.toThrow()
    expect(() => names('NEAR(')).not.toThrow()
    expect(names('*')).toEqual([])
    expect(names('"')).toEqual([])
    expect(names('')).toEqual([])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test tests/server/cards-repo.test.ts`
Expected: FAIL, because `src/server/cards/repo.ts` doesn't exist.

- [ ] **Step 4: Implement the repository**

`src/server/cards/repo.ts`:
```ts
import { normalizeName } from '../../shared/normalize.ts'
import type { Card, CardSummary, Prices, Printing } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'
import { CARD_COLUMNS, type CardRow, type StoredFace } from './map.ts'

/**
 * Inserts rows with INSERT OR REPLACE. Only for the import staging table and for seeding test/dev databases:
 * REPLACE deletes the old row first, which would break foreign keys on a populated `cards` table.
 */
export function insertCardRows(db: DB, table: 'cards' | 'cards_staging', rows: readonly CardRow[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO ${table} (${CARD_COLUMNS.join(', ')}) VALUES (${CARD_COLUMNS.map((c) => `@${c}`).join(', ')})`,
  )
  db.transaction((batch: readonly CardRow[]) => {
    for (const row of batch) stmt.run(row)
  })(rows)
}

/** Rebuilds `card_names` (one row per card identity, newest non-promo printing as default) and its trigram index. */
export function rebuildCardNames(db: DB): void {
  db.transaction(() => {
    db.exec('DELETE FROM card_names')
    db.exec(`
      INSERT INTO card_names (oracle_id, name, face_names, search_name, default_card_id)
      SELECT oracle_id, name, face_names, search_name, id FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY oracle_id ORDER BY is_promo ASC, released_at DESC, set_code ASC, collector_number ASC
        ) AS pick
        FROM cards
      ) WHERE pick = 1`)
    db.exec(`INSERT INTO card_names_fts (card_names_fts) VALUES ('rebuild')`)
  })()
}

function parsePrice(value: string | null | undefined): number | null {
  return value == null ? null : Number(value)
}

function parsePrices(json: string): Prices {
  const p = JSON.parse(json) as Record<string, string | null>
  return { usd: parsePrice(p.usd), usdFoil: parsePrice(p.usd_foil), usdEtched: parsePrice(p.usd_etched) }
}

export function rowToCard(row: CardRow): Card {
  const faces = row.card_faces ? (JSON.parse(row.card_faces) as StoredFace[]) : []
  return {
    id: row.id,
    oracleId: row.oracle_id,
    name: row.name,
    faceNames: row.face_names.split('\n'),
    layout: row.layout,
    releasedAt: row.released_at,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    manaCost: row.mana_cost,
    cmc: row.cmc,
    typeLine: row.type_line,
    oracleText: row.oracle_text,
    flavorText: row.flavor_text,
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    colors: row.colors,
    colorIdentity: row.color_identity,
    keywords: JSON.parse(row.keywords) as string[],
    legalities: JSON.parse(row.legalities) as Record<string, string>,
    finishes: JSON.parse(row.finishes) as Card['finishes'],
    artist: row.artist,
    prices: parsePrices(row.prices),
    imageNormal: row.image_normal,
    imageSmall: row.image_small,
    imageArtCrop: row.image_art_crop,
    faces: faces.map((f) => ({
      name: f.name,
      manaCost: f.mana_cost,
      typeLine: f.type_line,
      oracleText: f.oracle_text,
      power: f.power,
      toughness: f.toughness,
      loyalty: f.loyalty,
      imageNormal: f.image_normal,
    })),
    purchaseUris: row.purchase_uris ? (JSON.parse(row.purchase_uris) as Record<string, string>) : {},
    scryfallUri: row.scryfall_uri,
    isPromo: row.is_promo === 1,
  }
}

export function getCard(db: DB, id: string): Card | null {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined
  return row ? rowToCard(row) : null
}

/** Every printing of a card identity, newest first. */
export function getPrintings(db: DB, oracleId: string): Printing[] {
  const rows = db
    .prepare('SELECT * FROM cards WHERE oracle_id = ? ORDER BY released_at DESC, set_code ASC, collector_number ASC')
    .all(oracleId) as CardRow[]
  return rows.map((r) => ({
    id: r.id,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    releasedAt: r.released_at,
    rarity: r.rarity,
    finishes: JSON.parse(r.finishes) as Printing['finishes'],
    prices: parsePrices(r.prices),
    imageSmall: r.image_small,
    isPromo: r.is_promo === 1,
  }))
}

interface SummaryRow {
  oracle_id: string
  card_id: string
  name: string
  mana_cost: string
  type_line: string
  image_small: string | null
}

const SUMMARY_COLUMNS = 'n.oracle_id, n.default_card_id AS card_id, n.name, c.mana_cost, c.type_line, c.image_small'

/**
 * Card-name autocomplete, one result per card identity. Case-, accent-, and punctuation-insensitive.
 * Ranking: name starts with the query, then a word starts with it, then any substring; ties go to shorter names.
 * The query is normalized to [a-z0-9 ] first, so it can never inject FTS or LIKE syntax.
 */
export function autocomplete(db: DB, query: string, limit = 10): CardSummary[] {
  const q = normalizeName(query)
  if (q === '') return []
  const prefix = `${q}%`
  const wordPrefix = `% ${q}%`
  // The trigram index needs at least 3 characters; shorter queries use prefix matching.
  const rows =
    q.length < 3
      ? (db
          .prepare(
            `SELECT ${SUMMARY_COLUMNS} FROM card_names n JOIN cards c ON c.id = n.default_card_id
             WHERE n.search_name LIKE @prefix OR n.search_name LIKE @wordPrefix
             ORDER BY CASE WHEN n.search_name LIKE @prefix THEN 0 ELSE 1 END, length(n.name), n.name
             LIMIT @limit`,
          )
          .all({ prefix, wordPrefix, limit }) as SummaryRow[])
      : (db
          .prepare(
            `SELECT ${SUMMARY_COLUMNS} FROM card_names_fts f
             JOIN card_names n ON n.rowid = f.rowid
             JOIN cards c ON c.id = n.default_card_id
             WHERE card_names_fts MATCH @phrase
             ORDER BY CASE WHEN n.search_name LIKE @prefix THEN 0 WHEN n.search_name LIKE @wordPrefix THEN 1 ELSE 2 END,
                      length(n.name), n.name
             LIMIT @limit`,
          )
          .all({ phrase: `"${q}"`, prefix, wordPrefix, limit }) as SummaryRow[])
  return rows.map((r) => ({
    oracleId: r.oracle_id,
    cardId: r.card_id,
    name: r.name,
    manaCost: r.mana_cost,
    typeLine: r.type_line,
    imageSmall: r.image_small,
  }))
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test tests/server/cards-repo.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

---

### Task 4: Scryfall HTTP client

**Files:**
- Create: `src/server/scryfall/client.ts`
- Test: `tests/server/scryfall-client.test.ts`

**Interfaces:**
- Consumes: `ScryfallErrorBody` (Task 2)
- Produces:
  - `USER_AGENT = 'Binder/0.1 (personal)'`
  - `type ScryfallErrorCode = 'offline' | 'not_found' | 'rate_limited' | 'http'`
  - `class ScryfallError extends Error { code: ScryfallErrorCode; status: number | null }` with constructor `(code, status, message)`
  - `interface ScryfallClient { getJson<T>(pathOrUrl: string): Promise<T>; postJson<T>(pathOrUrl: string, body: unknown): Promise<T>; download(url: string): Promise<Response> }`
  - `createScryfallClient(options?: { baseUrl?; fetch?: (url: string, init: RequestInit) => Promise<Response>; sleep?: (ms: number) => Promise<void>; now?: () => number; minIntervalMs? }): ScryfallClient`

- [ ] **Step 1: Write the failing client tests**

`tests/server/scryfall-client.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { createScryfallClient, ScryfallError, USER_AGENT } from '../../src/server/scryfall/client.ts'

function fakeClock() {
  let t = 0
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function setup(responses: Array<Response | Error>) {
  const clock = fakeClock()
  const fetch = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => {
    const next = responses.shift()
    if (!next) throw new Error('unexpected extra request')
    if (next instanceof Error) throw next
    return next
  })
  return { clock, fetch, client: createScryfallClient({ fetch, now: clock.now, sleep: clock.sleep }) }
}

describe('scryfall client', () => {
  it('sends the required headers to the API base URL', async () => {
    const { fetch, client } = setup([json({ ok: true })])
    await expect(client.getJson('/cards/named?exact=bolt')).resolves.toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://api.scryfall.com/cards/named?exact=bolt')
    expect(init?.headers).toMatchObject({ 'User-Agent': USER_AGENT, Accept: 'application/json' })
  })

  it('uses absolute URLs as given', async () => {
    const { fetch, client } = setup([new Response('file')])
    await client.download('https://data.scryfall.io/default-cards/x.jsonl.gz')
    expect(fetch.mock.calls[0]?.[0]).toBe('https://data.scryfall.io/default-cards/x.jsonl.gz')
    expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({ 'User-Agent': USER_AGENT, Accept: '*/*' })
  })

  it('spaces request starts at least 100 ms apart', async () => {
    const { clock, client } = setup([json(1), json(2), json(3)])
    await Promise.all([client.getJson('/a'), client.getJson('/b'), client.getJson('/c')])
    expect(clock.sleeps).toEqual([100, 100])
  })

  it('retries a 429 after backing off', async () => {
    const { clock, fetch, client } = setup([json({}, 429), json({ ok: 1 })])
    await expect(client.getJson('/x')).resolves.toEqual({ ok: 1 })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(clock.sleeps).toEqual([1000])
  })

  it('gives up after three retries of 429', async () => {
    const { clock, fetch, client } = setup([json({}, 429), json({}, 429), json({}, 429), json({}, 429)])
    const err = await client.getJson('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ScryfallError)
    expect(err).toMatchObject({ code: 'rate_limited', status: 429 })
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(clock.sleeps).toEqual([1000, 2000, 4000])
  })

  it('reports network failures as offline', async () => {
    const { client } = setup([new TypeError('fetch failed')])
    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'offline', status: null, message: 'Scryfall is unreachable: fetch failed' })
  })

  it('uses Scryfall error details for 404s', async () => {
    const { client } = setup([json({ object: 'error', status: 404, code: 'not_found', details: 'No card found' }, 404)])
    await expect(client.getJson('/cards/named?exact=zzz')).rejects.toMatchObject({ code: 'not_found', status: 404, message: 'No card found' })
  })

  it('falls back to the status when an error body is not JSON', async () => {
    const { client } = setup([new Response('<html>oops</html>', { status: 500 })])
    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'http', status: 500, message: 'HTTP 500' })
  })

  it('posts JSON bodies', async () => {
    const { fetch, client } = setup([json({ data: [] })])
    await client.postJson('/cards/collection', { identifiers: [] })
    const init = fetch.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"identifiers":[]}')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json', 'User-Agent': USER_AGENT })
  })

  it('rejects failed downloads', async () => {
    const { client } = setup([new Response('gone', { status: 404 })])
    await expect(client.download('https://data.scryfall.io/x')).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/server/scryfall-client.test.ts`
Expected: FAIL, because `src/server/scryfall/client.ts` doesn't exist.

- [ ] **Step 3: Implement the client**

`src/server/scryfall/client.ts`:
```ts
import type { ScryfallErrorBody } from './types.ts'

export const USER_AGENT = 'Binder/0.1 (personal)'
const RETRY_DELAYS_MS = [1000, 2000, 4000]

export type ScryfallErrorCode = 'offline' | 'not_found' | 'rate_limited' | 'http'

export class ScryfallError extends Error {
  code: ScryfallErrorCode
  status: number | null
  constructor(code: ScryfallErrorCode, status: number | null, message: string) {
    super(message)
    this.name = 'ScryfallError'
    this.code = code
    this.status = status
  }
}

export interface ScryfallClient {
  /** GET an API path (e.g. `/cards/search?q=...`) or absolute URL and parse the JSON response. */
  getJson<T>(pathOrUrl: string): Promise<T>
  /** POST a JSON body and parse the JSON response. */
  postJson<T>(pathOrUrl: string, body: unknown): Promise<T>
  /** GET a file (bulk data). Resolves with the successful Response; rejects on any non-2xx. */
  download(url: string): Promise<Response>
}

export interface ScryfallClientOptions {
  baseUrl?: string
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  minIntervalMs?: number
}

export function createScryfallClient(options: ScryfallClientOptions = {}): ScryfallClient {
  const baseUrl = options.baseUrl ?? 'https://api.scryfall.com'
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init))
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const minIntervalMs = options.minIntervalMs ?? 100

  // Requests start one at a time, at least minIntervalMs apart (Scryfall asks for 50–100 ms between calls).
  let queue: Promise<void> = Promise.resolve()
  let lastStart = Number.NEGATIVE_INFINITY
  function waitForSlot(): Promise<void> {
    const slot = queue.then(async () => {
      const wait = lastStart + minIntervalMs - now()
      if (wait > 0) await sleep(wait)
      lastStart = now()
    })
    queue = slot
    return slot
  }

  const toUrl = (pathOrUrl: string) => (/^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${baseUrl}${pathOrUrl}`)

  async function send(pathOrUrl: string, init: RequestInit, accept: string): Promise<Response> {
    const url = toUrl(pathOrUrl)
    const headers = { 'User-Agent': USER_AGENT, Accept: accept, ...(init.headers as Record<string, string> | undefined) }
    for (let attempt = 0; ; attempt++) {
      await waitForSlot()
      let res: Response
      try {
        res = await doFetch(url, { ...init, headers })
      } catch (err) {
        throw new ScryfallError('offline', null, `Scryfall is unreachable: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (res.status !== 429) return res
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined) throw new ScryfallError('rate_limited', 429, 'Scryfall rate limit exceeded; try again in a minute')
      await sleep(delay)
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    if (res.ok) return (await res.json()) as T
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as Partial<ScryfallErrorBody>
      if (body.details) message = body.details
    } catch {
      // The error body wasn't JSON; keep the status message.
    }
    throw new ScryfallError(res.status === 404 ? 'not_found' : 'http', res.status, message)
  }

  return {
    async getJson<T>(pathOrUrl: string) {
      return parse<T>(await send(pathOrUrl, { method: 'GET' }, 'application/json'))
    },
    async postJson<T>(pathOrUrl: string, body: unknown) {
      const init: RequestInit = { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      return parse<T>(await send(pathOrUrl, init, 'application/json'))
    },
    async download(url: string) {
      const res = await send(url, { method: 'GET' }, '*/*')
      if (!res.ok) {
        throw new ScryfallError(res.status === 404 ? 'not_found' : 'http', res.status, `Download failed with HTTP ${res.status}`)
      }
      return res
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/server/scryfall-client.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

---

### Task 5: Bulk card-data import

**Files:**
- Create: `src/server/bulk/import.ts`
- Test: `tests/server/bulk-import.test.ts`

**Interfaces:**
- Consumes: `DB`, `openDb` (Task 1); `getMeta`, `setMeta` (Task 1); `CARD_COLUMNS`, `CardRow`, `scryfallToRow`, `shouldImport` (Task 2); `ScryfallBulkData`, `ScryfallCard` (Task 2); `insertCardRows`, `rebuildCardNames`, `getCard`, `autocomplete` (Task 3); `BulkState`, `BulkStatus` (Task 3); `ScryfallClient`, `ScryfallError` (Task 4)
- Produces:
  - `importCardsFile(db: DB, file: string, onProgress?: (processed: number) => void): Promise<{ imported: number; skipped: number }>`
  - `interface BulkImporter { status(): BulkStatus; isStale(): boolean; start(): Promise<void> | null }`. `start()` returns null when a refresh is already running, and its promise never rejects.
  - `createBulkImporter(deps: { db: DB; client: ScryfallClient; dataDir: string; now?: () => Date; log?: (message: string) => void }): BulkImporter`

- [ ] **Step 1: Write the failing import tests**

`tests/server/bulk-import.test.ts`:
```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { createBulkImporter, importCardsFile } from '../../src/server/bulk/import.ts'
import { autocomplete, getCard } from '../../src/server/cards/repo.ts'
import { openDb } from '../../src/server/db/index.ts'
import { getMeta, setMeta } from '../../src/server/db/meta.ts'
import { ScryfallError, type ScryfallClient } from '../../src/server/scryfall/client.ts'
import type { ScryfallCard } from '../../src/server/scryfall/types.ts'
import { count, createTestDb, tableExists } from '../helpers/db.ts'
import { fixtureCard, loadFixtureCards, syntheticCard } from '../helpers/fixtures.ts'

const SOURCE_UPDATED_AT = '2026-09-26T09:05:51.554+00:00'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-bulk-'))
})

const gzLines = (lines: string[]) => zlib.gzipSync(`${lines.join('\n')}\n`)
const gzCards = (cards: ScryfallCard[]) => gzLines(cards.map((c) => JSON.stringify(c)))

function writeFile(data: Buffer, name = 'cards.jsonl.gz'): string {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, data)
  return file
}

function fakeClient(opts: { meta?: Record<string, unknown>; file?: Buffer; metaError?: Error }): ScryfallClient {
  return {
    async getJson<T>() {
      if (opts.metaError) throw opts.metaError
      return (opts.meta ?? {
        type: 'default_cards',
        updated_at: SOURCE_UPDATED_AT,
        jsonl_download_uri: 'https://data.scryfall.io/default-cards/default-cards.jsonl.gz',
      }) as T
    },
    async postJson<T>(): Promise<T> {
      throw new Error('not used')
    },
    async download() {
      return new Response(new Uint8Array(opts.file ?? Buffer.alloc(0)))
    },
  }
}

describe('importCardsFile', () => {
  it('imports importable cards and builds the name index', async () => {
    const db = openDb(':memory:')
    const result = await importCardsFile(db, writeFile(gzCards([...loadFixtureCards(), syntheticCard({ digital: true })])))
    expect(result).toEqual({ imported: 61, skipped: 1 })
    expect(count(db, 'cards')).toBe(61)
    expect(count(db, 'card_names')).toBe(58)
    expect(autocomplete(db, 'bolt')[0]?.name).toBe('Lightning Bolt')
    expect(tableExists(db, 'cards_staging')).toBe(false)
  })

  it('reports progress', async () => {
    const db = openDb(':memory:')
    const seen: number[] = []
    await importCardsFile(db, writeFile(gzCards(loadFixtureCards())), (n) => seen.push(n))
    expect(seen.at(-1)).toBe(61)
  })

  it('updates changed printings in place and removes printings Scryfall dropped', async () => {
    const db = createTestDb()
    const bolt = fixtureCard('Lightning Bolt', 'm10')
    const helix = fixtureCard('Lightning Helix')
    const next = loadFixtureCards()
      .filter((c) => c.id !== helix.id)
      .map((c) => (c.id === bolt.id ? { ...c, prices: { ...c.prices, usd: '99.99' } } : c))
    await importCardsFile(db, writeFile(gzCards(next)))
    expect(getCard(db, bolt.id)?.prices.usd).toBe(99.99)
    expect(getCard(db, helix.id)).toBeNull()
    expect(autocomplete(db, 'helix')).toEqual([])
  })

  it('keeps dropped printings that the collection, a deck, or the scan queue reference', async () => {
    const db = createTestDb()
    const helix = fixtureCard('Lightning Helix')
    const goyf = fixtureCard('Tarmogoyf')
    const jace = fixtureCard('Jace, the Mind Sculptor')
    db.prepare(
      "INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (?, 'nonfoil', 2, 't', 't')",
    ).run(helix.id)
    const deckId = db
      .prepare("INSERT INTO decks (name, format, status, created_at, updated_at) VALUES ('d', 'modern', 'built', 't', 't')")
      .run().lastInsertRowid
    db.prepare(
      "INSERT INTO deck_cards (deck_id, oracle_id, preferred_card_id, quantity, board) VALUES (?, ?, ?, 1, 'main')",
    ).run(deckId, goyf.oracle_id, goyf.id)
    db.prepare("INSERT INTO scan_items (status, card_id, created_at, updated_at) VALUES ('review', ?, 't', 't')").run(jace.id)

    const dropped = new Set([helix.id, goyf.id, jace.id])
    await importCardsFile(db, writeFile(gzCards(loadFixtureCards().filter((c) => !dropped.has(c.id)))))
    for (const id of dropped) expect(getCard(db, id)).not.toBeNull()
  })

  it('rejects a malformed line and leaves the previous data untouched', async () => {
    const db = createTestDb()
    const lines = loadFixtureCards().map((c) => JSON.stringify(c))
    lines.splice(2, 0, '{"object":"card", truncated')
    await expect(importCardsFile(db, writeFile(gzLines(lines)))).rejects.toThrow(/line 3/)
    expect(count(db, 'cards')).toBe(61)
    expect(autocomplete(db, 'bolt')[0]?.name).toBe('Lightning Bolt')
    expect(tableExists(db, 'cards_staging')).toBe(false)
  })

  it('rejects a truncated download and leaves the previous data untouched', async () => {
    const db = createTestDb()
    const full = gzCards(loadFixtureCards())
    await expect(importCardsFile(db, writeFile(full.subarray(0, Math.floor(full.length / 2))))).rejects.toThrow()
    expect(count(db, 'cards')).toBe(61)
    expect(tableExists(db, 'cards_staging')).toBe(false)
  })

  it('rejects a file with no importable cards and leaves the previous data untouched', async () => {
    const db = createTestDb()
    await expect(importCardsFile(db, writeFile(gzCards([syntheticCard({ digital: true })])))).rejects.toThrow(/no importable cards/)
    expect(count(db, 'cards')).toBe(61)
  })
})

describe('bulk importer', () => {
  it('downloads, imports, records metadata, and clears an old error', async () => {
    const db = openDb(':memory:')
    setMeta(db, 'bulk_error', 'old failure')
    const bulk = createBulkImporter({
      db,
      client: fakeClient({ file: gzCards(loadFixtureCards()) }),
      dataDir: tmp,
      now: () => new Date('2026-09-26T12:00:00Z'),
    })
    await bulk.start()
    expect(bulk.status()).toEqual({
      state: 'idle',
      processed: 61,
      error: null,
      updatedAt: '2026-09-26T12:00:00.000Z',
      sourceUpdatedAt: SOURCE_UPDATED_AT,
      cardCount: 61,
    })
    expect(fs.existsSync(path.join(tmp, 'bulk', 'default-cards.jsonl.gz'))).toBe(true)
  })

  it('refuses to start a second import while one is running', async () => {
    const db = openDb(':memory:')
    const bulk = createBulkImporter({ db, client: fakeClient({ file: gzCards(loadFixtureCards()) }), dataDir: tmp })
    const first = bulk.start()
    expect(first).not.toBeNull()
    expect(bulk.start()).toBeNull()
    await first
    const again = bulk.start()
    expect(again).not.toBeNull()
    await again
  })

  it('records an error naming the fields when the metadata has no JSONL download', async () => {
    const db = createTestDb()
    const bulk = createBulkImporter({
      db,
      client: fakeClient({ meta: { type: 'default_cards', updated_at: 'x', download_uri: 'https://example.com/x.json' } }),
      dataDir: tmp,
    })
    await bulk.start()
    const status = bulk.status()
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/jsonl_download_uri.*download_uri/)
    expect(getMeta(db, 'bulk_error')).toBe(status.error)
    expect(status.cardCount).toBe(61)
  })

  it('records an error instead of throwing when Scryfall is offline', async () => {
    const db = createTestDb()
    const bulk = createBulkImporter({
      db,
      client: fakeClient({ metaError: new ScryfallError('offline', null, 'Scryfall is unreachable: ECONNREFUSED') }),
      dataDir: tmp,
    })
    await expect(bulk.start()).resolves.toBeUndefined()
    expect(bulk.status()).toMatchObject({ state: 'error', error: 'Scryfall is unreachable: ECONNREFUSED', cardCount: 61 })
  })

  it('is stale when never imported or older than 7 days', () => {
    const db = openDb(':memory:')
    let now = new Date('2026-09-26T00:00:00Z')
    const bulk = createBulkImporter({ db, client: fakeClient({}), dataDir: tmp, now: () => now })
    expect(bulk.isStale()).toBe(true)
    setMeta(db, 'bulk_updated_at', '2026-09-25T00:00:00.000Z')
    expect(bulk.isStale()).toBe(false)
    now = new Date('2026-10-02T00:00:01Z')
    expect(bulk.isStale()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/server/bulk-import.test.ts`
Expected: FAIL, because `src/server/bulk/import.ts` doesn't exist.

- [ ] **Step 3: Implement the importer**

`src/server/bulk/import.ts`:
```ts
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import zlib from 'node:zlib'
import type { BulkState, BulkStatus } from '../../shared/types.ts'
import { CARD_COLUMNS, scryfallToRow, shouldImport, type CardRow } from '../cards/map.ts'
import { insertCardRows, rebuildCardNames } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { getMeta, setMeta } from '../db/meta.ts'
import type { ScryfallClient } from '../scryfall/client.ts'
import type { ScryfallBulkData, ScryfallCard } from '../scryfall/types.ts'

const BATCH_SIZE = 2000
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Streams a gzipped JSONL file of Scryfall cards into a staging table, then merges it into `cards` in one
 * transaction. Any failure (truncated gzip, malformed line, nothing importable) leaves `cards` untouched.
 */
export async function importCardsFile(
  db: DB,
  file: string,
  onProgress?: (processed: number) => void,
): Promise<{ imported: number; skipped: number }> {
  db.exec('DROP TABLE IF EXISTS cards_staging; CREATE TABLE cards_staging AS SELECT * FROM cards WHERE 0')
  const input = fs.createReadStream(file)
  const gunzip = zlib.createGunzip()
  input.on('error', (err) => gunzip.destroy(err))
  try {
    const lines = readline.createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity })
    let batch: CardRow[] = []
    let imported = 0
    let skipped = 0
    let lineNo = 0
    const flush = () => {
      insertCardRows(db, 'cards_staging', batch)
      imported += batch.length
      batch = []
      onProgress?.(imported)
    }
    for await (const line of lines) {
      lineNo++
      if (line.trim() === '') continue
      let card: ScryfallCard
      try {
        card = JSON.parse(line) as ScryfallCard
      } catch {
        throw new Error(`Malformed card data on line ${lineNo}`)
      }
      const row = shouldImport(card) ? scryfallToRow(card) : null
      if (row) batch.push(row)
      else skipped++
      if (batch.length >= BATCH_SIZE) flush()
    }
    if (batch.length > 0) flush()
    if (imported === 0) throw new Error('Card data file contained no importable cards')
    mergeStaging(db)
    return { imported, skipped }
  } finally {
    input.destroy()
    gunzip.destroy()
    db.exec('DROP TABLE IF EXISTS cards_staging')
  }
}

/** Upserts staging into `cards`, deletes printings Scryfall dropped unless something references them, rebuilds names. */
function mergeStaging(db: DB): void {
  const columns = CARD_COLUMNS.join(', ')
  const updates = CARD_COLUMNS.filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')
  db.transaction(() => {
    // `WHERE true` is required: SQLite can't otherwise parse an upsert after INSERT ... SELECT.
    db.exec(`INSERT INTO cards (${columns}) SELECT ${columns} FROM cards_staging WHERE true
             ON CONFLICT (id) DO UPDATE SET ${updates}`)
    db.exec(`DELETE FROM cards
             WHERE id NOT IN (SELECT id FROM cards_staging)
               AND id NOT IN (SELECT card_id FROM collection)
               AND id NOT IN (SELECT preferred_card_id FROM deck_cards WHERE preferred_card_id IS NOT NULL)
               AND id NOT IN (SELECT card_id FROM scan_items WHERE card_id IS NOT NULL)`)
    rebuildCardNames(db)
  })()
}

export interface BulkImporter {
  status(): BulkStatus
  /** True when card data was never imported or the last import is older than 7 days. */
  isStale(): boolean
  /** Starts a refresh in the background. Returns its promise (which never rejects), or null if one is already running. */
  start(): Promise<void> | null
}

export interface BulkImporterDeps {
  db: DB
  client: ScryfallClient
  dataDir: string
  now?: () => Date
  log?: (message: string) => void
}

export function createBulkImporter(deps: BulkImporterDeps): BulkImporter {
  const { db, client, dataDir } = deps
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})
  let state: BulkState = 'idle'
  let processed = 0
  let running: Promise<void> | null = null

  async function refresh(): Promise<void> {
    state = 'downloading'
    processed = 0
    try {
      const meta = await client.getJson<ScryfallBulkData>('/bulk-data/default-cards')
      const uri = meta.jsonl_download_uri
      if (typeof uri !== 'string') {
        throw new Error(`Scryfall bulk metadata has no jsonl_download_uri (fields present: ${Object.keys(meta).join(', ')})`)
      }
      const dir = path.join(dataDir, 'bulk')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'default-cards.jsonl.gz')
      const partial = `${file}.part`
      const res = await client.download(uri)
      if (!res.body) throw new Error('Card data download returned an empty body')
      await pipeline(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>), fs.createWriteStream(partial))
      fs.renameSync(partial, file)

      state = 'importing'
      const { imported } = await importCardsFile(db, file, (n) => {
        processed = n
      })
      setMeta(db, 'bulk_updated_at', now().toISOString())
      setMeta(db, 'bulk_source_updated_at', meta.updated_at)
      setMeta(db, 'bulk_error', null)
      state = 'idle'
      log(`Imported ${imported.toLocaleString()} printings`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMeta(db, 'bulk_error', message)
      state = 'error'
      log(`Card data refresh failed: ${message}`)
    }
  }

  return {
    status() {
      return {
        state,
        processed,
        error: getMeta(db, 'bulk_error'),
        updatedAt: getMeta(db, 'bulk_updated_at'),
        sourceUpdatedAt: getMeta(db, 'bulk_source_updated_at'),
        cardCount: db.prepare('SELECT count(*) FROM cards').pluck().get() as number,
      }
    },
    isStale() {
      const updated = getMeta(db, 'bulk_updated_at')
      return updated === null || now().getTime() - Date.parse(updated) > STALE_AFTER_MS
    },
    start() {
      if (running) return null
      running = refresh().finally(() => {
        running = null
      })
      return running
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/server/bulk-import.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

---

### Task 6: HTTP API, server entry, and setup script

**Files:**
- Create: `src/server/http.ts`, `src/server/app.ts`, `src/server/cards/routes.ts`, `src/server/bulk/routes.ts`, `src/server/main.ts`, `scripts/setup.ts`
- Test: `tests/server/api.test.ts`

**Interfaces:**
- Consumes: `openDb`, `DB`, config constants (Task 1); `autocomplete`, `getCard`, `getPrintings` (Task 3); `CardDetail`, `CardSummary`, `BulkStatus`, `ApiErrorBody` (Task 3); `createScryfallClient` (Task 4); `createBulkImporter`, `BulkImporter` (Task 5)
- Produces:
  - `class ApiError extends Error { status: ContentfulStatusCode; code: string }` with constructor `(status, code, message)`
  - `parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S>` (throws `ApiError(400, 'bad_request', …)`)
  - `interface AppDeps { db: DB; bulk: BulkImporter; webDistDir?: string }` and `createApp(deps: AppDeps): Hono`
  - HTTP: `GET /api/health` → `{ ok: true }`
  - HTTP: `GET /api/cards/autocomplete?q=&limit=` → `CardSummary[]` (limit 1–50, default 10)
  - HTTP: `GET /api/cards/:id` → `CardDetail` or 404 `not_found`
  - HTTP: `GET /api/bulk/status` → `BulkStatus`
  - HTTP: `POST /api/bulk/refresh` → 202 `{ started: true }` or 409 `already_running`
  - HTTP: unknown `/api/*` → 404 JSON. With `webDistDir` set, everything else serves the SPA (falling back to `index.html`).

- [ ] **Step 1: Write the failing API tests**

`tests/server/api.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import type { BulkImporter } from '../../src/server/bulk/import.ts'
import type { ApiErrorBody, BulkStatus, CardDetail, CardSummary } from '../../src/shared/types.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard } from '../helpers/fixtures.ts'

const IDLE: BulkStatus = { state: 'idle', processed: 0, error: null, updatedAt: null, sourceUpdatedAt: null, cardCount: 61 }

function stubBulk(overrides: Partial<BulkImporter> = {}): BulkImporter {
  return { status: () => IDLE, isStale: () => false, start: () => Promise.resolve(), ...overrides }
}

function makeApp(bulk: BulkImporter = stubBulk()) {
  return createApp({ db: createTestDb(), bulk })
}

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

describe('api', () => {
  it('answers health checks', async () => {
    const res = await makeApp().request('/api/health')
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual({ ok: true })
  })

  it('autocompletes card names', async () => {
    const res = await makeApp().request('/api/cards/autocomplete?q=bolt')
    expect(res.status).toBe(200)
    const results = await body<CardSummary[]>(res)
    expect(results[0]).toMatchObject({ name: 'Lightning Bolt', cardId: fixtureCard('Lightning Bolt', 'sta').id, manaCost: '{R}' })
  })

  it('tolerates search syntax in autocomplete', async () => {
    const res = await makeApp().request(`/api/cards/autocomplete?q=${encodeURIComponent('"')}`)
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual([])
  })

  it('validates autocomplete parameters', async () => {
    const res = await makeApp().request('/api/cards/autocomplete?q=bolt&limit=999')
    expect(res.status).toBe(400)
    expect((await body<ApiErrorBody>(res)).error.code).toBe('bad_request')
  })

  it('returns card detail with printings', async () => {
    const bolt = fixtureCard('Lightning Bolt', 'm10')
    const res = await makeApp().request(`/api/cards/${bolt.id}`)
    expect(res.status).toBe(200)
    const detail = await body<CardDetail>(res)
    expect(detail.card.name).toBe('Lightning Bolt')
    expect(detail.printings.map((p) => p.setCode)).toEqual(['sta', 'm11', 'm10'])
  })

  it('404s unknown cards', async () => {
    const res = await makeApp().request('/api/cards/does-not-exist')
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: { code: 'not_found', message: 'Card not found' } })
  })

  it('404s unknown API routes as JSON', async () => {
    const res = await makeApp().request('/api/nope')
    expect(res.status).toBe(404)
    expect((await body<ApiErrorBody>(res)).error.code).toBe('not_found')
  })

  it('reports bulk status', async () => {
    const res = await makeApp().request('/api/bulk/status')
    expect(await body(res)).toEqual(IDLE)
  })

  it('refuses a second refresh while one runs', async () => {
    const start = vi.fn<BulkImporter['start']>().mockReturnValueOnce(Promise.resolve()).mockReturnValueOnce(null)
    const app = makeApp(stubBulk({ start }))
    const first = await app.request('/api/bulk/refresh', { method: 'POST' })
    expect(first.status).toBe(202)
    expect(await body(first)).toEqual({ started: true })
    const second = await app.request('/api/bulk/refresh', { method: 'POST' })
    expect(second.status).toBe(409)
    expect((await body<ApiErrorBody>(second)).error.code).toBe('already_running')
  })

  it('hides unexpected errors behind a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = makeApp(stubBulk({ status: () => { throw new Error('secret detail') } }))
    const res = await app.request('/api/bulk/status')
    expect(res.status).toBe(500)
    expect(await body(res)).toEqual({ error: { code: 'internal', message: 'Internal server error' } })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/server/api.test.ts`
Expected: FAIL, because `src/server/app.ts` doesn't exist.

- [ ] **Step 3: Implement error helpers, routes, and the app**

`src/server/http.ts`:
```ts
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'

/** An error with an HTTP status, rendered as `{ error: { code, message } }` by the app's error handler. */
export class ApiError extends Error {
  status: ContentfulStatusCode
  code: string
  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Validates input with a zod schema; throws a 400 ApiError listing every problem. */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const message = result.error.issues.map((i) => `${i.path.map(String).join('.') || 'input'}: ${i.message}`).join('; ')
  throw new ApiError(400, 'bad_request', message)
}
```

`src/server/cards/routes.ts`:
```ts
import { Hono } from 'hono'
import { z } from 'zod'
import type { CardDetail } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'
import { ApiError, parseWith } from '../http.ts'
import { autocomplete, getCard, getPrintings } from './repo.ts'

const AutocompleteQuery = z.object({
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

export function cardRoutes(deps: { db: DB }): Hono {
  const routes = new Hono()

  routes.get('/autocomplete', (c) => {
    const { q, limit } = parseWith(AutocompleteQuery, c.req.query())
    return c.json(autocomplete(deps.db, q, limit))
  })

  routes.get('/:id', (c) => {
    const card = getCard(deps.db, c.req.param('id'))
    if (!card) throw new ApiError(404, 'not_found', 'Card not found')
    const detail: CardDetail = { card, printings: getPrintings(deps.db, card.oracleId) }
    return c.json(detail)
  })

  return routes
}
```

`src/server/bulk/routes.ts`:
```ts
import { Hono } from 'hono'
import { ApiError } from '../http.ts'
import type { BulkImporter } from './import.ts'

export function bulkRoutes(deps: { bulk: BulkImporter }): Hono {
  const routes = new Hono()

  routes.get('/status', (c) => c.json(deps.bulk.status()))

  routes.post('/refresh', (c) => {
    if (deps.bulk.start() === null) {
      throw new ApiError(409, 'already_running', 'A card data refresh is already running')
    }
    return c.json({ started: true }, 202)
  })

  return routes
}
```

`src/server/app.ts`:
```ts
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { BulkImporter } from './bulk/import.ts'
import { bulkRoutes } from './bulk/routes.ts'
import { cardRoutes } from './cards/routes.ts'
import type { DB } from './db/index.ts'
import { ApiError } from './http.ts'

export interface AppDeps {
  db: DB
  bulk: BulkImporter
  /** Built SPA directory. When set, non-API requests serve it, falling back to index.html. */
  webDistDir?: string
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status)
    console.error(err)
    return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500)
  })

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route('/api/cards', cardRoutes(deps))
  app.route('/api/bulk', bulkRoutes(deps))
  app.all('/api/*', (c) =>
    c.json({ error: { code: 'not_found', message: `No API route for ${c.req.method} ${c.req.path}` } }, 404),
  )

  if (deps.webDistDir) {
    app.use('/*', serveStatic({ root: deps.webDistDir }))
    app.get('*', serveStatic({ path: path.join(deps.webDistDir, 'index.html') }))
  }

  return app
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/server/api.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the server entry and setup script**

`src/server/main.ts`:
```ts
import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { createBulkImporter } from './bulk/import.ts'
import { DATA_DIR, DB_PATH, HOST, PORT, WEB_DIST_DIR } from './config.ts'
import { openDb } from './db/index.ts'
import { createScryfallClient } from './scryfall/client.ts'

const db = openDb(DB_PATH)
const bulk = createBulkImporter({
  db,
  client: createScryfallClient(),
  dataDir: DATA_DIR,
  log: (message) => console.log(`[card data] ${message}`),
})
const app = createApp({ db, bulk, webDistDir: fs.existsSync(WEB_DIST_DIR) ? WEB_DIST_DIR : undefined })

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`Binder running at http://localhost:${info.port}`)
  if (bulk.isStale()) {
    console.log('[card data] Missing or older than 7 days; refreshing in the background')
    void bulk.start()
  }
})
```

`scripts/setup.ts`:
```ts
// `pnpm run setup`: creates the database and performs the first Scryfall card-data import.
import { createBulkImporter } from '../src/server/bulk/import.ts'
import { DATA_DIR, DB_PATH } from '../src/server/config.ts'
import { openDb } from '../src/server/db/index.ts'
import { createScryfallClient } from '../src/server/scryfall/client.ts'

const db = openDb(DB_PATH)
console.log(`Database ready at ${DB_PATH}`)

const bulk = createBulkImporter({ db, client: createScryfallClient(), dataDir: DATA_DIR })
if (!bulk.isStale()) {
  console.log('Card data is up to date.')
} else {
  console.log('Downloading Scryfall card data (about 80 MB)…')
  const started = Date.now()
  const timer = setInterval(() => {
    const s = bulk.status()
    process.stdout.write(`\r  ${s.state} ${s.processed.toLocaleString()} printings   `)
  }, 500)
  await bulk.start()
  clearInterval(timer)
  const status = bulk.status()
  if (status.state === 'error') {
    console.error(`\nCard data import failed: ${status.error}`)
    process.exitCode = 1
  } else {
    console.log(`\nImported ${status.cardCount.toLocaleString()} printings in ${Math.round((Date.now() - started) / 1000)}s.`)
  }
}
db.close()
```

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass. (The real download is exercised in Task 8. Don't run `main.ts` or `setup.ts` yet.)

---

### Task 7: Web shell, card lookup, and card drawer

**Files:**
- Create: `vite.config.ts`, `scripts/seed-dev.ts`
- Create: `src/web/index.html`, `src/web/index.css`, `src/web/main.tsx`, `src/web/routes.tsx`
- Create: `src/web/lib/api.ts`, `src/web/lib/card-drawer.tsx`, `src/web/lib/use-debounced.ts`, `src/web/lib/format.ts`
- Create: `src/web/components/Layout.tsx`, `src/web/components/QuickFind.tsx`, `src/web/components/CardDrawer.tsx`, `src/web/components/ManaText.tsx`
- Create: `src/web/pages/HomePage.tsx`

**Interfaces:**
- Consumes: HTTP endpoints from Task 6. Shared types `Card`, `CardDetail`, `CardFace`, `CardSummary`, `Printing`, `BulkStatus`, `ApiErrorBody` (Task 3). For the seed script: `openDb` (Task 1), `scryfallToRow` (Task 2), `insertCardRows`, `rebuildCardNames` (Task 3), `setMeta` (Task 1).
- Produces:
  - `apiGet<T>(path: string): Promise<T>`, `apiPost<T>(path: string, body?: unknown): Promise<T>`, and `class ApiRequestError extends Error { status: number; code: string }`
  - `CardDrawerProvider`, `useCardDrawer(): { cardId: string | null; open(cardId: string): void; close(): void }`. Any component can open the drawer for a printing id.
  - `useDebounced<T>(value: T, ms: number): T`
  - `formatUsd(value: number | null): string`, `formatDate(iso: string | null): string`
  - `<ManaText text className? />` renders `{X}` symbols as Scryfall SVGs, `symbolUrl(symbol: string): string`
  - `<QuickFind size? autoFocus? />`
  - `<Layout />`, `NAV` items array (Task 8 adds Settings to it)
  - `router` (Task 8 adds the settings route)

- [ ] **Step 1: Vite config, HTML shell, styles, and entry**

`vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4321' } },
})
```

`src/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Binder</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/web/index.css`:
```css
@import "tailwindcss";

@theme {
  --font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
}

:root {
  color-scheme: dark;
}

body {
  @apply bg-stone-950 text-stone-200 antialiased;
}
```

`src/web/main.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import './index.css'
import { CardDrawerProvider } from './lib/card-drawer.tsx'
import { router } from './routes.tsx'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <CardDrawerProvider>
        <RouterProvider router={router} />
      </CardDrawerProvider>
    </QueryClientProvider>
  </StrictMode>,
)
```

`src/web/routes.tsx`:
```tsx
import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout.tsx'
import { HomePage } from './pages/HomePage.tsx'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [{ index: true, element: <HomePage /> }],
  },
])
```

- [ ] **Step 2: Client libraries**

`src/web/lib/api.ts`:
```ts
import type { ApiErrorBody } from '../../shared/types.ts'

export class ApiRequestError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T
  let code = 'http_error'
  let message = `Request failed (${res.status})`
  try {
    const body = (await res.json()) as ApiErrorBody
    code = body.error.code
    message = body.error.message
  } catch {
    // Not a JSON error body; keep the generic message.
  }
  throw new ApiRequestError(res.status, code, message)
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(path))
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  return handle<T>(await fetch(path, init))
}
```

`src/web/lib/card-drawer.tsx`:
```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface CardDrawerApi {
  /** Printing id currently shown, or null when closed. */
  cardId: string | null
  open: (cardId: string) => void
  close: () => void
}

const CardDrawerContext = createContext<CardDrawerApi | null>(null)

export function CardDrawerProvider({ children }: { children: ReactNode }) {
  const [cardId, setCardId] = useState<string | null>(null)
  const open = useCallback((id: string) => setCardId(id), [])
  const close = useCallback(() => setCardId(null), [])
  const value = useMemo(() => ({ cardId, open, close }), [cardId, open, close])
  return <CardDrawerContext value={value}>{children}</CardDrawerContext>
}

export function useCardDrawer(): CardDrawerApi {
  const ctx = useContext(CardDrawerContext)
  if (!ctx) throw new Error('useCardDrawer must be used inside CardDrawerProvider')
  return ctx
}
```

`src/web/lib/use-debounced.ts`:
```ts
import { useEffect, useState } from 'react'

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}
```

`src/web/lib/format.ts`:
```ts
export function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
```

- [ ] **Step 3: Mana symbols and the quick-find combobox**

`src/web/components/ManaText.tsx`:
```tsx
import { useState, type ReactNode } from 'react'

const SYMBOL = /\{([^}]+)\}/g

/** Scryfall's SVG for a mana/tap symbol: {W/U} → WU.svg, {2/W} → 2W.svg, {T} → T.svg. */
export function symbolUrl(symbol: string): string {
  return `https://svgs.scryfall.io/card-symbols/${encodeURIComponent(symbol.replace(/\//g, '').toUpperCase())}.svg`
}

function ManaSymbol({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="font-mono text-xs">{`{${symbol}}`}</span>
  return (
    <img
      src={symbolUrl(symbol)}
      alt={`{${symbol}}`}
      title={`{${symbol}}`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="mx-px inline-block h-[1em] w-[1em] align-[-0.125em]"
    />
  )
}

/** Renders text with every `{…}` symbol replaced by its icon (falls back to the text if the icon fails). */
export function ManaText({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(SYMBOL)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(<ManaSymbol key={match.index} symbol={match[1] ?? ''} />)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span className={className}>{parts}</span>
}
```

`src/web/components/QuickFind.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CardSummary } from '../../shared/types.ts'
import { apiGet } from '../lib/api.ts'
import { useCardDrawer } from '../lib/card-drawer.tsx'
import { useDebounced } from '../lib/use-debounced.ts'
import { ManaText } from './ManaText.tsx'

/**
 * Card-name lookup. Arrow keys move, Enter opens the card drawer, Escape closes the list.
 * The header instance (size "md") also focuses when "/" is pressed anywhere outside a text field.
 */
export function QuickFind({ size = 'md', autoFocus = false }: { size?: 'md' | 'lg'; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(0)
  const query = useDebounced(text.trim(), 120)
  const drawer = useCardDrawer()
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const { data, isFetching } = useQuery({
    queryKey: ['autocomplete', query],
    queryFn: () => apiGet<CardSummary[]>(`/api/cards/autocomplete?q=${encodeURIComponent(query)}&limit=12`),
    enabled: query.length > 0,
    placeholderData: (previous) => previous,
  })
  const results = query.length > 0 ? (data ?? []) : []

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    if (size !== 'md') return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target !== null && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [size])

  function choose(card: CardSummary) {
    drawer.open(card.cardId)
    setListOpen(false)
    inputRef.current?.blur()
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setListOpen(true)
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const card = results[active]
      if (card) {
        e.preventDefault()
        choose(card)
      }
    } else if (e.key === 'Escape') {
      setListOpen(false)
      inputRef.current?.blur()
    }
  }

  const inputSize = size === 'lg' ? 'h-14 px-5 text-lg' : 'h-9 px-3 text-sm'
  const showList = listOpen && results.length > 0

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setListOpen(true)
        }}
        onFocus={() => setListOpen(true)}
        onBlur={() => setListOpen(false)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={size === 'lg' ? 'Look up any card…' : 'Find a card   /'}
        className={`w-full rounded-lg border border-stone-700 bg-stone-900/80 text-stone-100 outline-none placeholder:text-stone-500 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-500/20 ${inputSize}`}
      />
      {isFetching && (
        <span aria-hidden className="absolute top-1/2 right-3 size-2 -translate-y-1/2 animate-pulse rounded-full bg-amber-500/70" />
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-[60vh] w-full overflow-auto rounded-lg border border-stone-700 bg-stone-900 shadow-2xl shadow-black/50"
        >
          {results.map((card, i) => (
            <li
              key={card.oracleId}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(card)
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? 'bg-stone-800' : ''}`}
            >
              {card.imageSmall ? (
                <img src={card.imageSmall} alt="" loading="lazy" className="h-10 w-7 shrink-0 rounded-sm object-cover" />
              ) : (
                <div className="h-10 w-7 shrink-0 rounded-sm bg-stone-800" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-stone-100">{card.name}</div>
                <div className="truncate text-xs text-stone-400">{card.typeLine}</div>
              </div>
              <ManaText text={card.manaCost} className="shrink-0 text-sm" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Card drawer**

`src/web/components/CardDrawer.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query'
import { Fragment, useEffect, useState } from 'react'
import type { Card, CardDetail, CardFace, Printing } from '../../shared/types.ts'
import { apiGet } from '../lib/api.ts'
import { useCardDrawer } from '../lib/card-drawer.tsx'
import { formatUsd } from '../lib/format.ts'
import { ManaText } from './ManaText.tsx'

const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander'] as const

const LEGALITY_STYLE: Record<string, string> = {
  legal: 'border-emerald-800 bg-emerald-900/50 text-emerald-300',
  banned: 'border-rose-900 bg-rose-900/40 text-rose-300',
  restricted: 'border-amber-900 bg-amber-900/40 text-amber-300',
  not_legal: 'border-stone-800 bg-stone-800/60 text-stone-500',
}

/** Slide-over with a printing's details. Opened from anywhere via useCardDrawer().open(printingId). */
export function CardDrawer() {
  const { cardId, open, close } = useCardDrawer()

  useEffect(() => {
    if (!cardId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cardId, close])

  const { data, error, isPending } = useQuery({
    queryKey: ['card', cardId],
    queryFn: () => apiGet<CardDetail>(`/api/cards/${encodeURIComponent(cardId ?? '')}`),
    enabled: cardId !== null,
    placeholderData: (previous) => previous,
  })

  if (!cardId) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Close card details" onClick={close} className="absolute inset-0 bg-black/60" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={data?.card.name ?? 'Card details'}
        className="relative flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-stone-800 bg-stone-950 shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-800 bg-stone-950/95 px-5 py-3">
          <span className="text-xs tracking-[0.2em] text-stone-500 uppercase">Card</span>
          <button onClick={close} className="rounded px-2 py-1 text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-100">
            Close ✕
          </button>
        </div>
        {isPending && <div className="p-8 text-stone-400">Loading…</div>}
        {error && <div className="m-5 rounded-lg border border-rose-900 bg-rose-950/50 p-4 text-rose-200">{error.message}</div>}
        {data && <CardDetailView detail={data} onSelectPrinting={open} />}
      </aside>
    </div>
  )
}

function CardDetailView({ detail, onSelectPrinting }: { detail: CardDetail; onSelectPrinting: (id: string) => void }) {
  const { card, printings } = detail
  const faceImages = card.faces.map((f) => f.imageNormal).filter((url): url is string => url !== null)
  const [faceIndex, setFaceIndex] = useState(0)
  useEffect(() => setFaceIndex(0), [card.id])
  const image = faceImages.length > 1 ? faceImages[faceIndex % faceImages.length] : card.imageNormal
  const faces: CardFace[] =
    card.faces.length > 1
      ? card.faces
      : [{ name: card.name, manaCost: card.manaCost, typeLine: card.typeLine, oracleText: card.oracleText, power: card.power, toughness: card.toughness, loyalty: card.loyalty, imageNormal: card.imageNormal }]

  return (
    <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,15rem)_1fr]">
      <div className="space-y-3">
        {image ? (
          <img src={image} alt={card.name} className="w-full rounded-xl shadow-xl shadow-black/60" />
        ) : (
          <div className="aspect-[63/88] rounded-xl bg-stone-900" />
        )}
        {faceImages.length > 1 && (
          <button
            onClick={() => setFaceIndex((i) => i + 1)}
            className="w-full rounded-md border border-stone-700 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
          >
            Flip ↻
          </button>
        )}
        <PriceTable card={card} />
        <a href={card.scryfallUri} target="_blank" rel="noreferrer" className="block text-center text-xs text-stone-500 hover:text-amber-400">
          View on Scryfall ↗
        </a>
      </div>
      <div className="min-w-0 space-y-5">
        {faces.map((face, i) => (
          <FaceBlock key={i} face={face} />
        ))}
        <div className="text-sm text-stone-400">
          <span className="text-stone-300">{card.setName}</span> · {card.setCode.toUpperCase()} #{card.collectorNumber} ·{' '}
          <span className="capitalize">{card.rarity}</span>
          {card.artist && <> · Illus. {card.artist}</>}
        </div>
        <Legalities legalities={card.legalities} />
        <PrintingList printings={printings} currentId={card.id} onSelect={onSelectPrinting} />
      </div>
    </div>
  )
}

function FaceBlock({ face }: { face: CardFace }) {
  const stats = face.loyalty
    ? `Loyalty ${face.loyalty}`
    : face.power !== null && face.toughness !== null
      ? `${face.power}/${face.toughness}`
      : null
  return (
    <section className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-serif text-2xl font-semibold text-stone-50">{face.name}</h2>
        {face.manaCost && <ManaText text={face.manaCost} className="shrink-0 pt-1.5" />}
      </div>
      <div className="text-sm text-stone-300">{face.typeLine}</div>
      {face.oracleText && (
        <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-900/60 p-3 leading-relaxed text-stone-200">
          {face.oracleText.split('\n').map((paragraph, i) => (
            <p key={i}>
              <ManaText text={paragraph} />
            </p>
          ))}
        </div>
      )}
      {stats && <div className="text-right text-sm font-semibold text-stone-200">{stats}</div>}
    </section>
  )
}

function PriceTable({ card }: { card: Card }) {
  const rows: Array<[string, number | null]> = [
    ['Nonfoil', card.prices.usd],
    ['Foil', card.prices.usdFoil],
    ['Etched', card.prices.usdEtched],
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-stone-800 p-3 text-sm">
      {rows
        .filter(([, value], i) => i === 0 || value !== null)
        .map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-stone-400">{label}</dt>
            <dd className="text-right text-stone-100 tabular-nums">{formatUsd(value)}</dd>
          </Fragment>
        ))}
    </dl>
  )
}

function Legalities({ legalities }: { legalities: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FORMATS.map((format) => {
        const status = legalities[format] ?? 'not_legal'
        return (
          <span
            key={format}
            title={status.replace('_', ' ')}
            className={`rounded border px-2 py-0.5 text-xs capitalize ${LEGALITY_STYLE[status] ?? LEGALITY_STYLE.not_legal ?? ''}`}
          >
            {format}
          </span>
        )
      })}
    </div>
  )
}

function PrintingList({ printings, currentId, onSelect }: { printings: Printing[]; currentId: string; onSelect: (id: string) => void }) {
  return (
    <div>
      <h3 className="mb-2 text-xs tracking-[0.2em] text-stone-500 uppercase">Printings ({printings.length})</h3>
      <ul className="max-h-72 divide-y divide-stone-800/80 overflow-y-auto rounded-lg border border-stone-800">
        {printings.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p.id)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-stone-900 ${p.id === currentId ? 'bg-stone-900 text-amber-300' : 'text-stone-300'}`}
            >
              <span className="w-12 shrink-0 font-mono text-xs text-stone-500 uppercase">{p.setCode}</span>
              <span className="min-w-0 flex-1 truncate">
                {p.setName} <span className="text-stone-500">#{p.collectorNumber}</span>
              </span>
              <span className="shrink-0 text-xs text-stone-500">{p.releasedAt.slice(0, 4)}</span>
              <span className="w-16 shrink-0 text-right tabular-nums">{formatUsd(p.prices.usd ?? p.prices.usdFoil)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: Layout and home page**

`src/web/components/Layout.tsx`:
```tsx
import { NavLink, Outlet } from 'react-router'
import { CardDrawer } from './CardDrawer.tsx'
import { QuickFind } from './QuickFind.tsx'

/** Top-level navigation. Later milestones append entries here. */
export const NAV: Array<{ to: string; label: string; end: boolean }> = [{ to: '/', label: 'Look up', end: true }]

export function Layout() {
  return (
    <div className="min-h-dvh bg-stone-950 text-stone-200">
      <header className="sticky top-0 z-20 border-b border-stone-800/80 bg-stone-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-2.5">
          <NavLink to="/" className="font-serif text-xl font-semibold tracking-wide text-amber-400">
            Binder
          </NavLink>
          <nav className="flex gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-stone-800 text-stone-50' : 'text-stone-400 hover:text-stone-100'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto w-full max-w-sm">
            <QuickFind />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
      <CardDrawer />
    </div>
  )
}
```

`src/web/pages/HomePage.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query'
import type { BulkStatus } from '../../shared/types.ts'
import { QuickFind } from '../components/QuickFind.tsx'
import { apiGet } from '../lib/api.ts'
import { formatDate } from '../lib/format.ts'

export function HomePage() {
  const { data: status } = useQuery({
    queryKey: ['bulk-status'],
    queryFn: () => apiGet<BulkStatus>('/api/bulk/status'),
  })
  const importing = status?.state === 'downloading' || status?.state === 'importing'
  const empty = status !== undefined && status.cardCount === 0

  return (
    <div className="mx-auto max-w-2xl pt-16 text-center">
      <h1 className="font-serif text-4xl font-semibold text-stone-50">Look up any card</h1>
      <p className="mt-3 text-stone-400">Every paper printing from Scryfall, searchable instantly.</p>
      <div className="mt-8 text-left">
        {empty ? (
          <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-5 text-amber-100">
            {importing
              ? 'Downloading card data from Scryfall. This takes about a minute.'
              : 'No card data yet. Import it from Scryfall in Settings (about a minute).'}
          </div>
        ) : (
          <QuickFind size="lg" autoFocus />
        )}
      </div>
      {status && !empty && (
        <p className="mt-4 text-xs text-stone-500">
          {status.cardCount.toLocaleString()} printings · updated {formatDate(status.updatedAt)}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Dev seed script**

`scripts/seed-dev.ts`:
```ts
// Seeds a throwaway database with the 61 test fixture cards so the UI can be exercised without a real import.
// Usage: BINDER_DATA_DIR=/tmp/binder-dev node scripts/seed-dev.ts
import fs from 'node:fs'
import { scryfallToRow, type CardRow } from '../src/server/cards/map.ts'
import { insertCardRows, rebuildCardNames } from '../src/server/cards/repo.ts'
import { DB_PATH } from '../src/server/config.ts'
import { openDb } from '../src/server/db/index.ts'
import { setMeta } from '../src/server/db/meta.ts'
import type { ScryfallCard } from '../src/server/scryfall/types.ts'

if (!process.env.BINDER_DATA_DIR) {
  console.error('Set BINDER_DATA_DIR to a scratch directory so this never touches your real library.')
  process.exit(1)
}
const db = openDb(DB_PATH)
const cards = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/cards.json', import.meta.url), 'utf8')) as ScryfallCard[]
insertCardRows(db, 'cards', cards.map((c) => scryfallToRow(c)).filter((r): r is CardRow => r !== null))
rebuildCardNames(db)
setMeta(db, 'bulk_updated_at', new Date().toISOString())
console.log(`Seeded ${cards.length} fixture cards into ${DB_PATH}`)
db.close()
```

- [ ] **Step 7: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: no type errors. Vite prints `dist/web/index.html` and asset sizes, ending in `✓ built in …`.

- [ ] **Step 8: Smoke-test against fixture data**

Run:
```bash
BINDER_DATA_DIR=/tmp/binder-dev node scripts/seed-dev.ts
BINDER_DATA_DIR=/tmp/binder-dev pnpm dev
```
In another terminal:
```bash
curl -s 'http://localhost:5173/api/cards/autocomplete?q=delver' | head -c 300
curl -s http://localhost:5173/ | grep -o '<div id="root"></div>'
```
Expected: the first prints JSON starting `[{"oracleId":…,"name":"Delver of Secrets // Insectile Aberration"`. The second prints `<div id="root"></div>`.

Then open `http://localhost:5173` in a browser and check:
- The home page shows "Look up any card" with a focused search box.
- Typing `delv` lists Delver of Secrets with a thumbnail, and Enter opens the drawer.
- The drawer shows both faces' text, a **Flip ↻** button that swaps the image, legality badges, a price table, and a printings list.
- Pressing Escape closes the drawer.
- Searching `bolt` shows 3 printings (STA, M11, M10). Clicking M10 swaps the drawer to that printing and highlights it.
- Pressing `/` on the page focuses the header search.

Stop the dev server with Ctrl-C.

- [ ] **Step 9: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

---

### Task 8: Settings page and end-to-end run with real card data

**Files:**
- Create: `src/web/pages/SettingsPage.tsx`, `README.md`
- Modify: `src/web/routes.tsx` (add `settings` route), `src/web/components/Layout.tsx` (add Settings to `NAV`), `src/web/pages/HomePage.tsx` (link the empty state to Settings)

**Interfaces:**
- Consumes: `GET /api/bulk/status`, `POST /api/bulk/refresh` (Task 6); `apiGet`, `apiPost`, `formatDate` (Task 7); `NAV`, `router` (Task 7)
- Produces: `/settings` route with the Card data section. Later milestones add sections to this page.

- [ ] **Step 1: Settings page**

`src/web/pages/SettingsPage.tsx`:
```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BulkState, BulkStatus } from '../../shared/types.ts'
import { apiGet, apiPost } from '../lib/api.ts'
import { formatDate } from '../lib/format.ts'

const RUNNING: BulkState[] = ['downloading', 'importing']

export function SettingsPage() {
  const queryClient = useQueryClient()
  const { data: status, error } = useQuery({
    queryKey: ['bulk-status'],
    queryFn: () => apiGet<BulkStatus>('/api/bulk/status'),
    refetchInterval: (query) => (query.state.data && RUNNING.includes(query.state.data.state) ? 1000 : false),
  })
  const refresh = useMutation({
    mutationFn: () => apiPost<{ started: boolean }>('/api/bulk/refresh'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['bulk-status'] }),
  })
  const running = status !== undefined && RUNNING.includes(status.state)

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="font-serif text-3xl font-semibold text-stone-50">Settings</h1>

      <section className="rounded-xl border border-stone-800 bg-stone-900/40 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-100">Card data</h2>
            <p className="mt-1 text-sm text-stone-400">
              A local copy of every paper printing from Scryfall. Refreshes automatically when older than 7 days.
            </p>
          </div>
          <button
            onClick={() => refresh.mutate()}
            disabled={running || refresh.isPending}
            className="shrink-0 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>

        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-stone-400">Printings</dt>
          <dd className="text-stone-100 tabular-nums">{status ? status.cardCount.toLocaleString() : '…'}</dd>
          <dt className="text-stone-400">Last imported</dt>
          <dd className="text-stone-100">{formatDate(status?.updatedAt ?? null)}</dd>
          <dt className="text-stone-400">Scryfall data from</dt>
          <dd className="text-stone-100">{formatDate(status?.sourceUpdatedAt ?? null)}</dd>
        </dl>

        {running && status && (
          <div className="mt-5 text-sm text-amber-200">
            {status.state === 'downloading'
              ? 'Downloading card data from Scryfall…'
              : `Importing… ${status.processed.toLocaleString()} printings`}
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-stone-800">
              <div className="h-full w-1/3 animate-pulse rounded bg-amber-500" />
            </div>
          </div>
        )}
        {!running && status?.error && (
          <div className="mt-5 rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
            Last refresh failed: {status.error}
          </div>
        )}
        {refresh.error && (
          <div className="mt-5 rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
            {refresh.error.message}
          </div>
        )}
        {error && (
          <div className="mt-5 rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
            Couldn't load status: {error.message}
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Wire the route, nav entry, and home empty state**

In `src/web/routes.tsx`, add the import and the child route:
```tsx
import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])
```

In `src/web/components/Layout.tsx`, replace the `NAV` constant:
```tsx
export const NAV: Array<{ to: string; label: string; end: boolean }> = [
  { to: '/', label: 'Look up', end: true },
  { to: '/settings', label: 'Settings', end: false },
]
```

In `src/web/pages/HomePage.tsx`, add `import { Link } from 'react-router'` and replace the empty-state `<div>` contents with:
```tsx
            {importing ? (
              'Downloading card data from Scryfall. This takes about a minute.'
            ) : (
              <>
                No card data yet.{' '}
                <Link to="/settings" className="font-medium text-amber-300 underline underline-offset-2">
                  Import it from Scryfall in Settings
                </Link>{' '}
                (about a minute).
              </>
            )}
```

- [ ] **Step 3: README**

`README.md`:
````markdown
# Binder

Personal MTG collection manager. Runs locally at http://localhost:4321.

## First run

```bash
pnpm install
pnpm run setup      # creates data/binder.db and imports Scryfall card data (~1 min)
pnpm start          # builds the UI and serves everything at http://localhost:4321
```

## Development

```bash
pnpm dev            # API on :4321 (auto-restarts) + Vite on http://localhost:5173
pnpm test           # unit and integration tests
pnpm typecheck
```

Card data refreshes automatically at startup when it's older than 7 days, or from Settings → Card data.
Everything lives in `data/` (database, downloads). Set `BINDER_DATA_DIR` to use a different folder.
````

- [ ] **Step 4: Typecheck, test, build**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all green, and Vite reports `✓ built`.

- [ ] **Step 5: Real import**

Run: `pnpm run setup`
Expected: `Database ready at …/data/binder.db`, a live counter, then `Imported N printings in Ts.` with N above 90,000 and T under 120. Record N and T in the task report.

- [ ] **Step 6: Serve the built app and verify end to end**

Run `pnpm start` (in the background or a second terminal), then:
```bash
curl -s http://localhost:4321/api/health
curl -s 'http://localhost:4321/api/cards/autocomplete?q=atraxa&limit=3'
curl -s http://localhost:4321/api/bulk/status
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/settings
```
Expected:
- `{"ok":true}`
- A JSON array whose first entry is `"name":"Atraxa, Praetors' Voice"`
- Status JSON with `"state":"idle"`, `"error":null`, and `cardCount` equal to N
- `200` (SPA fallback)

In a browser at `http://localhost:4321`, check:
- The home page shows the printing count and last-updated time.
- Look up `aether vial`, `lim-dul`, and `jace mind`. Each resolves, and the drawer shows real prices and many printings.
- Settings shows the counts and dates. **Refresh now** switches to "Refreshing…", shows the progress text, and returns to idle with a new "Last imported" time. The server log prints `[card data] Imported … printings`.

Stop the server.

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass. M1 is done.
