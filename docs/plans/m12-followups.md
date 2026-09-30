# M12 follow-ups

These are the deferred findings from milestone 12 (Scryfall's tokens). They were triaged by the task reviews, the final
whole-milestone review, and that review's fix wave. None of them blocks M12. `m11-followups.md` still holds what M11
left.

## Checks for the owner (the first real use)
- **Installing:** quit Binder.app, then run `pnpm app` from `main` once the branch is merged.
  - Its first start upgrades the library with migration 008 (the `tokens` and `card_tokens` tables), saving
    `backups/binder-YYYY-MM-DD-before-008.db` first.
  - Since the card data was imported by an older Binder, a refresh then starts in the background. It re-imports the
    file already downloaded when Scryfall has nothing newer, which took about 5.5 s on the check's copy.
  - Until it finishes, the token lists are empty.
- **A game with tokens:** Toxrill against Tegwell.
  - Right-click a permanent that makes tokens (Alela, Cunning Conqueror → Faerie Rogue; Endless Ranks of the Dead →
    Zombie), and a spell on the stack (Tegwyll's Scouring).
  - Make an emblem from Create token…'s search ("elspeth").
  - A game started before the refresh finished has no token lists; Rematch picks them up.
- **The command zone at your window:** put a commander and two emblems there.
  - At Binder.app's 1320×900 the earlier two show 16 px each (11 and 8 px with four and five cards).
  - On a tall window (about 1117 px), the commander shrinks to a 4–8 px strip under the emblems. Say whether that
    bothers you (see "Your calls").
- **The search:** try a few names ("treasure", "spirit", "the monarch"). Same-name tokens come back in no useful order
  (see Later), and the pictures tell them apart.

## Your calls (decisions the approved plan made that the reviews questioned)
- **Token lists in more places:** the plan lists a card's tokens only on a face-up battlefield card and a spell on the
  stack. The final review pointed out cards that make tokens from elsewhere, where listing them reveals nothing:
  - the command zone: Eminence, e.g. Edgar Markov's Vampires;
  - the graveyard: embalm and eternalize;
  - the hand: cycling, e.g. Shark Typhoon;
  - an ability marker on the stack: its source's tokens, unless the source is face down.

  Today the workaround is Create token…'s search.
- **Emblems can be dragged out of the command zone.** A double-click doesn't play one, but a drag moves it to the
  battlefield or the stack, where it stays. On the stack it logs "cast", and Resolve puts it on the battlefield. Undo
  fixes it. Guard the drag, or leave it.
- **The command zone on tall windows:** to fit the side block, earlier cards overlap down to a 2-px floor, so a
  commander beside two emblems is a 4-px strip at about 1117 px tall. Hover still previews it, but clicking needs the
  strip. The options:
  - put the command zone on its own row once its cards don't fit side by side;
  - or draw the commander on top, with the emblems peeking out.

## Left by the final fix wave (found by its re-review; the milestone allows one fix wave)
- **The command zone spills to the left too** when its cards can't fit even at the 2-px floor: 6+ cards at the 64-px
  pile size, or a room narrower than one card. `justify-items-center` centres the wider item (`Table.tsx`, the
  `CommandZone` grid); `justify-items-[safe_center]` would keep the spill to the right. Separately, the room is measured
  as a whole-pixel `clientWidth`, up to 0.5 px generous.
- **A partner deck's tax label truncates at tall windows:** "Tax +0 / +0" is about 55–58 px in a zone about 54 px
  wide, so it reads "Tax +0 / +…". The full text is only in its tooltip.
- **The spec's §4.2 line** now ends "…are not linked (M12; art series and oversized cards are still skipped)". The
  parenthetical reads as if it qualified the reminder cards.

## Later (left after M12)
- **The import** (`src/server/bulk/import.ts`, `src/server/cards/`):
  - Tokens that make tokens (Mitotic Slime's Oozes) get no links: only rows headed for `cards` produce links.
  - A link to a digital-only or other-language printing is dropped even when a paper printing of the same token
    exists. Staging every token printing's id → oracle id would recover it.
  - `TOKEN_PRINTING_ORDER`'s last tie-break is `id`; the card rule uses set code and collector number, so which art of
    a same-day token is kept is stable but arbitrary.
  - Role printings the owner holds in the collection, a deck, or the scan queue would stay in `cards` (frozen) after
    the re-import, as well as in `tokens`. The check's copy had none (all 7 left `cards`).
  - The failure test fails while streaming, not inside the merge. The tokens' rollback rests on `replaceTokens` running
    inside the merge's transaction, where it can't fail a constraint.
- **The game** (`src/shared/playtest/`):
  - Moving an emblem to the stack isn't tested.
  - The purity test ("never changes the game it starts from") doesn't make an emblem. `apply` copies the seats first,
    so it is safe by reading.
  - An emblem moved into a graveyard isn't tested (exile is, which is the same branch).
  - The route's card schema has no `tokens`, so a token action's card loses its list on the server. Nothing sends one
    today: tokens from a card's list, the search, and the form carry none.
- **The server** (`src/server/cards/tokens.ts`, `src/server/playtest/`):
  - `searchTokens` lowercases the query in JS (all of Unicode) but the name with SQLite's `lower()` (ASCII only). Use
    `lower(@q)` on both sides.
  - The search's "whole name first" tier never changes the order, since an exact name also starts with the query. It's
    harmless.
  - `tests/helpers/db.ts`'s `addTokens` re-derives the import's sorting of lines, and could drift from `import.ts`.
- **The page** (`src/web/`):
  - Same-name tokens come back in `oracle_id` order (the check saw Spirit 1/1, 3/1, 2/2, 4/4, 2/2, 3/3). Sort them by
    colors, power, and toughness.
  - `tokenName` leaves out colours, so a white flying Spirit 1/1 and a colourless Spirit 1/1 share a label and an
    `aria-label`.
  - `keepPreviousData` brings the previous query's results back briefly after the search box is cleared and typed in
    again.
