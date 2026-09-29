# M10 follow-ups

These are the deferred findings from milestone 10 (Sets). They were triaged by the task reviews, the final
whole-milestone review, and that review's fix wave. None of them blocks M10. The "Later" sections of
`m1-followups.md` to `m9-followups.md` still hold what earlier milestones left.

## Checks for the owner (the first real use)
- **Installing:** quit Binder.app, then run `pnpm app` from `main` once the branch is merged. M10 has no migration,
  so the library isn't upgraded and no pre-upgrade backup is made. Take a **Settings → Back up now** first anyway:
  the scanned collection had no backup yet on 2026-09-29.
- **The Sets page:** sort by each option, filter by a name and by a code, open a set, and switch **Missing only**.
  Then add a missing card from its card details. Its row should turn to "✓ 1" and the bar should move.
- **Coming back to a set:** open a set, go back, scroll far down the list, and open the same set again. It should
  open at its top.
- **Binder.app at its narrowest** (820 px): M10 gave the header eight links, which by an estimate left the card finder
  about 20 px wide. Merging Look up into Search and Library (after M10) brought it back to seven. Say whether the
  finder is usable.
- **The List** (`/sets/plst`) is the largest set, at 5,258 cards. It shows in about 0.4 s in headless Chrome.
  Opening a card's details there takes about 0.1 s.

## Later (left after M10)
- **Speed:**
  - `GET /api/sets` took 91 ms at 20,000 copies spread over about 490 sets. It reads the wide `cards` rows of every
    owned set's printings. An index on `cards (set_code, oracle_id)` took the totals to 6 ms in the prototype, but it
    needs a migration and its pre-upgrade backup. It was left out because the spec says no migration.
  - The reviewer suggested one more idea, which nobody has measured: `set_type` is the table's last column, after the
    large JSON columns, so it could be read only from the owned rows.
  - Opening or closing the card details on The List still spends about 75–90 ms recalculating styles. That is most
    likely `Layout` toggling `inert` on `<main>`. The rows themselves no longer re-render.
- **Scrolling:**
  - Only the set page resets scroll on navigation. An app-wide `<ScrollRestoration />` would open every page at its
    top and restore the position on Back.
  - Switching **Missing only** from far down a set moves the page, from 800 px to 245 px in the check. That's
    Chrome's scroll anchoring on a list that got shorter.
- **Keyboard and accessibility:** the set page's rows are `<tr onClick>`, as in Search's list view, so the keyboard
  can't reach them. The All | Missing only tabs have no `tabpanel` or `aria-controls`. Fix both together with
  `SearchResults`.
- **Getting to a set:** only owned sets are listed, so an unowned set's page can be reached only by typing
  `/sets/<code>`. The card details' set code could link to its set's page.
- **Code and tests:**
  - `src/server/sets/repo.ts` writes the set-header columns (`MAX(set_name)`, `MAX(set_type)`, `MIN(released_at)`)
    in both queries.
  - `dateParts` (`src/web/lib/sets.ts`) accepts day 00 or 32. Scryfall never sends those.
  - A Sets row's link passes the list's address as its "back" state. That address can lag the filter box by a few
    milliseconds after a keystroke.
  - `tests/web/bulk-status.test.ts` pins `CARD_DATA_QUERIES` but not the loop that uses it.
  - The Sets filter box re-syncs from the address on every navigation that isn't a replace (Back/Forward, the header
    link from `/sets?q=…`). Nothing unit-tests that, since the project has no DOM tests.
- **README:** two lines run past its usual 120 characters: the Keyboard shortcuts line, and the line naming where
  cards open.
- **From the spec's "Later":** set symbols (which need Scryfall's set list), a card-image grid, and filtering by set
  type.
