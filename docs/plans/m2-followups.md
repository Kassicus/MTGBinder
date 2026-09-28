# M2 follow-ups

These are deferred findings from milestone 2 (Search), triaged by the final whole-milestone review. Fold each one into its milestone's plan when you write it. None of them blocks M2.

## M3 (collection): done in M3
All items below were completed in M3 (see docs/plans/2026-09-26-m3-collection.md); kept for the record.
- **Default printings for special products** (`src/server/cards/repo.ts` `rebuildCardNames`):
  - The v2 rule still makes about 3,400 cards default to special-product printings, mostly unpriced (Scryfall set types `box`, `memorabilia`, `masterpiece`, `funny`, `promo`). About 1,500 of those cards have a regular-set printing.
  - The Zeta Set (`slz`) alone is the default for 121 staples, including Lightning Bolt, Sol Ring, Birds of Paradise and Command Tower. Counterspell defaults to `mar`, and Rhystic Study to `fca`.
  - **Fix:**
    1. Store Scryfall's `set_type`: a migration, a new column in `map.ts`, and in staging.
    2. Rank regular set types first, and demote `box`, `memorabilia`, `masterpiece`, `the_list`, `funny` and `promo`.
    3. Bump `CARD_NAMES_VERSION` to 3, and rebuild only once `set_type` is populated (or trigger a refresh).
- **Library search at scale** (`src/server/search/run.ts` `searchLibrary`):
  - Fast at today's collection size, but at 23,000 collection rows an empty browse takes about 390 ms. The spec's 150 ms target is crossed at about 10,000 rows.
  - **Fix:**
    1. Pick each card's printing over narrow columns, then fetch only the page (the way `searchLocal` does).
    2. Join the `own`/`alloc` subqueries only when the filter uses `free`, `qty` or `is:wanted`.
    3. Count with `count(*) OVER ()`.
    4. Add a 20,000-row timing check to M3's end-to-end run.
- **Printings view:**
  - Foil and etched rows show the nonfoil price.
  - The sort has no final tiebreak, so two finishes of one printing tie on every key. Add `finish` as the last key.
  - The cards-view doc says "printing with the most copies", but the code picks the collection row (printing + finish) with the highest quantity.

## M4 (decks)
- (Done in M4.) **OwnershipBadge hides a built-deck conflict when you own no copies:** with 0 owned and a built deck claiming the card, it shows only "In Burn". Show the shortfall.

## M6 (brainstorm)
- (Done before M6: `openDb` registers it on every connection.) **`faces_include` registration:** the SQL function is emitted by `compile.ts` but registered only in `run.ts`. Register it wherever `compileFilter` can be called, before brainstorm tools use the compiler.

## Later (left after M8)
M8 did the items marked done; the rest wait for a later milestone.
- (Done in M8.) **Scryfall client:**
  - `downloadTimeoutMs` is a 10-minute cap on the whole 80 MB download. Use an idle timeout plus a generous overall cap.
  - The 4th consecutive 429 throws without setting a pause.
- (Done in M8.) **Scryfall search:**
  - Paging past the end returns 502 `scryfall_error`. It should return an empty page with `hasMore: false`.
  - `total` counts digital-only cards that the page then drops, so the UI could say "about N".
- **Catalog:**
  - (Done in M3.) Set and type autocomplete never refresh after a card-data refresh. Add `['catalog']` to `useBulkStatus`'s invalidation list.
  - (Done in M8.) Multi-word subtypes ("Time Lord") are split into separate words.
- (Done in M8.) **Parser:**
  - A lone `(` at the end gets "Expected a search term" with a zero-width span.
  - `m:{foo}` is accepted.
  - The rarity error message omits special/bonus.
  - It has two identical catch blocks.
- (Done in M8.) **Serializer:**
  - `quoteValue` doesn't protect name words containing `<` `>` `=` or starting with `-`/`!`.
  - Quote-only values produce `o:` and similar. A Name word made only of quotes also leaves a stray space in the
    composed query, which pauses the form on its own write. Trim `composeQuery`'s result or skip empty name terms
    (`src/web/lib/advanced-sync.ts`).
  - `EMPTY_FORM` shares its objects between copies; freeze it.
  - The `in:` branch is redundant.
- **Errors and types:**
  - The `ApiError` doc omits `span`.
  - `ApiErrorBody` repeats the `Span` shape.
  - `NO_OWNERSHIP` is mutable (`Object.freeze`).
- **Search page:**
  - (Done in M8.) Old Scryfall warnings stay visible after the query is cleared (gate the list on `enabled`).
  - (Done in M8.) `useBulkStatus` runs in Layout and also in Home/Settings, which doubles invalidation and polling on those pages. Split it into a read-only hook and a Layout-only effect.
  - List rows open only with a mouse.
  - The Grid/List and Cards/Printings toggles lack `aria-pressed`.
  - The scope radiogroup lacks arrow-key behavior.
  - `aria-invalid` isn't tied to the error text.
  - The offline banner isn't a live region.
  - (Done in M8.) "Search local card data instead" uses the URL query, while the scope buttons use the typed text.
- **Advanced panel:**
  - Single-control fields (Artist, Flavor, number inputs, selects) have no accessible name of their own.
  - (Done in M8.) The paused note can flash for one frame on back/forward.
  - (Done in M8.) `changeForm` relies on the disabled fieldset instead of checking the paused state. The one path around that
    is TypeChips' `onBlur={add}` firing when navigation disables the fieldset while a chip is half-typed, which
    would overwrite the navigated text.
- (Done in M8.) **All cards scope:** could hint that library-only keys (`in:`, `free`, `qty`) don't apply to Scryfall.

## Test hygiene (any time)
- **Scryfall client:**
  - The timeout test only checks that an `AbortSignal` exists.
  - No assertion that a failed download's body is cancelled.
  - A rejected queue slot never recovers (only reachable with a throwing injected clock).
  - The pause tests duplicate their clock scaffolding.
- **Card data:**
  - No tests for the `unk` demotion, the fallback order, the absent-key (null) M1 upgrade path, an empty download body, or a mid-stream download failure.
- **Parser:**
  - No tests for a lone `(` / `)` / `-(`, "Nothing before/after and", `!=`, or spans on successful nodes.
- **Search engine:**
  - No tests for paging past 60 results (hasMore, a non-first page, library paging).
  - The library-only-key error span isn't asserted.
  - The "missing values last" test uses a query with no missing prices.
- **API:**
  - No test that `/api/search/*` sits behind the local-only guard.
  - No tests for library `bad_query` + span, warnings on the 404 empty page, a non-`ScryfallError` becoming the generic 500, or `empty_query` vs `bad_request` codes.
- **End-to-end:**
  - Pin the Counterspell seed by set code.
  - Save curl status and time next to response bodies.

## Accepted as-is
- **Timing of default-printing rules:** `is_promo` outranks the future-date rule, and `date('now')` is evaluated at rebuild time, so a newly released printing becomes the default at the next import (within 7 days). Revisit with the M3 set_type work.
- **Vite dev proxy:** when the API server is down, the proxy answers with an HTTP error, so the page's single retry fires only in the production same-origin setup.
- **All cards sends raw Scryfall syntax:** library-only keys mean something else or nothing there.
