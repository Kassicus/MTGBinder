# M8 follow-ups

These are deferred findings from milestone 8 (Polish). They were triaged by:
- the task reviews;
- the final whole-milestone review;
- that review's fix wave.

None of them blocks M8. The "Later (left after M8)" sections of `m1-followups.md` to `m7-followups.md` still hold what
M8 didn't take up.

## Checks for the owner (the first real use)
- **The next start upgrades the library.** Binder first saves `data/backups/binder-YYYY-MM-DD-before-005.db`, then
  applies M7's migration 005. M8 adds no migration. The before-005 backup was tried on a copy of the library in M8's
  browser check.
- **Settings → Library file**, once, before you scan your collection in.
  - The size shown counts the library file and its log. Today's log (`binder.db-wal`, about 250 MB) is left over from
    a card-data refresh. From M8 on, Binder trims the log to 64 MiB (Settings says 67 MB) at the first write after a
    complete checkpoint, so it should shrink once the new version has run for a while.
  - **Compact** reclaims the free space a refresh leaves. On a copy of the library it went from about 461 MB to
    242 MB; on a test library of that size it took about a second. It saves a backup first, so `data/backups/` grows
    by one copy; look at Settings → Backups afterwards.
- **Keyboard shortcuts.** Press `?` on any page, or use **Keyboard shortcuts** under Getting started on Look up.
- **The first scanning session with the iPhone.**
  - If the iPhone disconnects, the Scan page waits for it: it doesn't switch to the Mac's camera by itself, and
    Capture is off until the phone is back.
  - A reload while it waits opens the best camera present, which can be the Mac's own.
- **A CSV from another app.** Look at the preview's notes before importing. Variant notes such as "(Borderless)" and
  "[Foil]" are dropped one at a time, and a card whose own name ends in parentheses keeps them.

## Later (left after M8)
- **Card data and the library file** (`src/server/bulk/import.ts`, `src/server/settings-routes.ts`,
  `src/server/main.ts`):
  - A download that hits the 30-minute cutoff mid-body says "The operation was aborted due to timeout", with no "the
    card data you have stays in use". It needs about 45 KB/s or less on an 80 MB file.
  - Compacting is disabled in Settings while a refresh runs, but the API doesn't refuse it. It blocks the server for
    about a second on a library the owner's size.
  - A second Binder, started while one runs, opens the library, checks the name index and runs a due backup before it
    fails on the port.
  - `fs.rmSync` at `bulk/import.ts:223` sits outside a try, so an EPERM there can still make `refresh()` reject.
  - A failed compaction always says "Free up disk space and try again", even when the reason is "database is locked".
  - `formatBytes` has no GB unit.
  - The spec and `openDb`'s comment say the log is trimmed "after each checkpoint". It's trimmed at the next write
    after a complete checkpoint, to 67,108,864 bytes.
- **Scanning** (`src/server/scanner/worker.ts`, `src/web/components/scan/CameraPanel.tsx`, `src/web/lib/capture.ts`):
  - The worker's `.catch` blames a `pump()` failure on the scan it just finished, and can end its retry chain. This
    happens only while the database is failing.
  - Camera `list()` enumerations aren't sequenced. A late, stale one can mark a live camera lost; it heals itself.
  - A fresh load before the iPhone connects opens the Mac's camera, and a remembered Auto mode captures from it until
    the iPhone is listed.
  - Space on the focused **Start it again** button captures (a no-op while stopped) instead of pressing the button.
    Space also ignores modifier keys, although §5.7 says shortcuts don't fire with Ctrl, Cmd or Alt.
- **Decks** (`src/server/decks/`, `src/web/components/deck/`, `src/web/lib/decks.ts`):
  - A commander missing from the card data (identity '') flags every card as outside its color identity and loses
    the deck's colors.
  - A line whose card left the card data reports status 'buy' and appears in the Mark-as-built list. It needs its own
    status.
  - `importIntoDeck` over-reports copies when the 999 cap clips them.
  - A re-keyed line whose chosen printing survived isn't flagged.
  - An overlapping deck change's invalidate cancels the joined refetch, which releases a pending Move or Remove a few
    tens of milliseconds early. Re-join while `isFetching`.
  - Toasts passed as `mutate`'s `onSuccess` are dropped when the drawer closes first (`DeckSections.tsx`), and rapid
    "+" clicks show only the last one (`CardSearchPanel.tsx`). Use `mutateAsync().then(...)`, as AddCopy does.
- **Search** (`src/shared/search/mana.ts`, `src/web/components/search/`):
  - `BRACED` accepts `{2/P}`, `{C/P}` and `{W/W}`.
  - SearchBar's effect returns `onDraftChange`'s result; give it a block body.
  - No test covers an estimated page-2 last page.
  - An empty later page with more after it (all its cards digital-only) reads "No cards match." with Next enabled.
- **Shortcuts** (`src/web/lib/shortcuts.ts`, `src/web/pages/HomePage.tsx`):
  - `GO_TO` duplicates `NAV`, so a page added to `NAV` without a letter isn't caught by the test.
  - Look up has two controls named "Keyboard shortcuts": the header's **?** and the Getting started button.
  - `TEXT_INPUT_TYPES` is a mutable exported Set.
- **CSV import** (`src/server/collection/import.ts`, `tests/server/collection-csv.test.ts`):
  - With no set, or a set but no number, `_____ [Foil]` reads as the real card "Foil": the normalized lookup
    (`import.ts` ~:316/:321 through `names.ts:60`) turns it into "foil". The preview shows it as ambiguous. With a set
    and number it resolves to `_____` since the fix wave.
  - The fuzzy rescue can pick a sibling (B.F.M.'s left half for the right). Such a row is ambiguous anyway.
  - The quadratic-parse timing test was never seen red.
- **Tooling:**
  - Put the browser check in the repository; M3's follow-ups ask for that too. M8's version is in the M8 plan's Task
    10: a fake camera feed through the real OCR helper, a scripted fake Claude, and a gate on console errors.
  - The project has no DOM test library. The fix wave's `SearchResults` tests render with `react-dom/server`.
