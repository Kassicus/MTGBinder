# Binder M3 (Collection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage the collection from the app. The card drawer shows my copies of a card with +/− steppers, adds a
copy of any printing and finish, and lists the decks that use the card. A Library page shows totals (cards, unique
cards, value, last added) above a search locked to my collection, and imports and exports collection CSVs. Library
search stays fast with tens of thousands of rows.

**Architecture:**
- **Server:**
  - A `collection` module:
    - repository: copies, adjust, bulk add, stats, export rows
    - CSV reader and writer
    - import resolver: CSV text → a preview of how each row resolves
    - routes under `/api/collection`
  - Card detail gains the card's copies and ownership.
  - Library search picks results over narrow columns and joins the ownership totals only when a query needs them.
  - Card data stores Scryfall's set type, so default printings skip special products. Card data imported by an older
    mapping refreshes itself once.
- **Web:**
  - Toasts for changes.
  - A rebuilt card drawer (copies, add, decks, focus handling).
  - `/library`, which reuses the Search page's body with the scope locked.
  - An accessible finder.

This milestone also clears the "M3" follow-ups in `docs/plans/m1-followups.md` and `docs/plans/m2-followups.md`.

**Tech Stack:** Same as M1 and M2: Node 24 running TypeScript directly, Hono 4, better-sqlite3 13 (SQLite 3.53), zod 4,
React 19, React Router 8, TanStack Query 5, Tailwind 4, Vite 8, Vitest 5. No new dependencies.

**Spec:** `docs/specs/2026-09-26-binder-design.md`. This plan covers milestone 3 of §8:
- §5.3 (Collection management);
- §5.2.5's drawer parts that change the collection (Your copies, Add a copy), plus its read-only Decks list;
- §5.2's `/library` page;
- §6's toasts for mutations.

Add to deck is M4.

**How this plan was made:** Every code block was prototyped in a scratch copy of the project. Replaying this plan
task by task onto the pre-M3 project reproduces that prototype exactly, and every task's checkpoint passes
(414 tests at the end, typecheck clean, build clean). The prototype also ran against a copy of the real
102,604-printing database, with a 23,000-row collection:

| Check | Result |
|---|---|
| Library search, 23k rows (was 170–420 ms) | 12–80 ms |
| CSV preview, 23k rows | 0.25–1 s |
| CSV import, 23k rows | 80–140 ms |
| Library stats | 33 ms |
| Export | 38 ms |
| Upgrade refresh (set types filled in) | about 1 min |

A headless-Chrome run exercised the drawer, toasts, finder, and import panel.

**Decisions made while prototyping (flagged for review):**
1. **Default printing v3** skips Scryfall's special-product set types (`promo`, `box`, `memorabilia`,
   `masterpiece`, `funny`, `token`, `minigame`, `vanguard`, `treasure_chest`, `alchemy`) and The List, Secret Lair,
   and Unknown Event.
   - Measured on the real data, special-product defaults drop from 3,382 cards to 1,877. The remaining 1,877 are
     cards printed only in special products.
   - Lightning Bolt, Sol Ring, and Command Tower move from `slz` to `msc`; Rhystic Study moves from `fca` to `j22`.
2. **Card data from an older mapping counts as stale**, so the first start after this update refreshes card data
   once. It re-imports the downloaded file when Scryfall has nothing newer, and deletes that file if it fails to import.
3. **`mmap_size` = 1 GiB** on every connection: scans of the card table run 30–60% faster.
4. **Library rows are priced by their finish**, including the price sort. The `usd` filter stays nonfoil, as spec
   §5.2.2 says. The cards view shows the matching collection row (printing and finish) with the most copies.
5. **`added_at` is the last time copies were added to a row**, so "date added" and "Last added" reflect re-adds.
6. **Removing more copies than owned removes them all** (no error).
7. **CSV import:**
   - It always adds; it never replaces the library.
   - A name alone resolves to the card's default printing (decision 1), not the literal newest printing, which is
     often a Secret Lair.
   - Rows with a guessed printing are included by default, and a checkbox leaves them out.
   - A finish the printing lacks switches to one it has, with a note.
   - A non-blank Foil value that isn't a known word reads as foil, with a note.
   - The count per row is 1–9999; the file can be up to 10 MB.
8. **Toasts:** failures always show one. Of the successes, only **Add** and imports show one; the steppers update in
   place.

## Global Constraints

Everything from M1 and M2 still applies:
- The server listens on `127.0.0.1:4321`, and `/api/*` sits behind the local-only guard.
- Node `>=24`.
- Every relative import has an explicit `.ts`/`.tsx` extension.
- Erasable TypeScript only: no `enum`, `namespace`, or constructor parameter properties.
- Exact pinned dependency versions. **No new dependencies in M3.**
- API errors are JSON `{ "error": { "code", "message" } }`.
- SQLite runs in WAL mode with `foreign_keys=ON`.
- Every user-supplied value in SQL is a bound parameter.
- Dark `stone` palette with an `amber` accent, Tailwind utilities only.
- **Not a git repository**: every task ends with a checkpoint (`pnpm typecheck && pnpm test`, plus `pnpm build` for
  web tasks), never a commit or `git init`.
- **Never write to `data/`** (the owner's real library). End-to-end checks use a copy in `/tmp`.

New in M3:
- **Collection rows** are (printing, finish) pairs with quantity > 0 (spec §4.1). A row that reaches 0 is deleted.
  Finishes are `nonfoil`, `foil`, `etched`.
- **Every change goes through a POST with a JSON body validated by zod**; a body that isn't JSON is a 400
  `bad_request`, never a 500.
- **Money:** totals are summed in whole cents. A copy's price is the price of its finish; no fallback to another
  finish.
- **CSV import is two calls:** a preview that changes nothing, then an all-or-nothing import of the chosen rows.
- **Allocation math** is unchanged (spec §4.3). `Ownership.free` can be negative.
- **Performance:** library search, stats, and export stay under the spec's 150 ms at 20,000 collection rows (Task 7
  measures this).

## Review Focus

1. **CSV files from other apps** arrive with:
   - quoted names containing commas, a byte-order mark, CRLF endings, or semicolon separators;
   - set names instead of codes, zero-padded numbers, reversible names like "Blood Crypt // Blood Crypt";
   - unknown cards and bad counts.

   Every row either resolves or says why not, and the file never crashes the preview.
   *Tests: Task 4 `collection-csv` and `collection-import`, and the export round trip in `collection-api`.*
2. **Rapid clicks on − and +, or removing the last copy twice,** never go negative, never error, and the row
   disappears at 0. *Tests: Task 3 "deletes the row at zero, and treats removing more than owned (or none) as
   removing all".*
3. **A finish the printing doesn't come in** (foil-only Thrasios, nonfoil-only precon Sol Ring):
   - the drawer offers only real finishes;
   - the API refuses to add one;
   - CSV import switches it, with a note.

   *Tests: Task 3 "refuses to add a finish the printing lacks, but lets you remove one"; Task 4 "adds a finish the
   printing has when the file asks for one it lacks".*
4. **Card data changes between preview and import** (or an owned printing leaves Scryfall). The import refuses as
   a whole and adds nothing; owned printings survive refreshes. *Tests: Task 4 "refuses the whole import when any
   item names an unknown card or a missing finish"; M1's "keeps dropped printings that the collection … reference".*
5. **Updating from M2 data** (no set types yet): defaults stay sensible before the refresh, the refresh happens once,
   and a damaged kept file can't wedge it. *Tests: Task 1 "still passes over Secret Lair, The List, and Unknown Event
   in data imported before set types", "is stale when … imported by an older card data version", "deletes a kept file
   that fails to import"; Task 7's real-data run.*

---

## File map

```
src/server/
  db/migrations/002_set_type.sql   cards.set_type
  db/index.ts                      + mmap_size
  cards/map.ts                     + set_type, CARD_DATA_VERSION
  cards/repo.ts                    default printing v3: SPECIAL_SET_TYPES, DEFAULT_PRINTING_ORDER; parsePrices exported
  bulk/import.ts                   card_data_version meta + staleness; re-import the kept file
  search/compile.ts                CompiledFilter.ownership
  search/run.ts                    library search rewrite; rows priced by finish
  cards/routes.ts                  card detail + copies + ownership
  collection/sql.ts                COPY_PRICE_SQL, finishOrderSql
  collection/repo.ts               getCopies, adjustCopies, collectionStats, addCopies, exportRows
  collection/csv.ts                parseCsv, csvLine, CsvError
  collection/import.ts             previewImport (CSV → resolved / ambiguous / unresolved rows)
  collection/routes.ts             /api/collection/stats|adjust|import/preview|import|export.csv
  app.ts, main.ts                  mount routes; startup log
src/shared/
  prices.ts                        finishPrice, listPrice
  types.ts                         CardDetail + copies/ownership; Copy, CollectionStats, CopyCount, Import* types
src/web/
  lib/toast.tsx                    ToastProvider, useToast
  lib/collection.ts                useAdjustCopies, invalidateCollection
  lib/import-items.ts              importItems (preview → items to add)
  lib/format.ts                    formatUsd with separators, plural
  lib/search-state.ts              locked scope
  lib/use-bulk-status.ts           also refreshes library stats and catalog
  components/CardDrawer.tsx        Your copies, Add a copy, Decks, prices by finish, focus handling
  components/QuickFind.tsx         accessible combobox
  components/Layout.tsx            Library nav entry; page inert behind the drawer
  components/ManaText.tsx          stable keys
  components/search/SearchBar.tsx, SearchResults.tsx   locked scope; empty-library wording
  components/library/ImportPanel.tsx
  pages/SearchPage.tsx             SearchView (shared with Library)
  pages/LibraryPage.tsx
  main.tsx, routes.tsx             ToastProvider; /library
scripts/setup.ts, scripts/seed-dev.ts
tests/
  server/collection-{csv,import,repo,api}.test.ts, shared/prices.test.ts, web/{format,import-items}.test.ts
  (and updates to cards-map, cards-repo, bulk-import, db, api, search-local, search-library, search-state)
```

---

### Task 1: Card data upkeep: set types, default printing v3, refresh after updates, faster reads

Scryfall files printings under set types. Storing the type lets the default printing (autocomplete, local search,
and Task 4's name-only CSV rows) skip special products such as Secret Lair and the Mystical Archive, which today
are the default for about 3,400 cards. Existing card data has no set types yet, so this task also makes card data
from an older mapping count as stale. The server then refreshes it once at the next start. The refresh re-imports
the already-downloaded file when Scryfall has nothing newer. The `mmap_size` pragma makes every scan of the 450 MB
card table 30–60% faster (measured: `t:creature` local search 237 → 170 ms, 23k-row library browse 100 → 65 ms).

**Files:**
- Create: `src/server/db/migrations/002_set_type.sql`
- Modify: `src/server/cards/map.ts` (`set_type` column, `CARD_DATA_VERSION`), `src/server/scryfall/types.ts`,
  `src/server/cards/repo.ts` (default-printing rule v3, `DEFAULT_PRINTING_ORDER`), `src/server/bulk/import.ts`
  (card data version, re-import the kept file), `src/server/db/index.ts` (`mmap_size`), `src/server/main.ts`,
  `scripts/setup.ts`, `scripts/seed-dev.ts`
- Test: `tests/server/cards-map.test.ts`, `tests/server/cards-repo.test.ts`, `tests/server/bulk-import.test.ts`,
  `tests/server/db.test.ts`, `tests/server/api.test.ts`, `tests/server/search-local.test.ts`

**Interfaces:**
- Consumes: M2's `rebuildCardNames`, `ensureCardNamesCurrent`, `importCardsFile`, `createBulkImporter`, `openDb`.
- Produces:
  - `CardRow.set_type: string` and `CARD_COLUMNS` ending in `'set_type'` (the column is added last by migration 002).
  - `CARD_DATA_VERSION = 2` (exported from `src/server/cards/map.ts`). Every import writes meta `card_data_version`,
    and `BulkImporter.isStale()` is true while that meta differs.
  - `SPECIAL_SET_TYPES` and `DEFAULT_PRINTING_ORDER` (an SQL `ORDER BY` list over `cards` columns, best printing
    first) from `src/server/cards/repo.ts`. Task 4's CSV import uses `DEFAULT_PRINTING_ORDER`. `CARD_NAMES_VERSION` is 3.
  - `openDb` sets `mmap_size = 1073741824`.

- [ ] **Step 1: Write the failing tests**

Update the existing tests and add new ones.

In `tests/server/cards-map.test.ts`, replace:

```ts
import { CARD_COLUMNS, canonColors, scryfallToRow, shouldImport, toNum } from '../../src/server/cards/map.ts'
```

with:

```ts
import { CARD_COLUMNS, canonColors, scryfallToRow, shouldImport, toNum } from '../../src/server/cards/map.ts'
import { openDb } from '../../src/server/db/index.ts'
```

In `tests/server/cards-map.test.ts`, replace:

```ts
  it('produces exactly the table columns', () => {
    expect(Object.keys(row('Lightning Bolt', 'm10')).sort()).toEqual([...CARD_COLUMNS].sort())
  })

```

with:

```ts
  it('produces exactly the table columns, listed in table order', () => {
    expect(Object.keys(row('Lightning Bolt', 'm10')).sort()).toEqual([...CARD_COLUMNS].sort())
    const columns = openDb(':memory:').pragma('table_info(cards)') as Array<{ name: string }>
    expect(columns.map((c) => c.name)).toEqual([...CARD_COLUMNS])
  })

  it('stores the set type, or an empty string when Scryfall leaves it out', () => {
    expect(row('Lightning Bolt', 'sta').set_type).toBe('masterpiece')
    expect(scryfallToRow({ ...fixtureCard('Lightning Bolt', 'm10'), set_type: undefined })?.set_type).toBe('')
  })

```

In `tests/server/cards-repo.test.ts`, replace:

```ts
import { getMeta, setMeta } from '../../src/server/db/meta.ts'
```

with:

```ts
import { getMeta, setMeta } from '../../src/server/db/meta.ts'
import type { ScryfallCard } from '../../src/server/scryfall/types.ts'
```

In `tests/server/cards-repo.test.ts`, replace:

```ts
  it('builds one name row per card identity, defaulting to the newest printing', () => {
    expect(count(db, 'card_names')).toBe(new Set(fixtureRows().map((r) => r.oracle_id)).size)
    expect(autocomplete(db, 'lightning bolt')[0]?.cardId).toBe(fixtureCard('Lightning Bolt', 'sta').id)
  })
```

with:

```ts
  it('builds one name row per card identity, defaulting to the newest regular printing', () => {
    expect(count(db, 'card_names')).toBe(new Set(fixtureRows().map((r) => r.oracle_id)).size)
    // Strixhaven Mystical Archive (sta, a masterpiece set) is newer than M11 but a special product.
    expect(autocomplete(db, 'lightning bolt')[0]?.cardId).toBe(fixtureCard('Lightning Bolt', 'm11').id)
  })
```

In `tests/server/cards-repo.test.ts`, replace:

```ts
  it('skips future-dated and reprint-product printings', () => {
    const bolt = fixtureCard('Lightning Bolt', 'sta')
    const later = { ...bolt, released_at: '2025-06-01' }
    const extra = [
      { ...later, id: '00000000-0000-4000-8000-00000000plst', set: 'plst', collector_number: 'M11-149' },
      { ...later, id: '00000000-0000-4000-8000-000000000sld', set: 'sld', collector_number: '999' },
      { ...bolt, id: '00000000-0000-4000-8000-00000future', set: 'fut', released_at: '2999-01-01' },
    ]
      .map((c) => scryfallToRow(c))
      .filter((r): r is CardRow => r !== null)
    insertCardRows(db, 'cards', extra)
    rebuildCardNames(db)
    expect(autocomplete(db, 'lightning bolt')[0]?.cardId).toBe(bolt.id)
  })

```

with:

```ts
  const addPrintings = (...cards: ScryfallCard[]) => {
    insertCardRows(db, 'cards', cards.map((c) => scryfallToRow(c)).filter((r): r is CardRow => r !== null))
    rebuildCardNames(db)
  }
  const defaultBolt = () => autocomplete(db, 'lightning bolt')[0]?.cardId

  it('passes over promos, future-dated printings, and special products while a regular printing exists', () => {
    const later = { ...fixtureCard('Lightning Bolt', 'm11'), released_at: '2025-06-01' }
    addPrintings(
      { ...later, id: '00000000-0000-4000-8000-0000000promo', set: 'pbolt', promo: true },
      { ...later, id: '00000000-0000-4000-8000-00000future', set: 'fut', released_at: '2999-01-01' },
      { ...later, id: '00000000-0000-4000-8000-00000000plst', set: 'plst', set_type: 'masters' },
      { ...later, id: '00000000-0000-4000-8000-000000000slz', set: 'slz', set_type: 'box' },
      { ...later, id: '00000000-0000-4000-8000-000000000unf', set: 'unf', set_type: 'funny' },
      { ...later, id: '00000000-0000-4000-8000-000000000p30', set: 'p30a', set_type: 'memorabilia' },
    )
    expect(defaultBolt()).toBe(fixtureCard('Lightning Bolt', 'm11').id)
    addPrintings({ ...later, id: '00000000-0000-4000-8000-00000000new', set: 'new', set_type: 'expansion' })
    expect(defaultBolt()).toBe('00000000-0000-4000-8000-00000000new')
  })

  it('falls back to the newest special product when a card has nothing else', () => {
    const only = syntheticCard({ name: 'Only Special', set: 'sld', set_type: 'box', released_at: '2021-01-01' })
    addPrintings(only, { ...only, id: '00000000-0000-4000-8000-0000000newer', set: 'sld2', released_at: '2022-01-01' })
    expect(autocomplete(db, 'only special')[0]?.cardId).toBe('00000000-0000-4000-8000-0000000newer')
  })

  it('still passes over Secret Lair, The List, and Unknown Event in data imported before set types', () => {
    const later = { ...fixtureCard('Lightning Bolt', 'm11'), released_at: '2025-06-01', set_type: undefined }
    addPrintings(
      { ...later, id: '00000000-0000-4000-8000-000000000sld', set: 'sld' },
      { ...later, id: '00000000-0000-4000-8000-00000000plst', set: 'plst' },
      { ...later, id: '00000000-0000-4000-8000-000000000unk', set: 'unk' },
    )
    expect(defaultBolt()).toBe(fixtureCard('Lightning Bolt', 'm11').id)
  })

```

In `tests/server/bulk-import.test.ts`, replace:

```ts
import { autocomplete, getCard, insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
```

with:

```ts
import { CARD_DATA_VERSION } from '../../src/server/cards/map.ts'
import { autocomplete, getCard, insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
```

In `tests/server/bulk-import.test.ts`, replace:

```ts
    expect(getMeta(db, 'bulk_updated_at')).toBe('x')
    expect(getMeta(db, 'bulk_error')).toBeNull()
```

with:

```ts
    expect(getMeta(db, 'bulk_updated_at')).toBe('x')
    expect(getMeta(db, 'bulk_error')).toBeNull()
    expect(getMeta(db, 'card_data_version')).toBe(String(CARD_DATA_VERSION))
```

In `tests/server/bulk-import.test.ts`, replace:

```ts
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
```

with:

```ts
  it('is stale when never imported, older than 7 days, or imported by an older card data version', () => {
    const db = openDb(':memory:')
    let now = new Date('2026-09-26T00:00:00Z')
    const bulk = createBulkImporter({ db, client: fakeClient({}), dataDir: tmp, now: () => now })
    expect(bulk.isStale()).toBe(true)
    setMeta(db, 'bulk_updated_at', '2026-09-25T00:00:00.000Z')
    setMeta(db, 'card_data_version', String(CARD_DATA_VERSION))
    expect(bulk.isStale()).toBe(false)
    setMeta(db, 'card_data_version', null)
    expect(bulk.isStale()).toBe(true)
    setMeta(db, 'card_data_version', String(CARD_DATA_VERSION - 1))
    expect(bulk.isStale()).toBe(true)
    setMeta(db, 'card_data_version', String(CARD_DATA_VERSION))
    now = new Date('2026-10-02T00:00:01Z')
    expect(bulk.isStale()).toBe(true)
  })

  function keptFile(data: Buffer): string {
    const file = path.join(tmp, 'bulk', 'default-cards.jsonl.gz')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data)
    return file
  }

  it('re-imports the kept file instead of downloading when Scryfall has nothing newer', async () => {
    const db = openDb(':memory:')
    keptFile(gzCards(loadFixtureCards()))
    setMeta(db, 'bulk_source_updated_at', SOURCE_UPDATED_AT)
    const client = fakeClient({})
    client.download = () => Promise.reject(new Error('should not download'))
    const logs: string[] = []
    const bulk = createBulkImporter({ db, client, dataDir: tmp, log: (m) => logs.push(m) })
    await bulk.start()
    expect(bulk.status()).toMatchObject({ state: 'idle', error: null, cardCount: 61 })
    expect(logs[0]).toMatch(/re-importing the downloaded file/)
    expect(getMeta(db, 'card_data_version')).toBe(String(CARD_DATA_VERSION))
  })

  it('downloads when Scryfall has newer data than the kept file', async () => {
    const db = openDb(':memory:')
    keptFile(gzLines(['not json']))
    setMeta(db, 'bulk_source_updated_at', '2026-09-01T00:00:00.000+00:00')
    const bulk = createBulkImporter({ db, client: fakeClient({ file: gzCards(loadFixtureCards()) }), dataDir: tmp })
    await bulk.start()
    expect(bulk.status()).toMatchObject({ state: 'idle', error: null, sourceUpdatedAt: SOURCE_UPDATED_AT, cardCount: 61 })
  })

  it('deletes a kept file that fails to import, so the next refresh downloads a fresh copy', async () => {
    const db = openDb(':memory:')
    const file = keptFile(gzLines(['not json']))
    setMeta(db, 'bulk_source_updated_at', SOURCE_UPDATED_AT)
    const bulk = createBulkImporter({ db, client: fakeClient({ file: gzCards(loadFixtureCards()) }), dataDir: tmp })
    await bulk.start()
    expect(bulk.status()).toMatchObject({ state: 'error', error: 'Malformed card data on line 1', cardCount: 0 })
    expect(fs.existsSync(file)).toBe(false)
    await bulk.start()
    expect(bulk.status()).toMatchObject({ state: 'idle', error: null, cardCount: 61 })
  })
```

In `tests/server/db.test.ts`, replace:

```ts
  it('creates parent directories and uses WAL for file databases', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-db-'))
    const db = openDb(path.join(dir, 'nested', 'test.db'))
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    db.close()
  })

```

with:

```ts
  it('creates parent directories and sets the pragmas for file databases', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-db-'))
    const db = openDb(path.join(dir, 'nested', 'test.db'))
    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(db.pragma('synchronous', { simple: true })).toBe(1) // NORMAL
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
      expect(db.pragma('mmap_size', { simple: true })).toBe(1073741824)
    } finally {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

```

In `tests/server/api.test.ts` (Lightning Bolt now defaults to M11: the Mystical Archive printing is a special product), replace:

```ts
cardId: fixtureCard('Lightning Bolt', 'sta').id, manaCost: '{R}' })
```

with:

```ts
cardId: fixtureCard('Lightning Bolt', 'm11').id, manaCost: '{R}' })
```

In `tests/server/search-local.test.ts`, replace:

```ts
expect(page.cards[0]).toMatchObject({ name: 'Lightning Bolt', setCode: 'sta', manaCost: '{R}', finish: null, quantity: null })
```

with:

```ts
expect(page.cards[0]).toMatchObject({ name: 'Lightning Bolt', setCode: 'm11', manaCost: '{R}', finish: null, quantity: null })
```

In `tests/server/search-local.test.ts` (the old query now matches the default printing, so it no longer tests the fallback), replace:

```ts
expect(searchLocal(db, { q: 'bolt a:moeller', sort: 'name', dir: 'asc', page: 1 }).cards[0]?.setCode).toBe('m11')
```

with:

```ts
expect(searchLocal(db, { q: 'bolt -s:m11', sort: 'name', dir: 'asc', page: 1 }).cards[0]?.setCode).toBe('sta')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/server/cards-map.test.ts tests/server/cards-repo.test.ts tests/server/bulk-import.test.ts tests/server/db.test.ts tests/server/api.test.ts tests/server/search-local.test.ts`
Expected: FAIL. `CARD_DATA_VERSION` is undefined, `table_info(cards)` has no `set_type`, Lightning Bolt still defaults to `sta`, and `mmap_size` is 0.

- [ ] **Step 3: Add the column, the mapping, and the default-printing rule**

Create `src/server/db/migrations/002_set_type.sql`:

```sql
-- Scryfall's set type (expansion, core, masters, commander, promo, box, memorabilia, funny, masterpiece, ...).
-- It decides each card's default printing. Rows imported before this migration hold '' until the next import.
ALTER TABLE cards ADD COLUMN set_type TEXT NOT NULL DEFAULT '';
```

In `src/server/cards/map.ts`, replace:

```ts
  is_promo: number
  is_digital: number
}
```

with:

```ts
  is_promo: number
  is_digital: number
  set_type: string
}
```

In `src/server/cards/map.ts`, replace:

```ts
  'purchase_uris', 'scryfall_uri', 'is_promo', 'is_digital',
] as const satisfies readonly (keyof CardRow)[]

```

with:

```ts
  'purchase_uris', 'scryfall_uri', 'is_promo', 'is_digital', 'set_type',
] as const satisfies readonly (keyof CardRow)[]

/**
 * Version of what scryfallToRow stores. Bump it when a mapping change needs data that only a new import can supply
 * (2: `set_type`); card data imported by an older version then counts as stale and refreshes at the next start.
 */
export const CARD_DATA_VERSION = 2

```

In `src/server/cards/map.ts`, replace:

```ts
    is_digital: card.digital ? 1 : 0,
  }
```

with:

```ts
    is_digital: card.digital ? 1 : 0,
    set_type: card.set_type ?? '',
  }
```

In `src/server/scryfall/types.ts`, replace:

```ts
  set: string
  set_name: string
  collector_number: string
```

with:

```ts
  set: string
  set_name: string
  /** expansion, core, masters, commander, promo, box, memorabilia, funny, masterpiece, ... */
  set_type?: string
  collector_number: string
```

In `src/server/cards/repo.ts`, replace:

```ts
/** Bump when the default-printing rule in rebuildCardNames changes, so existing databases get rebuilt at startup. */
export const CARD_NAMES_VERSION = 2

/**
 * Rebuilds `card_names` (one row per card identity) and its trigram index. The default printing is the newest one
 * that isn't a promo, isn't dated in the future, and isn't a reprint-only product (The List, Secret Lair, Unknown
 * Event), falling back through those in that order.
 */
export function rebuildCardNames(db: DB): void {
  db.transaction(() => {
    db.exec('DELETE FROM card_names')
    db.exec(`
      INSERT INTO card_names (oracle_id, name, face_names, search_name, default_card_id)
      SELECT oracle_id, name, face_names, search_name, id FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY oracle_id ORDER BY
            is_promo ASC,
            released_at > date('now') ASC,
            set_code IN ('plst', 'sld', 'unk') ASC,
            released_at DESC, set_code ASC, collector_number ASC
        ) AS pick
        FROM cards
      ) WHERE pick = 1`)
```

with:

```ts
/** Bump when the default-printing rule in rebuildCardNames changes, so existing databases get rebuilt at startup. */
export const CARD_NAMES_VERSION = 3

/** Scryfall set types of special products: promos, boxed sets like Secret Lair, collectibles, joke sets, and so on. */
export const SPECIAL_SET_TYPES = [
  'promo', 'box', 'memorabilia', 'masterpiece', 'funny', 'token', 'minigame', 'vanguard', 'treasure_chest', 'alchemy',
] as const

/**
 * Reprint products filed under regular set types: The List (`masters`), plus Secret Lair and Unknown Event so they
 * stay demoted in card data imported before set types were stored.
 */
const SPECIAL_SET_CODES = ['plst', 'sld', 'unk'] as const

const sqlList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ')

/**
 * Which printing of a card to show or pick by default, as an ORDER BY list over `cards` columns (best first): not a
 * promo, not dated in the future, not a special product (SPECIAL_SET_TYPES, SPECIAL_SET_CODES), newest, then lowest
 * collector number.
 */
export const DEFAULT_PRINTING_ORDER = `
  is_promo ASC,
  released_at > date('now') ASC,
  (set_type IN (${sqlList(SPECIAL_SET_TYPES)}) OR set_code IN (${sqlList(SPECIAL_SET_CODES)})) ASC,
  released_at DESC, set_code ASC, CAST(collector_number AS INTEGER) ASC, collector_number ASC`

/**
 * Rebuilds `card_names` (one row per card identity) and its trigram index. The default printing is the newest one
 * that isn't a promo, isn't dated in the future, and isn't from a special product, falling back through those in
 * that order (DEFAULT_PRINTING_ORDER).
 */
export function rebuildCardNames(db: DB): void {
  db.transaction(() => {
    db.exec('DELETE FROM card_names')
    db.exec(`
      INSERT INTO card_names (oracle_id, name, face_names, search_name, default_card_id)
      SELECT oracle_id, name, face_names, search_name, id FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY oracle_id ORDER BY ${DEFAULT_PRINTING_ORDER}) AS pick
        FROM cards
      ) WHERE pick = 1`)
```

- [ ] **Step 4: Store the card data version, refresh stale mappings, and re-import a current file**

In `src/server/bulk/import.ts`, replace:

```ts
import { CARD_COLUMNS, scryfallToRow, shouldImport, type CardRow } from '../cards/map.ts'
```

with:

```ts
import { CARD_COLUMNS, CARD_DATA_VERSION, scryfallToRow, shouldImport, type CardRow } from '../cards/map.ts'
```

In `src/server/bulk/import.ts`, replace:

```ts
/**
 * In one transaction: upserts staging into `cards`, deletes printings Scryfall dropped unless something references
 * them, rebuilds names, drops the staging table, and writes the meta entries.
 */
```

with:

```ts
/**
 * In one transaction: upserts staging into `cards`, deletes printings Scryfall dropped unless something references
 * them, rebuilds names, drops the staging table, and writes the meta entries plus the card data version.
 */
```

In `src/server/bulk/import.ts`, replace:

```ts
    db.exec('DROP TABLE temp.cards_staging')
    for (const [key, value] of Object.entries(meta)) setMeta(db, key, value)
```

with:

```ts
    db.exec('DROP TABLE temp.cards_staging')
    setMeta(db, 'card_data_version', String(CARD_DATA_VERSION))
    for (const [key, value] of Object.entries(meta)) setMeta(db, key, value)
```

In `src/server/bulk/import.ts`, replace:

```ts
  /** True when card data was never imported or the last import is older than 7 days. */
```

with:

```ts
  /** True when card data was never imported, is older than 7 days, or was imported by an older CARD_DATA_VERSION. */
```

In `src/server/bulk/import.ts`, replace:

```ts
    state = 'downloading'
    processed = 0
    try {
```

with:

```ts
    state = 'downloading'
    processed = 0
    let reusedFile = false
    try {
```

In `src/server/bulk/import.ts`, replace:

```ts
      const file = path.join(dir, 'default-cards.jsonl.gz')
      const partial = `${file}.part`
      try {
        const res = await client.download(uri)
        if (!res.body) throw new Error('the response was empty')
        await pipeline(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>), fs.createWriteStream(partial))
      } catch (err) {
        throw new Error(`Card data download failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
      }
      fs.renameSync(partial, file)

```

with:

```ts
      const file = path.join(dir, 'default-cards.jsonl.gz')
      // The file from the last successful import is still current when Scryfall hasn't published a newer one
      // (for example when an app update re-imports): import it again instead of downloading 80 MB.
      reusedFile = meta.updated_at === getMeta(db, 'bulk_source_updated_at') && fs.existsSync(file)
      if (reusedFile) {
        log('Scryfall has no newer card data; re-importing the downloaded file')
      } else {
        const partial = `${file}.part`
        try {
          const res = await client.download(uri)
          if (!res.body) throw new Error('the response was empty')
          await pipeline(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>), fs.createWriteStream(partial))
        } catch (err) {
          throw new Error(`Card data download failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
        }
        fs.renameSync(partial, file)
      }

```

In `src/server/bulk/import.ts`, replace:

```ts
      const message = err instanceof Error ? err.message : String(err)
      try {
```

with:

```ts
      const message = err instanceof Error ? err.message : String(err)
      // A kept file that fails to import may be damaged; delete it so the next refresh downloads a fresh copy.
      if (reusedFile) fs.rmSync(path.join(dataDir, 'bulk', 'default-cards.jsonl.gz'), { force: true })
      try {
```

In `src/server/bulk/import.ts`, replace:

```ts
    isStale() {
      const updated = getMeta(db, 'bulk_updated_at')
      return updated === null || now().getTime() - Date.parse(updated) > STALE_AFTER_MS
    },
```

with:

```ts
    isStale() {
      const updated = getMeta(db, 'bulk_updated_at')
      return (
        updated === null ||
        now().getTime() - Date.parse(updated) > STALE_AFTER_MS ||
        getMeta(db, 'card_data_version') !== String(CARD_DATA_VERSION)
      )
    },
```

In `src/server/db/index.ts`, replace:

```ts
  db.pragma('busy_timeout = 5000')
```

with:

```ts
  db.pragma('busy_timeout = 5000')
  // Read the ~450 MB card table through memory mapping: searches that scan it run 30–60% faster.
  db.pragma('mmap_size = 1073741824')
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/server/cards-map.test.ts tests/server/cards-repo.test.ts tests/server/bulk-import.test.ts tests/server/db.test.ts tests/server/api.test.ts tests/server/search-local.test.ts`
Expected: PASS.

- [ ] **Step 6: Say what the startup refresh and setup do now**

`scripts/seed-dev.ts` must record the card data version too, or a dev server on seeded data would start a real refresh.

In `src/server/main.ts`, replace:

```ts
console.log('[card data] Missing or older than 7 days; refreshing in the background')
```

with:

```ts
console.log('[card data] Missing, older than 7 days, or from an older Binder version; refreshing in the background')
```

In `scripts/setup.ts`, replace:

```ts
  console.log('Downloading Scryfall card data (about 80 MB)…')
```

with:

```ts
  console.log('Importing Scryfall card data (downloads about 80 MB when Scryfall has newer data)…')
```

In `scripts/seed-dev.ts`, replace:

```ts
import { scryfallToRow, type CardRow } from '../src/server/cards/map.ts'
```

with:

```ts
import { CARD_DATA_VERSION, scryfallToRow, type CardRow } from '../src/server/cards/map.ts'
```

In `scripts/seed-dev.ts`, replace:

```ts
setMeta(db, 'bulk_updated_at', new Date().toISOString())
```

with:

```ts
setMeta(db, 'bulk_updated_at', new Date().toISOString())
setMeta(db, 'card_data_version', String(CARD_DATA_VERSION))
```

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass (350 tests).

---

### Task 2: Library search at scale, priced by finish

At 23,000 collection rows, library search took 170–420 ms, even for queries with a handful of results, because every
query built the per-card owned and built-deck totals over the whole collection. The rewrite:
- picks each result over narrow columns and reads full rows only for the page (as `searchLocal` does);
- joins the totals only when the query uses `free`, `qty`, or `is:wanted`;
- counts with `count(*) OVER ()`.

Measured on a copy of the real card data with 23,000 rows: 12–80 ms. The same pass fixes M2's printings-view
follow-ups:
- rows are priced by their finish (foil copies at the foil price), including when sorting by price;
- `finish` is the last sort tiebreak;
- the doc says what the cards view actually shows.

**Files:**
- Create: `src/shared/prices.ts`, `src/server/collection/sql.ts`
- Modify: `src/server/search/compile.ts` (`ownership` flag), `src/server/search/run.ts` (library search rewrite,
  finish prices), `src/server/cards/repo.ts` (export `parsePrices`)
- Test: `tests/shared/prices.test.ts` (new), `tests/server/search-library.test.ts`

**Interfaces:**
- Consumes: M2's `compileFilter`, `searchLibrary`, `toSearchCard`, `getOwnership`, `LOCAL_PAGE_SIZE`.
- Produces:
  - `finishPrice(prices: Prices, finish: Finish): number | null` and
    `listPrice(prices: Prices, finishes: readonly Finish[]): { finish: Finish; usd: number } | null` from
    `src/shared/prices.ts`. Task 3 prices copies with `finishPrice`; Task 5's drawer lists printings with `listPrice`.
  - `COPY_PRICE_SQL` (one copy's price in its finish, over `c` and `co`) and `finishOrderSql(column)` (nonfoil, foil,
    etched) from `src/server/collection/sql.ts`. Tasks 3 and 4 use both.
  - `CompiledFilter.ownership: boolean`.
  - `parsePrices(json: string): Prices`, now exported from `src/server/cards/repo.ts`.
  - `toSearchCard(row, ownership, showFinish = false)`. Library rows are priced by their finish.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/prices.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { finishPrice, listPrice } from '../../src/shared/prices.ts'

const prices = { usd: 1.5, usdFoil: 6, usdEtched: 4 }

describe('prices', () => {
  it('prices a copy by its finish', () => {
    expect([finishPrice(prices, 'nonfoil'), finishPrice(prices, 'foil'), finishPrice(prices, 'etched')]).toEqual([1.5, 6, 4])
  })

  it('lists the first finish the printing comes in that has a price', () => {
    expect(listPrice(prices, ['nonfoil', 'foil'])).toEqual({ finish: 'nonfoil', usd: 1.5 })
    expect(listPrice({ ...prices, usd: null }, ['nonfoil', 'foil'])).toEqual({ finish: 'foil', usd: 6 })
    expect(listPrice(prices, ['etched'])).toEqual({ finish: 'etched', usd: 4 })
    expect(listPrice({ usd: null, usdFoil: null, usdEtched: null }, ['nonfoil'])).toBeNull()
  })

  it('ignores prices for finishes the printing does not come in', () => {
    expect(listPrice({ usd: null, usdFoil: 6, usdEtched: null }, ['nonfoil'])).toBeNull()
  })
})
```

In `tests/server/search-library.test.ts`, replace:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import type { DB } from '../../src/server/db/index.ts'
import { getOwnership } from '../../src/server/ownership/repo.ts'
import { searchLibrary, type LibrarySearchParams } from '../../src/server/search/run.ts'
import { freeCopies } from '../../src/shared/ownership.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard } from '../helpers/fixtures.ts'
```

with:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { insertCardRows } from '../../src/server/cards/repo.ts'
import type { DB } from '../../src/server/db/index.ts'
import { getOwnership } from '../../src/server/ownership/repo.ts'
import { compileFilter } from '../../src/server/search/compile.ts'
import { searchLibrary, type LibrarySearchParams } from '../../src/server/search/run.ts'
import { freeCopies } from '../../src/shared/ownership.ts'
import { parseSearch } from '../../src/shared/search/parse.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'
```

In `tests/server/search-library.test.ts` (adds tests after the last one in `searchLibrary`), replace:

```ts
  it('sorts by mana value with name as the tiebreak', () => {
    expect(names('', { sort: 'mv', dir: 'desc' })).toEqual(["Atraxa, Praetors' Voice", 'Counterspell', 'Lightning Bolt', 'Llanowar Elves', 'Sol Ring'])
  })
})
```

with:

```ts
  it('sorts by mana value with name as the tiebreak', () => {
    expect(names('', { sort: 'mv', dir: 'desc' })).toEqual(["Atraxa, Praetors' Voice", 'Counterspell', 'Lightning Bolt', 'Llanowar Elves', 'Sol Ring'])
  })

  it('prices each row by its finish, and the cards view by the row it shows', () => {
    const printings = search('bolt', { view: 'printings' }).cards.map((c) => [c.setCode, c.finish, c.priceUsd])
    expect(printings).toEqual([
      ['m10', 'nonfoil', 1.89],
      ['m11', 'foil', 6.68],
    ])
    // The cards view shows the row with the most copies: 2 nonfoil m10 over 1 foil m11.
    expect(search('bolt').cards.map((c) => [c.setCode, c.priceUsd, c.quantity])).toEqual([['m10', 1.89, 3]])
    expect(search('is:foil bolt').cards.map((c) => [c.setCode, c.priceUsd])).toEqual([['m11', 6.68]])
  })

  it('sorts by the finish price', () => {
    const byPrice = search('t:instant', { view: 'printings', sort: 'price', dir: 'desc' }).cards
    expect(byPrice.map((c) => [c.name, c.setCode, c.finish])).toEqual([
      ['Lightning Bolt', 'm11', 'foil'],
      ['Counterspell', 'dsc', 'nonfoil'],
      ['Lightning Bolt', 'm10', 'nonfoil'],
    ])
  })

  it('orders two finishes of one printing nonfoil first, then foil, then etched', () => {
    const own3 = createTestDb()
    own(own3, 'Lightning Bolt', 'sta', 1, 'etched')
    own(own3, 'Lightning Bolt', 'sta', 1, 'foil')
    own(own3, 'Lightning Bolt', 'sta', 1, 'nonfoil')
    const page = searchLibrary(own3, { q: '', view: 'printings', sort: 'name', dir: 'asc', page: 1 })
    expect(page.cards.map((c) => [c.finish, c.priceUsd])).toEqual([
      ['nonfoil', 4.13],
      ['foil', 6.09],
      ['etched', 5.54],
    ])
  })

  it('pages results and reports the total on every page, including past the end', () => {
    const everything = createTestDb()
    everything.exec("INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) SELECT id, 'nonfoil', 1, 't', 't' FROM cards")
    const at = (page: number) => searchLibrary(everything, { q: '', view: 'printings', sort: 'name', dir: 'asc', page })
    expect([at(1).total, at(1).cards.length, at(1).hasMore]).toEqual([61, 60, true])
    expect([at(2).total, at(2).cards.length, at(2).hasMore]).toEqual([61, 1, false])
    expect([at(3).total, at(3).cards.length, at(3).hasMore]).toEqual([61, 0, false])
    const cards = searchLibrary(everything, { q: '', view: 'cards', sort: 'name', dir: 'asc', page: 2 })
    expect([cards.total, cards.cards.length]).toEqual([58, 0])
    const names1 = at(1).cards.map((c) => c.cardId)
    expect(new Set([...names1, ...at(2).cards.map((c) => c.cardId)]).size).toBe(61)
  })

  it('marks only queries that use free, qty, or is:wanted as needing the ownership totals', () => {
    const uses = (q: string) => {
      const parsed = parseSearch(q)
      if (!parsed.ok) throw new Error(parsed.error.message)
      return compileFilter(parsed.ast, 'library').ownership
    }
    expect(['free>0', 'qty>=2', 'is:wanted', 't:elf or -own<1'].map(uses)).toEqual([true, true, true, true])
    expect(['', 't:elf', 'in:built', 'is:foil', 'usd>1'].map(uses)).toEqual([false, false, false, false, false])
  })

  it('combines ownership keys with other terms', () => {
    expect(names('free<0 or t:creature')).toEqual(["Atraxa, Praetors' Voice", 'Lightning Bolt', 'Llanowar Elves'])
    expect(names('-qty>=3')).toEqual(["Atraxa, Praetors' Voice", 'Sol Ring'])
  })

  it('sorts names without regard to letter case', () => {
    const mixed = createTestDb()
    const lower = scryfallToRow(syntheticCard({ name: 'b-side bear' })) as CardRow
    insertCardRows(mixed, 'cards', [lower])
    mixed.prepare("INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (?, 'nonfoil', 1, 't', 't')").run(lower.id)
    own(mixed, 'Counterspell', undefined, 1)
    own(mixed, 'Atraxa, Praetors\' Voice', undefined, 1)
    for (const view of ['cards', 'printings'] as const) {
      const page = searchLibrary(mixed, { q: '', view, sort: 'name', dir: 'asc', page: 1 })
      expect(page.cards.map((c) => c.name)).toEqual(["Atraxa, Praetors' Voice", 'b-side bear', 'Counterspell'])
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/shared/prices.test.ts tests/server/search-library.test.ts`
Expected: FAIL. `src/shared/prices.ts` does not exist; the library tests fail on `ownership` (undefined), on prices (nonfoil prices for foil rows), and on name sorting.

- [ ] **Step 3: Add the price helpers and the shared collection SQL**

`parsePrices` already exists in `src/server/cards/repo.ts`; export it.

Create `src/shared/prices.ts`:

```ts
import type { Finish, Prices } from './types.ts'

const FINISH_ORDER: readonly Finish[] = ['nonfoil', 'foil', 'etched']

/** What one copy in this finish is worth: foil copies use the foil price, etched the etched price. */
export function finishPrice(prices: Prices, finish: Finish): number | null {
  return finish === 'foil' ? prices.usdFoil : finish === 'etched' ? prices.usdEtched : prices.usd
}

/** The price to list for a printing: its first finish (nonfoil, foil, etched) that has one, or null if none do. */
export function listPrice(prices: Prices, finishes: readonly Finish[]): { finish: Finish; usd: number } | null {
  for (const finish of FINISH_ORDER) {
    const usd = finishes.includes(finish) ? finishPrice(prices, finish) : null
    if (usd !== null) return { finish, usd }
  }
  return null
}
```

Create `src/server/collection/sql.ts`:

```ts
/** SQL fragments over a collection row `co` joined to its printing `c`. */

/** Price of one copy in its own finish: foil copies use the foil price, etched the etched price. */
export const COPY_PRICE_SQL =
  "CAST(json_extract(c.prices, CASE co.finish WHEN 'foil' THEN '$.usd_foil' WHEN 'etched' THEN '$.usd_etched' ELSE '$.usd' END) AS REAL)"

/** Nonfoil, then foil, then etched, as an ORDER BY term over a finish column. */
export const finishOrderSql = (column: string) => `CASE ${column} WHEN 'nonfoil' THEN 0 WHEN 'foil' THEN 1 ELSE 2 END`
```

In `src/server/cards/repo.ts`, replace:

```ts
function parsePrices(json: string): Prices {
```

with:

```ts
/** Reads the `prices` JSON column. */
export function parsePrices(json: string): Prices {
```

- [ ] **Step 4: Mark filters that need the ownership totals**

In `src/server/search/compile.ts`, replace:

```ts
export interface CompiledFilter {
  /** A boolean SQL expression over `c` (cards); in library scope also `co` (collection), `own`, and `alloc`. */
  sql: string
  params: Record<string, string | number>
}

/** Owned copies of the row's card identity. Valid only in the library query, which joins `own` and `alloc`. */
export const OWNED_SQL = 'COALESCE(own.owned, 0)'
/** Owned copies not committed to built decks (spec §4.3). Valid only in the library query. */
export const FREE_SQL = '(COALESCE(own.owned, 0) - COALESCE(alloc.allocated, 0))'
```

with:

```ts
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
```

In `src/server/search/compile.ts`, replace:

```ts
  let count = 0
  const param
```

with:

```ts
  let count = 0
  let ownership = false
  const param
```

In `src/server/search/compile.ts`, replace:

```ts
      case 'wanted':
        return (
```

with:

```ts
      case 'wanted':
        ownership = true
        return (
```

In `src/server/search/compile.ts`, replace:

```ts
      case 'free':
        return `(${FREE_SQL}
```

with:

```ts
      case 'free':
        ownership = true
        return `(${FREE_SQL}
```

In `src/server/search/compile.ts`, replace:

```ts
      case 'qty':
        return `(${OWNED_SQL}
```

with:

```ts
      case 'qty':
        ownership = true
        return `(${OWNED_SQL}
```

In `src/server/search/compile.ts`, replace:

```ts
  return { sql: compile(ast), params }
```

with:

```ts
  const sql = compile(ast) // sets `ownership` as it goes
  return { sql, params, ownership }
```

- [ ] **Step 5: Rewrite the library search**

`searchLocal` and the Scryfall path are unchanged apart from `toSearchCard`'s new signature.

Replace the whole of `src/server/search/run.ts`:

```ts
import { normalizeName } from '../../shared/normalize.ts'
import { NO_OWNERSHIP } from '../../shared/ownership.ts'
import { finishPrice } from '../../shared/prices.ts'
import { parseSearch } from '../../shared/search/parse.ts'
import type { Finish, Ownership, SearchCard, SearchPage, SearchSort, SortDir } from '../../shared/types.ts'
import type { CardRow } from '../cards/map.ts'
import { parsePrices } from '../cards/repo.ts'
import { COPY_PRICE_SQL, finishOrderSql } from '../collection/sql.ts'
import type { DB } from '../db/index.ts'
import { getOwnership } from '../ownership/repo.ts'
import { compileFilter, rarityRankSql, SearchQueryError, type CompiledFilter, type SearchScope } from './compile.ts'

export const LOCAL_PAGE_SIZE = 60

export interface SearchParams {
  q: string
  sort: SearchSort
  dir: SortDir
  page: number
}

export interface LibrarySearchParams extends SearchParams {
  /** `cards`: one row per card identity; `printings`: one row per owned printing and finish. */
  view: 'cards' | 'printings'
}

/** Sort keys over the result columns (`name`, `cmc`, …). `added` exists only on library rows. */
const SORT_SQL: Record<SearchSort, string> = {
  name: 'name COLLATE NOCASE',
  mv: 'cmc',
  price: "CAST(json_extract(prices, '$.usd') AS REAL)",
  // Scryfall's color order: W, U, B, R, G, then multicolor, then colorless.
  color: "CASE WHEN colors = '' THEN 6 WHEN length(colors) > 1 THEN 5 ELSE instr('WUBRG', colors) - 1 END",
  rarity: rarityRankSql('rarity'),
  added: 'added_at',
}

function orderBy(sort: SearchSort, dir: SortDir): string {
  const key = SORT_SQL[sort]
  // Missing values (no price) always sort last; ties break by name, then collector order for printings.
  return `ORDER BY (${key}) IS NULL, ${key} ${dir === 'desc' ? 'DESC' : 'ASC'}, name COLLATE NOCASE, set_code, collector_number`
}

const registered = new WeakSet<DB>()

/** SQL functions the compiled filters call. Registered once per connection. */
function registerSearchFunctions(db: DB): void {
  if (registered.has(db)) return
  db.function('faces_include', { deterministic: true }, (faceNames: unknown, normalized: unknown) =>
    typeof faceNames === 'string' && faceNames.split('\n').some((face) => normalizeName(face) === normalized) ? 1 : 0,
  )
  registered.add(db)
}

function compileQuery(q: string, scope: SearchScope): CompiledFilter {
  const parsed = parseSearch(q)
  if (!parsed.ok) throw new SearchQueryError(parsed.error.message, parsed.error.span)
  return compileFilter(parsed.ast, scope)
}

type ResultRow = CardRow & {
  /** Library rows: the collection row's finish, which also picks the price. */
  row_finish?: Finish
  /** Library rows: copies matching the search. */
  quantity?: number
}

/**
 * Maps a `cards` row to a search result. Library rows carry their finish and quantity, and are priced by that finish;
 * other rows show the nonfoil price. `showFinish` reports the finish (the library printings view).
 */
export function toSearchCard(row: ResultRow, ownership: Ownership, showFinish = false): SearchCard {
  const prices = parsePrices(row.prices)
  return {
    cardId: row.id,
    oracleId: row.oracle_id,
    name: row.name,
    manaCost: row.mana_cost,
    typeLine: row.type_line,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    priceUsd: row.row_finish ? finishPrice(prices, row.row_finish) : prices.usd,
    imageNormal: row.image_normal,
    imageSmall: row.image_small,
    finish: showFinish ? (row.row_finish ?? null) : null,
    quantity: row.quantity ?? null,
    ownership,
  }
}

function withOwnership(db: DB, rows: ResultRow[], showFinish = false): SearchCard[] {
  const ownership = getOwnership(db, rows.map((r) => r.oracle_id))
  return rows.map((r) => toSearchCard(r, ownership.get(r.oracle_id) ?? NO_OWNERSHIP, showFinish))
}

function page(total: number, params: SearchParams, cards: SearchCard[]): SearchPage {
  return {
    total,
    page: params.page,
    pageSize: LOCAL_PAGE_SIZE,
    hasMore: params.page * LOCAL_PAGE_SIZE < total,
    cards,
    warnings: [],
  }
}

/**
 * Searches every printing in the local card data (the offline stand-in for Scryfall). One result per card identity:
 * its default printing when that printing matches, otherwise the newest matching printing.
 * Picks printings over narrow columns first and reads full rows only for the page (full scans beat the oracle index here).
 */
export function searchLocal(db: DB, params: SearchParams): SearchPage {
  registerSearchFunctions(db)
  const filter = compileQuery(params.q, 'cards')
  const limits = { limit: LOCAL_PAGE_SIZE, offset: (params.page - 1) * LOCAL_PAGE_SIZE }
  const rows = db
    .prepare(
      `WITH picked AS (
         SELECT id FROM (
           SELECT c.id, ROW_NUMBER() OVER (
             PARTITION BY c.oracle_id ORDER BY (c.id = n.default_card_id) DESC, c.released_at DESC, c.id
           ) AS pick
           FROM cards c NOT INDEXED JOIN card_names n ON n.oracle_id = c.oracle_id
           WHERE ${filter.sql}
         ) WHERE pick = 1
       )
       SELECT c.*, count(*) OVER () AS total_count FROM picked p JOIN cards c ON c.id = p.id
       ${orderBy(params.sort === 'added' ? 'name' : params.sort, params.dir)}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...filter.params, ...limits }) as Array<ResultRow & { total_count: number }>
  // The window count rides on the page's rows; a page past the end has none, so count separately then.
  const total =
    rows[0]?.total_count ??
    (params.page === 1
      ? 0
      : (db
          .prepare(`SELECT count(*) FROM (SELECT DISTINCT c.oracle_id FROM cards c NOT INDEXED WHERE ${filter.sql})`)
          .pluck()
          .get(filter.params) as number))
  return page(total, params, withOwnership(db, rows))
}

// Library queries start from the (small) collection and look cards up by id. CROSS JOIN pins that join order rather
// than letting the planner walk all ~100k printings; SQLite treats CROSS JOIN as an ordering hint.
const LIBRARY_FROM = 'FROM collection co CROSS JOIN cards c ON c.id = co.card_id'

// Per-identity owned and built-deck totals, joined only for filters that use them (free, qty, is:wanted).
const OWNERSHIP_JOINS = `
  LEFT JOIN (
    SELECT c2.oracle_id, SUM(co2.quantity) AS owned
    FROM collection co2 CROSS JOIN cards c2 ON c2.id = co2.card_id GROUP BY c2.oracle_id
  ) own ON own.oracle_id = c.oracle_id
  LEFT JOIN (
    SELECT dc.oracle_id, SUM(dc.quantity) AS allocated
    FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
    WHERE d.status = 'built' AND dc.board != 'maybe' GROUP BY dc.oracle_id
  ) alloc ON alloc.oracle_id = c.oracle_id`

/** Library sort keys over `c` and `co`; `added` is the row's date (the cards view swaps in the identity's latest). */
const LIBRARY_SORT_SQL: Record<SearchSort, string> = {
  name: 'c.name COLLATE NOCASE',
  mv: 'c.cmc',
  price: COPY_PRICE_SQL,
  color: "CASE WHEN c.colors = '' THEN 6 WHEN length(c.colors) > 1 THEN 5 ELSE instr('WUBRG', c.colors) - 1 END",
  rarity: rarityRankSql('c.rarity'),
  added: 'co.added_at',
}

interface LibraryPick {
  row_id: number
  quantity: number
  total_count: number
}

/**
 * Searches the owner's collection. Filters apply to each owned printing and finish (collection row). The `printings`
 * view returns each matching row; the `cards` view returns one row per card identity, showing the matching collection
 * row (printing and finish) with the most copies, with `quantity` = matching copies across its printings.
 * Results are priced by each row's finish. Picks rows over narrow columns first and reads full rows only for the page.
 */
export function searchLibrary(db: DB, params: LibrarySearchParams): SearchPage {
  registerSearchFunctions(db)
  const filter = compileQuery(params.q, 'library')
  const from = `${LIBRARY_FROM} ${filter.ownership ? OWNERSHIP_JOINS : ''}`
  const dir = params.dir === 'desc' ? 'DESC' : 'ASC'
  const order = `ORDER BY sort_key IS NULL, sort_key ${dir}, name COLLATE NOCASE, set_code, collector_number, ${finishOrderSql('finish')}`
  const limits = { limit: LOCAL_PAGE_SIZE, offset: (params.page - 1) * LOCAL_PAGE_SIZE }
  let picks: LibraryPick[]
  let countSql: string
  if (params.view === 'printings') {
    picks = db
      .prepare(
        `SELECT co.id AS row_id, co.quantity AS quantity, count(*) OVER () AS total_count,
           ${LIBRARY_SORT_SQL[params.sort]} AS sort_key, c.name AS name, c.set_code AS set_code,
           c.collector_number AS collector_number, co.finish AS finish
         ${from} WHERE ${filter.sql}
         ${order} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...filter.params, ...limits }) as LibraryPick[]
    countSql = `SELECT count(*) ${from} WHERE ${filter.sql}`
  } else {
    const sortKey = params.sort === 'added' ? 'm.added_at' : LIBRARY_SORT_SQL[params.sort]
    picks = db
      .prepare(
        `WITH matched AS (
           SELECT co.id AS row_id,
             SUM(co.quantity) OVER card AS quantity,
             MAX(co.added_at) OVER card AS added_at,
             ROW_NUMBER() OVER (PARTITION BY c.oracle_id ORDER BY co.quantity DESC, co.added_at DESC, c.id, co.id) AS pick
           ${from} WHERE ${filter.sql}
           WINDOW card AS (PARTITION BY c.oracle_id)
         )
         SELECT m.row_id AS row_id, m.quantity AS quantity, count(*) OVER () AS total_count,
           ${sortKey} AS sort_key, c.name AS name, c.set_code AS set_code,
           c.collector_number AS collector_number, co.finish AS finish
         FROM matched m CROSS JOIN collection co ON co.id = m.row_id CROSS JOIN cards c ON c.id = co.card_id
         WHERE m.pick = 1
         ${order} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...filter.params, ...limits }) as LibraryPick[]
    countSql = `SELECT count(DISTINCT c.oracle_id) ${from} WHERE ${filter.sql}`
  }
  // The window count rides on the page's rows; a page past the end has none, so count separately then.
  const total = picks[0]?.total_count ?? (params.page === 1 ? 0 : (db.prepare(countSql).pluck().get(filter.params) as number))
  const full = new Map(
    (
      db
        .prepare(
          `SELECT c.*, co.id AS row_id, co.finish AS row_finish
           ${LIBRARY_FROM} WHERE co.id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(picks.map((p) => p.row_id))) as Array<ResultRow & { row_id: number }>
    ).map((row) => [row.row_id, row]),
  )
  const rows = picks.flatMap((p) => {
    const row = full.get(p.row_id)
    return row ? [{ ...row, quantity: p.quantity }] : []
  })
  return page(total, params, withOwnership(db, rows, params.view === 'printings'))
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run tests/shared/prices.test.ts tests/server/search-library.test.ts tests/server/search-local.test.ts tests/server/search-api.test.ts`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass (360 tests).

---

### Task 3: Collection API: copies in card detail, add and remove copies, library stats

Spec §5.2.5 and §5.3: the drawer lists my copies with +/− steppers and adds copies; `/library` shows totals. Decisions
recorded here:
- A row's `added_at` is the last time copies were added to it, so "date added" and "Last added" reflect re-adds.
  Removing copies leaves it alone.
- Removing more copies than I own removes them all instead of failing, so a double-clicked − is harmless.
- Adding requires a finish the printing comes in. Removing doesn't, so a finish Scryfall stops listing can still be
  cleared out.
- Library value sums each copy at its finish's price, in whole cents. Copies with no price for their finish add
  nothing and are counted separately.

**Files:**
- Create: `src/server/collection/repo.ts`, `src/server/collection/routes.ts`
- Modify: `src/shared/types.ts` (`CardDetail` gains `copies` and `ownership`; `Copy`, `CollectionStats`, `CopyCount`),
  `src/server/cards/routes.ts`, `src/server/app.ts`
- Test: `tests/server/collection-repo.test.ts` (new), `tests/server/collection-api.test.ts` (new)

**Interfaces:**
- Consumes: `finishPrice` (Task 2), `COPY_PRICE_SQL` and `finishOrderSql` (Task 2), `parsePrices`, `getCard`,
  `getOwnership`, `NO_OWNERSHIP`, `ApiError`, `parseWith`.
- Produces:
  - `GET /api/cards/:id` → `CardDetail` = `{ card, printings, copies: Copy[], ownership: Ownership }`.
  - `POST /api/collection/adjust` with `{ cardId, finish, delta }` → `CopyCount` = `{ cardId, finish, quantity }`
    (quantity left; 0 = row removed). Errors: 404 `not_found`; 400 `finish_unavailable` (adding a finish the
    printing lacks); 400 `bad_request` (`delta` 0 or outside ±1000, bad JSON).
  - `GET /api/collection/stats` → `CollectionStats` = `{ totalCards, uniqueCards, valueUsd, unpricedCards, lastAddedAt }`.
  - `getCopies(db, oracleId)`, `adjustCopies(db, cardId, finish, delta, now?)`, and `collectionStats(db)` from
    `src/server/collection/repo.ts`. Task 4 appends `addCopies` and `exportRows` to it.
  - `collectionRoutes({ db })`, mounted at `/api/collection`. Task 4 replaces this file with the import/export version.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/collection-repo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { adjustCopies, collectionStats, getCopies } from '../../src/server/collection/repo.ts'
import type { DB } from '../../src/server/db/index.ts'
import { count, createTestDb } from '../helpers/db.ts'
import { fixtureCard } from '../helpers/fixtures.ts'
import { own } from '../helpers/library.ts'

let db: DB
beforeEach(() => {
  db = createTestDb()
})

const bolt = (set: string) => fixtureCard('Lightning Bolt', set)
const quantity = (cardId: string, finish: string) =>
  db.prepare('SELECT quantity FROM collection WHERE card_id = ? AND finish = ?').pluck().get(cardId, finish) as number | undefined

describe('adjustCopies', () => {
  it('adds a new row, then increases and decreases it; adding (not removing) counts as the date added', () => {
    const row = () => db.prepare('SELECT quantity, added_at, updated_at FROM collection').get()
    expect(adjustCopies(db, bolt('m10').id, 'foil', 1, new Date('2026-09-26T10:00:00Z'))).toBe(1)
    expect(row()).toEqual({ quantity: 1, added_at: '2026-09-26T10:00:00.000Z', updated_at: '2026-09-26T10:00:00.000Z' })
    expect(adjustCopies(db, bolt('m10').id, 'foil', 2, new Date('2026-09-27T10:00:00Z'))).toBe(3)
    expect(row()).toEqual({ quantity: 3, added_at: '2026-09-27T10:00:00.000Z', updated_at: '2026-09-27T10:00:00.000Z' })
    expect(adjustCopies(db, bolt('m10').id, 'foil', -1, new Date('2026-09-28T10:00:00Z'))).toBe(2)
    expect(row()).toEqual({ quantity: 2, added_at: '2026-09-27T10:00:00.000Z', updated_at: '2026-09-28T10:00:00.000Z' })
  })

  it('deletes the row at zero, and treats removing more than owned (or none) as removing all', () => {
    adjustCopies(db, bolt('m10').id, 'nonfoil', 2)
    expect(adjustCopies(db, bolt('m10').id, 'nonfoil', -5)).toBe(0)
    expect(count(db, 'collection')).toBe(0)
    expect(adjustCopies(db, bolt('m10').id, 'nonfoil', -1)).toBe(0)
    expect(count(db, 'collection')).toBe(0)
  })

  it('keeps finishes of one printing apart', () => {
    adjustCopies(db, bolt('sta').id, 'foil', 1)
    adjustCopies(db, bolt('sta').id, 'etched', 2)
    expect([quantity(bolt('sta').id, 'foil'), quantity(bolt('sta').id, 'etched')]).toEqual([1, 2])
  })
})

describe('getCopies', () => {
  it('lists every copy of the card identity, newest printing first, priced by finish', () => {
    own(db, 'Lightning Bolt', 'm10', 2, 'nonfoil', '2026-01-01T00:00:00.000Z')
    own(db, 'Lightning Bolt', 'sta', 1, 'etched', '2026-01-02T00:00:00.000Z')
    own(db, 'Lightning Bolt', 'sta', 1, 'nonfoil', '2026-01-03T00:00:00.000Z')
    own(db, 'Sol Ring', 'cmr', 1)
    expect(getCopies(db, bolt('m10').oracle_id!)).toEqual([
      { cardId: bolt('sta').id, setCode: 'sta', setName: 'Strixhaven Mystical Archive', collectorNumber: '42', finish: 'nonfoil', quantity: 1, priceUsd: 4.13, addedAt: '2026-01-03T00:00:00.000Z' },
      { cardId: bolt('sta').id, setCode: 'sta', setName: 'Strixhaven Mystical Archive', collectorNumber: '42', finish: 'etched', quantity: 1, priceUsd: 5.54, addedAt: '2026-01-02T00:00:00.000Z' },
      { cardId: bolt('m10').id, setCode: 'm10', setName: 'Magic 2010', collectorNumber: '146', finish: 'nonfoil', quantity: 2, priceUsd: 1.89, addedAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(getCopies(db, fixtureCard('Counterspell').oracle_id!)).toEqual([])
  })
})

describe('collectionStats', () => {
  it('is all zeros for an empty collection', () => {
    expect(collectionStats(db)).toEqual({ totalCards: 0, uniqueCards: 0, valueUsd: 0, unpricedCards: 0, lastAddedAt: null })
  })

  it('totals copies, card identities, value by finish, unpriced copies, and the last addition', () => {
    own(db, 'Lightning Bolt', 'm10', 2, 'nonfoil', '2026-01-01T00:00:00.000Z') // 2 × 1.89
    own(db, 'Lightning Bolt', 'm10', 1, 'foil', '2026-01-05T00:00:00.000Z') // 12.69
    own(db, 'Sol Ring', 'cmr', 3, 'nonfoil', '2026-01-02T00:00:00.000Z') // 3 × 1.66
    own(db, 'Command Tower', undefined, 2, 'nonfoil', '2026-01-03T00:00:00.000Z') // no price
    expect(collectionStats(db)).toEqual({
      totalCards: 8,
      uniqueCards: 3,
      valueUsd: 21.45,
      unpricedCards: 2,
      lastAddedAt: '2026-01-05T00:00:00.000Z',
    })
  })
})
```

Create `tests/server/collection-api.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../../src/server/db/index.ts'
import type { ApiErrorBody, CardDetail, CollectionStats, CopyCount } from '../../src/shared/types.ts'
import { body, makeApp } from '../helpers/app.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard } from '../helpers/fixtures.ts'
import { deck, inDeck, own } from '../helpers/library.ts'

let db: DB
let app: ReturnType<typeof makeApp>
beforeEach(() => {
  db = createTestDb()
  app = makeApp({ db })
})

const post = (path: string, json: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
const errorCode = async (res: Response) => (await body<ApiErrorBody>(res)).error.code
const bolt = (set: string) => fixtureCard('Lightning Bolt', set)

describe('card detail', () => {
  it('includes every owned copy of the card and its ownership', async () => {
    own(db, 'Lightning Bolt', 'm10', 2)
    own(db, 'Lightning Bolt', 'sta', 1, 'etched')
    const burn = deck(db, 'Burn', 'built', 'modern')
    inDeck(db, burn, 'Lightning Bolt', 4)
    const detail = await body<CardDetail>(await app.request(`/api/cards/${bolt('m11').id}`))
    expect(detail.copies.map((c) => [c.setCode, c.finish, c.quantity])).toEqual([
      ['sta', 'etched', 1],
      ['m10', 'nonfoil', 2],
    ])
    expect(detail.ownership).toEqual({ owned: 3, free: -1, decks: [{ id: burn, name: 'Burn', status: 'built', quantity: 4 }] })
  })

  it('shows no copies and no decks for a card I do not own', async () => {
    const detail = await body<CardDetail>(await app.request(`/api/cards/${bolt('m11').id}`))
    expect([detail.copies, detail.ownership]).toEqual([[], { owned: 0, free: 0, decks: [] }])
  })
})

describe('POST /api/collection/adjust', () => {
  it('adds and removes copies, reporting what is left', async () => {
    const add = await post('/api/collection/adjust', { cardId: bolt('m10').id, finish: 'foil', delta: 2 })
    expect(add.status).toBe(200)
    expect(await body<CopyCount>(add)).toEqual({ cardId: bolt('m10').id, finish: 'foil', quantity: 2 })
    const remove = await post('/api/collection/adjust', { cardId: bolt('m10').id, finish: 'foil', delta: -3 })
    expect(await body<CopyCount>(remove)).toEqual({ cardId: bolt('m10').id, finish: 'foil', quantity: 0 })
  })

  it('refuses to add a finish the printing lacks, but lets you remove one', async () => {
    const res = await post('/api/collection/adjust', { cardId: bolt('m10').id, finish: 'etched', delta: 1 })
    expect(res.status).toBe(400)
    expect(await body(res)).toEqual({
      error: { code: 'finish_unavailable', message: 'Lightning Bolt (M10 #146) has no etched version' },
    })
    db.prepare("INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (?, 'etched', 1, 't', 't')").run(bolt('m10').id)
    const removed = await post('/api/collection/adjust', { cardId: bolt('m10').id, finish: 'etched', delta: -1 })
    expect((await body<CopyCount>(removed)).quantity).toBe(0)
  })

  it('404s an unknown card and 400s a bad body', async () => {
    expect((await post('/api/collection/adjust', { cardId: 'nope', finish: 'foil', delta: 1 })).status).toBe(404)
    for (const bad of [{ cardId: bolt('m10').id, finish: 'foil', delta: 0 }, { cardId: bolt('m10').id, finish: 'shiny', delta: 1 }, { cardId: bolt('m10').id, finish: 'foil', delta: 1.5 }, {}]) {
      const res = await post('/api/collection/adjust', bad)
      expect([res.status, await errorCode(res)]).toEqual([400, 'bad_request'])
    }
    const notJson = await app.request('/api/collection/adjust', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    expect([notJson.status, await errorCode(notJson)]).toEqual([400, 'bad_request'])
  })

  it('refuses a request from another site', async () => {
    const res = await app.request('/api/collection/adjust', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ cardId: bolt('m10').id, finish: 'nonfoil', delta: 1 }),
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/collection/stats', () => {
  it('reports the library totals', async () => {
    own(db, 'Lightning Bolt', 'm10', 2)
    const stats = await body<CollectionStats>(await app.request('/api/collection/stats'))
    expect(stats).toMatchObject({ totalCards: 2, uniqueCards: 1, valueUsd: 3.78, unpricedCards: 0 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/server/collection-repo.test.ts tests/server/collection-api.test.ts`
Expected: FAIL. `src/server/collection/repo.ts` does not exist.

- [ ] **Step 3: Add the shared types**

In `src/shared/types.ts`, replace:

```ts
export interface CardDetail {
  card: Card
  printings: Printing[]
}

```

with:

```ts
export interface CardDetail {
  card: Card
  printings: Printing[]
  /** Every owned copy of this card identity, across printings and finishes. */
  copies: Copy[]
  ownership: Ownership
}

/** Owned copies of one printing in one finish (a collection row). */
export interface Copy {
  cardId: string
  setCode: string
  setName: string
  collectorNumber: string
  finish: Finish
  quantity: number
  /** Price of one copy in this finish. */
  priceUsd: number | null
  addedAt: string
}

export interface CollectionStats {
  /** Copies owned. */
  totalCards: number
  /** Card identities owned. */
  uniqueCards: number
  /** Σ quantity × the price of each copy's finish, in dollars. Copies with no price add nothing. */
  valueUsd: number
  /** Copies whose finish has no price. */
  unpricedCards: number
  /** When a copy was last added (ISO time), or null for an empty collection. */
  lastAddedAt: string | null
}

/** The collection row a change left behind; quantity 0 means none are left. */
export interface CopyCount {
  cardId: string
  finish: Finish
  quantity: number
}

```

- [ ] **Step 4: Add the collection repository**

Create `src/server/collection/repo.ts`:

```ts
import { finishPrice } from '../../shared/prices.ts'
import type { CollectionStats, Copy, Finish } from '../../shared/types.ts'
import { parsePrices } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { COPY_PRICE_SQL, finishOrderSql } from './sql.ts'

interface CopyRow {
  card_id: string
  set_code: string
  set_name: string
  collector_number: string
  finish: Finish
  quantity: number
  prices: string
  added_at: string
}

/** Every owned copy of a card identity, one entry per printing and finish, newest printing first. */
export function getCopies(db: DB, oracleId: string): Copy[] {
  const rows = db
    .prepare(
      `SELECT co.card_id, c.set_code, c.set_name, c.collector_number, co.finish, co.quantity, c.prices, co.added_at
       FROM cards c JOIN collection co ON co.card_id = c.id
       WHERE c.oracle_id = ?
       ORDER BY c.released_at DESC, c.set_code, c.collector_number, ${finishOrderSql('co.finish')}`,
    )
    .all(oracleId) as CopyRow[]
  return rows.map((r) => ({
    cardId: r.card_id,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    finish: r.finish,
    quantity: r.quantity,
    priceUsd: finishPrice(parsePrices(r.prices), r.finish),
    addedAt: r.added_at,
  }))
}

/**
 * Adds copies of one printing in one finish (positive delta) or removes them (negative). Removing more than are owned
 * removes them all. Returns how many are left. The caller checks that the card exists and comes in that finish.
 * A row's `added_at` is the last time copies were added to it (what "date added" sorts by); removing leaves it alone.
 */
export function adjustCopies(db: DB, cardId: string, finish: Finish, delta: number, now = new Date()): number {
  return db.transaction(() => {
    const current =
      (db.prepare('SELECT quantity FROM collection WHERE card_id = ? AND finish = ?').pluck().get(cardId, finish) as
        | number
        | undefined) ?? 0
    const next = Math.max(0, current + delta)
    const at = now.toISOString()
    if (next === 0) {
      db.prepare('DELETE FROM collection WHERE card_id = ? AND finish = ?').run(cardId, finish)
    } else if (current === 0) {
      db.prepare(
        'INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(cardId, finish, next, at, at)
    } else {
      db.prepare(
        `UPDATE collection SET quantity = @next, updated_at = @at, added_at = CASE WHEN @delta > 0 THEN @at ELSE added_at END
         WHERE card_id = @cardId AND finish = @finish`,
      ).run({ next, at, delta, cardId, finish })
    }
    return next
  })()
}

/** Totals for the library header (spec §5.3). */
export function collectionStats(db: DB): CollectionStats {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(co.quantity), 0) AS total,
         COUNT(DISTINCT c.oracle_id) AS unique_cards,
         COALESCE(SUM(co.quantity * CAST(round(${COPY_PRICE_SQL} * 100) AS INTEGER)), 0) AS value_cents,
         COALESCE(SUM(CASE WHEN ${COPY_PRICE_SQL} IS NULL THEN co.quantity ELSE 0 END), 0) AS unpriced,
         MAX(co.added_at) AS last_added
       FROM collection co CROSS JOIN cards c ON c.id = co.card_id`,
    )
    .get() as { total: number; unique_cards: number; value_cents: number; unpriced: number; last_added: string | null }
  return {
    totalCards: row.total,
    uniqueCards: row.unique_cards,
    valueUsd: row.value_cents / 100,
    unpricedCards: row.unpriced,
    lastAddedAt: row.last_added,
  }
}
```

- [ ] **Step 5: Add the routes and include copies in card detail**

Create `src/server/collection/routes.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import type { CopyCount } from '../../shared/types.ts'
import { getCard } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { ApiError, parseWith } from '../http.ts'
import { adjustCopies, collectionStats } from './repo.ts'

const CardId = z.string().min(1).max(100)
const FinishSchema = z.enum(['nonfoil', 'foil', 'etched'])
const AdjustBody = z.object({
  cardId: CardId,
  finish: FinishSchema,
  delta: z.number().int().min(-1000).max(1000).refine((n) => n !== 0, 'must not be 0'),
})

/** Reads a JSON body, answering 400 (not 500) when it isn't JSON. */
async function jsonBody(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw new ApiError(400, 'bad_request', 'The request body must be JSON')
  }
}

/** "Lightning Bolt (M10 #146)" */
function printingLabel(name: string, setCode: string, collectorNumber: string): string {
  return `${name} (${setCode.toUpperCase()} #${collectorNumber})`
}

export function collectionRoutes(deps: { db: DB }): Hono {
  const routes = new Hono()
  const { db } = deps

  routes.get('/stats', (c) => c.json(collectionStats(db)))

  routes.post('/adjust', async (c) => {
    const { cardId, finish, delta } = parseWith(AdjustBody, await jsonBody(c.req))
    const card = getCard(db, cardId)
    if (!card) throw new ApiError(404, 'not_found', 'Card not found')
    // Removing is always allowed, so a finish Scryfall no longer lists can still be cleared out.
    if (delta > 0 && !card.finishes.includes(finish)) {
      throw new ApiError(400, 'finish_unavailable', `${printingLabel(card.name, card.setCode, card.collectorNumber)} has no ${finish} version`)
    }
    const result: CopyCount = { cardId, finish, quantity: adjustCopies(db, cardId, finish, delta) }
    return c.json(result)
  })

  return routes
}
```

In `src/server/cards/routes.ts`, replace:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import type { CardDetail } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'
import { ApiError, parseWith } from '../http.ts'
import { autocomplete, getCard, getPrintings } from './repo.ts'

```

with:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { NO_OWNERSHIP } from '../../shared/ownership.ts'
import type { CardDetail } from '../../shared/types.ts'
import { getCopies } from '../collection/repo.ts'
import type { DB } from '../db/index.ts'
import { ApiError, parseWith } from '../http.ts'
import { getOwnership } from '../ownership/repo.ts'
import { autocomplete, getCard, getPrintings } from './repo.ts'

```

In `src/server/cards/routes.ts`, replace:

```ts
    const detail: CardDetail = { card, printings: getPrintings(deps.db, card.oracleId) }
```

with:

```ts
    const detail: CardDetail = {
      card,
      printings: getPrintings(deps.db, card.oracleId),
      copies: getCopies(deps.db, card.oracleId),
      ownership: getOwnership(deps.db, [card.oracleId]).get(card.oracleId) ?? NO_OWNERSHIP,
    }
```

In `src/server/app.ts`, replace:

```ts
import { catalogRoutes } from './catalog/routes.ts'
```

with:

```ts
import { catalogRoutes } from './catalog/routes.ts'
import { collectionRoutes } from './collection/routes.ts'
```

In `src/server/app.ts`, replace:

```ts
  app.route('/api/catalog', catalogRoutes(deps))
```

with:

```ts
  app.route('/api/catalog', catalogRoutes(deps))
  app.route('/api/collection', collectionRoutes(deps))
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run tests/server/collection-repo.test.ts tests/server/collection-api.test.ts tests/server/api.test.ts`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass (373 tests).

---

### Task 4: CSV import and export

Spec §5.3: headers are detected case-insensitively, and rows resolve by set + number, then set + name, then name.
The prototype also covers what real exports contain:
- Moxfield (Edition = set code), Deckbox (Edition = set name, Card Number), ManaBox (Set code, Scryfall ID, finish
  words), Archidekt, TCGplayer (Printing), and Dragon Shield headings;
- quoted names with commas;
- a byte-order mark, CRLF endings, semicolon or tab separators;
- zero-padded collector numbers;
- reversible printings named "Blood Crypt // Blood Crypt";
- names written with either face or `/`.

Decisions:
- A Scryfall ID column wins when present.
- A name alone resolves to the card's **default printing** (Task 1's newest regular printing), not the literal
  newest (which is often a Secret Lair). It prefers a printing that comes in the row's finish.
- Rows whose printing was picked are `ambiguous` and say why. The UI includes them by default, with a checkbox to
  leave them out.
- A finish the printing lacks switches to one it has, with a note. An unrecognized non-blank Foil value reads as foil,
  with a note.
- Import always adds to the library; it never replaces it.

Measured: a 23,000-row file previews in 0.25–1 s and commits in 80–140 ms.

**Files:**
- Create: `src/server/collection/csv.ts`, `src/server/collection/import.ts`
- Modify: `src/shared/types.ts` (import types), `src/server/collection/repo.ts` (append `addCopies`, `exportRows`),
  `src/server/collection/routes.ts` (replace: adds preview, import, export)
- Test: `tests/server/collection-csv.test.ts` (new), `tests/server/collection-import.test.ts` (new),
  `tests/server/collection-repo.test.ts`, `tests/server/collection-api.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_PRINTING_ORDER` (Task 1), `normalizeName`, the `card_names` table, `finishOrderSql` (Task 2),
  Task 3's repo and routes.
- Produces:
  - `POST /api/collection/import/preview` with `{ csv }` (≤ 10,000,000 characters) → `ImportPreview` =
    `{ rows: ImportRow[], counts: { resolved, ambiguous, unresolved } }`. A file with no header naming the card,
    or an unclosed quote, → 400 `bad_csv`.
  - `POST /api/collection/import` with `{ items: ImportItem[] }` (1–100,000 items, quantity 1–9999) →
    `ImportResult` = `{ rows, copies }`. All or nothing: an unknown card or a finish the printing lacks → 400
    `bad_import`, and nothing is added.
  - `GET /api/collection/export.csv` → `Count,Name,Edition,Collector Number,Foil` (Moxfield's format), CRLF line
    endings, downloaded as `binder-collection-YYYY-MM-DD.csv`.
  - Types `ImportRowStatus`, `ImportRow`, `ImportPreview`, `ImportItem`, `ImportResult` in `src/shared/types.ts`.
    Task 6's import panel uses them.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/collection-csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CsvError, csvLine, parseCsv } from '../../src/server/collection/csv.ts'

const cells = (text: string) => parseCsv(text).map((r) => r.cells)

describe('parseCsv', () => {
  it('splits rows and cells', () => {
    expect(cells('Count,Name\n2,Lightning Bolt\n1,Sol Ring')).toEqual([
      ['Count', 'Name'],
      ['2', 'Lightning Bolt'],
      ['1', 'Sol Ring'],
    ])
  })

  it('reads quoted cells with commas, doubled quotes, and line breaks', () => {
    expect(cells('"Atraxa, Praetors\' Voice","say ""hi""","two\nlines"\nnext')).toEqual([
      ["Atraxa, Praetors' Voice", 'say "hi"', 'two\nlines'],
      ['next'],
    ])
  })

  it('reports the line each record starts on, counting line breaks inside quotes', () => {
    expect(parseCsv('a\n"b\nc"\nd').map((r) => r.line)).toEqual([1, 2, 4])
  })

  it('accepts CRLF endings, a trailing line break, a byte-order mark, and empty cells', () => {
    expect(cells('﻿a,b\r\n1,\r\n,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', ''],
      ['', '2'],
    ])
  })

  it('uses tabs or semicolons when the header line has no commas', () => {
    expect(cells('Count\tName\n1\tSol Ring')).toEqual([['Count', 'Name'], ['1', 'Sol Ring']])
    expect(cells('Count;Name\n1;Sol Ring')).toEqual([['Count', 'Name'], ['1', 'Sol Ring']])
  })

  it('keeps a quote inside an unquoted cell as text', () => {
    expect(cells('5" ruler,x')).toEqual([['5" ruler', 'x']])
  })

  it('returns nothing for empty text', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('rejects a quoted cell that never closes, naming its line', () => {
    expect(() => parseCsv('a\n"oops,b\nc')).toThrow(CsvError)
    expect(() => parseCsv('a\n"oops,b\nc')).toThrow(/line 2/)
  })
})

describe('csvLine', () => {
  it('quotes only cells that need it', () => {
    expect(csvLine([2, 'Lightning Bolt', "Atraxa, Praetors' Voice", 'say "hi"', ' edge'])).toBe(
      '2,Lightning Bolt,"Atraxa, Praetors\' Voice","say ""hi"""," edge"',
    )
  })

  it('round-trips through parseCsv', () => {
    const row = ['a,b', 'c"d', 'e\nf', '', 'plain']
    expect(cells(csvLine(row))).toEqual([row])
  })
})
```

Create `tests/server/collection-import.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import { CsvError } from '../../src/server/collection/csv.ts'
import { previewImport } from '../../src/server/collection/import.ts'
import type { DB } from '../../src/server/db/index.ts'
import type { ImportRow } from '../../src/shared/types.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard } from '../helpers/fixtures.ts'

let db: DB
beforeEach(() => {
  db = createTestDb()
})

const id = (name: string, set?: string) => fixtureCard(name, set).id

function rows(csv: string): ImportRow[] {
  return previewImport(db, csv).rows
}

/** [status, card id, finish, quantity, note] for each row. */
function summary(csv: string) {
  return rows(csv).map((r) => [r.status, r.card?.id ?? null, r.finish, r.quantity, r.note])
}

describe('previewImport: columns', () => {
  it('reads a Moxfield export (Edition holds set codes)', () => {
    const csv = [
      '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number"',
      '"2","0","Lightning Bolt","m10","Near Mint","English","","","2026-01-01","146"',
      '"1","0","Lightning Bolt","m11","Near Mint","English","foil","","2026-01-01","149"',
    ].join('\n')
    expect(summary(csv)).toEqual([
      ['resolved', id('Lightning Bolt', 'm10'), 'nonfoil', 2, null],
      ['resolved', id('Lightning Bolt', 'm11'), 'foil', 1, null],
    ])
  })

  it('reads a Deckbox export (Edition holds set names, Card Number the number)', () => {
    const csv = 'Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil\n3,0,Sol Ring,Commander Legends,472,Near Mint,English,'
    expect(summary(csv)).toEqual([['resolved', id('Sol Ring', 'cmr'), 'nonfoil', 3, null]])
  })

  it('reads a ManaBox export (Set code, Scryfall ID, finish words)', () => {
    const csv = [
      'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID',
      `Lightning Bolt,sta,Strixhaven Mystical Archive,42,etched,uncommon,1,1,${id('Lightning Bolt', 'sta')}`,
    ].join('\n')
    expect(summary(csv)).toEqual([['resolved', id('Lightning Bolt', 'sta'), 'etched', 1, null]])
  })

  it('reads headings in any letter case and order, with a default count of 1', () => {
    expect(summary('card name,SET\nCounterspell,DSC')).toEqual([['resolved', id('Counterspell'), 'nonfoil', 1, null]])
  })

  it('rejects a file with no column naming the card', () => {
    expect(() => previewImport(db, 'Count,Condition\n1,NM')).toThrow(CsvError)
    expect(() => previewImport(db, 'Count,Condition\n1,NM')).toThrow(/found: Count, Condition/)
    expect(() => previewImport(db, '\n\n')).toThrow(/empty/)
  })

  it('skips blank lines and reports the line each row came from', () => {
    expect(rows('Name\n\nSol Ring\n\n"Fire // Ice"').map((r) => r.line)).toEqual([3, 5])
  })
})

describe('previewImport: resolution order', () => {
  it('trusts a Scryfall ID over the other columns', () => {
    expect(summary(`Name,Set,Scryfall ID\nSomething Else,m10,${id('Sol Ring', 'c21')}`)[0]?.slice(0, 2)).toEqual([
      'resolved',
      id('Sol Ring', 'c21'),
    ])
  })

  it('resolves set + collector number, ignoring leading zeros', () => {
    expect(summary('Set,Collector Number\nm10,0146')[0]?.slice(0, 2)).toEqual(['resolved', id('Lightning Bolt', 'm10')])
  })

  it('falls back to set + name when the number is wrong or names a different card', () => {
    expect(summary('Name,Set,Number\nLightning Bolt,m11,1')[0]).toEqual([
      'ambiguous',
      id('Lightning Bolt', 'm11'),
      'nonfoil',
      1,
      'Magic 2011 has no #1',
    ])
    const [status, cardId, , , note] = summary('Name,Set,Number\nSol Ring,dsc,114')[0] ?? []
    expect([status, cardId]).toEqual(['ambiguous', id('Sol Ring', 'c21')])
    expect(note).toMatch(/^Duskmourn: House of Horror Commander #114 is Counterspell, not Sol Ring\. Not printed in /)
  })

  it('resolves set + name when the set has one printing of the card', () => {
    expect(summary('Name,Set\nLightning Bolt,Magic 2010')[0]?.slice(0, 2)).toEqual(['resolved', id('Lightning Bolt', 'm10')])
  })

  it('picks the lowest collector number when a set has several printings, and says so', () => {
    const bolt = fixtureCard('Lightning Bolt', 'm10')
    const variant = scryfallToRow({ ...bolt, id: '00000000-0000-4000-8000-000000000300', collector_number: '300' })
    insertCardRows(db, 'cards', [variant as CardRow])
    rebuildCardNames(db)
    expect(summary('Name,Set\nLightning Bolt,m10')[0]).toEqual([
      'ambiguous',
      bolt.id,
      'nonfoil',
      1,
      '2 printings in Magic 2010; picked #146',
    ])
  })

  it('uses the default printing for a name alone, preferring one that comes in the finish', () => {
    expect(summary('Name\nLightning Bolt')[0]).toEqual([
      'ambiguous',
      id('Lightning Bolt', 'm11'),
      'nonfoil',
      1,
      'No set given; picked the newest printing',
    ])
    expect(summary('Name,Foil\nLightning Bolt,etched')[0]?.slice(0, 3)).toEqual(['ambiguous', id('Lightning Bolt', 'sta'), 'etched'])
  })

  it('explains a set it does not know or a card not printed in that set', () => {
    expect(summary('Name,Set\nSol Ring,zzz')[0]?.[4]).toBe('Unknown set "zzz". Picked the newest printing')
    expect(summary('Name,Set\nSol Ring,m10')[0]?.[4]).toBe('Not printed in Magic 2010. Picked the newest printing')
  })

  it('matches names without regard to case, accents, punctuation, or which face is named', () => {
    const found = rows('Name\nlightning BOLT\nfire/ice\nDelver of Secrets\nInsectile Aberration\nAtraxa Praetors Voice\nLightning Bolt // Lightning Bolt')
    expect(found.map((r) => r.card?.name)).toEqual([
      'Lightning Bolt',
      'Fire // Ice',
      'Delver of Secrets // Insectile Aberration',
      'Delver of Secrets // Insectile Aberration',
      "Atraxa, Praetors' Voice",
      'Lightning Bolt', // reversible printings name both faces the same
    ])
  })
})

describe('previewImport: problems', () => {
  it('marks unknown cards and bad counts unresolved, with the reason', () => {
    expect(summary('Count,Name\n1,Not A Real Card\nx,Sol Ring\n0,Sol Ring\n10000,Sol Ring\n1,')).toEqual([
      ['unresolved', null, 'nonfoil', 1, 'No card named "Not A Real Card"'],
      ['unresolved', null, 'nonfoil', 0, 'The count "x" isn\'t a whole number of 1 or more'],
      ['unresolved', null, 'nonfoil', 0, 'The count "0" isn\'t a whole number of 1 or more'],
      ['unresolved', null, 'nonfoil', 10000, 'The count 10000 is more than 9999'],
      ['unresolved', null, 'nonfoil', 1, 'The row has no card name'],
    ])
  })

  it('adds a finish the printing has when the file asks for one it lacks', () => {
    expect(summary('Name,Set,Foil\nSol Ring,cmr,foil\nThrasios Triton Hero,c16,')).toEqual([
      ['resolved', id('Sol Ring', 'cmr'), 'nonfoil', 1, 'This printing has no foil version; adding nonfoil'],
      ['resolved', id('Thrasios, Triton Hero'), 'foil', 1, 'This printing has no nonfoil version; adding foil'],
    ])
  })

  it('reads finish words, treating other non-blank values as foil and saying so', () => {
    const finishes = rows('Name,Set,Foil\nLightning Bolt,sta,Normal\nLightning Bolt,sta,TRUE\nLightning Bolt,sta,Etched Foil\nLightning Bolt,sta,✓')
    expect(finishes.map((r) => [r.finish, r.note])).toEqual([
      ['nonfoil', null],
      ['foil', null],
      ['etched', null],
      ['foil', 'Read "✓" as foil'],
    ])
  })

  it('counts rows by status', () => {
    expect(previewImport(db, 'Name,Set\nSol Ring,cmr\nLightning Bolt,\nNope,').counts).toEqual({ resolved: 1, ambiguous: 1, unresolved: 1 })
  })
})
```

In `tests/server/collection-repo.test.ts`, replace:

```ts
import { adjustCopies, collectionStats, getCopies } from '../../src/server/collection/repo.ts'
```

with:

```ts
import { addCopies, adjustCopies, collectionStats, exportRows, getCopies } from '../../src/server/collection/repo.ts'
```

Add to the end of `tests/server/collection-repo.test.ts`, after a blank line:

```ts
describe('addCopies', () => {
  it('adds every item in one go, summing repeats and adding to rows already owned', () => {
    own(db, 'Lightning Bolt', 'm10', 1)
    const result = addCopies(db, [
      { cardId: bolt('m10').id, finish: 'nonfoil', quantity: 2 },
      { cardId: bolt('m10').id, finish: 'nonfoil', quantity: 1 },
      { cardId: bolt('m11').id, finish: 'foil', quantity: 4 },
    ])
    expect(result).toEqual({ rows: 2, copies: 7 })
    expect(quantity(bolt('m10').id, 'nonfoil')).toBe(4)
    expect(quantity(bolt('m11').id, 'foil')).toBe(4)
  })

  it('counts every row it touches as added now', () => {
    own(db, 'Lightning Bolt', 'm10', 1, 'nonfoil', '2026-01-01T00:00:00.000Z')
    addCopies(db, [{ cardId: bolt('m10').id, finish: 'nonfoil', quantity: 1 }], new Date('2026-09-26T10:00:00Z'))
    expect(db.prepare('SELECT added_at FROM collection').pluck().get()).toBe('2026-09-26T10:00:00.000Z')
  })

  it('adds nothing when any item fails', () => {
    expect(() =>
      addCopies(db, [
        { cardId: bolt('m10').id, finish: 'nonfoil', quantity: 2 },
        { cardId: 'missing', finish: 'nonfoil', quantity: 1 },
      ]),
    ).toThrow(/FOREIGN KEY/)
    expect(count(db, 'collection')).toBe(0)
  })
})

describe('exportRows', () => {
  it('lists each row by name, set, number, and finish', () => {
    own(db, 'Sol Ring', 'cmr', 1)
    own(db, 'Lightning Bolt', 'm10', 1, 'foil')
    own(db, 'Lightning Bolt', 'm10', 2, 'nonfoil')
    expect(exportRows(db)).toEqual([
      { quantity: 2, name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146', finish: 'nonfoil' },
      { quantity: 1, name: 'Lightning Bolt', setCode: 'm10', collectorNumber: '146', finish: 'foil' },
      { quantity: 1, name: 'Sol Ring', setCode: 'cmr', collectorNumber: '472', finish: 'nonfoil' },
    ])
  })
})
```

In `tests/server/collection-api.test.ts`, replace:

```ts
import type { ApiErrorBody, CardDetail, CollectionStats, CopyCount } from '../../src/shared/types.ts'
```

with:

```ts
import type { ApiErrorBody, CardDetail, CollectionStats, CopyCount, ImportPreview, ImportResult } from '../../src/shared/types.ts'
```

Add to the end of `tests/server/collection-api.test.ts`, after a blank line:

```ts
describe('CSV import', () => {
  it('previews a file, then imports the chosen rows in one go', async () => {
    const preview = await body<ImportPreview>(await post('/api/collection/import/preview', { csv: 'Count,Name,Edition\n2,Lightning Bolt,m10\n1,Nope,\n1,Sol Ring,' }))
    expect(preview.counts).toEqual({ resolved: 1, ambiguous: 1, unresolved: 1 })
    const items = preview.rows.flatMap((r) => (r.card ? [{ cardId: r.card.id, finish: r.finish, quantity: r.quantity }] : []))
    const res = await post('/api/collection/import', { items })
    expect(res.status).toBe(200)
    expect(await body<ImportResult>(res)).toEqual({ rows: 2, copies: 3 })
    expect((await body<CollectionStats>(await app.request('/api/collection/stats'))).totalCards).toBe(3)
  })

  it('reports a file it cannot read as bad_csv', async () => {
    const res = await post('/api/collection/import/preview', { csv: 'Count,Condition\n1,NM' })
    expect([res.status, await errorCode(res)]).toEqual([400, 'bad_csv'])
  })

  it('refuses the whole import when any item names an unknown card or a missing finish', async () => {
    for (const bad of [
      { cardId: 'nope', finish: 'nonfoil', quantity: 1 },
      { cardId: bolt('m10').id, finish: 'etched', quantity: 1 },
    ]) {
      const res = await post('/api/collection/import', { items: [{ cardId: bolt('m11').id, finish: 'nonfoil', quantity: 1 }, bad] })
      expect([res.status, await errorCode(res)]).toEqual([400, 'bad_import'])
    }
    expect((await body<CollectionStats>(await app.request('/api/collection/stats'))).totalCards).toBe(0)
  })
})

describe('GET /api/collection/export.csv', () => {
  it('exports Count,Name,Edition,Collector Number,Foil as a download', async () => {
    own(db, "Atraxa, Praetors' Voice", undefined, 1, 'foil')
    own(db, 'Lightning Bolt', 'm10', 2)
    const res = await app.request('/api/collection/export.csv')
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="binder-collection-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(await res.text()).toBe('Count,Name,Edition,Collector Number,Foil\r\n1,"Atraxa, Praetors\' Voice",2xm,190,foil\r\n2,Lightning Bolt,m10,146,\r\n')
  })

  it('round-trips: importing an export resolves every row to the same printing and finish', async () => {
    own(db, 'Lightning Bolt', 'sta', 1, 'etched')
    own(db, 'Fire // Ice', undefined, 3)
    own(db, 'Thrasios, Triton Hero', undefined, 1, 'foil')
    const csv = await (await app.request('/api/collection/export.csv')).text()
    const preview = await body<ImportPreview>(await post('/api/collection/import/preview', { csv }))
    expect(preview.counts).toEqual({ resolved: 3, ambiguous: 0, unresolved: 0 })
    const before = db.prepare('SELECT card_id, finish, quantity FROM collection ORDER BY card_id, finish').all()
    expect(preview.rows.map((r) => ({ card_id: r.card?.id, finish: r.finish, quantity: r.quantity })).sort((a, b) => (a.card_id! < b.card_id! ? -1 : 1))).toEqual(before)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/server/collection-csv.test.ts tests/server/collection-import.test.ts tests/server/collection-repo.test.ts tests/server/collection-api.test.ts`
Expected: FAIL. `csv.ts` and `import.ts` do not exist; `addCopies`/`exportRows` are not exported; the import routes answer 404.

- [ ] **Step 3: Add the import types**

In `src/shared/types.ts`, replace:

```ts
/** The collection row a change left behind; quantity 0 means none are left. */
export interface CopyCount {
  cardId: string
  finish: Finish
  quantity: number
}

```

with:

```ts
/** The collection row a change left behind; quantity 0 means none are left. */
export interface CopyCount {
  cardId: string
  finish: Finish
  quantity: number
}

/**
 * How a CSV row resolved: `resolved` names one printing; `ambiguous` found the card but had to pick its printing;
 * `unresolved` can't be imported.
 */
export type ImportRowStatus = 'resolved' | 'ambiguous' | 'unresolved'

export interface ImportRow {
  /** Line in the file where the row starts (the header is line 1). */
  line: number
  status: ImportRowStatus
  /** What the file says. */
  input: { name: string; set: string; collectorNumber: string }
  quantity: number
  finish: Finish
  /** The printing it will add, or null when unresolved. */
  card: { id: string; name: string; setCode: string; setName: string; collectorNumber: string } | null
  /** Why a row is ambiguous or unresolved, or what the import changed (a finish the printing lacks). */
  note: string | null
}

export interface ImportPreview {
  rows: ImportRow[]
  counts: Record<ImportRowStatus, number>
}

/** Copies to add: one entry per CSV row. */
export interface ImportItem {
  cardId: string
  finish: Finish
  quantity: number
}

export interface ImportResult {
  /** Collection rows created or increased. */
  rows: number
  /** Copies added. */
  copies: number
}

```

- [ ] **Step 4: Add the CSV reader and writer**

Create `src/server/collection/csv.ts`:

```ts
/** A CSV file that can't be read as a table (or has no column naming the card). */
export class CsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvError'
  }
}

export interface CsvRecord {
  /** Line where the record starts, from 1. */
  line: number
  cells: string[]
}

/** Comma, unless the first line has none and uses tabs or semicolons instead (some spreadsheet exports). */
function detectDelimiter(text: string): string {
  const first = text.slice(0, text.search(/\r|\n|$/))
  if (first.includes(',')) return ','
  if (first.includes('\t')) return '\t'
  if (first.includes(';')) return ';'
  return ','
}

/**
 * Parses CSV text (RFC 4180: quoted cells may hold delimiters, doubled quotes, and line breaks). Accepts CRLF or LF
 * line endings and a leading byte-order mark. A quote that isn't at the start of a cell is kept as text.
 * Throws CsvError when a quoted cell never closes.
 */
export function parseCsv(text: string): CsvRecord[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const delimiter = detectDelimiter(src)
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let quoteLine = 0
  let line = 1
  let recordLine = 1
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        if (ch === '\n') line++
        cell += ch
      }
    } else if (ch === '"' && cell === '') {
      quoted = true
      quoteLine = line
    } else if (ch === delimiter) {
      cells.push(cell)
      cell = ''
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      cells.push(cell)
      records.push({ line: recordLine, cells })
      cells = []
      cell = ''
      line++
      recordLine = line
    } else {
      cell += ch
    }
  }
  if (quoted) throw new CsvError(`A quoted value starting on line ${quoteLine} never ends (missing closing ")`)
  if (cell !== '' || cells.length > 0) {
    cells.push(cell)
    records.push({ line: recordLine, cells })
  }
  return records
}

/** One CSV line (no line break): cells with a comma, quote, line break, or edge space are quoted. */
export function csvLine(cells: readonly (string | number)[]): string {
  return cells
    .map((value) => {
      const text = String(value)
      return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    })
    .join(',')
}
```

- [ ] **Step 5: Add the import resolver**

Create `src/server/collection/import.ts`:

```ts
import { normalizeName } from '../../shared/normalize.ts'
import type { Finish, ImportPreview, ImportRow, ImportRowStatus } from '../../shared/types.ts'
import { DEFAULT_PRINTING_ORDER } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { CsvError, parseCsv } from './csv.ts'

/** Most copies one CSV row may add. */
export const MAX_ROW_QUANTITY = 9999

type Column = 'quantity' | 'name' | 'scryfallId' | 'setCode' | 'set' | 'setName' | 'number' | 'finish'

/**
 * Accepted headings per column, compared case-insensitively. Covers Moxfield, Deckbox, ManaBox, Archidekt, TCGplayer,
 * and Dragon Shield exports. `set` holds a set code or a set name; `setCode`/`setName` hold only one kind.
 */
const HEADINGS: Record<Column, readonly string[]> = {
  quantity: ['count', 'quantity', 'qty'],
  name: ['name', 'card name', 'card'],
  scryfallId: ['scryfall id', 'scryfall_id'],
  setCode: ['set code', 'edition code'],
  set: ['set', 'edition'],
  setName: ['set name', 'edition name'],
  number: ['collector number', 'card number', 'number', 'collector_number'],
  finish: ['foil', 'finish', 'printing'],
}

/** Finish cell values (lowercase). Blank means nonfoil; any other truthy word means foil. */
const FINISH_WORDS: Record<string, Finish> = {
  '': 'nonfoil', nonfoil: 'nonfoil', 'non-foil': 'nonfoil', normal: 'nonfoil', regular: 'nonfoil', no: 'nonfoil',
  n: 'nonfoil', false: 'nonfoil', '0': 'nonfoil',
  foil: 'foil', yes: 'foil', y: 'foil', true: 'foil', '1': 'foil',
  etched: 'etched', 'etched foil': 'etched', 'foil etched': 'etched',
}

const FINISHES: readonly Finish[] = ['nonfoil', 'foil', 'etched']

interface PrintingRow {
  id: string
  oracle_id: string
  name: string
  face_names: string
  set_code: string
  set_name: string
  collector_number: string
  finishes: string
}

interface Candidate extends PrintingRow {
  finishList: Finish[]
}

const PRINTING_COLUMNS = 'id, oracle_id, name, face_names, set_code, set_name, collector_number, finishes'

function candidate(row: PrintingRow): Candidate {
  return { ...row, finishList: JSON.parse(row.finishes) as Finish[] }
}

/** Maps each heading to the column it names; the first column wins when two headings mean the same thing. */
function findColumns(header: readonly string[]): Partial<Record<Column, number[]>> {
  const found: Partial<Record<Column, number[]>> = {}
  header.forEach((heading, index) => {
    const key = heading.trim().toLowerCase()
    for (const column of Object.keys(HEADINGS) as Column[]) {
      if (HEADINGS[column].includes(key)) (found[column] ??= []).push(index)
    }
  })
  return found
}

/**
 * Resolves each row of a collection CSV to a printing, without changing anything (spec §5.3). A row resolves by
 * Scryfall ID, then set + collector number, then set + name, then name alone (the card's default printing). Rows
 * where the printing had to be picked are `ambiguous`; rows that can't be imported are `unresolved`, with a reason.
 * Throws CsvError when the file can't be read or no column names the card.
 */
export function previewImport(db: DB, text: string): ImportPreview {
  const records = parseCsv(text).filter((r) => r.cells.some((cell) => cell.trim() !== ''))
  const header = records.shift()
  if (!header) throw new CsvError('The file is empty')
  const columns = findColumns(header.cells)
  if (!columns.name && !columns.scryfallId && !(columns.number && (columns.set || columns.setCode))) {
    throw new CsvError(
      `No column names the card. The first line must name the columns, like Count,Name,Edition,Collector Number,Foil ` +
        `(found: ${header.cells.map((c) => c.trim()).join(', ')})`,
    )
  }
  const resolver = createResolver(db)
  const rows = records.map((record) => {
    const cell = (column: Column) =>
      (columns[column] ?? []).map((i) => (record.cells[i] ?? '').trim()).find((value) => value !== '') ?? ''
    const setValues = (['setCode', 'set', 'setName'] as const).flatMap((column) =>
      (columns[column] ?? []).map((i) => (record.cells[i] ?? '').trim()).filter((value) => value !== ''),
    )
    return resolver.resolve({
      line: record.line,
      quantityText: cell('quantity'),
      name: cell('name'),
      scryfallId: cell('scryfallId'),
      setValues,
      number: cell('number'),
      finishText: cell('finish'),
    })
  })
  const counts: Record<ImportRowStatus, number> = { resolved: 0, ambiguous: 0, unresolved: 0 }
  for (const row of rows) counts[row.status]++
  return { rows, counts }
}

interface RowInput {
  line: number
  quantityText: string
  name: string
  scryfallId: string
  setValues: string[]
  number: string
  finishText: string
}

function createResolver(db: DB) {
  const setByCode = new Map<string, { code: string; name: string }>()
  const setByName = new Map<string, { code: string; name: string }>()
  for (const s of db.prepare('SELECT set_code AS code, set_name AS name FROM cards GROUP BY set_code').all() as Array<{
    code: string
    name: string
  }>) {
    setByCode.set(s.code.toLowerCase(), s)
    setByName.set(s.name.toLowerCase(), s)
  }
  // Full names first, so a face name never shadows a card that has that full name.
  const oracleByName = new Map<string, string>()
  const names = db.prepare('SELECT oracle_id, search_name, face_names FROM card_names').all() as Array<{
    oracle_id: string
    search_name: string
    face_names: string
  }>
  for (const n of names) oracleByName.set(n.search_name, n.oracle_id)
  for (const n of names) {
    for (const face of n.face_names.split('\n')) {
      const key = normalizeName(face)
      if (!oracleByName.has(key)) oracleByName.set(key, n.oracle_id)
    }
  }
  const byId = db.prepare(`SELECT ${PRINTING_COLUMNS} FROM cards WHERE id = ?`)
  const bySetNumber = db.prepare(`SELECT ${PRINTING_COLUMNS} FROM cards WHERE set_code = ? AND collector_number = ?`)
  const byOracle = db.prepare(`SELECT ${PRINTING_COLUMNS} FROM cards WHERE oracle_id = ? ORDER BY ${DEFAULT_PRINTING_ORDER}`)
  const printingsCache = new Map<string, Candidate[]>()
  const printingsOf = (oracleId: string): Candidate[] => {
    let list = printingsCache.get(oracleId)
    if (!list) {
      list = (byOracle.all(oracleId) as PrintingRow[]).map(candidate)
      printingsCache.set(oracleId, list)
    }
    return list
  }
  const findSet = (values: readonly string[]) => {
    for (const value of values) {
      const key = value.toLowerCase()
      const set = setByCode.get(key) ?? setByName.get(key)
      if (set) return set
    }
    return null
  }
  // Reversible printings are named "Blood Crypt // Blood Crypt" while the card is "Blood Crypt": try the front half too.
  const findOracle = (name: string) =>
    oracleByName.get(normalizeName(name)) ??
    (name.includes('//') ? oracleByName.get(normalizeName(name.slice(0, name.indexOf('//')))) : undefined)
  const nameMatches = (card: Candidate, name: string) => {
    const key = normalizeName(name)
    return normalizeName(card.name) === key || card.face_names.split('\n').some((face) => normalizeName(face) === key)
  }

  function resolve(input: RowInput): ImportRow {
    const finishKey = input.finishText.toLowerCase()
    const finish = FINISH_WORDS[finishKey] ?? 'foil'
    const quantity = input.quantityText === '' ? 1 : /^\d+$/.test(input.quantityText) ? Number(input.quantityText) : NaN
    const base = {
      line: input.line,
      input: { name: input.name, set: input.setValues[0] ?? '', collectorNumber: input.number },
      quantity: Number.isFinite(quantity) ? quantity : 0,
      finish,
    }
    const unresolved = (note: string): ImportRow => ({ ...base, status: 'unresolved', card: null, note })
    if (!Number.isInteger(quantity) || quantity < 1) {
      return unresolved(`The count "${input.quantityText}" isn't a whole number of 1 or more`)
    }
    if (quantity > MAX_ROW_QUANTITY) return unresolved(`The count ${quantity} is more than ${MAX_ROW_QUANTITY}`)

    const notes: string[] = []
    if (!(finishKey in FINISH_WORDS)) notes.push(`Read "${input.finishText}" as foil`)
    const found = (status: 'resolved' | 'ambiguous', card: Candidate): ImportRow => {
      let chosen = finish
      if (!card.finishList.includes(finish)) {
        chosen = FINISHES.find((f) => card.finishList.includes(f)) ?? finish
        notes.push(`This printing has no ${finish} version; adding ${chosen}`)
      }
      return {
        ...base,
        finish: chosen,
        status,
        card: {
          id: card.id,
          name: card.name,
          setCode: card.set_code,
          setName: card.set_name,
          collectorNumber: card.collector_number,
        },
        note: notes.length > 0 ? notes.join('. ') : null,
      }
    }
    /** The first candidate that comes in the row's finish, else the first. */
    const pick = (list: readonly Candidate[]) => list.find((c) => c.finishList.includes(finish)) ?? list[0]!

    if (input.scryfallId !== '') {
      const row = byId.get(input.scryfallId) as PrintingRow | undefined
      if (row) return found('resolved', candidate(row))
      notes.push(`Scryfall ID ${input.scryfallId} isn't in the card data`)
    }
    const set = findSet(input.setValues)
    if (input.setValues.length > 0 && !set) notes.push(`Unknown set "${input.setValues[0]}"`)
    if (set && input.number !== '') {
      const row = (bySetNumber.get(set.code, input.number) ??
        bySetNumber.get(set.code, input.number.replace(/^0+(?=\d)/, ''))) as PrintingRow | undefined
      if (row && (input.name === '' || nameMatches(candidate(row), input.name))) return found('resolved', candidate(row))
      notes.push(
        row ? `${set.name} #${input.number} is ${row.name}, not ${input.name}` : `${set.name} has no #${input.number}`,
      )
    }
    const oracleId = input.name === '' ? undefined : findOracle(input.name)
    if (!oracleId) {
      if (input.name === '') return unresolved(notes.length > 0 ? notes.join('. ') : 'The row has no card name')
      return unresolved([...notes, `No card named "${input.name}"`].join('. '))
    }
    const printings = printingsOf(oracleId)
    if (set) {
      const inSet = printings.filter((p) => p.set_code === set.code)
      if (inSet.length === 1 && notes.length === 0) return found('resolved', inSet[0]!)
      if (inSet.length > 0) {
        const chosen = pick(inSet)
        if (inSet.length > 1) notes.push(`${inSet.length} printings in ${set.name}; picked #${chosen.collector_number}`)
        return found('ambiguous', chosen)
      }
      notes.push(`Not printed in ${set.name}`)
    }
    const chosen = pick(printings)
    notes.push(input.setValues.length === 0 ? 'No set given; picked the newest printing' : 'Picked the newest printing')
    return found('ambiguous', chosen)
  }

  return { resolve }
}
```

- [ ] **Step 6: Add bulk adding and export rows to the repository**

In `src/server/collection/repo.ts`, replace:

```ts
import type { CollectionStats, Copy, Finish } from '../../shared/types.ts'
```

with:

```ts
import type { CollectionStats, Copy, Finish, ImportItem, ImportResult } from '../../shared/types.ts'
```

Add to the end of `src/server/collection/repo.ts`, after a blank line:

```ts
/**
 * Adds every item's copies in one transaction (all or nothing). Items for the same printing and finish add up, and
 * every row they touch counts as added now. The caller checks that each card exists and comes in its finish.
 */
export function addCopies(db: DB, items: readonly ImportItem[], now = new Date()): ImportResult {
  const at = now.toISOString()
  const upsert = db.prepare(
    `INSERT INTO collection (card_id, finish, quantity, added_at, updated_at) VALUES (@cardId, @finish, @quantity, @at, @at)
     ON CONFLICT (card_id, finish) DO UPDATE
       SET quantity = quantity + excluded.quantity, added_at = excluded.added_at, updated_at = excluded.updated_at`,
  )
  return db.transaction(() => {
    const rows = new Set<string>()
    let copies = 0
    for (const item of items) {
      upsert.run({ ...item, at })
      rows.add(`${item.cardId}/${item.finish}`)
      copies += item.quantity
    }
    return { rows: rows.size, copies }
  })()
}

export interface ExportRow {
  quantity: number
  name: string
  setCode: string
  collectorNumber: string
  finish: Finish
}

/** Every collection row for export, by name, then set, number, and finish. */
export function exportRows(db: DB): ExportRow[] {
  return db
    .prepare(
      `SELECT co.quantity AS quantity, c.name AS name, c.set_code AS setCode, c.collector_number AS collectorNumber,
         co.finish AS finish
       FROM collection co CROSS JOIN cards c ON c.id = co.card_id
       ORDER BY c.name COLLATE NOCASE, c.set_code, CAST(c.collector_number AS INTEGER), c.collector_number,
         ${finishOrderSql('co.finish')}`,
    )
    .all() as ExportRow[]
}
```

- [ ] **Step 7: Add the import and export routes**

Replace the whole of `src/server/collection/routes.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import type { CopyCount, Finish } from '../../shared/types.ts'
import { getCard } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { ApiError, parseWith } from '../http.ts'
import { csvLine, CsvError } from './csv.ts'
import { MAX_ROW_QUANTITY, previewImport } from './import.ts'
import { addCopies, adjustCopies, collectionStats, exportRows } from './repo.ts'

const CardId = z.string().min(1).max(100)
const FinishSchema = z.enum(['nonfoil', 'foil', 'etched'])
const AdjustBody = z.object({
  cardId: CardId,
  finish: FinishSchema,
  delta: z.number().int().min(-1000).max(1000).refine((n) => n !== 0, 'must not be 0'),
})
const PreviewBody = z.object({ csv: z.string().max(10_000_000) })
const ImportItemSchema = z.object({ cardId: CardId, finish: FinishSchema, quantity: z.number().int().min(1).max(MAX_ROW_QUANTITY) })
const ImportBody = z.object({ items: z.array(ImportItemSchema).min(1).max(100_000) })

/** The Foil column of an export: blank for nonfoil, as Moxfield writes it. */
const FOIL_COLUMN: Record<Finish, string> = { nonfoil: '', foil: 'foil', etched: 'etched' }

/** Reads a JSON body, answering 400 (not 500) when it isn't JSON. */
async function jsonBody(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw new ApiError(400, 'bad_request', 'The request body must be JSON')
  }
}

/** "Lightning Bolt (M10 #146)" */
function printingLabel(name: string, setCode: string, collectorNumber: string): string {
  return `${name} (${setCode.toUpperCase()} #${collectorNumber})`
}

export function collectionRoutes(deps: { db: DB }): Hono {
  const routes = new Hono()
  const { db } = deps

  routes.get('/stats', (c) => c.json(collectionStats(db)))

  routes.post('/adjust', async (c) => {
    const { cardId, finish, delta } = parseWith(AdjustBody, await jsonBody(c.req))
    const card = getCard(db, cardId)
    if (!card) throw new ApiError(404, 'not_found', 'Card not found')
    // Removing is always allowed, so a finish Scryfall no longer lists can still be cleared out.
    if (delta > 0 && !card.finishes.includes(finish)) {
      throw new ApiError(400, 'finish_unavailable', `${printingLabel(card.name, card.setCode, card.collectorNumber)} has no ${finish} version`)
    }
    const result: CopyCount = { cardId, finish, quantity: adjustCopies(db, cardId, finish, delta) }
    return c.json(result)
  })

  routes.post('/import/preview', async (c) => {
    const { csv } = parseWith(PreviewBody, await jsonBody(c.req))
    try {
      return c.json(previewImport(db, csv))
    } catch (err) {
      if (err instanceof CsvError) throw new ApiError(400, 'bad_csv', err.message)
      throw err
    }
  })

  routes.post('/import', async (c) => {
    const { items } = parseWith(ImportBody, await jsonBody(c.req))
    // Checked up front so the import is all or nothing (the card data may have changed since the preview).
    const lookup = db.prepare('SELECT name, set_code, collector_number, finishes FROM cards WHERE id = ?')
    for (const item of items) {
      const card = lookup.get(item.cardId) as { name: string; set_code: string; collector_number: string; finishes: string } | undefined
      if (!card) throw new ApiError(400, 'bad_import', `Card ${item.cardId} isn't in the card data; preview the file again`)
      if (!(JSON.parse(card.finishes) as Finish[]).includes(item.finish)) {
        throw new ApiError(
          400,
          'bad_import',
          `${printingLabel(card.name, card.set_code, card.collector_number)} has no ${item.finish} version; preview the file again`,
        )
      }
    }
    return c.json(addCopies(db, items))
  })

  routes.get('/export.csv', (c) => {
    const lines = [csvLine(['Count', 'Name', 'Edition', 'Collector Number', 'Foil'])]
    for (const row of exportRows(db)) {
      lines.push(csvLine([row.quantity, row.name, row.setCode, row.collectorNumber, FOIL_COLUMN[row.finish]]))
    }
    const date = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local time
    return c.body(`${lines.join('\r\n')}\r\n`, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="binder-collection-${date}.csv"`,
    })
  })

  return routes
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run tests/server/collection-csv.test.ts tests/server/collection-import.test.ts tests/server/collection-repo.test.ts tests/server/collection-api.test.ts`
Expected: PASS.

- [ ] **Step 9: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass (410 tests).

---

### Task 5: Drawer editing, toasts, and finder accessibility

Spec §5.2.5 (Your copies with steppers, Add a copy, Decks) and §6 (toasts for mutations), plus the M1 drawer and
finder follow-ups:
- focus moves into the drawer and back out;
- the page behind the drawer is `inert`, so Tab stays inside it;
- `/` is ignored while the drawer is open;
- a reopened drawer never flashes the previous card (the panel mounts on open);
- a loading cue when switching printings;
- the finder is a full ARIA combobox (label, `aria-activedescendant`, `aria-controls` only while open, a live region);
- "No matches" no longer flickers while typing;
- the home finder only takes focus if nothing else has it;
- mana symbols are keyed by symbol;
- the printings list labels a foil or etched price.

Toasts: every failed change shows one. Successful **Add** and imports show one; the steppers update in place, so
they don't. The Decks list is read-only (Add to deck is M4). The web has no component tests (as in M1 and M2);
Task 7 drives these flows in headless Chrome.

**Files:**
- Create: `src/web/lib/toast.tsx`, `src/web/lib/collection.ts`
- Modify: `src/web/lib/format.ts` (thousands separators, `plural`), `src/web/main.tsx` (ToastProvider),
  `src/web/lib/use-bulk-status.ts`, `src/web/components/CardDrawer.tsx` (replace), `src/web/components/Layout.tsx`
  (inert page behind the drawer), `src/web/components/QuickFind.tsx` (replace), `src/web/components/ManaText.tsx`
- Test: `tests/web/format.test.ts` (new)

**Interfaces:**
- Consumes: `CardDetail.copies`/`.ownership`, `POST /api/collection/adjust` → `CopyCount` (Task 3); `listPrice` (Task 2).
- Produces:
  - `ToastProvider` and `useToast(): { success(message), error(message) }` from `src/web/lib/toast.tsx`.
  - `invalidateCollection(queryClient)`, which refetches `['card']`, `['search']`, and `['collection']`, and
    `useAdjustCopies()`, a mutation of `{ cardId, finish, delta }` that shows errors as toasts. Both are in
    `src/web/lib/collection.ts`. Task 6's import panel uses `invalidateCollection`.
  - `plural(count, singular, pluralForm?)` from `src/web/lib/format.ts`; `formatUsd` now prints `$480,962.46`.
  - Query key `['collection', 'stats']`, which Task 6 reads. `useBulkStatus` also refreshes `['collection']` and
    `['catalog']` after a card-data refresh.

- [ ] **Step 1: Write the failing test**

Create `tests/web/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatUsd, plural } from '../../src/web/lib/format.ts'

describe('format', () => {
  it('formats dollars with cents and thousands separators, or a dash for no price', () => {
    expect([formatUsd(0), formatUsd(3.5), formatUsd(480962.456), formatUsd(null)]).toEqual(['$0.00', '$3.50', '$480,962.46', '—'])
  })

  it('pluralizes counts', () => {
    expect([plural(1, 'row'), plural(0, 'row'), plural(2345, 'copy', 'copies')]).toEqual(['1 row', '0 rows', '2,345 copies'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/web/format.test.ts`
Expected: FAIL. `plural` is not exported, and `formatUsd(480962.456)` gives `$480962.46`.

- [ ] **Step 3: Update the formatters**

Replace the whole of `src/web/lib/format.ts`:

```ts
export function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "1 row", "2,345 rows"; pass the plural when it isn't singular + "s" ("copy", "copies"). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/web/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Add toasts**

Create `src/web/lib/toast.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Tone = 'success' | 'error'

interface Toast {
  id: number
  tone: Tone
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** How long a toast stays up; errors stay longer so there's time to read them. */
const DURATION_MS: Record<Tone, number> = { success: 4000, error: 8000 }
/** Toasts shown at once; older ones make way. */
const MAX_TOASTS = 4

/** Brief messages about changes (spec §6: toasts for mutations), stacked in the bottom-right corner. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const show = useCallback(
    (tone: Tone, message: string) => {
      const id = ++nextId.current
      setToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), { id, tone, message }])
      setTimeout(() => dismiss(id), DURATION_MS[tone])
    },
    [dismiss],
  )
  const api = useMemo<ToastApi>(
    () => ({ success: (message) => show('success', message), error: (message) => show('error', message) }),
    [show],
  )
  return (
    <ToastContext value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-xl shadow-black/50 ${
              toast.tone === 'error' ? 'border-rose-900 bg-rose-950 text-rose-100' : 'border-emerald-900 bg-stone-900 text-stone-100'
            }`}
          >
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="-mr-1 rounded px-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
```

In `src/web/main.tsx`, replace:

```tsx
import { CardDrawerProvider } from './lib/card-drawer.tsx'
```

with:

```tsx
import { CardDrawerProvider } from './lib/card-drawer.tsx'
import { ToastProvider } from './lib/toast.tsx'
```

In `src/web/main.tsx`, replace:

```tsx
      <CardDrawerProvider>
        <RouterProvider router={router} />
      </CardDrawerProvider>
```

with:

```tsx
      <ToastProvider>
        <CardDrawerProvider>
          <RouterProvider router={router} />
        </CardDrawerProvider>
      </ToastProvider>
```

- [ ] **Step 6: Add the collection mutation, and refresh library data after a card-data refresh**

Create `src/web/lib/collection.ts`:

```ts
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { CopyCount, Finish } from '../../shared/types.ts'
import { apiPost } from './api.ts'
import { useToast } from './toast.tsx'

export interface CopyChange {
  cardId: string
  finish: Finish
  delta: number
}

/** Refetches everything that shows what I own: card details, searches, and library stats. */
export function invalidateCollection(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['card'] })
  void queryClient.invalidateQueries({ queryKey: ['search'] })
  void queryClient.invalidateQueries({ queryKey: ['collection'] })
}

/** Adds or removes copies of one printing and finish. Failures show as a toast. */
export function useAdjustCopies() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (change: CopyChange) => apiPost<CopyCount>('/api/collection/adjust', change),
    onSuccess: () => invalidateCollection(queryClient),
    onError: (err) => toast.error(`Couldn't change your copies: ${err.message}`),
  })
}
```

In `src/web/lib/use-bulk-status.ts`, replace:

```ts
 * When a run finishes, cached lookups and searches are refetched so results from the new data show up.
```

with:

```ts
 * When a run finishes, cached lookups, searches, library stats, and set/type lists are refetched so the new data shows up.
```

In `src/web/lib/use-bulk-status.ts`, replace:

```ts
      void queryClient.invalidateQueries({ queryKey: ['search'] })
```

with:

```ts
      void queryClient.invalidateQueries({ queryKey: ['search'] })
      void queryClient.invalidateQueries({ queryKey: ['collection'] })
      void queryClient.invalidateQueries({ queryKey: ['catalog'] })
```

- [ ] **Step 7: Rebuild the drawer, and make the page behind it inert**

The new drawer keeps M1's image, flip, price table, face text, and legalities. It adds Your copies, Add a copy, Decks, and printing prices with finish labels.

Replace the whole of `src/web/components/CardDrawer.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Fragment, useEffect, useRef, useState } from 'react'
import { listPrice } from '../../shared/prices.ts'
import type { Card, CardDetail, CardFace, Copy, Finish, Ownership, Printing } from '../../shared/types.ts'
import { ApiRequestError, apiGet } from '../lib/api.ts'
import { useCardDrawer } from '../lib/card-drawer.tsx'
import { useAdjustCopies } from '../lib/collection.ts'
import { formatUsd } from '../lib/format.ts'
import { useToast } from '../lib/toast.tsx'
import { ManaText } from './ManaText.tsx'

const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander'] as const

const LEGALITY_STYLE: Record<string, string> = {
  legal: 'border-emerald-800 bg-emerald-900/50 text-emerald-300',
  banned: 'border-rose-900 bg-rose-900/40 text-rose-300',
  restricted: 'border-amber-900 bg-amber-900/40 text-amber-300',
  not_legal: 'border-stone-800 bg-stone-800/60 text-stone-500',
}

/**
 * Slide-over with a printing's details and my copies of the card. Opened from anywhere via useCardDrawer().open(id).
 * The panel mounts on open, so a reopened drawer never flashes the previous card.
 */
export function CardDrawer() {
  const { cardId, open, close } = useCardDrawer()
  if (!cardId) return null
  return <DrawerPanel cardId={cardId} onSelectPrinting={open} onClose={close} />
}

function DrawerPanel({ cardId, onSelectPrinting, onClose }: { cardId: string; onSelectPrinting: (id: string) => void; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null)

  // Focus moves into the drawer when it opens and goes back where it was when it closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Switching printings inside the drawer keeps the current card on screen (dimmed) until the next one loads.
  const { data, error, isPending, isPlaceholderData } = useQuery({
    queryKey: ['card', cardId],
    queryFn: ({ signal }) => apiGet<CardDetail>(`/api/cards/${encodeURIComponent(cardId)}`, signal),
    placeholderData: (previous) => previous,
  })

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Close card details" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/60" />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={data?.card.name ?? 'Card details'}
        aria-busy={isPlaceholderData}
        className="relative flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-stone-800 bg-stone-950 shadow-2xl outline-none"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-800 bg-stone-950/95 px-5 py-3">
          <span className="text-xs tracking-[0.2em] text-stone-500 uppercase">
            Card{isPlaceholderData && <span className="ml-2 tracking-normal normal-case">loading…</span>}
          </span>
          <button onClick={onClose} className="rounded px-2 py-1 text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-100">
            Close ✕
          </button>
        </div>
        {isPending && <div className="p-8 text-stone-400">Loading…</div>}
        {error && (
          <div className="m-5 rounded-lg border border-rose-900 bg-rose-950/50 p-4 text-rose-200">
            {error instanceof ApiRequestError && error.status === 404
              ? "This printing isn't in your local card data yet. Refresh card data in Settings to add it."
              : error.message}
          </div>
        )}
        {data && (
          <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
            <CardDetailView detail={data} onSelectPrinting={onSelectPrinting} />
          </div>
        )}
      </aside>
    </div>
  )
}

function CardDetailView({ detail, onSelectPrinting }: { detail: CardDetail; onSelectPrinting: (id: string) => void }) {
  const { card, printings, copies } = detail
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
        <YourCopies detail={detail} onSelectPrinting={onSelectPrinting} />
        <AddCopy key={card.id} card={card} printings={printings} />
        <DeckList ownership={detail.ownership} />
        <PrintingList printings={printings} copies={copies} currentId={card.id} onSelect={onSelectPrinting} />
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

const FINISH_LABEL: Record<Finish, string> = { nonfoil: 'Nonfoil', foil: 'Foil', etched: 'Etched' }

const sectionHeading = 'mb-2 text-xs tracking-[0.2em] text-stone-500 uppercase'
const stepButton =
  'size-7 rounded-md border border-stone-700 text-stone-200 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40'

/** "Own 3 · 1 free", warning when built decks claim more copies than I own. */
function OwnershipLine({ ownership }: { ownership: Ownership }) {
  const { owned, free } = ownership
  if (owned === 0 && free >= 0) return null
  return (
    <span className={`text-xs normal-case tracking-normal ${free < 0 ? 'text-amber-300' : 'text-stone-400'}`}>
      Own {owned} · {free < 0 ? `built decks use ${owned - free}` : `${free} free`}
    </span>
  )
}

/** Every owned copy of this card, per printing and finish, with steppers (spec §5.2.5 "Your copies"). */
function YourCopies({ detail, onSelectPrinting }: { detail: CardDetail; onSelectPrinting: (id: string) => void }) {
  const adjust = useAdjustCopies()
  const finishesById = new Map(detail.printings.map((p) => [p.id, p.finishes]))
  return (
    <section aria-labelledby="your-copies">
      <h3 id="your-copies" className={`${sectionHeading} flex items-baseline justify-between`}>
        Your copies <OwnershipLine ownership={detail.ownership} />
      </h3>
      {detail.copies.length === 0 ? (
        <p className="text-sm text-stone-500">You don't own this card yet.</p>
      ) : (
        <ul className="divide-y divide-stone-800/80 rounded-lg border border-stone-800">
          {detail.copies.map((copy) => {
            const label = `${copy.setCode.toUpperCase()} #${copy.collectorNumber} ${copy.finish}`
            const canAdd = finishesById.get(copy.cardId)?.includes(copy.finish) ?? false
            return (
              <li key={`${copy.cardId}-${copy.finish}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <button
                  onClick={() => onSelectPrinting(copy.cardId)}
                  className="w-12 shrink-0 text-left font-mono text-xs text-stone-400 uppercase hover:text-amber-300"
                >
                  {copy.setCode}
                </button>
                <span className="min-w-0 flex-1 truncate text-stone-300">
                  {copy.setName} <span className="text-stone-500">#{copy.collectorNumber}</span>
                </span>
                {copy.finish !== 'nonfoil' && <span className="shrink-0 text-xs text-amber-300">{FINISH_LABEL[copy.finish]}</span>}
                <span className="w-16 shrink-0 text-right text-stone-300 tabular-nums">{formatUsd(copy.priceUsd)}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    aria-label={`Remove one ${label}`}
                    onClick={() => adjust.mutate({ cardId: copy.cardId, finish: copy.finish, delta: -1 })}
                    className={stepButton}
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-stone-100 tabular-nums">{copy.quantity}</span>
                  <button
                    aria-label={`Add one ${label}`}
                    disabled={!canAdd}
                    title={canAdd ? undefined : `This printing no longer comes in ${copy.finish}`}
                    onClick={() => adjust.mutate({ cardId: copy.cardId, finish: copy.finish, delta: 1 })}
                    className={stepButton}
                  >
                    +
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function printingLabel(p: Printing): string {
  return `${p.setCode.toUpperCase()} · ${p.setName} #${p.collectorNumber} (${p.releasedAt.slice(0, 4)})`
}

/** Printing picker (starting at the printing on screen) and finish picker (spec §5.2.5 "Add a copy"). */
function AddCopy({ card, printings }: { card: Card; printings: Printing[] }) {
  const [printingId, setPrintingId] = useState(card.id)
  const printing = printings.find((p) => p.id === printingId) ?? printings[0]
  const finishes = printing?.finishes ?? []
  const [finish, setFinish] = useState<Finish>(finishes[0] ?? 'nonfoil')
  const chosenFinish = finishes.includes(finish) ? finish : (finishes[0] ?? 'nonfoil')
  const adjust = useAdjustCopies()
  const toast = useToast()
  if (!printing) return null

  function add() {
    if (!printing) return
    const what = `${card.name} (${printing.setCode.toUpperCase()} #${printing.collectorNumber}${chosenFinish === 'nonfoil' ? '' : `, ${chosenFinish}`})`
    adjust.mutate(
      { cardId: printing.id, finish: chosenFinish, delta: 1 },
      { onSuccess: (result) => toast.success(`Added ${what}. You have ${result.quantity}.`) },
    )
  }

  return (
    <section aria-labelledby="add-copy">
      <h3 id="add-copy" className={sectionHeading}>
        Add a copy
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Printing"
          value={printing.id}
          onChange={(e) => setPrintingId(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-100"
        >
          {printings.map((p) => (
            <option key={p.id} value={p.id}>
              {printingLabel(p)}
            </option>
          ))}
        </select>
        <select
          aria-label="Finish"
          value={chosenFinish}
          onChange={(e) => setFinish(e.target.value as Finish)}
          className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-100"
        >
          {finishes.map((f) => (
            <option key={f} value={f}>
              {FINISH_LABEL[f]}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={adjust.isPending}
          className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  )
}

/** Decks that include this card, with status and copies (spec §5.2.5 "Decks"). */
function DeckList({ ownership }: { ownership: Ownership }) {
  return (
    <section aria-labelledby="card-decks">
      <h3 id="card-decks" className={sectionHeading}>
        Decks
      </h3>
      {ownership.decks.length === 0 ? (
        <p className="text-sm text-stone-500">Not in any deck.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {ownership.decks.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <span className="text-stone-200">{d.name}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] ${d.status === 'built' ? 'bg-emerald-900/60 text-emerald-200' : 'bg-stone-800 text-stone-300'}`}
              >
                {d.status}
              </span>
              <span className="text-stone-500 tabular-nums">×{d.quantity}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PrintingPrice({ printing }: { printing: Printing }) {
  const price = listPrice(printing.prices, printing.finishes)
  if (!price) return <>—</>
  return (
    <>
      {formatUsd(price.usd)}
      {price.finish !== 'nonfoil' && <span className="ml-1 text-[10px] text-amber-300/80">{price.finish}</span>}
    </>
  )
}

function PrintingList({
  printings,
  copies,
  currentId,
  onSelect,
}: {
  printings: Printing[]
  copies: Copy[]
  currentId: string
  onSelect: (id: string) => void
}) {
  const owned = new Map<string, number>()
  for (const copy of copies) owned.set(copy.cardId, (owned.get(copy.cardId) ?? 0) + copy.quantity)
  return (
    <div>
      <h3 className={sectionHeading}>Printings ({printings.length})</h3>
      <ul className="max-h-72 divide-y divide-stone-800/80 overflow-y-auto rounded-lg border border-stone-800">
        {printings.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p.id)}
              aria-current={p.id === currentId ? 'true' : undefined}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-stone-900 ${p.id === currentId ? 'bg-stone-900 text-amber-300' : 'text-stone-300'}`}
            >
              <span className="w-12 shrink-0 font-mono text-xs text-stone-500 uppercase">{p.setCode}</span>
              <span className="min-w-0 flex-1 truncate">
                {p.setName} <span className="text-stone-500">#{p.collectorNumber}</span>
              </span>
              {owned.has(p.id) && <span className="shrink-0 rounded bg-emerald-900/60 px-1.5 text-[11px] text-emerald-200">×{owned.get(p.id)}</span>}
              <span className="shrink-0 text-xs text-stone-500">{p.releasedAt.slice(0, 4)}</span>
              <span className="w-20 shrink-0 text-right tabular-nums">
                <PrintingPrice printing={p} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

In `src/web/components/Layout.tsx`, replace:

```tsx
import { NavLink, Outlet } from 'react-router'
```

with:

```tsx
import { NavLink, Outlet } from 'react-router'
import { useCardDrawer } from '../lib/card-drawer.tsx'
```

In `src/web/components/Layout.tsx`, replace:

```tsx
  useBulkStatus() // keeps lookups and searches fresh after a card-data refresh, whichever page is open
  return (
    <div className="min-h-dvh bg-stone-950 text-stone-200">
      <header className="sticky top-0 z-20 border-b border-stone-800/80 bg-stone-950/90 backdrop-blur">
```

with:

```tsx
  useBulkStatus() // keeps lookups and searches fresh after a card-data refresh, whichever page is open
  // While the card drawer is open, the page behind it can't be focused or clicked, so Tab stays in the drawer.
  const drawerOpen = useCardDrawer().cardId !== null
  return (
    <div className="min-h-dvh bg-stone-950 text-stone-200">
      <header inert={drawerOpen} className="sticky top-0 z-20 border-b border-stone-800/80 bg-stone-950/90 backdrop-blur">
```

In `src/web/components/Layout.tsx`, replace:

```tsx
      <main className="mx-auto max-w-7xl px-4 py-8">
```

with:

```tsx
      <main inert={drawerOpen} className="mx-auto max-w-7xl px-4 py-8">
```

In `src/web/components/ManaText.tsx`, replace:

```tsx
    parts.push(<ManaSymbol key={match.index} symbol={match[1] ?? ''} />)
```

with:

```tsx
    // Keyed by position and symbol, so a failed-image fallback never carries over to a different symbol.
    parts.push(<ManaSymbol key={`${match.index}:${match[1]}`} symbol={match[1] ?? ''} />)
```

- [ ] **Step 8: Make the finder an accessible combobox**

Replace the whole of `src/web/components/QuickFind.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CardSummary } from '../../shared/types.ts'
import { apiGet } from '../lib/api.ts'
import { useCardDrawer } from '../lib/card-drawer.tsx'
import { useDebounced } from '../lib/use-debounced.ts'
import { ManaText } from './ManaText.tsx'

/**
 * Card-name lookup, as an ARIA combobox. Arrow keys move, Enter opens the card drawer, Escape closes the list.
 * The header instance (size "md") also focuses when "/" is pressed outside a text field while the drawer is closed.
 * `autoFocus` focuses the field on mount unless something else on the page already has focus.
 */
export function QuickFind({ size = 'md', autoFocus = false }: { size?: 'md' | 'lg'; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(0)
  const query = useDebounced(text.trim(), 120)
  const drawer = useCardDrawer()
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const { data, error, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['autocomplete', query],
    queryFn: ({ signal }) => apiGet<CardSummary[]>(`/api/cards/autocomplete?q=${encodeURIComponent(query)}&limit=12`, signal),
    enabled: query.length > 0,
    placeholderData: (previous) => previous,
  })
  const results = query.length > 0 ? (data ?? []) : []
  // Keyboard selection only acts on results for exactly what's typed: not while the debounce or a fetch is pending
  // (the list still shows the previous query's results), and not when the list shows an error instead.
  const selectable = text.trim() === query && !isPlaceholderData && !error
  // The results are final for what's typed, so "No matches" is true (not a flash between keystrokes).
  const settled = selectable && !isFetching
  const drawerOpen = drawer.cardId !== null

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    // Claim focus only if the user isn't already somewhere else (e.g. typing in the header search).
    if (autoFocus && (document.activeElement === null || document.activeElement === document.body)) inputRef.current?.focus()
  }, []) // mount only: a later render must never pull focus back

  useEffect(() => {
    if (size !== 'md' || drawerOpen) return
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
  }, [size, drawerOpen])

  function choose(card: CardSummary) {
    drawer.open(card.cardId)
    setListOpen(false)
    inputRef.current?.blur()
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setListOpen(true)
      if (selectable && results.length > 0) setActive((i) => Math.max(0, Math.min(i + 1, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (selectable && results.length > 0) setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const card = selectable ? results[active] : undefined
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
  const showList = listOpen && query.length > 0 && (results.length > 0 || error !== null || settled)
  const optionId = (i: number) => `${listId}-option-${i}`
  const activeId = showList && !error && results[active] ? optionId(active) : undefined
  const announcement =
    query.length === 0 ? '' : error ? error.message : settled ? (results.length === 0 ? 'No matches' : `${results.length} matches`) : ''

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setListOpen(true)
        }}
        onFocus={() => setListOpen(true)}
        onBlur={() => setListOpen(false)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-label={size === 'lg' ? 'Look up any card' : 'Find a card'}
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={activeId}
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
          {error ? (
            <li role="presentation" className="px-3 py-2 text-sm text-rose-300">
              {error.message}
            </li>
          ) : results.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-sm text-stone-500">
              No matches
            </li>
          ) : (
            results.map((card, i) => (
              <li
                key={card.oracleId}
                id={optionId(i)}
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
            ))
          )}
        </ul>
      )}
      <span aria-live="polite" className="sr-only">
        {listOpen ? announcement : ''}
      </span>
    </div>
  )
}
```

- [ ] **Step 9: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: no type errors, all tests pass (412 tests), the build succeeds.

---

### Task 6: Library page: stats, CSV import and export, locked search

Spec §5.2 says "/library is the same page locked to My library with a stats header", and §5.3 covers the stats,
import preview, and export. The Search page's body becomes `SearchView`, which both pages render. The import panel
reads a chosen file (or pasted text) in the browser and previews it. It lists rows that weren't found, then rows
with a guessed printing, then matched rows (the first 200 of each). A checkbox (on by default) includes the guessed
rows. **Add N copies** then commits in one go. Export is a plain download link.

**Files:**
- Create: `src/web/lib/import-items.ts`, `src/web/components/library/ImportPanel.tsx`, `src/web/pages/LibraryPage.tsx`
- Modify: `src/web/lib/search-state.ts` (locked scope), `src/web/pages/SearchPage.tsx` (replace: `SearchView`),
  `src/web/components/search/SearchBar.tsx`, `src/web/components/search/SearchResults.tsx`, `src/web/routes.tsx`,
  `src/web/components/Layout.tsx` (Library nav entry)
- Test: `tests/web/search-state.test.ts`, `tests/web/import-items.test.ts` (new)

**Interfaces:**
- Consumes: `GET /api/collection/stats`, `POST /api/collection/import/preview` and `/import`, `GET
  /api/collection/export.csv` (Tasks 3–4); `invalidateCollection`, `useToast`, `plural`, `formatUsd` (Task 5).
- Produces:
  - Route `/library`, and a Library entry in `NAV`.
  - `readSearchState(params, locked?)` and `writeSearchState(state, locked?)`. A locked scope ignores the URL's
    scope and never writes it.
  - `SearchView({ locked? })`, exported from `src/web/pages/SearchPage.tsx`.
  - `importItems(preview, includeAmbiguous)` → `{ items, copies }`.

- [ ] **Step 1: Write the failing tests**

In `tests/web/search-state.test.ts`, replace:

```ts
describe('searchApiUrl and canSearch', () => {
```

with:

```ts
describe('a locked scope (the Library page)', () => {
  it('reads the locked scope whatever the URL says, and leaves it out of the URL', () => {
    const state = readSearchState(new URLSearchParams('scope=all&sort=added&q=bolt'), 'library')
    expect(state).toMatchObject({ scope: 'library', sort: 'added', q: 'bolt' })
    expect(writeSearchState(state, 'library').toString()).toBe('q=bolt&sort=added')
    expect(readSearchState(writeSearchState(state, 'library'), 'library')).toEqual(state)
  })
})

describe('searchApiUrl and canSearch', () => {
```

Create `tests/web/import-items.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ImportPreview, ImportRow } from '../../src/shared/types.ts'
import { importItems } from '../../src/web/lib/import-items.ts'

function row(status: ImportRow['status'], id: string | null, quantity: number): ImportRow {
  return {
    line: 2,
    status,
    input: { name: 'x', set: '', collectorNumber: '' },
    quantity,
    finish: 'foil',
    card: id ? { id, name: 'x', setCode: 's', setName: 'S', collectorNumber: '1' } : null,
    note: null,
  }
}

const preview: ImportPreview = {
  rows: [row('resolved', 'a', 2), row('ambiguous', 'b', 3), row('unresolved', null, 1), row('resolved', 'a', 1)],
  counts: { resolved: 2, ambiguous: 1, unresolved: 1 },
}

describe('importItems', () => {
  it('adds resolved rows and, when asked, ambiguous ones; never unresolved ones', () => {
    expect(importItems(preview, true)).toEqual({
      items: [
        { cardId: 'a', finish: 'foil', quantity: 2 },
        { cardId: 'b', finish: 'foil', quantity: 3 },
        { cardId: 'a', finish: 'foil', quantity: 1 },
      ],
      copies: 6,
    })
    expect(importItems(preview, false).copies).toBe(3)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/web/search-state.test.ts tests/web/import-items.test.ts`
Expected: FAIL. `import-items.ts` does not exist, and the locked-scope test reads scope `all`.

- [ ] **Step 3: Lock the scope in search state, and add the import selection helper**

In `src/web/lib/search-state.ts`, replace:

```ts
/** Reads search state from the page URL, ignoring anything invalid. `added` sorting exists only in My library. */
export function readSearchState(params: URLSearchParams): SearchState {
  const scope = pick(params.get('scope'), SCOPES, DEFAULT_SEARCH.scope)
```

with:

```ts
/**
 * Reads search state from the page URL, ignoring anything invalid. `added` sorting exists only in My library.
 * `locked` fixes the scope (the Library page), whatever the URL says.
 */
export function readSearchState(params: URLSearchParams, locked?: SearchScope): SearchState {
  const scope = locked ?? pick(params.get('scope'), SCOPES, DEFAULT_SEARCH.scope)
```

In `src/web/lib/search-state.ts`, replace:

```ts
/** Writes search state to URL params, leaving out defaults so links stay short. */
export function writeSearchState(state: SearchState): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of Object.keys(DEFAULT_SEARCH) as Array<keyof SearchState>) {
    if (state[key] !== DEFAULT_SEARCH[key]) params.set(key, String(state[key]))
  }
  return params
}

```

with:

```ts
/** Writes search state to URL params, leaving out defaults (and a locked scope) so links stay short. */
export function writeSearchState(state: SearchState, locked?: SearchScope): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of Object.keys(DEFAULT_SEARCH) as Array<keyof SearchState>) {
    if (key === 'scope' && locked) continue
    if (state[key] !== DEFAULT_SEARCH[key]) params.set(key, String(state[key]))
  }
  return params
}

```

Create `src/web/lib/import-items.ts`:

```ts
import type { ImportItem, ImportPreview } from '../../shared/types.ts'

/** What an import will add: resolved rows, plus ambiguous ones (a guessed printing) when included. */
export function importItems(preview: ImportPreview, includeAmbiguous: boolean): { items: ImportItem[]; copies: number } {
  const items: ImportItem[] = []
  let copies = 0
  for (const row of preview.rows) {
    if (!row.card || row.status === 'unresolved' || (row.status === 'ambiguous' && !includeAmbiguous)) continue
    items.push({ cardId: row.card.id, finish: row.finish, quantity: row.quantity })
    copies += row.quantity
  }
  return { items, copies }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/web/search-state.test.ts tests/web/import-items.test.ts`
Expected: PASS.

- [ ] **Step 5: Split the search UI out of the Search page**

Replace the whole of `src/web/pages/SearchPage.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import type { SearchPage as ResultPage } from '../../shared/types.ts'
import { SearchBar } from '../components/search/SearchBar.tsx'
import { SearchResults } from '../components/search/SearchResults.tsx'
import { ApiRequestError, apiGet } from '../lib/api.ts'
import { canSearch, readSearchState, searchApiUrl, writeSearchState, type SearchScope, type SearchState } from '../lib/search-state.ts'

/** Search all cards (Scryfall), my library, or — when Scryfall is unreachable — the local card data (spec §5.2). */
export function SearchPage() {
  return (
    <div className="space-y-5">
      <h1 className="font-serif text-3xl font-semibold text-stone-50">Search</h1>
      <SearchView />
    </div>
  )
}

/** The search bar and results, with state in the page URL. `locked` pins the scope and hides the scope switch. */
export function SearchView({ locked }: { locked?: SearchScope }) {
  const [params, setParams] = useSearchParams()
  const state = readSearchState(params, locked)
  const url = searchApiUrl(state)
  const enabled = canSearch(state)
  const { data, error, isFetching } = useQuery({
    queryKey: ['search', url],
    queryFn: ({ signal }) => apiGet<ResultPage>(url, signal),
    enabled,
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    // Retry once only when our own server couldn't be reached; an ApiRequestError is a deliberate answer
    // (a query mistake, Scryfall offline or busy) that retrying can't change.
    retry: (count, err) => !(err instanceof ApiRequestError) && count < 1,
  })

  /** Changes the search; any change except paging (or an explicit page) goes back to page 1. */
  const update = (patch: Partial<SearchState>) => setParams(writeSearchState({ ...state, page: 1, ...patch }, locked))
  const apiError = error instanceof ApiRequestError ? error : null
  const queryError = apiError?.code === 'bad_query' || apiError?.code === 'empty_query' ? apiError : null
  const offline = apiError?.code === 'scryfall_offline'

  return (
    <div className="space-y-5">
      <SearchBar
        q={state.q}
        scope={state.scope}
        scopeLocked={locked !== undefined}
        queryError={queryError}
        onSearch={(q) => update({ q })}
        onScopeChange={(scope, q) => update({ scope, q })}
      />

      {offline && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          <span className="flex-1">{apiError.message}</span>
          <button
            onClick={() => update({ scope: 'local' })}
            className="rounded-md bg-amber-500 px-3 py-1.5 font-medium text-stone-950 hover:bg-amber-400"
          >
            Search local card data instead
          </button>
        </div>
      )}
      {error && !queryError && !offline && (
        <div role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error.message}
        </div>
      )}
      {data && data.warnings.length > 0 && (
        <ul className="rounded-lg border border-stone-800 bg-stone-900/50 px-4 py-2 text-xs text-stone-400">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {!enabled ? (
        <p className="py-16 text-center text-stone-500">
          Search every card with Scryfall syntax, or switch to My library to search what you own.
        </p>
      ) : data && !queryError ? (
        <SearchResults page={data} state={state} fetching={isFetching} onChange={update} />
      ) : isFetching ? (
        <p className="py-16 text-center text-stone-500">Searching…</p>
      ) : null}
    </div>
  )
}
```

In `src/web/components/search/SearchBar.tsx`, replace:

```tsx
  scope: SearchScope
  /** A query mistake reported by the server for `q`. */
```

with:

```tsx
  scope: SearchScope
  /** Hide the scope switch (the Library page always searches My library). */
  scopeLocked?: boolean
  /** A query mistake reported by the server for `q`. */
```

In `src/web/components/search/SearchBar.tsx`, replace:

```tsx
export function SearchBar({ q, scope, queryError, onSearch, onScopeChange }: Props) {
```

with:

```tsx
export function SearchBar({ q, scope, scopeLocked = false, queryError, onSearch, onScopeChange }: Props) {
```

In `src/web/components/search/SearchBar.tsx`, replace:

```tsx
        <div className="flex rounded-lg border border-stone-800 bg-stone-900/60 p-0.5" role="radiogroup" aria-label="Search in">
          {scopes.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              onClick={() => changeScope(value)}
              className={`rounded-md px-3 py-1.5 text-sm ${scope === value ? 'bg-amber-500 font-medium text-stone-950' : 'text-stone-400 hover:text-stone-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
```

with:

```tsx
        {!scopeLocked && (
          <div className="flex rounded-lg border border-stone-800 bg-stone-900/60 p-0.5" role="radiogroup" aria-label="Search in">
            {scopes.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                onClick={() => changeScope(value)}
                className={`rounded-md px-3 py-1.5 text-sm ${scope === value ? 'bg-amber-500 font-medium text-stone-950' : 'text-stone-400 hover:text-stone-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
```

In `src/web/components/search/SearchResults.tsx`, replace:

```tsx
          {library && state.q.trim() === '' ? 'Your library is empty. Cards you add will show up here.' : 'No cards match.'}
```

with:

```tsx
          {library && state.q.trim() === ''
            ? 'Your library is empty. Import a CSV on the Library page, or open any card and use Add a copy.'
            : 'No cards match.'}
```

- [ ] **Step 6: Add the Library page and its import panel**

Create `src/web/components/library/ImportPanel.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ImportPreview, ImportResult, ImportRow } from '../../../shared/types.ts'
import { apiPost } from '../../lib/api.ts'
import { invalidateCollection } from '../../lib/collection.ts'
import { plural } from '../../lib/format.ts'
import { importItems } from '../../lib/import-items.ts'
import { useToast } from '../../lib/toast.tsx'

/** Rows listed per group; the rest are counted. */
const SHOWN_ROWS = 200

/** CSV import (spec §5.3): choose or paste a file, preview how its rows resolve, then add them to the library. */
export function ImportPanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [includeAmbiguous, setIncludeAmbiguous] = useState(true)
  const queryClient = useQueryClient()
  const toast = useToast()

  const preview = useMutation({
    mutationFn: (csv: string) => apiPost<ImportPreview>('/api/collection/import/preview', { csv }),
  })
  const commit = useMutation({
    mutationFn: (items: ReturnType<typeof importItems>['items']) => apiPost<ImportResult>('/api/collection/import', { items }),
    onSuccess: (result) => {
      invalidateCollection(queryClient)
      toast.success(`Added ${plural(result.copies, 'copy', 'copies')} to your library.`)
      onClose()
    },
    onError: (err) => toast.error(`Import failed; nothing was added. ${err.message}`),
  })

  async function chooseFile(file: File | undefined) {
    if (!file) return
    const content = await file.text()
    setFileName(file.name)
    setText(content)
    preview.mutate(content)
  }

  const result = preview.data
  const selection = result ? importItems(result, includeAmbiguous) : null
  const groups = result ? groupRows(result.rows) : null

  return (
    <section aria-labelledby="import-heading" className="space-y-4 rounded-xl border border-stone-800 bg-stone-900/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="import-heading" className="text-lg font-semibold text-stone-100">
            Import a CSV
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-stone-400">
            Adds the file's cards to your library; it doesn't replace what's already there. Works with exports from
            Moxfield, Deckbox, ManaBox, Archidekt, TCGplayer, and Dragon Shield, or any CSV with Count and Name columns
            (add Edition and Collector Number to pin the printing).
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 rounded px-2 py-1 text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-100">
          Close ✕
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <label className="cursor-pointer rounded-md border border-stone-700 px-3 py-2 text-sm text-stone-200 focus-within:ring-2 focus-within:ring-amber-500/40 hover:bg-stone-800">
          {fileName ? `File: ${fileName}` : 'Choose a file…'}
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            onChange={(e) => void chooseFile(e.target.files?.[0])}
          />
        </label>
        <textarea
          aria-label="Or paste CSV text"
          placeholder={'…or paste CSV text here, e.g.\nCount,Name,Edition,Collector Number,Foil\n4,Lightning Bolt,m10,146,'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setFileName(null)
          }}
          rows={4}
          className="min-w-72 flex-1 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-xs text-stone-100 placeholder:text-stone-600"
        />
        <button
          onClick={() => preview.mutate(text)}
          disabled={text.trim() === '' || preview.isPending}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {preview.isPending ? 'Reading…' : 'Preview'}
        </button>
      </div>

      {preview.error && (
        <div role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {preview.error.message}
        </div>
      )}

      {result && groups && selection && (
        <div className="space-y-3">
          <p className="text-sm text-stone-300" aria-live="polite">
            {plural(result.rows.length, 'row')}: {result.counts.resolved.toLocaleString()} matched,{' '}
            {result.counts.ambiguous.toLocaleString()} with a guessed printing, {result.counts.unresolved.toLocaleString()} not found.
          </p>
          <RowGroup title="Not found (won't be added)" rows={groups.unresolved} open />
          <RowGroup title="Printing guessed" rows={groups.ambiguous} open={groups.unresolved.length === 0} />
          <RowGroup title="Matched" rows={groups.resolved} />
          {result.counts.ambiguous > 0 && (
            <label className="flex items-center gap-2 text-sm text-stone-300">
              <input type="checkbox" checked={includeAmbiguous} onChange={(e) => setIncludeAmbiguous(e.target.checked)} />
              Also add the {plural(result.counts.ambiguous, 'row')} with a guessed printing
            </label>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => commit.mutate(selection.items)}
              disabled={selection.items.length === 0 || commit.isPending}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {commit.isPending ? 'Adding…' : `Add ${plural(selection.copies, 'copy', 'copies')}`}
            </button>
            <button onClick={onClose} className="rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-300 hover:bg-stone-800">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function groupRows(rows: ImportRow[]): Record<ImportRow['status'], ImportRow[]> {
  const groups: Record<ImportRow['status'], ImportRow[]> = { resolved: [], ambiguous: [], unresolved: [] }
  for (const row of rows) groups[row.status].push(row)
  return groups
}

function RowGroup({ title, rows, open = false }: { title: string; rows: ImportRow[]; open?: boolean }) {
  if (rows.length === 0) return null
  return (
    <details open={open} className="rounded-lg border border-stone-800">
      <summary className="cursor-pointer px-3 py-2 text-sm text-stone-200">
        {title} ({rows.length.toLocaleString()})
      </summary>
      <div className="max-h-80 overflow-auto border-t border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-stone-900 text-stone-400">
            <tr>
              <th className="px-3 py-1.5 font-medium">Line</th>
              <th className="px-3 py-1.5 font-medium">In the file</th>
              <th className="px-3 py-1.5 font-medium">Adds</th>
              <th className="px-3 py-1.5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/70 text-stone-300">
            {rows.slice(0, SHOWN_ROWS).map((row) => (
              <tr key={row.line}>
                <td className="px-3 py-1.5 text-stone-500 tabular-nums">{row.line}</td>
                <td className="px-3 py-1.5">
                  {row.input.name || '—'}
                  {(row.input.set || row.input.collectorNumber) && (
                    <span className="text-stone-500">
                      {' '}
                      {row.input.set} {row.input.collectorNumber && `#${row.input.collectorNumber}`}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {row.card ? (
                    <>
                      {row.quantity}× {row.card.name}{' '}
                      <span className="text-stone-500 uppercase">
                        {row.card.setCode} #{row.card.collectorNumber}
                      </span>
                      {row.finish !== 'nonfoil' && <span className="ml-1 text-amber-300">{row.finish}</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-1.5 text-stone-400">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > SHOWN_ROWS && (
          <p className="px-3 py-2 text-xs text-stone-500">…and {(rows.length - SHOWN_ROWS).toLocaleString()} more</p>
        )}
      </div>
    </details>
  )
}
```

Create `src/web/pages/LibraryPage.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { CollectionStats } from '../../shared/types.ts'
import { ImportPanel } from '../components/library/ImportPanel.tsx'
import { apiGet } from '../lib/api.ts'
import { formatDate, formatUsd } from '../lib/format.ts'
import { SearchView } from './SearchPage.tsx'

/** My library: totals, CSV import and export, and search locked to the collection (spec §5.2, §5.3). */
export function LibraryPage() {
  const [importing, setImporting] = useState(false)
  const stats = useQuery({
    queryKey: ['collection', 'stats'],
    queryFn: ({ signal }) => apiGet<CollectionStats>('/api/collection/stats', signal),
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-serif text-3xl font-semibold text-stone-50">Library</h1>
          {stats.data ? (
            <StatsLine stats={stats.data} />
          ) : stats.error ? (
            <p className="text-sm text-rose-300">Couldn't load library totals: {stats.error.message}</p>
          ) : (
            <p className="text-sm text-stone-500">…</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setImporting(true)}
            disabled={importing}
            className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-800 disabled:opacity-50"
          >
            Import CSV
          </button>
          <a
            href="/api/collection/export.csv"
            download
            className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-800"
          >
            Export CSV
          </a>
        </div>
      </div>
      {importing && <ImportPanel onClose={() => setImporting(false)} />}
      <SearchView locked="library" />
    </div>
  )
}

function StatsLine({ stats }: { stats: CollectionStats }) {
  const items: Array<[string, string]> = [
    ['Cards', stats.totalCards.toLocaleString()],
    ['Unique', stats.uniqueCards.toLocaleString()],
    ['Value', formatUsd(stats.valueUsd)],
    ['Last added', stats.lastAddedAt ? formatDate(stats.lastAddedAt) : 'never'],
  ]
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex gap-1.5">
          <dt className="text-stone-500">{label}</dt>
          <dd className="text-stone-100 tabular-nums">
            {value}
            {label === 'Value' && stats.unpricedCards > 0 && (
              <span className="ml-1 text-xs text-stone-500">({stats.unpricedCards.toLocaleString()} without a price)</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
```

In `src/web/routes.tsx`, replace:

```tsx
import { HomePage } from './pages/HomePage.tsx'
```

with:

```tsx
import { HomePage } from './pages/HomePage.tsx'
import { LibraryPage } from './pages/LibraryPage.tsx'
```

In `src/web/routes.tsx`, replace:

```tsx
      { path: 'search', element: <SearchPage /> },
```

with:

```tsx
      { path: 'search', element: <SearchPage /> },
      { path: 'library', element: <LibraryPage /> },
```

In `src/web/components/Layout.tsx`, replace:

```tsx
  { to: '/search', label: 'Search', end: false },
```

with:

```tsx
  { to: '/search', label: 'Search', end: false },
  { to: '/library', label: 'Library', end: false },
```

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: no type errors, all tests pass (414 tests), the build succeeds.

---

### Task 7: End-to-end check on real card data, and docs

This task runs the upgrade path on a copy of the owner's real data (migration 002, then a one-time refresh that fills
in set types), imports a 20,000-row CSV, times library search, and drives the new UI in headless Chrome. Google
Chrome is installed at `/Applications/Google Chrome.app`. The UI driver uses Node 24's built-in `WebSocket` and the
Chrome DevTools Protocol, so it needs no new dependencies. Stop every process you start.

**Files:**
- Modify: `README.md` (a Your library section), `docs/plans/m1-followups.md` and `docs/plans/m2-followups.md` (mark
  the M3 items done)
- Scratch (outside the project, deleted at the end): `/tmp/binder-m3-e2e/` with `cdp.ts`, `ui-check.ts`, and
  `import-csv.ts`

**Interfaces:**
- Consumes: everything above; the real `data/binder.db` and `data/bulk/default-cards.jsonl.gz`, read only and copied.
  Never write to `data/`.
- Produces: timings and results recorded in the task report; updated docs.

- [ ] **Step 1: Copy the real data**

```bash
E2E=/tmp/binder-m3-e2e
rm -rf $E2E && mkdir -p $E2E/data/bulk $E2E/shots
sqlite3 -readonly data/binder.db ".backup $E2E/data/binder.db"
cp data/bulk/default-cards.jsonl.gz $E2E/data/bulk/
```
Never write to `data/binder.db` or anything else under `data/`.

- [ ] **Step 2: Build, start the server on the copy, and let the upgrade refresh finish**

```bash
pnpm build
BINDER_DATA_DIR=$E2E/data PORT=4400 node src/server/main.ts > $E2E/server.log 2>&1 &
echo $! > $E2E/server.pid
```
Poll `curl -s http://127.0.0.1:4400/api/bulk/status` every few seconds until `state` is `idle` (or `error`). Allow up
to 5 minutes: a download of about 80 MB plus an import of about 100,000 printings.

Expected `$E2E/server.log`, in order:
- `[card data] Rebuilt the card name index for this version` (the copy's name index predates rule v3)
- `Binder running at http://localhost:4400`
- `[card data] Missing, older than 7 days, or from an older Binder version; refreshing in the background`
- `[card data] Scryfall has no newer card data; re-importing the downloaded file`, only if Scryfall hasn't
  published newer data since the owner's last import. Otherwise the file is downloaded again, and nothing is logged
  for that.
- `[card data] Imported 10x,xxx printings`

Then run
`sqlite3 $E2E/data/binder.db "SELECT key, value FROM meta WHERE key IN ('card_data_version', 'card_names_version') ORDER BY key; SELECT count(*) FROM cards WHERE set_type = '';"`.
Expected: `card_data_version|2`, `card_names_version|3`, `0`.

- [ ] **Step 3: Check default printings**

For each of `lightning bolt`, `sol ring`, `command tower`, `counterspell`, `birds of paradise`, and `forest`, get the
first result of `/api/cards/autocomplete?q=<name>&limit=1`. Then get `/api/cards/<cardId>` and record `card.setCode`,
`card.setName`, and `card.releasedAt`.

Expected:
- None of them is from `sld`, `slz`, `plst`, `sta`, `mul`, `30a`, `unk`, or any other special product.
- No `releasedAt` is after today.
- Prototype results, for reference: Lightning Bolt, Sol Ring, Command Tower, and Birds of Paradise → `msc`;
  Counterspell → `dsc`; Forest → `hob`. M2 had `slz` for four of these.

- [ ] **Step 4: Import a 20,000-row CSV and time it**

Create `$E2E/import-csv.ts`:

```ts
// Previews and imports a CSV through the API, printing counts and timings. Usage: node import-csv.ts <file.csv>
import fs from 'node:fs'

const B = 'http://127.0.0.1:4400'
const csv = fs.readFileSync(process.argv[2]!, 'utf8')
const post = async (path: string, body: unknown) => {
  const started = performance.now()
  const res = await fetch(`${B}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`)
  return { json, seconds: (performance.now() - started) / 1000 }
}
type Row = { status: string; card: { id: string } | null; finish: string; quantity: number; note: string | null }
const preview = await post('/api/collection/import/preview', { csv })
const rows = preview.json.rows as Row[]
console.log(`preview: ${rows.length} rows in ${preview.seconds.toFixed(2)} s`, preview.json.counts)
const notes = new Map<string, number>()
for (const r of rows) if (r.note) notes.set(r.note.replace(/"[^"]*"|#\S+|\d+ printings in [^;]+/g, '…'), (notes.get(r.note.replace(/"[^"]*"|#\S+|\d+ printings in [^;]+/g, '…')) ?? 0) + 1)
console.log('notes:', [...notes].sort((a, b) => b[1] - a[1]).slice(0, 8))
const items = rows.flatMap((r) => (r.card ? [{ cardId: r.card.id, finish: r.finish, quantity: r.quantity }] : []))
const commit = await post('/api/collection/import', { items })
console.log(`import: ${JSON.stringify(commit.json)} in ${commit.seconds.toFixed(2)} s`)
```

Then:
```bash
sqlite3 -csv -header $E2E/data/binder.db "SELECT 1 + abs(random()) % 4 AS Count, name AS Name, set_code AS Edition, collector_number AS 'Collector Number', CASE WHEN finishes LIKE '%\"foil\"%' AND abs(random()) % 5 = 0 THEN 'foil' ELSE '' END AS Foil FROM cards ORDER BY random() LIMIT 20000" > $E2E/collection.csv
node $E2E/import-csv.ts $E2E/collection.csv
```

Expected:
- preview: 20000 rows, all `resolved` (every row names its exact set and number).
- about 2,000 notes, all "This printing has no nonfoil version; adding foil" (or "adding etched"): foil-only
  printings the generated file asks for as nonfoil.
- preview under 3 s; import under 1 s. Prototype: 0.24 s and 0.13 s.
- the import reports 20000 rows and about 50,000 copies.

- [ ] **Step 5: Time the library endpoints**

Time each request with `curl -s -o /dev/null -w '%{http_code} %{time_total}\n'`:
- `/api/search/library?view=cards&q=` and `view=printings`
- the same two views for `q=t%3Acreature`, `q=free%3C0`, `q=qty%3E%3D3`, `q=bolt`, and `q=c%3Ag%20mv%3C%3D3`
- `/api/collection/stats`
- `/api/collection/export.csv`

Expected: every one returns 200 **in under 0.15 s**, the spec's target (prototype: 12–80 ms). The export's first line
is `Count,Name,Edition,Collector Number,Foil`, and it has one more line than `SELECT count(*) FROM collection`.
Record all times in the report.

- [ ] **Step 6: Drive the UI in headless Chrome**

Create `$E2E/cdp.ts`:

```ts
// Minimal Chrome DevTools Protocol driver (Node 24 global WebSocket, no dependencies).
import fs from 'node:fs'

export interface Page {
  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>
  eval<T = any>(expression: string): Promise<T>
  waitFor(expression: string, timeoutMs?: number): Promise<any>
  goto(url: string): Promise<void>
  click(selector: string): Promise<void>
  type(text: string): Promise<void>
  key(key: string, code?: string, keyCode?: number): Promise<void>
  shot(file: string): Promise<void>
  close(): Promise<void>
}

export async function openPage(port = 9333): Promise<Page> {
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string; id: string }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let nextId = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${msg.error.message}`))
      else p.resolve(msg.result)
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false })
  const page: Page = {
    send,
    eval: evaluate,
    async waitFor(expression, timeoutMs = 8000) {
      const start = Date.now()
      for (;;) {
        const v = await evaluate(`!!(${expression})`).catch(() => undefined)
        if (v) return v
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${expression}`)
        await new Promise((r) => setTimeout(r, 100))
      }
    },
    async goto(url) {
      await send('Page.navigate', { url })
      await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('#root > *')`)
    },
    async click(selector) {
      const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2} })()`)
      if (!box) throw new Error(`no element ${selector}`)
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
      }
    },
    async type(text) {
      await send('Input.insertText', { text })
    },
    async key(key, code = key, keyCode = 0) {
      if (key === 'Enter') await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: 13, text: '\r' })
      else await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode })
      if (key.length === 1) await send('Input.dispatchKeyEvent', { type: 'char', text: key, key })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
    },
    async shot(file) {
      const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
    },
    async close() {
      ws.close()
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`)
    },
  }
  return page
}
```

Create `$E2E/ui-check.ts`:

```ts
// Drives the built app in headless Chrome (started with --remote-debugging-port=9333) and checks the M3 flows.
// Usage: node ui-check.ts <screenshot dir>. Needs a library with at least one card. Throws on the first failed check.
import assert from 'node:assert/strict'
import { openPage } from './cdp.ts'

const SHOTS = process.argv[2] ?? '.'
const B = 'http://localhost:4400'
const page = await openPage()
const copies = () => page.eval(`[...document.querySelectorAll('[aria-labelledby=your-copies] li')].map((li) => li.textContent)`)
const statsText = () => page.eval(`document.querySelector('dl')?.textContent ?? ''`)

// Library page: stats header, nav entry, scope locked.
await page.goto(`${B}/library`)
await page.waitFor(`document.body.textContent.includes('Unique')`)
assert.match(await statsText(), /Cards[\d,]+Unique[\d,]+Value\$[\d,]+\.\d\d/)
assert.deepEqual(await page.eval(`[...document.querySelectorAll('header nav a')].map((a) => a.textContent)`), ['Look up', 'Search', 'Library', 'Settings'])
assert.equal(await page.eval(`document.querySelector('[role=radiogroup]')`), null, 'no scope switch on /library')
await page.waitFor(`document.querySelectorAll('main ul li button').length > 0`)
await page.shot(`${SHOTS}/1-library.png`)

// Open the first card with the keyboard: focus moves into the drawer and the page behind is inert.
await page.eval(`document.querySelector('main ul li button').focus()`)
const opener = await page.eval(`document.activeElement.outerHTML`)
await page.key('Enter', 'Enter', 13)
await page.waitFor(`document.querySelector('[role=dialog]') && document.body.textContent.includes('Your copies')`)
assert.equal(await page.eval(`document.activeElement?.getAttribute('role')`), 'dialog')
assert.equal(await page.eval(`document.querySelector('header').inert && document.querySelector('main').inert`), true)
await page.shot(`${SHOTS}/2-drawer.png`)

// + on the first copy raises its count.
const before = await copies()
await page.click('[aria-labelledby=your-copies] li button[aria-label^="Add one"]')
await page.waitFor(`JSON.stringify([...document.querySelectorAll('[aria-labelledby=your-copies] li')].map((li) => li.textContent)) !== ${JSON.stringify(JSON.stringify(before))}`)

// Add a copy: a success toast.
await page.click('[aria-labelledby=add-copy] button')
await page.waitFor(`[...document.querySelectorAll('[role=status]')].some((t) => t.textContent.startsWith('Added '))`)
await page.shot(`${SHOTS}/3-added.png`)

// "/" does nothing while the drawer is open; Escape closes it and focus returns to the card that opened it.
const focusedBefore = await page.eval(`document.activeElement.outerHTML`)
await page.key('/', 'Slash', 191)
assert.equal(await page.eval(`document.activeElement.outerHTML`), focusedBefore)
await page.key('Escape', 'Escape', 27)
await page.waitFor(`!document.querySelector('[role=dialog]')`)
assert.equal(await page.eval(`document.activeElement.outerHTML`), opener)
assert.equal(await page.eval(`document.querySelector('header').inert`), false)

// Finder combobox: "/" focuses it; options, active descendant, and a live region.
await page.key('/', 'Slash', 191)
assert.equal(await page.eval(`document.activeElement?.getAttribute('aria-label')`), 'Find a card')
await page.type('lightning bo')
await page.waitFor(`document.querySelector('[role=listbox] [role=option]')`)
await page.key('ArrowDown', 'ArrowDown', 40)
const combo = await page.eval(`(() => { const i = document.querySelector('[role=combobox]'); return { controls: i.getAttribute('aria-controls'), active: !!document.getElementById(i.getAttribute('aria-activedescendant')), live: document.querySelector('[aria-live=polite].sr-only')?.textContent } })()`)
assert.equal(combo.active, true, 'aria-activedescendant names an option')
assert.ok(combo.controls, 'aria-controls set while the list is open')
assert.match(combo.live, /^\d+ match/)
await page.type('zzzz')
await page.waitFor(`document.querySelector('[aria-live=polite].sr-only')?.textContent === 'No matches'`)
await page.key('Escape', 'Escape', 27)

// CSV import: preview groups, then add; stats change and a toast confirms.
await page.eval(`[...document.querySelectorAll('main button')].find((b) => b.textContent === 'Import CSV').click()`)
await page.waitFor(`document.querySelector('textarea')`)
await page.click('textarea')
await page.type('Count,Name,Edition,Collector Number,Foil\n2,Lightning Bolt,m10,146,\n1,Sol Ring,,,foil\n1,Not A Card,,,')
await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Preview').click()`)
await page.waitFor(`document.body.textContent.includes('not found.')`)
assert.equal(await page.eval(`document.querySelector('[aria-labelledby=import-heading] p[aria-live]').textContent`), '3 rows: 1 matched, 1 with a guessed printing, 1 not found.')
await page.shot(`${SHOTS}/4-import.png`)
const statsBefore = await statsText()
await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Add 3 copies').click()`)
await page.waitFor(`[...document.querySelectorAll('[role=status]')].some((t) => t.textContent.includes('Added 3 copies to your library.'))`)
await page.waitFor(`document.querySelector('dl').textContent !== ${JSON.stringify(statsBefore)}`)

// The home page focuses its own finder on load.
await page.goto(`${B}/`)
assert.equal(await page.eval(`document.activeElement?.getAttribute('aria-label')`), 'Look up any card')
await page.close()
console.log('UI check passed')
```

Then:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 \
  --user-data-dir=$E2E/chrome --no-first-run --no-default-browser-check --window-size=1400,1000 about:blank \
  > $E2E/chrome.log 2>&1 &
echo $! > $E2E/chrome.pid
node $E2E/ui-check.ts $E2E/shots
```
Wait for `curl -s http://127.0.0.1:9333/json/version` to answer before running the check. Expected output:
`UI check passed`. Look at the four screenshots in `$E2E/shots` and describe them in the report: the library header
with stats, the drawer with Your copies / Add a copy / Decks, a success toast, and the import preview.

- [ ] **Step 7: Stop everything**

```bash
kill $(cat $E2E/server.pid) $(cat $E2E/chrome.pid)
```
Confirm that nothing listens on 4321, 4400, 5173, or 9333 (`lsof -iTCP:<port> -sTCP:LISTEN` prints nothing), and
that no headless Chrome is left (`pgrep -f remote-debugging-port=9333` prints nothing). Then `rm -rf $E2E`.

- [ ] **Step 8: Update the docs**

In `README.md`, replace:

```markdown
## Development
```

with:

```markdown
## Your library

Open any card (from Look up, Search, Library, or the `/` finder) to see **Your copies**. Step them up or down, or
pick a printing and finish under **Add a copy**. **Library** lists what you own, with totals (cards, unique cards, and
value at each copy's finish price), and searches only your collection.

**Import CSV** reads exports from Moxfield, Deckbox, ManaBox, Archidekt, TCGplayer, and Dragon Shield, or any CSV with
Count and Name columns (add Edition and Collector Number to pin the printing). It shows how each row matched before
anything is added, and it adds to your library rather than replacing it. **Export CSV** writes
`Count,Name,Edition,Collector Number,Foil`, which Moxfield and most other apps can import.

## Development
```

In `README.md`, replace:

```markdown
Card data refreshes automatically at startup when it's older than 7 days, or from Settings → Card data.
```

with:

```markdown
Card data refreshes automatically at startup when it's older than 7 days (or when a Binder update needs
something new from it), or from Settings → Card data.
```

In `docs/plans/m1-followups.md`, replace:

```markdown
## M3 (collection): the drawer gains editing
```

with:

```markdown
## M3 (collection): done in M3
All items below were completed in M3 (see docs/plans/2026-09-26-m3-collection.md); kept for the record.
```

In `docs/plans/m2-followups.md`, replace:

```markdown
## M3 (collection): do these before CSV import or drawer "add a copy" rely on them
```

with:

```markdown
## M3 (collection): done in M3
All items below were completed in M3 (see docs/plans/2026-09-26-m3-collection.md); kept for the record.
```

In `docs/plans/m2-followups.md`, replace:

```markdown
  - Set and type autocomplete never refresh after a card-data refresh. Add `['catalog']` to `useBulkStatus`'s invalidation list.
```

with:

```markdown
  - (Done in M3.) Set and type autocomplete never refresh after a card-data refresh. Add `['catalog']` to `useBulkStatus`'s invalidation list.
```

- [ ] **Step 9: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass (414 tests).

---
