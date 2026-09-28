# M1 follow-ups

These are deferred review findings from milestone 1 (Foundation), triaged by the final whole-milestone review. Each one belongs to the milestone listed. Fold them into that milestone's plan when you write it. None of them blocks M1.

## M2 (search): done in M2
All items below were completed in M2 (see docs/plans/2026-09-26-m2-search.md); kept for the record.
- **Offline classification** (`src/server/scryfall/client.ts`):
  - A dropped connection while reading the body (`res.json()` outside the try), or a 2xx response that isn't JSON, escapes as a raw error instead of `ScryfallError('offline' | 'http')`.
  - Keep `err.cause`. Undici's message is always "fetch failed"; the real reason (ECONNREFUSED, ENOTFOUND) is in `cause`.
- **Rate limiting:** a 429 backoff should pause the whole request queue, not just the retrying request.
- **Response bodies:** cancel the bodies of 429 responses and failed downloads, which otherwise hold their socket until garbage collection.
- **Spacing clock:** space requests with a monotonic clock (`performance.now`) instead of `Date.now`.
- **Timeouts:** add a request timeout / `AbortSignal`, and pass React Query's `AbortSignal` through `apiGet` (`src/web/lib/api.ts`).
- **Client test gaps:**
  - `postJson` errors
  - a non-404 download failure
  - a 429 during `download`
  - an error JSON without `details`
  - an absolute URL through `getJson` (pagination)
  - the option overrides
  - a spacing test that asserts actual fetch start times
- **Multi-face P/T:** `scryfallToRow` takes power/toughness from any face, so Westvale Abbey (a land) gets `power_num` 9. `pow:`/`tou:` search semantics must account for this.
- **Default printing** (`src/server/cards/repo.ts` `rebuildCardNames`):
  - The List (`plst`) is the default printing for about 3,400 cards.
  - About 1,350 cards default to printings dated after today (Forest and Island default to a 2026-11 Star Trek set).
  - Fix: prefer `released_at <= today` and push `plst`/`sld`/`unk` down.
- **Status hook placement:** move `useBulkStatus()` into `Layout` once more pages exist. Its post-refresh cache invalidation only runs while Home or Settings is mounted.
- **Error messages:** prefix import and download failures with their phase ("Download interrupted: …", "Card data file is corrupt: …") instead of raw zlib/JSON text.

## M3 (collection): done in M3
All items below were completed in M3 (see docs/plans/2026-09-26-m3-collection.md); kept for the record.
- **Toasts:** spec §6 calls for toasts on mutations. Build them when the first real mutations land (Settings shows its one error inline today).
- **Drawer:**
  - Move focus into the drawer when it opens and restore it afterwards.
  - The `/` hotkey stays live while the drawer is open.
  - The drawer briefly shows the previous card on reopen (`placeholderData` persists), with no loading cue.
- **Combobox accessibility:**
  - Add `aria-activedescendant` and option ids.
  - Give the input a real label.
  - Add an `aria-live` region for "No matches" and errors.
  - `aria-controls` points to an absent id while the list is closed.
- **QuickFind polish:**
  - The first-run page switch steals focus from the header search via `autoFocus`.
  - The "No matches" row flickers while a debounced fetch runs.
- **Mana symbols:** `ManaSymbol` is keyed only by index, so a failed-load flag can carry over to a different symbol.
- **Printings list:** it shows the foil price as the regular price with no label, and etched-only printings show "—".

## Later (left after M8)
M8 did the items marked done; the rest wait for a later milestone.
- (Done in M8: Settings → Library file → **Compact the library**, after a backup.) **Database compaction:** `data/binder.db` carries about 200 MB of free pages left by the pre-fix staging table. Add a maintenance step that runs `VACUUM` and then rebuilds `card_names_fts`. VACUUM can renumber `card_names`' implicit rowids, which would desync the external-content FTS index.
- (Done in M8.) **Setup errors:** `scripts/setup.ts` passes no `log`. If both the refresh and the `bulk_error` write fail, it prints "import failed: null". Keep the last error in memory as a fallback for `status().error`.
- **Startup:**
  - `main.ts` prints `http://localhost` while binding `127.0.0.1`.
  - (Done in M8.) There is no listen `'error'` handler, so EADDRINUSE dies with a raw stack.
  - (Done in M8.) Setup shows "downloading 0 printings" for the whole download phase.
  - (Done in M8.) `PORT` is not validated.
- (Done in M8: the proxy follows `PORT`, and the guard compares host and port.) **Config and security:**
  - The Vite dev proxy hardcodes port 4321 even though the server honours `PORT`.
  - The Origin guard compares hostnames only, so another dev server on a different localhost port can still POST.

## Test hygiene (any time)
- (Done before M6.) **Temp directories and handles:**
  - The WAL test (`db.test.ts`) and the bulk-import tests leave temp directories behind.
  - The WAL test needs `try/finally` around `close`.
- **Missing assertions:**
  - `busy_timeout`/`synchronous` pragmas.
  - The first-run row count in the migration test.
  - `CARD_COLUMNS` against `PRAGMA table_info(cards)`.
- **Autocomplete coverage:**
  - The non-promo default-printing rule (the fixtures contain no promos).
  - Ranking tiers.
  - Exact price values.
  - Query-side accents and uppercase.
  - `delver zq` → `[]`, to pin the short-word filter.
  - Routing of `of a` and `bolt or near`.
- **Mapping coverage:** adventure, flip and modal-DFC layouts.
- **Import and client failure paths:**
  - A forced rollback inside `mergeStaging`.
  - A throwing injected `sleep`/`now`, which poisons the client queue.
- **API test gaps:**
  - The `console.error` spy in `api.test.ts` is never restored or asserted.
  - No `missing q` / `limit=abc` cases.
  - No routing-order test with `webDistDir` set.
  - The error envelope in `app.ts` is written out three times instead of typed against `ApiErrorBody`.
- **Fixture helper:** `fixtureCard` and `syntheticCard` clone all 61 fixtures per lookup.

## Accepted as-is
- Server imports need `.ts` extensions, and TypeScript doesn't enforce them. The real `node` run catches a missing one.
- `openDb` doesn't close the handle if `migrate` throws.
- `card_names_fts` is keyed on implicit rowids. That is safe because every change goes through `rebuildCardNames`; rebuild the FTS after any VACUUM.
- `autocomplete` doesn't clamp `limit`; the route clamps it.
- `getPrintings` repeats part of `rowToCard`'s mapping.
- A leftover `.part` file after a failed download is overwritten on the next run.
- `bulk_updated_at` records the import's start time rather than its commit.
- Card data auto-refreshes only at server start (spec §4.2), so a server left running past 7 days doesn't refresh on its own.
- Tokens, emblems, art-series and oversized cards are skipped on import. Revisit in M3/M5 if you collect or scan tokens.
