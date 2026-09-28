# M9 follow-ups

These are deferred findings from milestone 9 (Binder.app), triaged by the task reviews, the final whole-milestone
review, and that review's fix wave. None of them blocks M9. The "Later" sections of `m1-followups.md` to
`m8-followups.md` still hold what earlier milestones left.

## Checks for the owner (the first real use)
- **Installing and moving, once.** In the project:
  1. `pnpm install`, since the main checkout needs Electron and electron-builder;
  2. `pnpm app`;
  3. `pnpm move-library`, *before* opening Binder.app the first time;
  4. open Binder.

  The move copies `data/` to `~/Library/Application Support/Binder`. A failed copy changes nothing and can be run
  again. `data/` stays as it was until you delete it.
- **In Binder.app:**
  - enter the Anthropic API key again in Settings; it isn't copied;
  - allow the camera the first time you open Scan, and pick the iPhone;
  - check your collection and decks are all there.
- **After each `pnpm app`**, macOS may ask for the camera again: the app is signed on this Mac, and the signature
  changes with each build. If the camera is refused, turn Binder on in System Settings → Privacy & Security →
  Camera, then quit and reopen Binder.
- **Opening Binder from Terminal while Binder.app runs** (or the other way round) fails on port 4321 with one line
  saying so. Quit one first.

## Later (left after M9)
- **The server's start and stop** (`src/server/start.ts`, `src/server/db/index.ts`):
  - `openDb` leaves its handle open when a pragma or migration throws. Both entries exit afterwards, so nothing is
    held; it's contract hygiene.
  - `start.ts`'s startup `'error'` listener stays after listening. A later server error is swallowed, and a second one
    crashes the process. The old `main.ts` exited with one line.
  - `[backup] Failed …` and the card-data backstop now go to stdout rather than stderr, and without the stack.
  - The upgrade-backup log lines are written in two places (`db/index.ts`, `start.ts`).
  - Test gaps:
    - no test of the `Binder running at <url>` line;
    - the `port_denied` and `listen` codes aren't exercised;
    - `start.test.ts` resolves the migrations folder from the working directory.
- **Binder.app** (`electron/`):
  - After a bad `PORT` (checks only), the app shows its dialog, calls `app.exit(1)`, then throws. A second dialog is
    possible.
  - A stop that arrives before `startBinder` resolves exits with the library open. This is only possible while it's
    listening; SQLite recovers.
  - `pnpm.onlyBuiltDependencies: electron` does nothing: Electron 44 installs its runtime the first time it runs.
  - The window-open and navigation rules are inline in `main.ts`, and untested.
  - `ServerMessage`'s `failed.code` is typed `string`. `StartupErrorCode | 'crash'` would make `startupFailure`
    exhaustive.
  - "One Binder at a time" holds per library. `pnpm app:dev` started while Binder.app runs fails on the port, with the
    `pnpm start` wording.
  - A local signing certificate would keep the camera permission across updates.
  - The permission *check* handler doesn't see the media type, so a microphone check reads "allowed". Any real
    microphone request is still refused (the request handler checks). The fix is one line.
  - The `load()` helper around `loadURL` is redundant on Electron 44, which already ignores a replaced load. It's
    harmless.
  - Under `pnpm app:dev`, the camera-refused message says "Binder" while macOS's Camera list says "Electron" (dev
    only).
  - Checks that stop the app while its startup dialog is open need `pkill -KILL`, since the modal dialog holds off a
    plain `pkill`.
- **Packaging** (`package.json`'s `build`, `scripts/app.ts`, `scripts/lib/install.ts`):
  - Installing removes the old app before copying the new one, so an interrupted copy leaves no whole Binder.app.
    Stage the copy beside it, then rename. A rerun of `pnpm app` recovers.
  - `appRunning` treats any pgrep error as "not running", and reads the path as a regex.
  - `builtApp` takes the first `release/mac*` folder, so a stale `mac/` could win over `mac-arm64/`. Its test name
    claims both architectures.
  - Build-step failures print stack traces, not one line.
  - `--no-install` doesn't refuse while Binder runs from `release/`.
  - About 30 MB of better-sqlite3's other platforms' prebuilds, and its source, ship in the app. Trim them with
    negation globs.
  - Noise: pnpm's electron-winstaller notice (use `ignoredBuiltDependencies`), and electron-builder's missing `author`.
  - `app.ts` repeats the icons command instead of running `pnpm icons`.
- **Moving the library** (`scripts/lib/move.ts`, `scripts/move-library.ts`):
  - "Untouched" means empty now: a library emptied later counts. Moving a library onto itself isn't refused. That's
    harmless since the staged copy: a used one is refused, and an untouched one copies onto itself.
  - A target `binder.db` that isn't SQLite, or a source with an older schema, gives a stack trace.
  - The "Binder is running" check covers only `/Applications/Binder.app` and port 4321. A busy writer on another
    `PORT` can stall SQLite's backup.
  - Kill windows:
    - between removing an untouched `binder.db` and its folders, an old folder the source lacks can survive a rerun;
    - between the database's rename and removing `.moving`, an empty `.moving/` is left.

    A failure while putting the copy in place is a plain Error (recoverable, since no `binder.db` is in place yet). A
    staging failure leaves an empty target folder when there wasn't one.
  - A copy failure's reason names the (deleted) staging path, not the source file.
  - `move-library` prints "Copying your library…" before its refusal checks, so a refusal follows a "Copying" line.
  - Test gaps:
    - the integrity-failure path;
    - the target's `.env`, `Electron/` and `Logs/` surviving a replacement;
    - the CLI's refusals.
- **Tooling:** the end-to-end check of the packaged app lives in the M9 plan's Task 5 (in `/tmp` when it runs). It
  could move into the repository together with the browser check, as M3's and M8's follow-ups ask.
