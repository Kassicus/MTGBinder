# M4 follow-ups

These are deferred findings from milestone 4 (Decks). They were triaged by the task reviews, the final whole-milestone
review and its fix wave. Fold each one into its milestone's plan when you write it. None of them blocks M4.

## Answered by the owner (2026-09-27)
- **MTGO split cards:** MTGO accepts "Fire // Ice", so exports stay as they are.
- **TCGplayer imports:** a real TCGplayer export does put variant suffixes such as "(Borderless)" in its Name column.
  Those rows come back unresolved even when the set and number match. (Done in M5: Simple Name is preferred, and a
  trailing variant is dropped when the full name doesn't match.)

## M5 (scanner): done in M5
- **Default printings ignore language:**
  - The default-printing order doesn't consider `lang`.
  - A card whose newest regular printing is non-English shows that printing everywhere: search, drawer, deck lines
    and exports. For example, Abu Ja'far shows the Italian-only Rinascimento printing.
  - Prefer English printings in `DEFAULT_PRINTING_ORDER` before scans start relying on it.

## Later (left after M8)
M8 did the items marked done; the rest wait for a later milestone.
- **Backups** (`src/server/backup.ts`, `src/server/main.ts`):
  - (Done in M7.) Settings UI: last backup, "Back up now", folder path (spec §5.6).
  - (Done before M6 for migrations: an existing library is copied to `binder-YYYY-MM-DD-before-NNN.db` before a
    migration upgrades it. The card-name rebuild still runs before the daily backup.) Migrations and the card-name
    rebuild run before the startup backup, so a backup never holds the pre-upgrade state.
    Consider a copy before migrating when `schema_version` changes.
  - (Done before M6.) A `last_backup_at` in the future (the clock was once set ahead) stops backups until the clock
    catches up.
  - (Done before M6: a failed copy removes its temporary file, and each backup first removes any `binder-*.db.tmp`
    that an interrupted one, such as a killed start, left.) A partial `.tmp` file from a failed `VACUUM INTO` stays in
    `backups/`. It is never counted or pruned, and it can be about 240 MB.
  - (Done before M6.) A skipped backup (today's file already exists) isn't logged.
  - (Done before M6.) Spec §6 still says `.backup()`, but the code uses `VACUUM INTO`.
- **Deck data:**
  - (Done before M6.) Card-data refresh keeps too much for cards that decks use. It keeps every printing of that card
    that drops out of the new file, even when the card itself is still in the file. So if Scryfall re-IDs or removes
    one printing of Sol Ring, that printing stays with a frozen price. If that price is the lowest, it can win the buy
    list and its TCGplayer link.
    - Narrow the clause in `src/server/bulk/import.ts` so printings are kept only when the card is missing from the
      staging data: `oracle_id IN deck_cards AND oracle_id NOT IN cards_staging`.
    - Do this soon. It's a one-line change with a test.
  - (Done in M8.) A line whose card identity Scryfall re-keys still disappears from its deck, while built decks still count it as
    allocated. `LINE_SELECT` inner-joins the printing. Refresh now keeps printings of cards that decks use, but that
    doesn't cover re-keys. A LEFT JOIN with placeholder fields would keep the line visible and removable.
  - `updateLine` with a board and other fields together, onto an existing line, merges the quantity but drops the
    moved line's chosen printing and category. The UI sends one field at a time, so it isn't reachable today.
  - (Done in M8.) `addToDeck` has no quantity maximum: the drawer, decklist import and fast "+" clicks can pass 999, which PATCH
    refuses.
  - (Done in M8.) `addToDeck` with a negative delta on a missing line still bumps `updated_at`.
  - (Done in M8: a printing with a TCGplayer link wins, then the first by id.) `cheapestPrices` breaks equal-price ties by row order.
  - (Done in M8.) Duplicating a deck with a 100-character name makes a 107-character name, over the 100 limit.
  - (Done in M8.) Deck ids coerce loosely (`/api/decks/0x1`, `/1e0`).
  - (Done before M6.) The settings PATCH schema isn't strict: a mistyped key returns 200 and changes nothing.
- **Deck analysis and rules:**
  - (Done in M8.) A maybe line where other built decks hold some copies and this deck holds the rest still says "N held by other
    built decks" for all N. Only the none-elsewhere case was reworded.
  - (Done before M6.) The mana curve counts land creatures (Dryad Arbor) as nonland. `cardType` also substring-matches
    subtypes ("Lander").
  - (Done in M8.) The header's warning count counts lines, not warnings. A card on main and side counts twice, and Deck health lists
    it twice.
  - (Done before M6.) The comment on the `Board` type says maybe cards never count toward format rules, but legality
    and color identity do apply to them. Make the comments agree.
  - (Done in M8: 27 decks of about 100 cards, on the real card data, take about 40 ms.) Performance was measured with 3 decks. `deckSummaries` runs `checkDeck` for every deck, and `cheapestPrices` loads
    every printing of basic lands. Re-time `GET /api/decks` with 20 or more real decks.
- **Decklist import and export:**
  - Not understood:
    - Archidekt and Moxfield annotations: `[Ramp]`, `^Have^`, `#tags`.
    - TappedOut's `*CMDR*`.
    - `// Sideboard`, which is read as a comment.
  - A list with no headings in the form "commander, blank line, 99" puts the 99 in the sideboard (the MTGO rule).
  - `1 Sol Ring (CMR) *F*` records `*F*` as the collector number. This is harmless, because the printing isn't pinned.
  - "4 X (ABC)" reads X as the 4x marker.
  - Past the preview's 500-name fuzzy limit, unsearched names look the same as names that weren't found.
  - Arena export names printings Arena lacks (CLB, 2XM, MSC). This was plan decision 9. Arena falls back to the name.
- **Deck editor and Decks page (web):**
  - Search and layout:
    - The search pane has no local fallback when Scryfall is offline.
    - (Done in M8, except combobox semantics: it closes on Escape and on a click elsewhere.) Its suggestion dropdown covers the board select, doesn't close on an outside click or Escape, and lacks
      combobox semantics. `QuickFind` has the pattern.
    - The deck-name input sits about 6 px out of line with the header.
  - (Done in M8.) Stale or confusing state:
    - Move-to and Remove re-enable when the request settles, before the refetch removes the row. A second click 20–35 ms
      later gives a 404 toast.
    - "+" right after a remove or move can recreate the line before the refetch, losing its category.
    - A failed name save reverts to the name captured at blur. That name can be stale.
    - A failed background refetch is silent: a deck deleted in another tab gives "Deck not found" toasts on edit.
    - The global `retry: 1` delays the unknown-deck message by about 1 s.
    - "Mark as built anyway" has no pending state, and the confirmation can outlive its reason ("0 cards short").
    - The printing select shows "Default printing" until the card detail loads.
  - (Done in M8.) Decks page display:
    - Hides unpriced copies in the cost ("$0.00 to finish").
    - An empty deck shows 100% and a {C} pip.
    - Long deck names overflow.
  - (Done in M8.) The buy list's "Leave out basic lands" toggle changes the global setting without saying so.
  - (Done in M8.) The drawer's Decks section leaves out maybe boards: after "Add to deck" with Maybe, it still says "Not in any deck".
    Fixing this touches `DeckRef` and `OwnershipBadge`.
  - (Done in M8: "N short" in both, and the buttons are **Add copy** and **Add to deck**.) The drawer says "built decks use N" in amber, while the search badge says "N short" in rose. Pick one wording.
    The drawer also has two buttons named "Add".
  - (Done before M8.) The Settings Deckbuilder checkbox lacks `accent-amber-500`.
  - Accessibility:
    - Tabs lack `tabpanel`, `aria-controls` and arrow keys; so do the radiogroups.
    - Focus drops to `<body>` after Delete, Cancel and Remove.
    - The warnings jump doesn't move focus.
    - The hover card image doesn't show on keyboard focus.
- **Tests:**
  - Untested format-rule branches:
    - Partner—X;
    - Doctor's companion with a Time Lord Doctor;
    - a lone Background;
    - more than two commanders;
    - restricted cards across main and side;
    - the "can be your commander" clause.
  - The maybe-size assertion can't fail, because 60 is a minimum.
  - The foil and etched price fallbacks are untested.
  - `updateDeck`, `removeLine` and `createDeck` have no direct tests.
  - The U+2028/U+2029 decklist test has literal invisible separators; use ` `/` ` escapes. The `s` flag on
    `SB:` has no correctness test.
  - The fuzzy-limit test's "looking each up once" isn't asserted.
  - The maybe-line test (`tests/server/decks.test.ts`, "already used by this deck") uses main 1 and maybe 1. With those
    numbers, subtracting the maybe line's own quantity gives the same answer as subtracting the deck's other copies.
    Use main 2 and maybe 1 so the test can tell the two apart.
  - The "another site" API test passes with no deck routes at all (the local-only guard answers first).
  - There is no DOM test setup. Component behavior is covered only by the Task 8 headless-Chrome run, and the raw E2E
    output was deleted with `/tmp`. Keep raw outputs next time, and wait for images before taking screenshots.
- (Done before M6.) **Docs:** the README's Decks section describes ⚠️ only as "held by another built deck". It doesn't
  mention the "already used by this deck" wording that maybe lines now use.
- **Layout:** `src/server/settings-routes.ts` breaks the `<domain>/routes.ts` layout.
