# M5 follow-ups

These are deferred findings from milestone 5 (Scanner). They were triaged by:
- the task reviews;
- the final whole-milestone review;
- that review's fix wave.

Fold each one into its milestone's plan when you write it. None of them blocks M5.

## Checks for the owner
- **A first real scanning session with the iPhone** (spec §5.1.6). Include:
  - one foil and one nonfoil modern card, which checks the foil preset;
  - a sleeved card;
  - an old card with no set code;
  - two copies of one card in auto mode, which checks the "Same card as the scan before it" marker.

  The benchmark covers only clean Scryfall images; a phone photo has glare, tilt and sleeves.
- **Saving an API key in Settings.** Check that the browser doesn't offer to save it as a password. A headless browser
  can't show that prompt.
- **Leftover test directories.** `rm -rf $TMPDIR/binder-*` clears about 5,000 of them. The M1–M4 tests left most (see
  Test hygiene).

## M6 (brainstorm): the API key's first real use
The key and client are ready:
- `src/server/ai/client.ts` has `get()`, `AI_MODEL`, and `describeAiError`;
- the key is kept in the project's `.env` with mode 600;
- scanning never uses them.

Before relying on them:
- (Done in M6: the owner chose `claude-opus-5-5`; adaptive thinking at effort `medium`; see the M6 plan's Decisions.)
  **Model.** Confirm the model (`AI_MODEL = 'claude-opus-5'`) and its settings for brainstorming.
- (Done before M6.) **Key UX:**
  - Remove deletes the key with one click and no confirmation, and Anthropic shows a key only once.
  - A key pasted with its `ANTHROPIC_API_KEY=` prefix is saved with the prefix.
  - The Test result stays on screen after Remove or Save (`test.reset()`), and isn't announced (`role="status"`).
  - The typed key stays in React Query's mutation cache for 5 minutes (in-tab memory). Clear the variables or set
    `gcTime: 0`.
- **`describeAiError`:**
  - (Done in M6.) It prints raw JSON with the status twice.
  - (Done in M6.) It calls a timeout a connection problem.
  - `POST /api/settings/ai/test` validates the body before its 404.
- **Key-store edge cases:**
  - A symlinked or hard-linked `.env` is replaced, not written through.
  - (Done before M6 for a save that fails: the temporary file is removed when writing or renaming it throws. A crash
    or kill between write and rename can still leave it, and the next save, under another pid, doesn't remove it.) A
    crash between write and rename can leave a mode-600 `.env.<pid>.tmp` that holds the key.
  - Tests don't pin the temp file's own mode or its `wx` flag.
  - Hand-edited lines:
    - a quoted value with a comment keeps its quotes;
    - `KEY= # paste here` reads the comment as the key;
    - rewriting drops `export`.
- **The shell's `ANTHROPIC_CUSTOM_HEADERS`** still adds headers to Binder's requests, and can even replace the key
  header. The host is pinned to api.anthropic.com (`baseURL`), so nothing reaches another server, but a stray setting
  could break requests. The SDK has no option to turn it off; drop the variable from the client's environment if it
  matters.

## Later (left after M8)
M8 did the items marked done; the rest wait for a later milestone.
- **Matching** (`src/server/scanner/matcher.ts`, `lookups.ts`):
  - The title ignores OCR confidence, and stray sleeve text can become the title.
  - `★`-suffixed collector numbers ("123★") aren't parsed.
  - `PT_BOX_X` uses the photo's x rather than the card's.
  - NaN boxes aren't handled.
  - Confident paths that remain within the rules:
    - a year misread into another printing's window;
    - an ambiguous short title plus a number misread ("Goblin R" → Roughrider, 0.894);
    - a keyword-named card confirmed by its keyword line with no clear title (Flash);
    - a number misread onto a namesake variant, or onto another printing of the same card in the same set.
  - A 6-way namesake group loses one candidate to `MAX_CANDIDATES` 5.
  - SQLite `lower()` folds ASCII only, so namesakes that differ only in non-ASCII case aren't grouped.
  - The lookups go stale if `rebuildCardNames` runs without `bulk_updated_at` changing (tests and scripts only).
- **Benchmark** (`scripts/ocr-benchmark.ts`):
  - Download failures escape the try.
  - "Slowest" includes the first card's index build.
  - It covers clean images only.
  - It opens `data/` unless `BINDER_DATA_DIR` is set.
- **OCR helper** (`src/server/scanner/ocr-client.ts`, `native/ocr.swift`):
  - Test gaps:
    - (Done in M8.) the timeout test doesn't prove the hung helper is killed;
    - the stale-rebuild path, multi-request crash, `close()` and concurrent `prepare` are untested (probes show they
      work).
  - `close()` during `prepare` still spawns a helper, which exits on EOF.
  - (Done in M8.) An unparseable request, or a result that can't be encoded (NaN), can't be matched to its request, so it waits out
    the 10 s timeout.
  - The mtime staleness check misses `cp -p` copies.
  - A missing source gives a bare ENOENT, and the Xcode hint is appended to real compile errors.
  - (Done in M8: the helper gets one image at a time.) Queue wait counts against each request's 10 s. With one helper and concurrency 2, a slow image can time out its
    neighbor, which lands in review with Try again.
  - `minimumTextHeight = 0` is unproven on synthetic images.
- **Scan pipeline** (`src/server/scanner/*`):
  - (Done before M6: the queue sends the ids in requests of at most 1000, one after another.) **Do this first: the
    1000-card commit limit.** `POST /api/scan/commit` refuses more than 1000 ids (`routes.ts`), but the queue always
    sends every ready id. A queue with more than 1000 ready rows can't be added: every click toasts a 400, and
    discarding is the only way out. Nothing is lost. Since auto-mode captures no longer auto-commit, a long auto
    session goes through Add. Chunk the ids in `useCommitScans`, or send the first 1000 and let the rest wait.
  - (Done in M7: the scan before it counts whether it's still in the queue or added, and a bare-mat capture between
    two copies of one card keeps them apart.) The same-card marker compares only rows still in the queue. If the first
    of a double capture is added before the second is identified, the second isn't marked.
  - (Done in M8.) If deleting an image fails after a commit (for example EACCES), the worker logs "auto-commit failed" for rows that
    were in fact committed.
  - (Done before M6.) `MatchDecision.contradicted`'s doc comment says the reading ruled out every printing of the
    card. It means every printing still left after the earlier filters.
  - (Done in M8.) Matcher exceptions are labeled "OCR failed".
  - (Done in M8.) `idle()`'s doc says "nothing queued", but it resolves with unkicked queued rows.
  - Test gaps:
    - the 413 test covers only the streaming path;
    - retry and image 404s are untested.
  - (Done in M8.) Loose parsing:
    - `?auto` is read raw;
    - ids coerce loosely (`0x1`, `1e0`).
  - (Done in M8.) An auto capture with no text disappears without a trace. The spec allows it, but a note ("skipped a capture with
    no text") would make it visible.
  - (Done in M8: it reads "Ready · confirmed".) "Looks right" keeps `method` as `ocr`, so a row a person confirmed says "Ready · by OCR".
  - (Done in M8: it is tried again, after 5 s and then longer waits, until it is saved.) When both the save and the fallback's save fail (the database is failing), the backstop logs the failure and the
    scan stays `identifying` until a restart re-queues it.
  - Auto mode's double captures:
    - the queue only marks them;
    - if that proves too easy to miss, route a same-card auto capture to review instead;
    - this needs capture-order state across concurrent identification.
- **Scan page** (`src/web/components/scan/*`, `src/web/lib/capture.ts`):
  - (Done in M8.) The iPhone is preferred only when its label contains "iPhone", which misses renamed phones.
  - (Done in M8.) Camera edge cases:
    - a track that ends or mutes;
    - a resize mid-stream;
    - a stale error from a cancelled stream;
    - probe errors that stick;
    - the probe reopening the camera on every `devicechange`.
  - (Done in M8.) One `AudioContext` per mount, never closed. Beeps scheduled while it's suspended all play at once on resume.
  - (Done in M7.) Auto-commit (now manual captures only) gives no feedback on the Scan page, and doesn't refresh
    collection caches.
  - Accessibility:
    - per-row labels lack the card name;
    - radiogroups lack arrow keys;
    - badge changes aren't announced;
    - the capture flash ignores `prefers-reduced-motion`.
  - A native checkbox, radio or range added to the Scan page later would stop toggling on Space.
  - The quantity stepper wraps inconsistently.
  - `CameraPanel` queries the DOM for an open dialog on every key event, before checking the key. It's harmless.
  - The autocomplete query key is shared across callers with different limits.
  - Capture test gaps:
    - the 4–12 band while disarmed;
    - the second capture's timing;
    - reset while armed;
    - a one-sided clamp.
  - (Done in M7 for the browser check: its feed has an old card that comes back as a review row, and its waits await
    promises.) There are no component tests, and the browser check has never shown a review row. Add one to the next
    end-to-end feed. Its Chrome helper's waits must await promises; a `!!(expr)` check passes at once on a `fetch`.
- **Settings page:**
  - Scanner toggles invalidate collection caches they can't affect.
  - A two-line checkbox label centers its box.
  - The key input shrinks to about 85 px instead of wrapping on narrow screens.
  - The Card data section doesn't use the `section` constant.
- **TCGplayer and CSV import** (`src/server/collection/import.ts`):
  - (Done in M8.) A misspelled real parenthesized name ("Erase (Not the Urza Legacy One)") resolves as ambiguous to Urza's Legacy
    Erase. The note shows the mismatch.
  - (Done in M8.) `withoutVariant` strips only one trailing note, and its regex is quadratic on huge inputs (0.84 s on 40k spaces).
  - (Done in M8: a Name that isn't the Simple Name with a variant after it is noted.) Simple Name silently wins over a different Name.
  - The "Solo Italiano" assertion can't fail, because the card has one printing.
  - English is sorted after promo, special and future printings. A card whose only English printings are promos
    defaults to a foreign regular one; none is expected in default_cards.
  - Fuzzy matching at 0.75 takes about 13.5 ms per query on 36k names.

## Docs
- (Done before M6.) Spec §4.1 and its bulk-refresh steps (§4.2) describe a `cards_fts` table over `name`,
  `face_names` and `oracle_text`. The schema's only FTS table is `card_names_fts`, over `card_names.search_name`
  (`001_init.sql`). This dates from M1.
- (Done before M6.) Spec §5.1.6 says a foil-only printing's collector line prints the `★`. Only the modern collector
  line does, so an older foil-only printing prints no `★`. The rule it supports still holds: only foil-only printings
  should appear in the benchmark's foil list.

## Test hygiene (any time)
- (Done before M6: a full run leaves none.) `tests/server/bulk-import.test.ts` leaks about 23 `binder-bulk-*` temp
  dirs per run, and the db tests leak `binder-db-*`. About 5,000 have piled up in `$TMPDIR`. Clean them up with
  `onTestFinished`, as the M5 tests do.
- From the pre-M6 cleanup's review:
  - The "no stack" test for a failed library open (`tests/server/backup.test.ts`) checks one `console.error` call
    whose first argument has no newline, so printing the stack as a second argument would still pass. Assert the
    whole call list.
  - `bareKey`'s final `trim()` (`src/server/settings-routes.ts`) is untested (`" sk-… "`, `ANTHROPIC_API_KEY= sk-…`),
    and so is the key's 300-character limit.
