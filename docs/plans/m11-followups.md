# M11 follow-ups

These are the deferred findings from milestone 11 (Playtest). They were triaged by the task reviews, the final
whole-milestone review, and that review's fix wave. None of them blocks M11. The "Later" sections of
`m1-followups.md` to `m10-followups.md` still hold what earlier milestones left. M12 (Scryfall's tokens, spec §5.9.8) is
specced and not started.

## Checks for the owner (the first real use)
- **Installing:** quit Binder.app, then run `pnpm app` from `main` once the branch is merged. Its first start upgrades
  the library with migration 007 (the playtest's tables), saving `backups/binder-YYYY-MM-DD-before-007.db` first. Take
  a **Settings → Back up now** beforehand anyway.
- **A whole Commander game in Binder.app** (spec §7's manual check): Tegwell against Toxrill, with the playgroup's
  mulligans, a few turns each, tokens, an attached card, something on the stack, a commander cast twice (tax +4),
  commander damage, Switch side, and Undo. Quit Binder.app mid-game and reopen it: the game should be where you left
  it.
- **⌘Z in Binder.app:** the page takes ⌘Z for Undo. Check that the Electron window's Edit → Undo doesn't also act, and
  that one press undoes one action.
- **A big board:** make 100 tokens (the form's "How many") and drag a few around. Say if hovering or dragging stutters.
  The check measured saves (3 ms) but not the table's rendering at that size.
- **Card images:** the mulligan screen and the Look dialog load Scryfall's normal images, and show blank frames until
  they arrive. Say if the wait bothers you.
- **Window size:** the check ran at 1440×900. Try the smallest window you play in; the side block and the hand are the
  tightest parts.

## Left by the final fix wave (found by it; the milestone allows one fix wave)
- **A card attached to a card that is itself attached is never drawn.** `looseCards` leaves it out, and the Board's
  `FieldCard` draws only a loose card's direct attachments, so "Attach to…" followed by a click on a tucked card makes
  the card vanish from the board (undo brings it back). Either refuse to attach to a tucked card, or draw attachments of
  attachments. The most visible thing M11 leaves.
- **Counter names that are `Object.prototype` keys** (`constructor`, `toString`) become `NaN`, and `__proto__` is dropped
  (`game.ts`, the counter code's `c.counters[name] ?? 0`). Nothing crashes. One line: `Object.hasOwn(c.counters, name)`.
- **A host moved to the other side** keeps its attached cards, which then show at the spots they had before they were
  attached (they stop being tucked, since their controller differs).
- **The detach step:** a card taken off its host moves 0.07 of the half per step, while the Board draws the tuck at 30%
  × 22% of a card that stops growing at 150 px; on tall windows a detached card shifts about 15 px per step. Two tucked
  cards near the far edge can clamp to one spot, and tucked cards in the creature row are clipped at the half's edge.
- **The menu's backdrop** swallows a middle-click without closing the menu; the first press of a double-click outside a
  menu closes it, and the second reaches the table.

## Later (left after M11)
- **The game model** (`src/shared/playtest/`):
  - A flip is accepted for any card with two faces, though the page only offers it for double-faced cards (split and
    adventure cards have one image).
  - No direct tests of `visibleTo`, `canFlip`, `faceOf`, `looseCards`, `attachmentsOf`, or of the keep sequence when
    seat 2 starts. The log's tests cover most of them indirectly; a small `visibleTo` table would pin the rules.
  - `PASSES`'s doc comment in `placement.ts` still says cards "start sharing spots" after the passes; the fallback now
    spreads 13 more first, and creatures get only 4 distinct passes (the 0.97 cap).
  - An ability marker of a face-down card stays "A face-down card" if the card turns face up before it resolves (the
    log's resolve line names it correctly). `StackItem`'s doc comment says a marker names its card.
- **The log:**
  - A stolen card leaving the battlefield is credited to the seat that controlled it, though it goes to its owner's hand
    or library ("Meren returned Goblin 11 to their hand" for seat 1's card).
  - The "Turn N" line is filed under the turn before (`gameLog` uses the turn before the action), so the panel shows it
    at the bottom of the previous turn. Use `after.turn` for `nextTurn`.
  - A search to the library's top hides the card from the seat that searched.
  - An ability whose source left the game (a token that died) resolves as "An ability resolved" for both seats, though
    the token was public.
  - Tests don't cover attach/detach, copy, setCounter, exile wording, "the library ran out", or commander damage going
    down.
- **The server:**
  - `schema.ts` claims the typecheck catches an action not mirrored in the schema; with Zod 4 a missing action type or
    optional field still typechecks. Add an exhaustiveness check (`Exclude<Action['type'], …>` must be `never`) or
    reword the comment.
  - The malformed-input route tests check only the status, not the `bad_request` code.
  - A deck the editor shows with 10 main-board cards, one gone from the card data, is refused as "has 9" without
    saying a card was left out.
  - Tests don't cover seat 2's deck missing or too small, `first: 1` with two decks, `startingDraws: true` saved, or a
    gone commander-board card counted in `leftOut`.
- **Saving** (`src/web/lib/playtest-save.ts`, `playtest.ts`):
  - `reset()` doesn't end a pending retry wait or reset the attempt count: after a new game started during an outage,
    its first save can wait the old delay (up to 30 s) under a false "Couldn't save" banner.
  - End game drops unsent saves before its DELETE; if the DELETE fails, the page still shows actions the server never
    got. Reset on success, or refetch on error.
  - While the page reloads after a refused save, actions played before the refetch lands are refused too, each with a
    toast. With two windows, a ⌘Z in that gap could take back the other window's last action. Pausing play and undo
    while a reload is pending fixes both.
  - A retried save whose first attempt was stored but whose answer was lost gets a 409 and reloads (not idempotent).
    Rare on a local server.
- **The table** (`src/web/components/playtest/`):
  - Tab is taken even when goldfishing, where Switch side is off.
  - A drag has no `pointercancel` handler and isn't cleaned up if the Board unmounts mid-drag.
  - Draw… opens at 2 with a maximum of 1 when one card is left, and its "The library is empty" line never shows.
  - The Look dialog's reordering uses the browser's own drag and drop without `dataTransfer`, which Firefox won't start
    (fine in Binder.app); there's no keyboard way to reorder.
  - Keys are looser than the menus: `f` ignores a selection, and held keys repeat (holding `d` draws, holding ⌘Z
    undoes).
  - The graveyard/exile panel and the Log open at the same spot; Escape doesn't close them; the preview goes under a
    panel on its side and shows faintly through the Log; the attach and retry banners share a spot.
  - The token form's kind check is case-sensitive ("creature" typed in lowercase drops power/toughness), and a
    non-creature type line (a Vehicle) drops them too.
  - Rematch is disabled, with "a deck has been deleted", while the decks are still loading or failed to load.
  - `aria-label` sits on elements without a role in a few places; menu separators have no `role="separator"`.
  - `Board.tsx` is about 670 lines (the drag, the menus, the keys, the dialogs); the context object is rebuilt on each
    render, so every hover re-renders every card. Measure at a big board (above) before splitting it.
  - "A face-down card" is capitalized mid-sentence ("Counters on A face-down card").
  - `SearchDialog`'s doc comment says "then shuffle", but a search into the library shuffles first.
  - The hover stays on a card that moves without changing zone (an undone drag), and a pile's hover stays on its old
    top card when another lands on it.
  - Revealing (a card, or the top of a library) shows only a log line; a toast naming the card would show it.
  - The mulligan screen has no End game or New game.
  - The page accepts some values the server refuses (then reloads with a technical toast; the counter name is capped
    since the fix wave): a typed life or poison
    change over 10,000, a token's name, type line, or power/toughness past 200/200/20 characters, a move of more than
    200 cards.
  - Mulligan cards show as blank frames until their images load.
  - A commander in a library is never asked "Command zone instead?" when milled, looked at into a graveyard or exile,
    or searched out.
- **The page:**
  - A deck's Playtest for a deck too small to play (or deleted) quietly puts the first playable deck in seat 1.
  - "Start anyway" ignores an invalid "Other…" life (and has no disabled style); nothing says why Start game is off for
    one.
  - Focus drops to the page after Start game shows its confirm (and after Cancel), and after each Mulligan or Keep.
  - The old-game message runs two sentences together ("…another version of Binder This saved game can't be opened
    here.").
  - `/playtest/` (a trailing slash) gets the padded layout instead of the full-window table.
  - The shortcuts list's Esc line doesn't say it clears the selection on the Playtest page.
  - The mulligan screen's retry banner scrolls out of view on a tall screen.
- **README:** "`t` taps" (it taps or untaps), and the "(on the card under the pointer, or the selection)" aside reads as
  covering `f`; "each seat's panel" should be the side block; the right-click list leaves out Reveal and Create token…;
  double-clicking the command zone isn't mentioned; "the playgroup's rule" has no referent for a reader of the public
  repo.
