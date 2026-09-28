# M7 follow-ups

These are deferred findings from milestone 7 (Deck scanning and polish). They were triaged by the task reviews, the
final whole-milestone review, and that review's fix wave. Fold each one into M8's plan (polish) when you write it. None
of them blocks M7.

## Checks for the owner
- **The next start upgrades the library.** Binder first saves `data/backups/binder-YYYY-MM-DD-before-005.db`, then
  applies migration 005 (tried on a copy of the library: about 0.2 s, integrity and foreign-key checks clean).
- **The first real deck scan.**
  - Choose the deck under **Scanning into**, or press **Scan cards into this deck** in the deck, and check the bar before
    the first capture. A chosen deck is forgotten after 8 hours.
  - In auto mode, lift each card and leave the mat empty for about a second before the next copy of the same card.
    Otherwise the copy is marked "Same card as the scan before it" (keep it: it's another copy).
  - The Add button says how many cards also go to the deck ("Add 60 cards (60 also to Goblins)").
- **One real refusal, if one happens.** Look at that answer's `meta.usage.iterations` in `ai_messages`. The cost estimate
  assumes an attempt declined before any output reports `output_tokens: 0` and isn't billed. Confirm both.
- **Back up now** once, in Settings → Backups.
- **Leftover test directories.** `rm -rf $TMPDIR/binder-*` clears about 5,000 of them, from M1–M4 runs.

## Later (left after M8)
M8 did the items marked done; the rest wait for a later milestone.
- **Scan queue, deck targets** (`src/server/scanner/repo.ts`, `src/web/lib/scan.ts`):
  - (Done in M8.) A committed Add whose image delete fails (for example EACCES) reports failure: `deleteImage` runs after the
    transaction and throws, so the page says "Couldn't add the scans" although they were added. Wrap each delete in
    try/catch and log.
  - (Done in M8: shown as "Scanned N of M" in the deck and on each line; the owner chose no reset.) The "fill the list first" counter (the scans committed to a deck) is hidden and permanent. A deck edited after
    scanning (a line lowered, or moved to another board) counts from it anyway, and a wrong-deck commit can't be taken
    back short of deleting the deck. Show it, or let the owner reset it.
  - (Done in M8.) A scan the owner discards before it was read counts like a bare-mat capture between two copies. Mark the worker's
    bare-mat drop explicitly (for example, store its empty `ocr_json`) and treat only that as a separator.
  - (Done in M8.) A bulk "send every scan in the queue to…" control, for a session started with the wrong deck.
  - A deck deleted in another tab, with its id reused, can show as the target for the few milliseconds before the
    decks refetch; a capture carries only the id. The capture could carry the deck's `createdAt`.
  - `listAutoAdded` relies on `updated_at` staying the commit time (committed rows are never updated today). Add a
    `committed_at`, or a comment.
  - (Done in M8.) `useAnnounceAutoAdded`: `isFetchedAfterMount` also turns true on a failed first poll, so a return visit can announce
    old auto-adds once.
  - New deck… finishing while the page's first decks load is in flight can be cleared by that older list (contrived).
  - (Done in M8.) The row's target select snaps back while a change is pending.
  - Performance nits: `commitScans` prepares the deck-name query per row; `addToTargetDeck` repeats `addToDeck`'s
    oracle lookup.
  - Test gaps: a target changed mid-identification honoured by auto-commit; an empty `PATCH {}` on a busy scan now
    answers 200; no DOM tests for `useScanTarget` and `useAnnounceAutoAdded` (the project has none; adding them needs a
    dev dependency).
- **Backups** (`src/server/backup.ts`):
  - A complete backup is reported as failed when recording `last_backup_at` fails afterwards.
  - "Last backup" is `last_backup_at`, which the daily check's "exists" branch also sets without writing.
  - The file-name grammar is written three times (`unusedFile` builds its regex from an unescaped name), and
    `messageOf` is duplicated in `settings-routes.ts` and `main.ts`.
  - Two loose doc comments: `backupNow`'s "never costs an earlier day's backup" holds for daily backups only;
    `backupIfDue`'s "always counting the one just saved".
  - After the clock was once set ahead, only the latest real-date daily backup survives until the real date passes the
    future ones.
- **Brainstorm** (`src/server/ai/`):
  - An answer stopped just after a fallback begins can be stored ending with the fallback block (the API treats it as an
    ignored marker).
  - `Brainstorm.answer(id, null)` relies on the route's `check` for "nothing to continue" (no other caller today).
  - From M6: a late delete success navigating away from a conversation opened meanwhile; the chat UI items in
    `docs/plans/m6-followups.md` still marked M8.
- (Done in M8: extended into its own check.) **The browser check.** It is in the M7 plan's Task 5 (`/tmp/binder-m7-e2e-scripts/`): a fake camera feed through the
  real OCR helper, a scripted fake Claude, and a gate on console errors. Reuse it for M8.
