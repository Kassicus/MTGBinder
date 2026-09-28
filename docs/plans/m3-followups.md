# M3 follow-ups

These are deferred findings from milestone 3 (Collection), triaged by the task reviews and the final whole-milestone
review. Fold each one into its milestone's plan when you write it. None of them blocks M3.

## M4 (decks): done in M4 and M5
Completed in M4 (see docs/plans/2026-09-26-m4-decks.md): backups at startup, `readJson` in `http.ts`, the drawer
split with `useId` headings. The TCGplayer check was answered by the owner and fixed in M5 (Simple Name, variant
suffixes).
- **Backups before real data piles up:**
  - The library now holds real data, and CSV import only adds, with no bulk undo.
  - Bring spec §6's startup backup forward from M7, or back up the database before each import commit.
- **`jsonBody`:**
  - It lives in `src/server/collection/routes.ts` but is a general HTTP-boundary helper.
  - Move it to `src/server/http.ts` next to `parseWith` before the deck routes need it.
- **Card drawer:**
  - `CardDrawer.tsx` is about 430 lines holding 11 components.
  - Split the editing sections (Your copies, Add a copy) out before adding Add to deck.
  - Its section ids (`your-copies`, `add-copy`, `card-decks`) are hard-coded; use `useId`.
- **TCGplayer imports:**
  - Check a real TCGplayer export.
  - If its Name column carries variant suffixes such as "(Borderless)", a correct set + number match fails the name check and the row comes back unresolved. It fails visibly, not silently.
  - Consider accepting `Simple Name`.

## M5 (scanner): done in M5
Scans use `DEFAULT_PRINTING_ORDER`, which now also prefers English printings (docs/plans/2026-09-27-m5-scanner.md).
- **Default printing for scans:**
  - Spec §5.1.2 says a scan's default printing is the "newest non-promo" one.
  - Decide whether scans should use `DEFAULT_PRINTING_ORDER` (the v3 rule that skips special products) instead.

## Later (left after M8)
M8 did the items marked done; the rest wait for a later milestone.
- **Card data upkeep** (`src/server/bulk/import.ts`, `src/server/cards/repo.ts`):
  - (Done in M8.) Hoist the kept-file path instead of rebuilding it in the error handler.
  - (Done in M8.) Delete the kept file only on corrupt-file errors, not on database errors.
  - (Done in M8: an offline refresh says the card data stays in use, and the start logs why it is stale.) Offline after an update: `isStale()` stays true until a refresh succeeds, and reusing the kept file needs Scryfall's metadata first. An offline start therefore logs a refresh error every time.
  - The `DEFAULT_PRINTING_ORDER` comment omits the `set_code` tiebreak.
  - `getPrintings` sorts collector numbers as text, while the default rule sorts them as numbers.
- (Done before M6.) **Local search fallback** (`src/server/search/run.ts`):
  - When the default printing doesn't match, local search picks the newest matching printing by date only, so `bolt -s:m11` returns the Mystical Archive printing.
  - Order by `(c.id = n.default_card_id) DESC, ${DEFAULT_PRINTING_ORDER}` instead, and flip the `search-local` test to `m10`.
- **Library search cleanup** (`src/server/search/run.ts`):
  - The color-rank `CASE` is duplicated. Add `colorRankSql(column)` next to `rarityRankSql`.
  - `SORT_SQL`'s `added` entry is unreachable, and its doc comment is stale.
  - Both library branches must expose the same column aliases for the shared `ORDER BY`. A shared column list would make that explicit.
  - The past-the-end count fallback repeats `searchLocal`'s.
  - A page past the end still runs the full-row read with `'[]'`.
  - Result keys `${cardId}-${finish}` change when a cards-view row's shown finish flips. That remounts the tile that opened the drawer, and focus falls to `<body>` on close.
- **CSV import and export** (`src/server/collection/`):
  - (Done in M8.) `sep=` hint lines:
    - A trailing space or padded delimiters (`"sep=,",,,`, as a spreadsheet re-save can write) still fall through to header detection.
    - Real Dragon Shield exports work.
  - (Done in M8.) A space before an opening quote (`1, "Atraxa, Praetors' Voice"`) isn't read as quoting.
  - (Done in M8.) A file with only Set Name and Collector Number columns is refused, although it could be matched.
  - (Done in M8.) In CR-only files, a line break inside a quoted cell misnumbers later lines.
  - (Done in M8.) Export:
    - The filename's date comes from `toLocaleDateString('en-CA')`, which depends on ICU data.
    - Names that look like formulas (`+2 Mace`) are written unquoted.
  - `/import` prepares its card-lookup SQL in `routes.ts` instead of the repository.
- **Accessibility and focus** (web):
  - Focus return:
    - A drawer opened from either finder returns focus to `<body>`, because the finder blurs itself first.
    - After clicking the "Look up" nav link, the home finder no longer takes focus: the focused link isn't `<body>`. Only skip stealing from text fields.
  - Steppers:
    - Quantity changes aren't announced.
    - Removing the last copy drops focus to `<body>`.
    - The set-code button is named only by its code.
  - Toasts:
    - `role="alert"` toasts sit inside an `aria-live` container, which can announce twice.
    - Error toasts dismiss after 8 s with no pause on hover or focus.
  - Import panel:
    - "Import CSV" disables itself while focused.
    - Focus isn't moved into the panel, and closing it drops focus.
    - The preview summary's live region is created along with its text, so it may not be announced.
  - Finder list:
    - A dimmed "No matches", or stale cards, can show briefly after clearing the field and typing a new name.
    - The dimmed row's contrast is about 2.3:1.
    - The finder keeps its text after Escape.
- **Small UI items:**
  - (Done in M8.) Add a copy's success toast is lost if the drawer closes before the request finishes.
  - Settings still shows its refresh error inline, although spec §6 says mutations show toasts. Inline suits a long job, so decide which you want.
  - (Done in M8.) The import textarea stays editable during a commit.
  - (Done in M8.) The "include guessed printings" checkbox persists across previews.
  - `LibraryPage`:
    - The `lastAddedAt ? … : 'never'` check is redundant.
    - The unpriced note is keyed on the display label "Value".
  - (Done in M8.) `ImportPanel` uses `ReturnType<typeof importItems>['items']` where `ImportItem[]` is meant.
  - (Done in M8.) The empty-library text says "Import a CSV on the Library page" even on the Library page.
- (Done before M6.) **Docs:** spec §5.3 still says a name-only CSV row takes the "newest printing". The approved rule, and the preview's note, is the card's usual (default) printing.

## Test hygiene (any time)
- **Reusable UI check:** keep Task 7's headless-Chrome driver (`cdp.ts`) and `ui-check.ts` as a script in the project. The M3 plan has their text. They are the only automated check of the drawer and import flows.
- (Done before M6.) **Cleanup:** `cards-map.test.ts` opens an in-memory database it never closes.
- **Missing tests:**
  - Library printings view with the ownership totals joined (`free`, `qty`, `is:wanted`).
  - The adjust route: the ±1000 `delta` bounds, and the 404's `not_found` code.
  - CSV:
    - Archidekt, TCGplayer and ManaBox header sets end to end.
    - Tab and semicolon files through `previewImport`.
    - zod rejections on `/import` (no items, quantity 0 or 10000).
    - Non-JSON bodies on the two import POSTs.
  - Web:
    - `invalidateCollection` (with a real `QueryClient`).
    - The toast `MAX_TOASTS` trimming.
- **E2E evidence:** save the end-to-end run's raw outputs (the import script, curl timings, meta queries, the test summary) as artifacts, not just in the report.

## Accepted as-is
- **CSV import always adds** and never replaces the library (owner-approved decision). The backups item under M4 is the safety net.
- **`mmap_size` of 1 GiB:** an I/O error on the mapped file surfaces as a crash instead of an error (approved decision).
- **`usd` filter:** it stays nonfoil (spec §5.2.2), while library rows are priced by their finish (approved decision).
- **Before the post-update refresh completes**, for example offline, Secret Lair Drop (`slz`) printings stay the default for their staples, because only `plst`, `sld` and `unk` are demoted by set code. That is the same as M2.
- **Web components have no unit tests** (as in M1 and M2). Pure logic lives in tested helpers (`finder-list`, `import-items`, `search-state`, `format`).
