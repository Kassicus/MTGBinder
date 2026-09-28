# Binder M6 (Brainstorm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brainstorm decks with Claude, grounded in what the owner owns. A chat that searches the library and Scryfall,
reads decks, and saves ideas to the deckbuilder as prospective decks.

**Architecture:**
- **Tools (`src/server/ai/tools.ts`).** Spec §5.5's five tools, each a Zod-validated `betaZodTool` over code that
  already exists: library search, Scryfall search, card detail, deck analysis, and decklist-style name resolution.
- **Conversations (`src/server/ai/threads.ts`, `history.ts`).** `ai_threads` and `ai_messages`, which have existed
  since migration 001, plus `ai_messages.meta` (migration 004). Messages are stored exactly as sent and received.
  They are turned into what the chat shows, and into what's replayed to Claude.
- **The loop (`src/server/ai/chat.ts`).** Claude Opus 5.5 through the SDK's streaming Messages API, with adaptive
  thinking at effort `medium`, its notes between tool calls, refusal fallbacks, and a cached system prompt (`prompt.ts`).
  Each round streams; then Binder runs the tool calls and stores the round.
- **API (`src/server/ai/routes.ts`).** `/api/ai/threads…`, with answers streamed as server-sent events.
- **Web.** A Brainstorm page (conversation list, chat, a message box with Stop), a small Markdown renderer with
  `[[Card]]` links, and "Brainstorm with Claude" in the deck editor.

**Tech Stack:** Same as M1–M5. The Anthropic SDK (`@anthropic-ai/sdk` 0.128.0) has been installed since M5. No new
dependencies.

**Spec:** `docs/specs/2026-09-26-binder-design.md`. This plan covers milestone 6 of §8:
- §5.5 (Brainstorm);
- §6's Anthropic error handling;
- §4.1's `ai_threads` and `ai_messages`;
- the M6 items in `docs/plans/m5-followups.md`.

The deferred items that made sense before M6 were done in a separate reviewed batch, first. That batch covered:
- backups before a migration;
- `faces_include` registered on every connection;
- the key's settings UX;
- strict settings;
- test hygiene.

**How this plan was made:** Every code block was prototyped in a scratch copy of the project. Replaying this plan task
by task onto the current project reproduces that prototype exactly, and every checkpoint passes (730 tests
at the end, typecheck clean, build clean). There is no Anthropic key on this Mac, and the prototype never called
Anthropic: a local fake of the Messages API, streaming in the SDK's wire format, played Claude.

| Check | Result |
|---|---|
| SDK 0.128.0 against the fake | Streaming, tool calls with streamed inputs, thinking blocks replayed with their signatures, `fallbacks`, thinking display `updates`, block binding, and their beta headers, cache control: all sent and parsed as the docs describe |
| Chat loop tests | Tool rounds, a failing tool, schema-breaking input, input that isn't JSON, refusal, a fallback partway through an answer, `max_tokens`, API errors, Stop, busy, Continue, and the 16-request cap |
| Browser check on a copy of the real library (Task 6) | Start page → answer with card links and a table → "save it" made a prospective deck (with one name left out) → a card link opened the drawer → the deckbuilder showed the deck with categories → a deck conversation → Stop kept the text → reload → rename and delete → no-key state |
| The copy's start | `[backup] Backing up the database before upgrading it…` then `Saved …-before-004.db` (holding migrations 1–3), then migration 004 |

**Decisions made while prototyping (flagged for review):**
1. **Binder runs the tool loop itself, not the SDK's tool runner.** The spec says "the tool runner drives the loop". The
   prototype uses the SDK's streaming Messages API with its own loop of about 60 lines: stream, validate and run the
   tool calls, store, and ask again. The runner can't do two things without Binder taking over its history:
   - store each round atomically (a tool call with its results, since a tool may have created a deck);
   - drop what a declining model wrote before a fallback, before its tool calls run (the API's echo rule).

   The tools are still the SDK's `betaZodTool`s, validated before running. At most 16 requests per answer.
2. **Model and settings.** Claude Opus 5.5 (`claude-opus-5-5`), your choice (the spec said Opus 5). Its API differs from
   Opus 5 in ways that set the rest:
   - **Effort `medium`**, set explicitly; it's Opus 5.5's default. Anthropic's guidance for Opus 5.5: `medium` does better
     than Opus 5 did at `high` (the spec's setting), and each level up thinks longer and costs more. `EFFORT` in
     `chat.ts` changes it.
   - **Thinking display `updates`** (beta `thinking-display-updates-2026-08-18`). Opus 5.5 writes its notes between tool
     calls ("Looking at your green creatures") as thinking blocks, which would otherwise come back empty. The chat shows
     them; the reasoning itself stays hidden.
   - **Block binding `drop_block`** (beta `thinking-binding-controls-2026-08-01`). A replayed thinking block is tied to
     the exact system prompt, tools, and earlier messages. Binder's history is append-only, but a later Binder update
     that changes the system prompt would otherwise make old conversations fail; this drops those blocks instead.
   - **Refusal fallbacks** `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), routed by refusal category;
     a fallback model runs without Opus 5.5's thinking blocks, which the API handles.
   - Up to 64k output tokens; no forced tool choice (Opus 5.5 refuses it; Binder never used it).
3. **Tool inputs stream as Claude writes them** (`eager_input_streaming`). This follows the SDK docs' rule for
   streamed tools. A long decklist starts arriving at once, and Binder checks each input against its schema before
   running it.
4. **What's stored, and what Claude sees again.** Messages are stored exactly as sent and received, with:
   - `ai_messages.meta` recording the model, the stop reason and token usage;
   - a question Claude declined (after the fallbacks) kept for the chat, but not sent again, so the next message isn't
     declined for it;
   - a stopped answer keeping its text (and its usage so far);
   - a failed answer offering **Continue**;
   - a tool call cut off by `max_tokens` never run.
5. **Cost estimate.** Each conversation shows "≈ $…", from each answer's token usage at Claude Opus 5.5's prices ($4 per
   million input tokens, $20 output, $5 cache writes, $0.20 cache reads). A turn a fallback model answered is priced
   the same, so the figure is approximate.
6. **Tool details beyond the spec.**
   - `search_scryfall` ranks most-played first (EDHREC rank), and both searches return 25 results by default (at most
     60).
   - Names resolve like decklist import (exact, face, fuzzy ≥ 0.92). `get_card` suggests close names when none
     matches.
   - `create_prospective_deck` only ever creates prospective decks, never touching the collection or an existing
     deck. It keeps categories and boards, leaves out names that match no card and reports them, and makes no deck
     when none match.
7. **Deck-scoped conversations.**
   - The deck's summary goes in a text block before the first message, as the spec says.
   - The chat shows "About the deck …" instead of the summary's text.
   - Deleting the deck unlinks the conversation (`ON DELETE SET NULL`, since 001).
8. **`[[Card]]` links.** The system prompt asks for card names in double brackets. The chat turns them into links that
   open the card drawer, through a new `GET /api/cards/named`. Mana symbols render as icons.
9. **A small Markdown renderer**, pure and unit-tested, covering paragraphs, headings, lists, tables, code, bold,
   italics and links. It adds no dependency and never renders HTML.
10. **One answer at a time per conversation.** **Stop**, or leaving the page, stops it. Another window's answer shows
    as "Claude is answering in another window…" until it finishes.
11. **Titles.** A conversation takes the first line of its first message (60 characters) and can be renamed. Deleting
    a conversation asks first and keeps any deck Claude made.
12. **The system prompt** asks for brief answers, card names in brackets, the owner's own cards first, and the scope
    the owner asked for. It never changes, so it stays cached, and it's easy to tune in `src/server/ai/prompt.ts`.
13. **Clearer Anthropic errors** (from `m5-followups.md`): overload (529), server errors, timeouts, and the error body's
    own message instead of raw JSON. A refused key says to check it in Settings.

## Global Constraints

Everything from M1–M5 still applies:
- **Server and imports.**
  - The server listens on `127.0.0.1:4321`, and `/api/*` sits behind the local-only guard.
  - Node `>=24`.
  - Every relative import has an explicit `.ts`/`.tsx` extension.
  - Erasable TypeScript only.
  - Exact pinned dependency versions. **M6 adds none.**
- **API and SQL.**
  - API errors are JSON `{ "error": { "code", "message" } }`.
  - Every change goes through a POST, PUT, PATCH, or DELETE whose body is validated by zod. A body that isn't JSON is
    a 400 `bad_request`.
  - Every user-supplied value in SQL is a bound parameter.
- **UI:** dark `stone` palette with an `amber` accent, Tailwind utilities only.
- **Not a git repository:** every task ends with a checkpoint (`pnpm typecheck && pnpm test`, plus `pnpm build` for web
  tasks), never a commit.
- **Never write to `data/`.** End-to-end checks use a copy in `/tmp`.
- **Scanning never calls Anthropic** (the owner's ruling). The API key is for Claude's deckbuilding help.
- **The API key never leaves the server.** It is sent only to `api.anthropic.com` (the SDK's host is pinned), never to
  the browser or a log.

New in M6:
- **Nothing from the owner's library changes without the owner asking.** The tools only read, except
  `create_prospective_deck`, which only adds a new prospective deck.
- **No real Anthropic calls in tests or checks.** They use the fake Messages API. The owner's manual test with a real
  key is the only real call.
- **Spend stays bounded:** at most 16 requests per answer, one answer at a time per conversation, and Stop.

## Review Focus

1. **Money.** An answer can't loop forever, can't run twice at once in one conversation, and stops when the owner
   presses Stop or leaves the page. *Tests: Task 3 "stops an answer that keeps calling tools after MAX_ROUNDS
   requests…", "stops on request…", "stop() stops the answer in progress"; Task 4 "stops an answer…" (busy, 409).*
2. **Half-finished answers.** A failure partway (network, rate limit, overload, a bad tool input) keeps every finished
   round, never stores a tool call without its result, and can be continued. *Tests: Task 3 "reports an API failure
   and lets Continue ask again", "tells Claude when a tool fails, and carries on", "asks again when a streamed tool
   input is not JSON at all"; Task 4 "continues an answer that failed".*
3. **Refusals and fallbacks** follow the API's rules. Nothing a declining model wrote before a fallback is run or sent
   back except its text. A declined question isn't sent again. *Tests: Task 3 "records a refusal…", "drops what the
   declining model wrote before a fallback…", the history tests.*
4. **The owner's library.** Only `create_prospective_deck` writes, and it only adds a prospective deck; an unknown name
   is left out and reported, never guessed. *Tests: Task 2 `create_prospective_deck` tests.*
5. **The key.** It never reaches the browser or a log, and brainstorming without one explains where to add it. *Tests:
   Task 3 "checks for a key…", Task 4 "needs an API key"; M5's settings tests.*

---

## File map

```
src/shared/types.ts                 + DeckImportItem.category, CreatedDeck, ThreadSummary, ChatItem, ThreadDetail, ChatEvent
src/server/
  cards/repo.ts, cards/routes.ts    findCardByName; GET /api/cards/named
  decks/repo.ts                     importIntoDeck sets line categories
  search/scryfall.ts                ScryfallSearchParams.order (edhrec)
  db/migrations/004_brainstorm.sql  ai_messages.meta, an index
  ai/client.ts                      clearer describeAiError
  ai/tools.ts                       the five tools
  ai/threads.ts                     conversations and messages
  ai/prompt.ts                      the system prompt, deck context
  ai/history.ts                     replay, chat items, cost estimate
  ai/chat.ts                        the streaming tool loop
  ai/routes.ts, app.ts              /api/ai
src/web/
  lib/markdown.ts, lib/brainstorm.ts
  components/brainstorm/            Markdown, ChatItemView, Composer, ChatView, ThreadList
  pages/BrainstormPage.tsx, routes.tsx, components/Layout.tsx, components/decks/DeckHeader.tsx
tests/
  helpers/fake-anthropic.ts         a local fake of the Messages API
  server/ai-tools, brainstorm, ai-api (+ api, decks, search-api cases); web/brainstorm
```

---

### Task 1: Card lookup by name, Scryfall orders, and line categories on import

**Files:**
- Modify: `src/shared/types.ts` (`DeckImportItem.category`)
- Modify: `src/server/decks/repo.ts` (`importIntoDeck` sets categories)
- Modify: `src/server/search/scryfall.ts` (`ScryfallSearchParams.order`)
- Modify: `src/server/cards/repo.ts` (`findCardByName`), `src/server/cards/routes.ts` (`GET /api/cards/named`)
- Test: `tests/server/api.test.ts`, `tests/server/decks.test.ts`, `tests/server/search-api.test.ts`

**Interfaces:**
- Produces:
  - `DeckImportItem.category?: string | null`: `importIntoDeck` sets it on the line, and keeps a line's category when
    an import leaves it out.
  - `ScryfallSearchParams.order?: string`: one of Scryfall's own orders (`'edhrec'`), used instead of `sort`'s.
  - `findCardByName(db, name): CardSummary | null` in `src/server/cards/repo.ts`: full name or one face's, ignoring
    case, accents, and punctuation.
  - `GET /api/cards/named?name=…` → `CardSummary`, 404 `not_found` when no card has the name, 400 for a blank name.

- [ ] **Step 1: Write the failing tests**

In `tests/server/api.test.ts`, replace:

```ts
    expect(detail.card.name).toBe('Lightning Bolt')
    expect(detail.printings.map((p) => p.setCode)).toEqual(['sta', 'm11', 'm10'])
  })

```

with:

```ts
    expect(detail.card.name).toBe('Lightning Bolt')
    expect(detail.printings.map((p) => p.setCode)).toEqual(['sta', 'm11', 'm10'])
  })

  it('finds a card by its written name, or one face of it', async () => {
    const app = makeApp()
    const named = async (name: string) => (await app.request(`/api/cards/named?name=${encodeURIComponent(name)}`))
    expect(await body<CardSummary>(await named('lightning bolt'))).toMatchObject({ name: 'Lightning Bolt' })
    expect(await body<CardSummary>(await named('Atraxa Praetors Voice'))).toMatchObject({ name: "Atraxa, Praetors' Voice" })
    expect(await body<CardSummary>(await named('Ice'))).toMatchObject({ name: 'Fire // Ice' })
    expect(await body<CardSummary>(await named('Fire // Ice'))).toMatchObject({ name: 'Fire // Ice' })
    expect(await body<CardSummary>(await named('Brazen Borrower'))).toMatchObject({ name: 'Brazen Borrower // Petty Theft' })
    expect((await named('Not A Card')).status).toBe(404)
    expect((await named('  ')).status).toBe(400)
  })

```

In `tests/server/decks.test.ts`, replace:

```ts
    expect(getLineRows(db, burn).map((l) => [l.board, l.quantity])).toEqual([['main', 4]])
  })
})
```

with:

```ts
    expect(getLineRows(db, burn).map((l) => [l.board, l.quantity])).toEqual([['main', 4]])
  })

  it("sets an imported line's category, and keeps a line's category when the import gives none", () => {
    const boltOracle = fixtureCard('Lightning Bolt').oracle_id!
    importIntoDeck(db, burn, [{ oracleId: boltOracle, cardId: null, quantity: 1, board: 'side', category: 'Removal' }], false)
    importIntoDeck(db, burn, [{ oracleId: boltOracle, cardId: null, quantity: 1, board: 'side' }], false)
    expect(getLineRows(db, burn).filter((l) => l.board === 'side').map((l) => [l.quantity, l.category])).toEqual([[2, 'Removal']])
  })
})
```

In `tests/server/search-api.test.ts`, replace:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ScryfallError } from '../../src/server/scryfall/client.ts'
import type { ScryfallCard, ScryfallList } from '../../src/server/scryfall/types.ts'
import type { SetInfo, TypeCatalog } from '../../src/server/catalog/catalog.ts'
```

with:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ScryfallError } from '../../src/server/scryfall/client.ts'
import { searchScryfall } from '../../src/server/search/scryfall.ts'
import type { ScryfallCard, ScryfallList } from '../../src/server/scryfall/types.ts'
import type { SetInfo, TypeCatalog } from '../../src/server/catalog/catalog.ts'
```

In `tests/server/search-api.test.ts`, replace:

```ts
      ['Lightning Helix', 'mkm', 0, 0],
    ])
  })

```

with:

```ts
      ['Lightning Helix', 'mkm', 0, 0],
    ])
  })

  it("can ask for one of Scryfall's own orders, such as most-played first", async () => {
    const getJson = vi.fn(async (_path: string) => scryfallList([]))
    await searchScryfall(createTestDb(), stubScryfall({ getJson }), { q: 't:elf', sort: 'name', order: 'edhrec', dir: 'asc', page: 1 })
    expect(new URL(`https://api.scryfall.com${getJson.mock.calls[0]?.[0]}`).searchParams.get('order')).toBe('edhrec')
  })

```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/server/api.test.ts tests/server/decks.test.ts tests/server/search-api.test.ts`
Expected: FAIL: `/api/cards/named` answers 404; the imported category is null; Scryfall is asked for `order=name`, not `edhrec`.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, replace:

```ts
export interface DeckImportItem {
  oracleId: string
  cardId: string | null
  quantity: number
  board: Board
}
```

with:

```ts
export interface DeckImportItem {
  oracleId: string
  cardId: string | null
  quantity: number
  board: Board
  /** A role for the line, such as "Ramp"; a line that already has one keeps it when this is left out. */
  category?: string | null
}
```

In `src/server/decks/repo.ts`, replace:

```ts
): { lines: number; copies: number } {
  const upsert = db.prepare(
    `INSERT INTO deck_cards (deck_id, oracle_id, preferred_card_id, quantity, board) VALUES (@deckId, @oracleId, @preferred, @quantity, @board)
     ON CONFLICT (deck_id, oracle_id, board) DO UPDATE SET quantity = quantity + excluded.quantity,
       preferred_card_id = COALESCE(excluded.preferred_card_id, preferred_card_id)`,
  )
  return db.transaction(() => {
```

with:

```ts
): { lines: number; copies: number } {
  const upsert = db.prepare(
    `INSERT INTO deck_cards (deck_id, oracle_id, preferred_card_id, quantity, board, category)
     VALUES (@deckId, @oracleId, @preferred, @quantity, @board, @category)
     ON CONFLICT (deck_id, oracle_id, board) DO UPDATE SET quantity = quantity + excluded.quantity,
       preferred_card_id = COALESCE(excluded.preferred_card_id, preferred_card_id),
       category = COALESCE(excluded.category, category)`,
  )
  return db.transaction(() => {
```

In `src/server/decks/repo.ts`, replace:

```ts
    let copies = 0
    for (const item of items) {
      upsert.run({ deckId, oracleId: item.oracleId, preferred: preferredFor(db, item.oracleId, item.cardId), quantity: item.quantity, board: item.board })
      lines.add(`${item.oracleId}/${item.board}`)
      copies += item.quantity
```

with:

```ts
    let copies = 0
    for (const item of items) {
      upsert.run({
        deckId,
        oracleId: item.oracleId,
        preferred: preferredFor(db, item.oracleId, item.cardId),
        quantity: item.quantity,
        board: item.board,
        category: item.category ?? null,
      })
      lines.add(`${item.oracleId}/${item.board}`)
      copies += item.quantity
```

In `src/server/search/scryfall.ts`, replace:

```ts
  q: string
  sort: Exclude<SearchSort, 'added'>
  dir: SortDir
  page: number
```

with:

```ts
  q: string
  sort: Exclude<SearchSort, 'added'>
  /** One of Scryfall's own orders (`edhrec`: most-played first), in place of `sort`'s. */
  order?: string
  dir: SortDir
  page: number
```

In `src/server/search/scryfall.ts`, replace:

```ts
    q: params.q,
    unique: 'cards',
    order: ORDER[params.sort],
    dir: params.dir,
    page: String(params.page),
```

with:

```ts
    q: params.q,
    unique: 'cards',
    order: params.order ?? ORDER[params.sort],
    dir: params.dir,
    page: String(params.page),
```

In `src/server/cards/repo.ts`, replace:

```ts
    imageSmall: r.image_small,
  }))
}
```

with:

```ts
    imageSmall: r.image_small,
  }))
}

/**
 * The card a written name means, as its default printing: its full name, or one face's (for [[Fire]] or [[Fire // Ice]]),
 * ignoring case, accents, and punctuation. Null when no card has that name.
 */
export function findCardByName(db: DB, name: string): CardSummary | null {
  const key = normalizeName(name.split(' // ')[0] ?? name)
  if (key === '') return null
  const full = db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM card_names n JOIN cards c ON c.id = n.default_card_id WHERE n.search_name IN (?, ?)`)
    .get(normalizeName(name), key) as SummaryRow | undefined
  const row =
    full ??
    (
      db
        .prepare(
          `SELECT ${SUMMARY_COLUMNS}, n.face_names FROM card_names n JOIN cards c ON c.id = n.default_card_id
           WHERE instr(n.face_names, char(10)) > 0 AND n.search_name LIKE ?`,
        )
        .all(`%${key}%`) as Array<SummaryRow & { face_names: string }>
    ).find((r) => r.face_names.split('\n').some((face) => normalizeName(face) === key))
  return row
    ? { oracleId: row.oracle_id, cardId: row.card_id, name: row.name, manaCost: row.mana_cost, typeLine: row.type_line, imageSmall: row.image_small }
    : null
}
```

In `src/server/cards/routes.ts`, replace:

```ts
import { ApiError, parseWith } from '../http.ts'
import { getOwnership } from '../ownership/repo.ts'
import { autocomplete, getCard, getPrintings } from './repo.ts'

const AutocompleteQuery = z.object({
  q: z.string().max(200).default(''),
```

with:

```ts
import { ApiError, parseWith } from '../http.ts'
import { getOwnership } from '../ownership/repo.ts'
import { autocomplete, findCardByName, getCard, getPrintings } from './repo.ts'

const NamedQuery = z.object({ name: z.string().trim().min(1).max(200) })
const AutocompleteQuery = z.object({
  q: z.string().max(200).default(''),
```

In `src/server/cards/routes.ts`, replace:

```ts
    const { q, limit } = parseWith(AutocompleteQuery, c.req.query())
    return c.json(autocomplete(deps.db, q, limit))
  })

```

with:

```ts
    const { q, limit } = parseWith(AutocompleteQuery, c.req.query())
    return c.json(autocomplete(deps.db, q, limit))
  })

  // Brainstorm's [[card]] links (spec §5.5): the card a written name means.
  routes.get('/named', (c) => {
    const card = findCardByName(deps.db, parseWith(NamedQuery, c.req.query()).name)
    if (!card) throw new ApiError(404, 'not_found', 'No card has that name')
    return c.json(card)
  })

```

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run tests/server/api.test.ts tests/server/decks.test.ts tests/server/search-api.test.ts`
Expected: PASS (61 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; 684 tests pass.

---

### Task 2: Brainstorm's tools

The five tools of spec §5.5, over the owner's library, the card data, Scryfall, and the decks. Each is a
`betaZodTool` (the SDK's helper: a Zod schema, converted to the tool's JSON Schema, and validated before `run`). The
chat loop (Task 3) sends `definitions` with every request and calls `run` for each tool call Claude makes.

**Files:**
- Modify: `src/shared/types.ts` (`CreatedDeck`)
- Create: `src/server/ai/tools.ts`
- Test: `tests/server/ai-tools.test.ts`

**Interfaces:**
- Consumes (Task 1): `DeckImportItem.category`, `ScryfallSearchParams.order`; and from M1–M5: `searchLibrary`,
  `searchScryfall`, `cardNameIndex`, `createFuzzySearch`, `FUZZY_THRESHOLD`, `getCard`, `getOwnership`, `deckDetail`,
  `createDeck`, `importIntoDeck`, `getDeckRow`, `SearchQueryError`, `ScryfallError`.
- Produces:
  - `CreatedDeck` in `src/shared/types.ts`.
  - `createBrainstormTools({ db, scryfall }): BrainstormTools`, where `BrainstormTools` has:
    - `definitions: Anthropic.Beta.BetaToolUnion[]` (always the same five, in the same order, each with
      `eager_input_streaming: true`);
    - `run(name, input): Promise<ToolOutcome>`: validates, runs, and answers `{ content: string (JSON), deck:
      CreatedDeck | null }`, or throws with a message Claude can act on;
    - `describe(name, input): string`: the chat's activity line, such as "Searching your library for \`t:elf\`".
  - `createdDeckFrom(content): CreatedDeck | null`: the deck a `create_prospective_deck` result describes.
  - `MAX_DECK_CARDS = 250`.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/ai-tools.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createBrainstormTools, createdDeckFrom } from '../../src/server/ai/tools.ts'
import type { DB } from '../../src/server/db/index.ts'
import { deckDetail } from '../../src/server/decks/analysis.ts'
import { ScryfallError } from '../../src/server/scryfall/client.ts'
import { stubScryfall } from '../helpers/app.ts'
import { count, createTestDb } from '../helpers/db.ts'
import { fixtureCard } from '../helpers/fixtures.ts'
import { deck, inDeck, own } from '../helpers/library.ts'

let db: DB

// Own 2 Llanowar Elves (one held by the built deck Elves) and 1 Sol Ring.
beforeEach(() => {
  db = createTestDb()
  own(db, 'Llanowar Elves', undefined, 2)
  own(db, 'Sol Ring', undefined, 1)
  const elves = deck(db, 'Elves', 'built', 'commander')
  inDeck(db, elves, 'Llanowar Elves', 1)
})

const tools = (scryfall = stubScryfall()) => createBrainstormTools({ db, scryfall })
const run = async (name: string, input: unknown, scryfall = stubScryfall()) =>
  JSON.parse((await tools(scryfall).run(name, input)).content) as Record<string, unknown>

describe('search_my_library', () => {
  it("finds owned cards with the owner's stake in each", async () => {
    expect(await run('search_my_library', { query: 't:elf' })).toEqual({
      total: 1,
      cards: [
        {
          name: 'Llanowar Elves',
          mana_cost: '{G}',
          type: 'Creature — Elf Druid',
          pt: '1/1',
          price_usd: expect.any(Number),
          owned: 2,
          free: 1,
          decks: ['Elves (built, 1)'],
        },
      ],
    })
  })

  it('limits results and reports a bad query so Claude can fix it', async () => {
    own(db, 'Forest', undefined, 1)
    expect(((await run('search_my_library', { query: 'mv<=1', limit: 1 })).cards as unknown[]).length).toBe(1)
    await expect(tools().run('search_my_library', { query: 'mv>' })).rejects.toThrow(/^That query isn't valid/)
    await expect(tools().run('search_my_library', { query: '' })).rejects.toThrow()
  })
})

describe('search_scryfall', () => {
  it('searches Scryfall most-played first and marks owned cards', async () => {
    const paths: string[] = []
    const scryfall = stubScryfall({
      getJson: async (path) => {
        paths.push(path)
        return { object: 'list', total_cards: 1, has_more: false, data: [fixtureCard('Sol Ring')] }
      },
    })
    const result = await run('search_scryfall', { query: 'o:"add {c}{c}"' }, scryfall)
    expect(new URLSearchParams(paths[0]!.split('?')[1]).get('order')).toBe('edhrec')
    expect(result).toMatchObject({ total: 1, cards: [{ name: 'Sol Ring', owned: 1, free: 1 }] })
  })

  it('says when Scryfall is offline', async () => {
    const scryfall = stubScryfall({ getJson: () => Promise.reject(new ScryfallError('offline', null, 'fetch failed')) })
    await expect(tools(scryfall).run('search_scryfall', { query: 't:elf' })).rejects.toThrow(/can't be reached/)
  })
})

describe('get_card', () => {
  it("gives a card's text, legality, and the owner's copies", async () => {
    const card = await run('get_card', { name: 'llanowar elves' })
    expect(card).toMatchObject({
      name: 'Llanowar Elves',
      mana_value: 1,
      oracle_text: '{T}: Add {G}.',
      color_identity: 'G',
      owned: 2,
      free: 1,
      decks: ['Elves (built, 1)'],
    })
    expect(card.legal_in).toContain('commander')
  })

  it('gives each face of a multi-face card', async () => {
    const card = await run('get_card', { name: 'Fire // Ice' })
    expect((card.faces as Array<{ name: string }>).map((f) => f.name)).toEqual(['Fire', 'Ice'])
  })

  it('suggests close names when none matches', async () => {
    await expect(tools().run('get_card', { name: 'Llanowar Elfs' })).resolves.toBeTruthy() // fuzzy ≥ 0.92 resolves
    await expect(tools().run('get_card', { name: 'Llanowar' })).rejects.toThrow(/No card is named "Llanowar"\. Did you mean: Llanowar Elves\?/)
  })
})

describe('get_deck', () => {
  it('reads a deck with the status of every card', async () => {
    const id = deck(db, 'Burn', 'prospective', 'modern')
    inDeck(db, id, 'Lightning Bolt', 4)
    expect(await run('get_deck', { deck_id: id })).toMatchObject({
      name: 'Burn',
      format: 'modern',
      status: 'prospective',
      completion_percent: 0,
      cards: [{ name: 'Lightning Bolt', quantity: 4, board: 'main', status: 'buy', short: 4 }],
    })
    await expect(tools().run('get_deck', { deck_id: 999 })).rejects.toThrow('There is no deck 999.')
  })
})

describe('create_prospective_deck', () => {
  it('makes a prospective deck from names, boards, and categories, leaving out names it can’t match', async () => {
    const outcome = await tools().run('create_prospective_deck', {
      name: 'Elf Ramp',
      format: 'commander',
      notes: 'Go wide with elves.',
      cards: [
        { name: 'Omnath, Locus of Creation', quantity: 1, board: 'commander' },
        { name: 'llanowar elves', quantity: 1, category: 'Ramp' },
        { name: 'Sol Ring', quantity: 1, category: 'Ramp' },
        { name: 'Elvish Archdruidd', quantity: 1 },
      ],
    })
    expect(outcome.deck).toMatchObject({ name: 'Elf Ramp', format: 'commander', cardCount: 3, unresolved: ['Elvish Archdruidd'] })
    const detail = deckDetail(db, outcome.deck!.id)!
    expect(detail).toMatchObject({ status: 'prospective', notes: 'Go wide with elves.' })
    expect(detail.lines.map((l) => [l.name, l.board, l.category])).toEqual([
      ['Llanowar Elves', 'main', 'Ramp'],
      ['Omnath, Locus of Creation', 'commander', null],
      ['Sol Ring', 'main', 'Ramp'],
    ])
    expect(JSON.parse(outcome.content)).toMatchObject({ deck_id: outcome.deck!.id, cards: 3, unresolved: ['Elvish Archdruidd'] })
  })

  it('makes nothing when no name matches, and refuses a bad format', async () => {
    const before = count(db, 'decks')
    await expect(
      tools().run('create_prospective_deck', { name: 'X', format: 'commander', cards: [{ name: 'Nothing Real', quantity: 1 }] }),
    ).rejects.toThrow(/no deck was made/)
    await expect(tools().run('create_prospective_deck', { name: 'X', format: 'brawl', cards: [{ name: 'Sol Ring', quantity: 1 }] })).rejects.toThrow()
    expect(count(db, 'decks')).toBe(before)
  })
})

describe('activity lines', () => {
  it('say what each call does', () => {
    const t = tools()
    const elves = db.prepare("SELECT id FROM decks WHERE name = 'Elves'").pluck().get() as number
    expect(t.describe('search_my_library', { query: 't:elf' })).toBe('Searching your library for `t:elf`')
    expect(t.describe('search_scryfall', { query: 'id:g' })).toBe('Searching Scryfall for `id:g`')
    expect(t.describe('get_card', { name: 'Sol Ring' })).toBe('Looking up Sol Ring')
    expect(t.describe('get_deck', { deck_id: elves })).toBe('Reading Elves')
    expect(t.describe('get_deck', { deck_id: 999 })).toBe('Reading deck 999')
    expect(t.describe('create_prospective_deck', { name: 'Elf Ramp', cards: [{ quantity: 1 }, { quantity: 4 }] })).toBe(
      'Creating the deck “Elf Ramp” (5 cards)',
    )
    expect(t.describe('get_card', null)).toBe('Looking up ')
  })

  it('reads a created deck back from its tool result', () => {
    expect(createdDeckFrom('not json')).toBeNull()
    expect(createdDeckFrom('{"total": 1}')).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/server/ai-tools.test.ts`
Expected: FAIL: `src/server/ai/tools.ts` does not exist.

- [ ] **Step 3: Implement**

Add to the end of `src/shared/types.ts`, after a blank line:

```ts
/** A prospective deck Claude saved to the deckbuilder. */
export interface CreatedDeck {
  id: number
  name: string
  format: FormatId
  cardCount: number
  /** Share of the deck the owner has available, 0–1. */
  completion: number
  costToFinish: number
  /** Card names Claude gave that match no card, so were left out. */
  unresolved: string[]
}
```

Create `src/server/ai/tools.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { FORMAT_IDS, FORMATS } from '../../shared/formats.ts'
import { normalizeName } from '../../shared/normalize.ts'
import type { Board, CreatedDeck, DeckImportItem, FormatId, Ownership, SearchCard } from '../../shared/types.ts'
import { createFuzzySearch } from '../cards/fuzzy.ts'
import { cardNameIndex, type CardNameIndex } from '../cards/names.ts'
import { getCard } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { deckDetail } from '../decks/analysis.ts'
import { FUZZY_THRESHOLD } from '../decks/import.ts'
import { createDeck, getDeckRow, importIntoDeck } from '../decks/repo.ts'
import { getOwnership } from '../ownership/repo.ts'
import { ScryfallError, type ScryfallClient } from '../scryfall/client.ts'
import { SearchQueryError } from '../search/compile.ts'
import { LOCAL_PAGE_SIZE, searchLibrary } from '../search/run.ts'
import { searchScryfall } from '../search/scryfall.ts'

/** Results a search returns unless Claude asks for another number. */
const DEFAULT_LIMIT = 25
/** Most distinct cards Claude may put in one new deck. */
export const MAX_DECK_CARDS = 250
/** How close a name must be for get_card to suggest it when nothing matches. */
const SUGGEST_THRESHOLD = 0.8

export interface ToolOutcome {
  /** The tool result Claude reads (JSON). */
  content: string
  /** Set when the call created a deck, for the "Open in deckbuilder" button. */
  deck: CreatedDeck | null
}

export interface BrainstormTools {
  /** Tool definitions for the API, always in the same order so the prompt cache holds. */
  definitions: Anthropic.Beta.BetaToolUnion[]
  /** Validates a call's input and runs it. Throws with a message Claude can act on when the input or the call fails. */
  run(name: string, input: unknown): Promise<ToolOutcome>
  /** The activity line the chat shows for a call: "Searching your library for `t:elf`". */
  describe(name: string, input: unknown): string
}

const money = (usd: number | null) => (usd === null ? null : Math.round(usd * 100) / 100)

function stake(ownership: Ownership) {
  return {
    owned: ownership.owned,
    free: ownership.free,
    decks: ownership.decks.map((d) => `${d.name} (${d.status}, ${d.quantity})`),
  }
}

function compact(card: SearchCard) {
  return {
    name: card.name,
    mana_cost: card.manaCost,
    type: card.typeLine,
    ...(card.power !== null ? { pt: `${card.power}/${card.toughness ?? '?'}` } : {}),
    ...(card.loyalty !== null ? { loyalty: card.loyalty } : {}),
    price_usd: money(card.priceUsd),
    ...stake(card.ownership),
  }
}

const Query = z.string().trim().min(1).max(500)
const Limit = z.number().int().min(1).max(LOCAL_PAGE_SIZE)
const BoardSchema = z.enum(['commander', 'main', 'side', 'maybe'])

const SearchInput = z.object({
  query: Query.describe('A search in Scryfall syntax, e.g. `t:elf id:g mv<=3` or `o:"draw a card" f:commander`.'),
  limit: Limit.optional().describe(`Most cards to return (default ${DEFAULT_LIMIT}).`),
})
const CardInput = z.object({ name: z.string().trim().min(1).max(200).describe("The card's name, as printed.") })
const DeckInput = z.object({ deck_id: z.number().int().min(1).describe('The deck id Binder gave the deck.') })
const CreateInput = z.object({
  name: z.string().trim().min(1).max(100).describe("The deck's name."),
  format: z.enum(FORMAT_IDS as [FormatId, ...FormatId[]]),
  notes: z.string().max(5000).optional().describe('The plan for the deck, in a few sentences: its strategy and key cards.'),
  cards: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        quantity: z.number().int().min(1).max(99),
        board: BoardSchema.optional().describe('Defaults to main. Commanders go on the commander board.'),
        category: z.string().trim().max(60).optional().describe('A role such as "Ramp" or "Removal".'),
      }),
    )
    .min(1)
    .max(MAX_DECK_CARDS),
})

/** Why a Scryfall search failed, in words Claude can act on. */
function scryfallProblem(err: unknown): string {
  if (err instanceof ScryfallError && err.code === 'offline') return "Scryfall can't be reached right now; search the library instead"
  if (err instanceof ScryfallError && err.code === 'rate_limited') return 'Scryfall is rate-limiting searches; wait before searching it again'
  return err instanceof Error ? err.message : String(err)
}

/** Brainstorm's tools (spec §5.5), over the owner's library, the card data, Scryfall, and the decks. */
export function createBrainstormTools(deps: { db: DB; scryfall: ScryfallClient }): BrainstormTools {
  const { db, scryfall } = deps

  /** Resolves a written card name the way decklist import does: exact, then a face, then a close fuzzy match. */
  function resolver() {
    const index: CardNameIndex = cardNameIndex(db)
    let fuzzy: ReturnType<typeof createFuzzySearch> | undefined
    return {
      index,
      find(name: string): string | null {
        const hit = index.find(name)
        if (hit) return hit.oracleId
        const key = normalizeName(name)
        if (key === '') return null
        fuzzy ??= createFuzzySearch(index.keys)
        return fuzzy(key, FUZZY_THRESHOLD)[0]?.oracleId ?? null
      },
      suggest(name: string): string[] {
        fuzzy ??= createFuzzySearch(index.keys)
        const names = fuzzy(normalizeName(name), SUGGEST_THRESHOLD).map((h) => index.name(h.oracleId) ?? '')
        return [...new Set(names.filter(Boolean))].slice(0, 3)
      },
    }
  }

  const tools = [
    betaZodTool({
      name: 'search_my_library',
      description:
        "Searches the cards the owner owns (their collection), in Scryfall syntax. Call this whenever a suggestion depends on what they own: before recommending a card as 'already owned', and to find owned cards that fit a plan. Library-only filters: `free>0` (copies not in built decks), `qty>=2` (copies owned), `is:foil`, and `in:built`, `in:prospective`, or `in:\"Deck name\"` (cards in those decks). Each result has owned (copies), free (not in built decks), and the decks using it.",
      inputSchema: SearchInput,
      run: ({ query, limit = DEFAULT_LIMIT }) => {
        try {
          const page = searchLibrary(db, { q: query, sort: 'name', dir: 'asc', page: 1, view: 'cards' })
          return JSON.stringify({ total: page.total, cards: page.cards.slice(0, limit).map(compact) })
        } catch (err) {
          if (err instanceof SearchQueryError) throw new Error(`That query isn't valid: ${err.message}`)
          throw err
        }
      },
    }),
    betaZodTool({
      name: 'search_scryfall',
      description:
        "Searches every Magic card on Scryfall, in Scryfall syntax, most-played first (EDHREC rank). Call this to find cards the owner doesn't own yet, e.g. upgrades or missing pieces. Each result shows how many copies the owner has, so owned cards stand out.",
      inputSchema: SearchInput,
      run: async ({ query, limit = DEFAULT_LIMIT }) => {
        try {
          const page = await searchScryfall(db, scryfall, { q: query, sort: 'name', order: 'edhrec', dir: 'asc', page: 1 })
          return JSON.stringify({
            total: page.total,
            ...(page.warnings.length > 0 ? { warnings: page.warnings } : {}),
            cards: page.cards.slice(0, limit).map(compact),
          })
        } catch (err) {
          throw new Error(scryfallProblem(err))
        }
      },
    }),
    betaZodTool({
      name: 'get_card',
      description:
        "Gets one card's full Oracle text, types, legality in each format, price, and the owner's copies and decks. Call this before relying on a card's exact wording or legality.",
      inputSchema: CardInput,
      run: ({ name }) => {
        const names = resolver()
        const oracleId = names.find(name)
        if (!oracleId) {
          const close = names.suggest(name)
          throw new Error(`No card is named "${name}".${close.length > 0 ? ` Did you mean: ${close.join(', ')}?` : ''}`)
        }
        const defaultId = db.prepare('SELECT default_card_id FROM card_names WHERE oracle_id = ?').pluck().get(oracleId) as string
        const card = getCard(db, defaultId)!
        const ownership = getOwnership(db, [oracleId]).get(oracleId)!
        const legal = Object.values(FORMATS).flatMap((f) => (f.legality ? [[f.id, card.legalities[f.legality] ?? 'not_legal'] as const] : []))
        return JSON.stringify({
          name: card.name,
          mana_cost: card.manaCost,
          mana_value: card.cmc,
          type: card.typeLine,
          oracle_text: card.oracleText,
          ...(card.faces.length > 0
            ? { faces: card.faces.map((f) => ({ name: f.name, mana_cost: f.manaCost, type: f.typeLine, oracle_text: f.oracleText })) }
            : {}),
          ...(card.power !== null ? { pt: `${card.power}/${card.toughness ?? '?'}` } : {}),
          ...(card.loyalty !== null ? { loyalty: card.loyalty } : {}),
          color_identity: card.colorIdentity,
          legal_in: legal.filter(([, l]) => l === 'legal' || l === 'restricted').map(([id, l]) => (l === 'restricted' ? `${id} (restricted)` : id)),
          price_usd: money(card.prices.usd),
          ...stake(ownership),
        })
      },
    }),
    betaZodTool({
      name: 'get_deck',
      description:
        "Gets one of the owner's decks: its format, status (built or prospective), notes, every card with its board and category, and whether each card is owned, held by another built deck, or needs buying. Call this when the owner asks about a deck, and before suggesting changes to it.",
      inputSchema: DeckInput,
      run: ({ deck_id }) => {
        const deck = deckDetail(db, deck_id)
        if (!deck) throw new Error(`There is no deck ${deck_id}.`)
        return JSON.stringify({
          id: deck.id,
          name: deck.name,
          format: deck.format,
          status: deck.status,
          notes: deck.notes,
          boards: deck.boards,
          completion_percent: Math.floor(deck.completion * 100),
          cost_to_finish_usd: money(deck.costToFinish),
          color_identity: deck.colorIdentity,
          warnings: deck.warnings,
          cards: deck.lines.map((l) => ({
            name: l.name,
            quantity: l.quantity,
            board: l.board,
            ...(l.category ? { category: l.category } : {}),
            status: l.status,
            ...(l.short > 0 ? { short: l.short } : {}),
            ...(l.warnings.length > 0 ? { warnings: l.warnings } : {}),
          })),
        })
      },
    }),
    betaZodTool({
      name: 'create_prospective_deck',
      description:
        "Saves a deck idea to the owner's deckbuilder as a prospective deck (it claims none of their cards). Call this only when the owner asks to save or build the deck. Names are matched like a pasted decklist; names that match no card are left out and listed in the result. Answers with the deck's id, how much of it the owner already has, and the cost to finish it.",
      inputSchema: CreateInput,
      run: ({ name, format, notes, cards }) => {
        const names = resolver()
        const items: DeckImportItem[] = []
        const unresolved: string[] = []
        for (const card of cards) {
          const oracleId = names.find(card.name)
          if (!oracleId) unresolved.push(card.name)
          else items.push({ oracleId, cardId: null, quantity: card.quantity, board: (card.board ?? 'main') as Board, category: card.category || null })
        }
        if (items.length === 0) throw new Error(`None of the card names matched a card, so no deck was made: ${unresolved.join(', ')}`)
        const id = db.transaction(() => {
          const deckId = createDeck(db, { name, format, status: 'prospective', notes: notes ?? '' })
          importIntoDeck(db, deckId, items, false)
          return deckId
        })()
        const deck = deckDetail(db, id)!
        return JSON.stringify({
          deck_id: id,
          name: deck.name,
          format: deck.format,
          cards: deck.cardCount,
          completion_percent: Math.floor(deck.completion * 100),
          cost_to_finish_usd: money(deck.costToFinish),
          ...(unresolved.length > 0 ? { unresolved } : {}),
          ...(deck.warnings.length > 0 ? { warnings: deck.warnings } : {}),
        })
      },
    }),
  ]
  const byName = new Map(tools.map((t) => [t.name, t]))

  return {
    // betaZodTool makes custom tools; streamed tool inputs arrive as Claude writes them (validated here before running).
    definitions: tools.map((tool) => {
      const { name, description, input_schema } = tool as Anthropic.Beta.BetaTool
      return { name, description, input_schema, eager_input_streaming: true }
    }),
    async run(name, input) {
      const tool = byName.get(name)
      if (!tool) throw new Error(`There is no tool named ${name}.`)
      const parsed = tool.parse(input)
      const content = await tool.run(parsed as never)
      if (typeof content !== 'string') throw new Error('A tool answered with something other than text')
      return { content, deck: name === 'create_prospective_deck' ? createdDeckFrom(content) : null }
    },
    describe(name, input) {
      const field = (key: string) => {
        const value = (input as Record<string, unknown> | null)?.[key]
        return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
      }
      switch (name) {
        case 'search_my_library':
          return `Searching your library for \`${field('query')}\``
        case 'search_scryfall':
          return `Searching Scryfall for \`${field('query')}\``
        case 'get_card':
          return `Looking up ${field('name')}`
        case 'get_deck': {
          const deck = getDeckRow(db, Number(field('deck_id')))
          return `Reading ${deck ? deck.name : `deck ${field('deck_id')}`}`
        }
        case 'create_prospective_deck': {
          const cards = (input as { cards?: unknown } | null)?.cards
          const count = Array.isArray(cards) ? cards.reduce((n: number, c) => n + (Number((c as { quantity?: unknown }).quantity) || 0), 0) : 0
          return `Creating the deck “${field('name')}” (${count} cards)`
        }
        default:
          return `Using ${name}`
      }
    },
  }
}

/** The deck a create_prospective_deck result describes, or null when the text isn't one. */
export function createdDeckFrom(content: string): CreatedDeck | null {
  try {
    const r = JSON.parse(content) as Record<string, unknown>
    if (typeof r.deck_id !== 'number' || typeof r.name !== 'string') return null
    return {
      id: r.deck_id,
      name: r.name,
      format: r.format as FormatId,
      cardCount: Number(r.cards) || 0,
      completion: (Number(r.completion_percent) || 0) / 100,
      costToFinish: Number(r.cost_to_finish_usd) || 0,
      unresolved: Array.isArray(r.unresolved) ? r.unresolved.map(String) : [],
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run tests/server/ai-tools.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; 696 tests pass.

---

### Task 3: Conversations and Claude's answers

The chat loop of spec §5.5, as the SDK's streaming Messages API (see Decision 1): stream a request, relay its
events, then validate and run the tool calls, store the round, and ask again. Tests talk to a local fake of the
Messages API that streams scripted answers in the SDK's wire format, so nothing here needs a key or reaches Anthropic.

`ai_threads` and `ai_messages` exist since migration 001 (spec §4.1); migration 004 only adds `ai_messages.meta` and an
index.

**Files:**
- Create: `src/server/db/migrations/004_brainstorm.sql`
- Modify: `src/shared/types.ts` (`ThreadSummary`, `ChatItem`, `ThreadDetail`, `ChatEvent`)
- Modify: `src/server/ai/client.ts` (`AI_MODEL` is `claude-opus-5-5`; `describeAiError`: plainer messages)
- Create: `src/server/ai/threads.ts` (the store), `src/server/ai/prompt.ts` (system prompt, deck context),
  `src/server/ai/history.ts` (replay, chat items, cost), `src/server/ai/chat.ts` (the loop)
- Create: `tests/helpers/fake-anthropic.ts`
- Test: `tests/server/brainstorm.test.ts`

**Interfaces:**
- Consumes (Task 2): `BrainstormTools`, `createdDeckFrom`; (M5) `AiClient`, `AI_MODEL`.
- Produces:
  - `createBrainstorm({ db, ai, tools, now? }): Brainstorm` in `src/server/ai/chat.ts`, where `Brainstorm` has:
    - `busy(threadId)`;
    - `check(threadId, text | null)`, which throws the `ApiError` an answer would fail with: 404 `not_found`,
      409 `no_key`, 409 `busy`, 409 `nothing_to_continue`;
    - `answer(threadId, text | null, emit, signal?)`, which never throws and ends with a `done` event;
    - `stop(threadId)`.
  - `titleFrom(text)`, `MAX_ROUNDS = 16`, `MAX_TOKENS = 64_000`, `EFFORT = 'medium'`.
  - `src/server/ai/threads.ts`:
    - `createThread(db, deckId)`, `listThreads(db)`, `getThread(db, id)`, `renameThread(db, id, title)`,
      `deleteThread(db, id)`, `getMessages(db, threadId)`, and `appendMessages(db, threadId, messages, title?, now?)`;
    - the types `ContentBlock`, `MessageMeta`, `StoredMessage`.
  - `src/server/ai/history.ts`: `chatItems(messages, describe)`, `replayMessages`, `forReplay`, `canContinue`,
    `estimateCost`, `NOTICE`.
  - `src/server/ai/prompt.ts`: `SYSTEM_PROMPT`, `deckContext(deck)`, `deckContextName(text)`, `DECK_CONTEXT_TAG`.
  - `tests/helpers/fake-anthropic.ts`: `fakeAnthropic(...replies)` and `fakeAiClient(fake, key?)`.

- [ ] **Step 1: Write the fake Messages API and the failing tests**

Create `tests/helpers/fake-anthropic.ts`:

```ts
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import Anthropic from '@anthropic-ai/sdk'
import { onTestFinished } from 'vitest'
import { createAiClient, type AiClient } from '../../src/server/ai/client.ts'

/** A content block the fake streams: text, a note (thinking), a tool call, or a refusal-fallback switch point. */
export type FakeBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; /** Streamed as-is instead of `input`'s JSON. */ rawJson?: string }
  | { type: 'fallback'; from: string; to: string }

/** One scripted answer to a Messages API request. */
export type FakeReply =
  | { content: FakeBlock[]; stop_reason: string; model?: string; usage?: Partial<Anthropic.Beta.BetaUsage> }
  /** An HTTP error with the API's error body. */
  | { status: number; type: string; message: string }
  /** Streams `content`, then holds the connection open until the client goes away. */
  | { content: FakeBlock[]; hang: true }

export interface FakeRequest {
  headers: http.IncomingHttpHeaders
  body: Record<string, unknown> & { messages: Array<{ role: string; content: unknown }> }
}

export interface FakeAnthropic {
  url: string
  /** Every request the fake received, in order. */
  requests: FakeRequest[]
  /** Queues more answers. */
  reply(...replies: FakeReply[]): void
}

/**
 * A local stand-in for the Messages API that streams scripted answers as server-sent events, in the wire format the
 * SDK parses. Answers are used in order; a request with none left fails the test's conversation with a 500.
 */
export async function fakeAnthropic(...replies: FakeReply[]): Promise<FakeAnthropic> {
  const queue = [...replies]
  const requests: FakeRequest[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw) })
      const reply = queue.shift() ?? { status: 500, type: 'api_error', message: 'The fake has no answer left' }
      if ('status' in reply) {
        res.writeHead(reply.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: { type: reply.type, message: reply.message } }))
        return
      }
      stream(res, reply, requests.length)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => {
    server.closeAllConnections()
    server.close()
  })
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    reply: (...more) => queue.push(...more),
  }
}

function stream(res: http.ServerResponse, reply: Exclude<FakeReply, { status: number }>, n: number) {
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const model = 'model' in reply && reply.model ? reply.model : 'claude-opus-5-5'
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  send('message_start', {
    type: 'message_start',
    message: {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  })
  reply.content.forEach((block, index) => {
    const start = (content_block: unknown) => send('content_block_start', { type: 'content_block_start', index, content_block })
    const delta = (d: unknown) => send('content_block_delta', { type: 'content_block_delta', index, delta: d })
    if (block.type === 'text') {
      start({ type: 'text', text: '' })
      for (const part of block.text.match(/[\s\S]{1,8}/g) ?? []) delta({ type: 'text_delta', text: part })
    } else if (block.type === 'thinking') {
      start({ type: 'thinking', thinking: '', signature: '' })
      delta({ type: 'thinking_delta', thinking: block.thinking })
      delta({ type: 'signature_delta', signature: block.signature ?? `sig-${n}-${index}` })
    } else if (block.type === 'tool_use') {
      start({ type: 'tool_use', id: block.id, name: block.name, input: {} })
      const json = block.rawJson ?? JSON.stringify(block.input)
      for (const part of json.match(/[\s\S]{1,16}/g) ?? []) delta({ type: 'input_json_delta', partial_json: part })
    } else {
      start({ type: 'fallback', from: { model: block.from }, to: { model: block.to } })
    }
    send('content_block_stop', { type: 'content_block_stop', index })
  })
  if ('hang' in reply) return
  send('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: reply.stop_reason, stop_sequence: null },
    usage: { output_tokens: 200, ...reply.usage },
  })
  send('message_stop', { type: 'message_stop' })
  res.end()
}

/** An AI client with a saved key, talking to `fake` (no retries, so errors surface at once). */
export function fakeAiClient(fake: FakeAnthropic, key: string | null = 'sk-ant-test-0000'): AiClient {
  let saved = key
  return createAiClient(
    { read: () => saved, write: (next) => void (saved = next) },
    (apiKey) => new Anthropic({ apiKey, baseURL: fake.url, authToken: null, maxRetries: 0 }),
  )
}
```

Create `tests/server/brainstorm.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createBrainstorm, MAX_ROUNDS, titleFrom } from '../../src/server/ai/chat.ts'
import { canContinue, chatItems, estimateCost, forReplay, NOTICE, replayMessages } from '../../src/server/ai/history.ts'
import { DECK_CONTEXT_TAG, SYSTEM_PROMPT } from '../../src/server/ai/prompt.ts'
import { createThread, getMessages, getThread, type ContentBlock, type StoredMessage } from '../../src/server/ai/threads.ts'
import { createBrainstormTools } from '../../src/server/ai/tools.ts'
import type { DB } from '../../src/server/db/index.ts'
import type { ChatEvent, ChatItem } from '../../src/shared/types.ts'
import { stubScryfall } from '../helpers/app.ts'
import { count, createTestDb } from '../helpers/db.ts'
import { fakeAiClient, fakeAnthropic, type FakeAnthropic, type FakeReply } from '../helpers/fake-anthropic.ts'
import { deck, inDeck, own } from '../helpers/library.ts'

let db: DB

beforeEach(() => {
  db = createTestDb()
  own(db, 'Llanowar Elves', undefined, 2)
  own(db, 'Sol Ring', undefined, 1)
})

async function setup(...replies: FakeReply[]) {
  const fake = await fakeAnthropic(...replies)
  const tools = createBrainstormTools({ db, scryfall: stubScryfall() })
  const brainstorm = createBrainstorm({ db, ai: fakeAiClient(fake), tools, now: () => new Date('2026-09-28T12:00:00Z') })
  return { fake, brainstorm, tools }
}

async function ask(brainstorm: ReturnType<typeof createBrainstorm>, threadId: number, text: string | null, signal?: AbortSignal) {
  const events: ChatEvent[] = []
  await brainstorm.answer(threadId, text, (e) => events.push(e), signal)
  return events
}

const elfSearch: FakeReply = {
  content: [
    { type: 'thinking', thinking: 'Check which elves they own.', signature: 'sig-a' },
    { type: 'text', text: 'Let me check your elves.' },
    { type: 'tool_use', id: 'toolu_1', name: 'search_my_library', input: { query: 't:elf' } },
  ],
  stop_reason: 'tool_use',
}
const answer: FakeReply = { content: [{ type: 'text', text: 'You own [[Llanowar Elves]] (2 free).' }], stop_reason: 'end_turn' }

describe('answering a question', () => {
  it('streams the answer, runs the tool, and stores each round with its result', async () => {
    const { fake, brainstorm } = await setup(elfSearch, answer)
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Which elves do I own?')

    expect(events.map((e) => (e.type === 'item' ? `item:${e.item.kind}` : e.type))).toEqual([
      'item:user',
      'title',
      'item:note',
      'delta',
      'item:text',
      'delta',
      'delta',
      'delta',
      'item:tool',
      'tool_done',
      'item:text',
      'delta',
      'delta',
      'delta',
      'delta',
      'delta',
      'done',
    ])
    const tool = events.find((e) => e.type === 'item' && e.item.kind === 'tool')
    expect(tool).toMatchObject({ item: { activity: 'Searching your library for `t:elf`', state: 'running' } })
    expect(events.find((e) => e.type === 'tool_done')).toMatchObject({ id: 'toolu_1', state: 'done' })

    const stored = getMessages(db, id)
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(stored[1]!.content).toEqual([
      { type: 'thinking', thinking: 'Check which elves they own.', signature: 'sig-a' },
      { type: 'text', text: 'Let me check your elves.' },
      { type: 'tool_use', id: 'toolu_1', name: 'search_my_library', input: { query: 't:elf' } },
    ])
    const result = stored[2]!.content[0] as Extract<ContentBlock, { type: 'tool_result' }>
    expect(result.tool_use_id).toBe('toolu_1')
    expect(JSON.parse(result.content as string)).toMatchObject({ total: 1, cards: [{ name: 'Llanowar Elves', owned: 2, free: 2 }] })
    expect(stored[1]!.meta).toMatchObject({ model: 'claude-opus-5-5', stopReason: 'tool_use' })
    expect(getThread(db, id)!.title).toBe('Which elves do I own?')
    expect(canContinue(stored)).toBe(false)

    // The second request replays the first round verbatim, reasoning signature included.
    expect(fake.requests[1]!.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Which elves do I own?' }] },
      { role: 'assistant', content: stored[1]!.content },
      { role: 'user', content: stored[2]!.content },
    ])
  })

  it('asks Claude Opus 5.5 for its notes, at medium effort, with refusal fallbacks and a cached system prompt', async () => {
    const { fake, brainstorm } = await setup(answer)
    await ask(brainstorm, createThread(db, null), 'Hi')
    const { headers, body } = fake.requests[0]!
    expect(headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01,thinking-display-updates-2026-08-18,thinking-binding-controls-2026-08-01')
    expect(headers['x-api-key']).toBe('sk-ant-test-0000')
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      thinking: { type: 'adaptive', display: 'updates', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      stream: true,
    })
    const tools = body.tools as Array<{ name: string; eager_input_streaming: boolean }>
    expect(tools.map((t) => t.name)).toEqual(['search_my_library', 'search_scryfall', 'get_card', 'get_deck', 'create_prospective_deck'])
    expect(tools.every((t) => t.eager_input_streaming)).toBe(true)
  })

  it('opens a conversation about a deck with the deck, in the first message only', async () => {
    const burn = deck(db, 'Burn', 'built', 'modern')
    inDeck(db, burn, 'Lightning Bolt', 4)
    const { fake, brainstorm, tools } = await setup(answer, answer)
    const id = createThread(db, burn)
    const events = await ask(brainstorm, id, 'How do I make this faster?')
    const again = await ask(brainstorm, id, 'And cheaper?')
    expect(events[1]).toEqual({ type: 'title', title: 'How do I make this faster?' })
    expect(again.some((e) => e.type === 'title')).toBe(false)

    expect(events[0]).toEqual({ type: 'item', item: { kind: 'user', text: 'How do I make this faster?', deck: 'Burn' } })
    const first = fake.requests[0]!.body.messages[0]!.content as Array<{ text: string }>
    expect(first).toHaveLength(2)
    expect(first[0]!.text.startsWith(DECK_CONTEXT_TAG)).toBe(true)
    expect(first[0]!.text).toContain('4 Lightning Bolt (main; to buy)')
    expect(first[1]!.text).toBe('How do I make this faster?')
    const second = fake.requests[1]!.body.messages.at(-1)!.content as Array<{ text: string }>
    expect(second).toEqual([{ type: 'text', text: 'And cheaper?' }])
    // The system prompt stays the same, so the cache holds across conversations.
    expect((fake.requests[0]!.body.system as Array<{ text: string }>)[0]!.text).toBe(SYSTEM_PROMPT)

    const items = chatItems(getMessages(db, id), tools.describe)
    expect(items[0]).toEqual({ kind: 'user', text: 'How do I make this faster?', deck: 'Burn' })
  })

  it('tells Claude when a tool fails, and carries on', async () => {
    const { brainstorm } = await setup(
      { content: [{ type: 'tool_use', id: 'toolu_1', name: 'search_my_library', input: { query: 'mv>' } }], stop_reason: 'tool_use' },
      answer,
    )
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Cheap spells?')
    const done = events.find((e) => e.type === 'tool_done')
    expect(done).toMatchObject({ state: 'failed' })
    expect((done as { error: string }).error).toMatch(/^That query isn't valid/)
    const result = getMessages(db, id)[2]!.content[0] as Extract<ContentBlock, { type: 'tool_result' }>
    expect(result).toMatchObject({ is_error: true })
    expect(result.content).toMatch(/^Error: That query isn't valid/)
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('refuses tool input that breaks the schema, without running the tool', async () => {
    const { brainstorm } = await setup(
      { content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_deck', input: { deck_id: 'three' } }], stop_reason: 'tool_use' },
      answer,
    )
    const id = createThread(db, null)
    await ask(brainstorm, id, 'Read my deck')
    const result = getMessages(db, id)[2]!.content[0] as Extract<ContentBlock, { type: 'tool_result' }>
    expect(result.is_error).toBe(true)
  })

  it('asks again when a streamed tool input is not JSON at all', async () => {
    const { fake, brainstorm } = await setup(
      { content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_card', input: null, rawJson: 'name = Sol Ring' }], stop_reason: 'tool_use' },
      answer,
    )
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Tell me about Sol Ring')
    expect(fake.requests).toHaveLength(2)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})

describe('when an answer goes wrong', () => {
  it('reports an API failure and lets Continue ask again', async () => {
    const { brainstorm } = await setup({ status: 401, type: 'authentication_error', message: 'invalid x-api-key' }, answer)
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Hi')
    expect(events.at(-2)).toEqual({ type: 'error', message: 'Anthropic refused the API key; check it in Settings', canContinue: true })
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user'])

    await ask(brainstorm, id, null)
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(canContinue(getMessages(db, id))).toBe(false)
  })

  it("explains Anthropic's failures in plain words, without the raw error body", async () => {
    const { brainstorm } = await setup(
      { status: 529, type: 'overloaded_error', message: 'Overloaded' },
      { status: 400, type: 'invalid_request_error', message: 'messages: text content blocks must be non-empty' },
    )
    const id = createThread(db, null)
    expect((await ask(brainstorm, id, 'Hi')).at(-2)).toEqual({
      type: 'error',
      message: 'Anthropic is overloaded right now; try again shortly',
      canContinue: true,
    })
    expect((await ask(brainstorm, id, null)).at(-2)).toEqual({
      type: 'error',
      message: 'Anthropic answered with an error (400): messages: text content blocks must be non-empty',
      canContinue: true,
    })
  })

  it('records a refusal and keeps the declined question out of later requests', async () => {
    const { fake, brainstorm, tools } = await setup({ content: [], stop_reason: 'refusal' }, answer)
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Something declined')
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'error', text: NOTICE.refusal } })
    expect(canContinue(getMessages(db, id))).toBe(false)

    await ask(brainstorm, id, 'Something else')
    expect(fake.requests[1]!.body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Something else' }] }])
    expect(chatItems(getMessages(db, id), tools.describe).map((i) => i.kind)).toEqual(['user', 'notice', 'user', 'text'])
  })

  it('drops what the declining model wrote before a fallback, and runs only the tool calls after it', async () => {
    const { fake, brainstorm } = await setup(
      {
        content: [
          { type: 'thinking', thinking: 'first model' },
          { type: 'text', text: 'Looking' },
          { type: 'tool_use', id: 'toolu_0', name: 'get_card', input: { name: 'Sol Ring' } },
          { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' },
          { type: 'tool_use', id: 'toolu_1', name: 'get_card', input: { name: 'Llanowar Elves' } },
        ],
        stop_reason: 'tool_use',
        model: 'claude-opus-5',
      },
      answer,
    )
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Compare')
    expect(events).toContainEqual({ type: 'item', item: { kind: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' } })
    const stored = getMessages(db, id)
    expect(stored[1]!.content.map((b) => b.type)).toEqual(['text', 'fallback', 'tool_use'])
    expect(stored[2]!.content).toHaveLength(1)
    expect((stored[2]!.content[0] as { tool_use_id: string }).tool_use_id).toBe('toolu_1')
    expect(stored[1]!.meta!.model).toBe('claude-opus-5')
    expect(fake.requests[1]!.body.messages[1]!.content).toEqual(stored[1]!.content)
  })

  it('keeps the text of an answer cut off by max_tokens, and never runs its tool call', async () => {
    const { brainstorm } = await setup({
      content: [
        { type: 'text', text: 'Here is a long plan' },
        { type: 'tool_use', id: 'toolu_1', name: 'create_prospective_deck', input: { name: 'Elves', format: 'commander', cards: [] } },
      ],
      stop_reason: 'max_tokens',
    })
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Build it')
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.cutOff } })
    expect(events.some((e) => e.type === 'item' && e.item.kind === 'tool')).toBe(false)
    expect(getMessages(db, id)[1]!.content).toEqual([{ type: 'text', text: 'Here is a long plan' }])
    expect(count(db, 'decks')).toBe(0)
  })

  it('stops on request, keeping the text so far', async () => {
    const { brainstorm } = await setup({ content: [{ type: 'text', text: 'Elves are great because' }], hang: true })
    const id = createThread(db, null)
    const controller = new AbortController()
    const events: ChatEvent[] = []
    const running = brainstorm.answer(id, 'Tell me about elves', (e) => {
      events.push(e)
      if (e.type === 'delta' && events.filter((x) => x.type === 'delta').length === 3) controller.abort()
    }, controller.signal)
    expect(brainstorm.busy(id)).toBe(true)
    expect(() => brainstorm.check(id, 'again')).toThrow(expect.objectContaining({ status: 409, code: 'busy' }))
    await running
    expect(brainstorm.busy(id)).toBe(false)
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.stopped } })
    const stored = getMessages(db, id)
    expect(stored[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Elves are great because' }], meta: { stopReason: 'stopped' } })
    // What streamed before the stop is still counted toward the cost.
    expect(stored[1]!.meta!.usage).toMatchObject({ input_tokens: 1000 })
  })

  it('stop() stops the answer in progress', async () => {
    const { brainstorm } = await setup({ content: [{ type: 'text', text: 'Thinking about it' }], hang: true })
    const id = createThread(db, null)
    const events: ChatEvent[] = []
    const running = brainstorm.answer(id, 'Go', (e) => {
      events.push(e)
      if (e.type === 'delta') brainstorm.stop(id)
    })
    await running
    expect(brainstorm.stop(id)).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('stops an answer that keeps calling tools after MAX_ROUNDS requests, and lets Continue go on', async () => {
    const lookUp = (i: number): FakeReply => ({
      content: [{ type: 'tool_use', id: `toolu_${i}`, name: 'get_card', input: { name: 'Sol Ring' } }],
      stop_reason: 'tool_use',
    })
    const { fake, brainstorm } = await setup(...Array.from({ length: MAX_ROUNDS }, (_, i) => lookUp(i)))
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'Keep looking')
    expect(fake.requests).toHaveLength(MAX_ROUNDS)
    expect(events.at(-2)).toEqual({
      type: 'error',
      message: `Claude took more than ${MAX_ROUNDS} steps without finishing; Continue lets it go on`,
      canContinue: true,
    })
    expect(getMessages(db, id)).toHaveLength(1 + 2 * MAX_ROUNDS)
  })

  it('checks for a key, the conversation, and something to continue before starting', async () => {
    const fake = await fakeAnthropic()
    const tools = createBrainstormTools({ db, scryfall: stubScryfall() })
    const keyless = createBrainstorm({ db, ai: fakeAiClient(fake, null), tools })
    const id = createThread(db, null)
    expect(() => keyless.check(id, 'Hi')).toThrow(expect.objectContaining({ status: 409, code: 'no_key' }))
    const { brainstorm } = await setup()
    expect(() => brainstorm.check(999, 'Hi')).toThrow(expect.objectContaining({ status: 404 }))
    expect(() => brainstorm.check(id, null)).toThrow(expect.objectContaining({ status: 409, code: 'nothing_to_continue' }))
  })
})

describe('history', () => {
  const message = (role: 'user' | 'assistant', content: ContentBlock[], stopReason?: string): StoredMessage => ({
    id: 0,
    role,
    content,
    meta: stopReason ? { model: 'claude-opus-5-5', stopReason, usage: null } : null,
    createdAt: '',
  })

  it('titles a conversation by the first line of its first message', () => {
    expect(titleFrom('  Build me an elf deck\nwith lords')).toBe('Build me an elf deck')
    expect(titleFrom('x'.repeat(80))).toBe(`${'x'.repeat(59)}…`)
  })

  it('keeps only text before the last fallback block', () => {
    const blocks = [
      { type: 'thinking', thinking: 'a', signature: 's' },
      { type: 'text', text: 'b' },
      { type: 'tool_use', id: 't', name: 'get_card', input: {} },
      { type: 'fallback', from: { model: 'x' }, to: { model: 'y' } },
      { type: 'thinking', thinking: 'c', signature: 's' },
    ] as ContentBlock[]
    expect(forReplay(blocks).map((b) => b.type)).toEqual(['text', 'fallback', 'thinking'])
    const plain = [{ type: 'thinking', thinking: 'a', signature: 's' }, { type: 'text', text: 'b' }] as ContentBlock[]
    expect(forReplay(plain)).toEqual(plain)
  })

  it('leaves a declined question out of what Claude sees, but not tool results before a refusal', () => {
    const messages = [
      message('user', [{ type: 'text', text: 'q1' }]),
      message('assistant', [], 'refusal'),
      message('user', [{ type: 'text', text: 'q2' }]),
      message('assistant', [{ type: 'tool_use', id: 't', name: 'get_card', input: {} }], 'tool_use'),
      message('user', [{ type: 'tool_result', tool_use_id: 't', content: '{}' }]),
      message('assistant', [], 'refusal'),
    ]
    expect(replayMessages(messages).map((m) => (m.content as ContentBlock[])[0]?.type ?? 'none')).toEqual(['text', 'tool_use', 'tool_result'])
  })

  it('shows tool calls with their outcome, notes, and notices', () => {
    const messages = [
      message('user', [{ type: 'text', text: 'Build it' }]),
      message(
        'assistant',
        [
          { type: 'thinking', thinking: 'Plan', signature: 's' },
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'tool_use', id: 't1', name: 'get_card', input: { name: 'Sol Ring' } },
          { type: 'tool_use', id: 't2', name: 'create_prospective_deck', input: { name: 'Elves', format: 'commander', cards: [{ name: 'x', quantity: 2 }] } },
        ],
        'tool_use',
      ),
      message('user', [
        { type: 'tool_result', tool_use_id: 't1', content: 'Error: No card is named "Sol Rign".', is_error: true },
        {
          type: 'tool_result',
          tool_use_id: 't2',
          content: JSON.stringify({ deck_id: 7, name: 'Elves', format: 'commander', cards: 2, completion_percent: 50, cost_to_finish_usd: 1.5, unresolved: ['Elf Lord'] }),
        },
      ]),
      message('assistant', [{ type: 'text', text: 'Done' }], 'max_tokens'),
    ]
    const items = chatItems(messages, (name) => `use ${name}`)
    expect(items).toEqual<ChatItem[]>([
      { kind: 'user', text: 'Build it', deck: null },
      { kind: 'note', text: 'Plan' },
      { kind: 'tool', id: 't1', name: 'get_card', activity: 'use get_card', state: 'failed', error: 'No card is named "Sol Rign".', deck: null },
      {
        kind: 'tool',
        id: 't2',
        name: 'create_prospective_deck',
        activity: 'use create_prospective_deck',
        state: 'done',
        error: null,
        deck: { id: 7, name: 'Elves', format: 'commander', cardCount: 2, completion: 0.5, costToFinish: 1.5, unresolved: ['Elf Lord'] },
      },
      { kind: 'text', text: 'Done' },
      { kind: 'notice', tone: 'info', text: NOTICE.cutOff },
    ])
  })

  it('estimates spend from recorded usage at Claude Opus 5.5 prices', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 2_000_000 }
    const messages = [{ ...message('assistant', [{ type: 'text', text: 'x' }], 'end_turn'), meta: { model: 'claude-opus-5-5', stopReason: 'end_turn', usage } }]
    // 4 + 2 + 1 + 0.4
    expect(estimateCost(messages as StoredMessage[])).toBe(7.4)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/server/brainstorm.test.ts`
Expected: FAIL: `src/server/ai/chat.ts` does not exist.

- [ ] **Step 3: Implement**

Create `src/server/db/migrations/004_brainstorm.sql`:

```sql
-- Brainstorm (spec §4.1, §5.5): `ai_threads` and `ai_messages` exist since 001. An assistant message's `meta` is JSON
-- about it: the model that wrote it, why it stopped, and its token usage.
ALTER TABLE ai_messages ADD COLUMN meta TEXT;
CREATE INDEX ai_messages_thread ON ai_messages (thread_id, id);
```

Add to the end of `src/shared/types.ts`, after a blank line:

```ts
/** A brainstorm conversation with Claude (spec §5.5). */
export interface ThreadSummary {
  id: number
  /** From the owner's first message; empty until then. */
  title: string
  /** The deck the conversation is about, when it was started from the deck editor. */
  deck: { id: number; name: string } | null
  createdAt: string
  updatedAt: string
}

/** One thing a conversation shows, in order. */
export type ChatItem =
  /** The owner's message; `deck` names the deck whose summary went with it. */
  | { kind: 'user'; text: string; deck: string | null }
  | { kind: 'text'; text: string }
  /** A note Claude wrote while working, such as what it's about to look up (a thinking block, display `updates`). */
  | { kind: 'note'; text: string }
  | { kind: 'tool'; id: string; name: string; activity: string; state: 'running' | 'done' | 'failed'; error: string | null; deck: CreatedDeck | null }
  /** The model declined and another carried on (spec §2 refusal fallbacks). */
  | { kind: 'fallback'; from: string; to: string }
  | { kind: 'notice'; tone: 'info' | 'error'; text: string }

export interface ThreadDetail extends ThreadSummary {
  items: ChatItem[]
  /** Estimated spend so far, in US dollars. */
  costUsd: number
  /** The conversation ends waiting for Claude (an answer failed partway): Continue asks again. */
  canContinue: boolean
  /** Claude is answering right now. */
  busy: boolean
}

/** One server-sent event of a brainstorm answer (POST /api/ai/threads/:id/messages). */
export type ChatEvent =
  /** A new item starts; text and note items then grow by `delta`s. */
  | { type: 'item'; item: ChatItem }
  | { type: 'delta'; text: string }
  /** The owner's first message named the conversation. */
  | { type: 'title'; title: string }
  | { type: 'tool_done'; id: string; state: 'done' | 'failed'; error: string | null; deck: CreatedDeck | null }
  /** The answer failed; with `canContinue`, Continue asks again. */
  | { type: 'error'; message: string; canContinue: boolean }
  | { type: 'done' }
```

In `src/server/ai/client.ts`, replace:

```ts
import type { KeyStore } from './key-store.ts'

/** The model for Claude's deckbuilding help (spec §2, §5.5). Scanning never calls Anthropic. */
export const AI_MODEL = 'claude-opus-5'

/** The Anthropic client for the saved API key; the Settings page changes the key (spec §5.6). */
```

with:

```ts
import type { KeyStore } from './key-store.ts'

/** The model for Claude's deckbuilding help (spec §2, §5.5; the owner chose Opus 5.5). Scanning never calls Anthropic. */
export const AI_MODEL = 'claude-opus-5-5'

/** The Anthropic client for the saved API key; the Settings page changes the key (spec §5.6). */
```

In `src/server/ai/client.ts`, replace:

```ts
  if (err instanceof Anthropic.PermissionDeniedError) return "The API key isn't allowed to use this model"
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic is rate-limiting requests; try again shortly'
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic; check the internet connection"
  if (err instanceof Anthropic.APIError) return `Anthropic answered with an error (${err.status ?? '?'}): ${err.message}`
  return err instanceof Error ? err.message : String(err)
}
```

with:

```ts
  if (err instanceof Anthropic.PermissionDeniedError) return "The API key isn't allowed to use this model"
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic is rate-limiting requests; try again shortly'
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Anthropic took too long to answer; try again'
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic; check the internet connection"
  if (err instanceof Anthropic.APIError && err.status === 529) return 'Anthropic is overloaded right now; try again shortly'
  if (err instanceof Anthropic.InternalServerError) return `Anthropic had a problem (${err.status}); try again shortly`
  if (err instanceof Anthropic.APIError) {
    // The SDK's own message repeats the status and the raw JSON body; the body's message is the useful part.
    const body = err.error as { error?: { message?: unknown } } | undefined
    const detail = typeof body?.error?.message === 'string' ? body.error.message : err.message
    return `Anthropic answered with an error (${err.status ?? '?'}): ${detail}`
  }
  return err instanceof Error ? err.message : String(err)
}
```

Create `src/server/ai/threads.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk'
import type { ThreadSummary } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'

export type ContentBlock = Anthropic.Beta.BetaContentBlockParam

/** What Binder records about an assistant message besides its content. */
export interface MessageMeta {
  /** The model that wrote it: Claude Opus 5, or the model a refusal fell back to. */
  model: string
  /**
   * Why it ended: the API's stop reason, or `stopped` when the owner stopped it (keeping the text so far). A `refusal`
   * message has no content and, with the question before it, is left out of what Claude sees later.
   */
  stopReason: string
  usage: Anthropic.Beta.BetaUsage | null
}

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: ContentBlock[]
  meta: MessageMeta | null
  createdAt: string
}

export interface NewMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
  meta?: MessageMeta
}

interface ThreadRow {
  id: number
  title: string
  deck_id: number | null
  deck_name: string | null
  created_at: string
  updated_at: string
}

const THREAD_SELECT = `
  SELECT t.id, t.title, t.deck_id, d.name AS deck_name, t.created_at, t.updated_at
  FROM ai_threads t LEFT JOIN decks d ON d.id = t.deck_id`

function toSummary(row: ThreadRow): ThreadSummary {
  return {
    id: row.id,
    title: row.title,
    deck: row.deck_id !== null && row.deck_name !== null ? { id: row.deck_id, name: row.deck_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Starts a conversation, about one deck when `deckId` is set. */
export function createThread(db: DB, deckId: number | null, now = new Date()): number {
  const at = now.toISOString()
  return Number(
    db
      .prepare("INSERT INTO ai_threads (title, deck_id, created_at, updated_at) VALUES ('', ?, ?, ?)")
      .run(deckId, at, at).lastInsertRowid,
  )
}

/** Every conversation, the most recently active first. */
export function listThreads(db: DB): ThreadSummary[] {
  return (db.prepare(`${THREAD_SELECT} ORDER BY t.updated_at DESC, t.id DESC`).all() as ThreadRow[]).map(toSummary)
}

export function getThread(db: DB, id: number): ThreadSummary | null {
  const row = db.prepare(`${THREAD_SELECT} WHERE t.id = ?`).get(id) as ThreadRow | undefined
  return row ? toSummary(row) : null
}

export function renameThread(db: DB, id: number, title: string, now = new Date()): boolean {
  return db.prepare('UPDATE ai_threads SET title = ?, updated_at = ? WHERE id = ?').run(title, now.toISOString(), id).changes > 0
}

/** Deletes a conversation and its messages. A deck Claude created stays. */
export function deleteThread(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM ai_threads WHERE id = ?').run(id).changes > 0
}

export function getMessages(db: DB, threadId: number): StoredMessage[] {
  const rows = db
    .prepare('SELECT id, role, content, meta, created_at FROM ai_messages WHERE thread_id = ? ORDER BY id')
    .all(threadId) as Array<{ id: number; role: 'user' | 'assistant'; content: string; meta: string | null; created_at: string }>
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: JSON.parse(r.content) as ContentBlock[],
    meta: r.meta === null ? null : (JSON.parse(r.meta) as MessageMeta),
    createdAt: r.created_at,
  }))
}

/**
 * Appends messages in one transaction, so a tool call is never stored without its result. The first message a
 * conversation gets names it: `title` is used when the conversation has none yet.
 */
export function appendMessages(db: DB, threadId: number, messages: readonly NewMessage[], title?: string, now = new Date()): void {
  const at = now.toISOString()
  const insert = db.prepare('INSERT INTO ai_messages (thread_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)')
  db.transaction(() => {
    for (const m of messages) insert.run(threadId, m.role, JSON.stringify(m.content), m.meta ? JSON.stringify(m.meta) : null, at)
    db.prepare(
      `UPDATE ai_threads SET updated_at = @at, title = CASE WHEN title = '' AND @title IS NOT NULL THEN @title ELSE title END
       WHERE id = @id`,
    ).run({ at, title: title ?? null, id: threadId })
  })()
}
```

Create `src/server/ai/prompt.ts`:

```ts
import { FORMATS } from '../../shared/formats.ts'
import type { DeckDetail } from '../../shared/types.ts'

const formatLines = Object.values(FORMATS)
  .map((f) => {
    const rules: string[] = []
    if (f.exactCards) rules.push(`exactly ${f.exactCards} cards including the commander`)
    if (f.minCards) rules.push(`at least ${f.minCards} main-deck cards`)
    if (f.maxCopies) rules.push(f.maxCopies === 1 ? 'one copy of each card but basic lands' : `at most ${f.maxCopies} copies of a card`)
    if (f.maxSideboard) rules.push(`a sideboard of up to ${f.maxSideboard}`)
    if (f.commanders === 'required') rules.push('one commander (or two with partner or a background), and every card within its color identity')
    return `- ${f.label} (\`${f.id}\`): ${rules.length > 0 ? rules.join('; ') : 'no deckbuilding rules'}.`
  })
  .join('\n')

/**
 * The system prompt (spec §5.5). It never changes between requests, so it stays in the prompt cache: anything about
 * the moment (a deck, the date) goes into the conversation instead.
 */
export const SYSTEM_PROMPT = `You are the deckbuilding assistant inside Binder, a personal app for managing one person's paper Magic: The Gathering collection. You help the owner decide what to build next and how to improve their decks, grounded in the cards they actually own.

# What you can see
You can't see the owner's collection or decks unless you use a tool. Use tools rather than guessing: never claim the owner owns a card, or that a card does something, without having checked.
- search_my_library searches only the cards the owner owns. Start there when an idea depends on their collection.
- search_scryfall searches every Magic card, most-played first. Use it for cards they'd need to buy.
- get_card gives one card's exact Oracle text, legality, price, and the owner's copies. Check it before relying on a card's exact wording or legality.
- get_deck reads one of the owner's decks with the status of every card.
- create_prospective_deck saves a deck idea to the deckbuilder. Use it only when the owner asks you to save or build a deck. Say what it couldn't match, and what it costs to finish.

Both searches take Scryfall syntax: \`t:elf\`, \`o:"draw a card"\`, \`c:g\` (color), \`id:bg\` (color identity, for commander decks), \`mv<=3\`, \`pow>=4\`, \`r:mythic\`, \`f:commander\` (legal in a format), \`is:commander\`, \`kw:flying\`, \`s:mh3\` (set), \`usd<2\`, \`-t:creature\` (not), \`(a or b)\`, and exact names in quotes after \`!\`. The library search also takes \`free>0\` (copies not already in a built deck), \`qty>=2\` (copies owned), \`is:foil\`, and \`in:built\`, \`in:prospective\`, or \`in:"Deck name"\` (cards in those decks). If a query is rejected, fix it and try again.

# How ownership works in Binder
- owned: the copies the owner has, over every printing.
- A built deck holds its cards: those copies aren't free for other decks. A prospective deck is an idea and holds nothing.
- free: owned copies not held by built decks. It can be negative when built decks claim more than the owner has.
- A card a deck needs is owned when enough free copies exist, in another deck when the owner has the copies but built decks hold them, and to buy otherwise. The maybe board is for candidates and counts toward none of this.
- Prices are Scryfall's US dollar prices for the cheapest printing, refreshed about weekly.

# Formats Binder checks
${formatLines}

# How to answer
- Keep responses focused, brief, and concise. When you suggest cards, say in a few words why each one fits, and whether the owner has it (free copies) or would need to buy it.
- While you work, the owner sees your short notes between tool calls: before looking something up, say in a few words what you're checking.
- Write card names in double square brackets, like [[Llanowar Elves]], using the exact name. Binder turns them into links to the card.
- Prefer the owner's own cards when they fit the plan; name the few purchases that would matter most.
- Deliver what the owner asked for, at the scope they intended. Make routine judgment calls yourself, and ask only when different readings would lead to materially different decks.
- Use Markdown sparingly: short paragraphs and bullet lists; a table only for short comparisons.`

/** The opening of a text block that carries a deck's summary into a conversation, instead of the system prompt. */
export const DECK_CONTEXT_TAG = '<deck_context>'

/**
 * A deck's summary for the first message of a conversation about it (spec §5.5): the deck goes into the conversation,
 * not the system prompt, so the prompt cache stays the same for every conversation.
 */
export function deckContext(deck: DeckDetail): string {
  const lines = deck.lines.map(
    (l) => `${l.quantity} ${l.name} (${l.board}${l.category ? `, ${l.category}` : ''}; ${l.status === 'owned' ? 'owned' : l.status === 'in_other_deck' ? 'held by another built deck' : 'to buy'})`,
  )
  return [
    DECK_CONTEXT_TAG,
    'The owner started this conversation from one of their decks. It stands as follows now (get_deck reads it again later).',
    `Deck id: ${deck.id}`,
    `Name: ${deck.name}`,
    `Format: ${FORMATS[deck.format].label}; status: ${deck.status}`,
    `Cards: ${deck.cardCount} (commander ${deck.boards.commander}, main ${deck.boards.main}, side ${deck.boards.side}, maybe ${deck.boards.maybe})`,
    `Available: ${Math.floor(deck.completion * 100)}%; cost to finish: $${deck.costToFinish.toFixed(2)}`,
    ...(deck.notes ? [`Notes: ${deck.notes}`] : []),
    ...(deck.warnings.length > 0 ? [`Problems: ${deck.warnings.join('; ')}`] : []),
    'Cards:',
    ...lines,
    '</deck_context>',
  ].join('\n')
}

/** The deck name a deck-context block names, or null when the text isn't one. */
export function deckContextName(text: string): string | null {
  if (!text.startsWith(DECK_CONTEXT_TAG)) return null
  return /^Name: (.*)$/m.exec(text)?.[1] ?? ''
}
```

Create `src/server/ai/history.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk'
import type { ChatItem } from '../../shared/types.ts'
import { deckContextName } from './prompt.ts'
import type { ContentBlock, StoredMessage } from './threads.ts'
import { createdDeckFrom } from './tools.ts'

/** US dollars per million tokens at Claude Opus 5.5's prices: input, output, 5-minute cache writes, and cache reads. */
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }

export const NOTICE = {
  refusal: "Claude declined to answer this. Asking another way usually works; this question won't be sent again.",
  cutOff: 'The answer was cut off because it got too long.',
  stopped: 'Stopped.',
} as const

/**
 * A response's content as it may be sent back (the API's echo rule for a refusal fallback partway through an answer):
 * before the last `fallback` block, only text is kept, so thinking and tool calls of the model that declined are
 * dropped, and never run.
 */
export function forReplay(content: readonly ContentBlock[]): ContentBlock[] {
  const last = content.findLastIndex((b) => b.type === 'fallback')
  return content.filter((b, i) => i >= last || b.type === 'text' || b.type === 'fallback')
}

const isRefusal = (m: StoredMessage) => m.role === 'assistant' && m.meta?.stopReason === 'refusal'
const isQuestion = (m: StoredMessage) => m.role === 'user' && !m.content.some((b) => b.type === 'tool_result')

/**
 * The conversation as Claude sees it: every stored message verbatim, except refusals. A refusal record and the question
 * it declined are left out, so the next message isn't declined again for the old one.
 */
export function replayMessages(messages: readonly StoredMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = []
  messages.forEach((m, i) => {
    if (isRefusal(m)) return
    const next = messages[i + 1]
    if (next && isRefusal(next) && isQuestion(m)) return
    out.push({ role: m.role, content: m.content })
  })
  return out
}

/** Whether the conversation ends waiting for Claude, so Continue can ask again. */
export function canContinue(messages: readonly StoredMessage[]): boolean {
  return messages.at(-1)?.role === 'user'
}

/** Estimated spend in US dollars, from each answer's recorded token usage. */
export function estimateCost(messages: readonly StoredMessage[]): number {
  let usd = 0
  for (const m of messages) {
    const u = m.meta?.usage
    if (!u) continue
    usd +=
      (u.input_tokens * PRICE.input +
        u.output_tokens * PRICE.output +
        (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
        (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
      1_000_000
  }
  return Math.round(usd * 10_000) / 10_000
}

const toolResultText = (block: Extract<ContentBlock, { type: 'tool_result' }>) =>
  typeof block.content === 'string'
    ? block.content
    : (block.content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('')

/**
 * What a stored conversation shows (spec §5.5): the owner's messages, Claude's text and its notes between tool calls, a
 * line per tool call with how it went, fallbacks, and notices for refusals, cut-off answers, and stopped ones.
 * `describe` gives a tool call's activity line.
 */
export function chatItems(messages: readonly StoredMessage[], describe: (name: string, input: unknown) => string): ChatItem[] {
  const items: ChatItem[] = []
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  for (const m of messages) {
    if (m.role === 'user') {
      let deck: string | null = null
      const texts: string[] = []
      for (const block of m.content) {
        if (block.type === 'text') {
          const name = deckContextName(block.text)
          if (name === null) texts.push(block.text)
          else deck = name
        } else if (block.type === 'tool_result') {
          const tool = tools.get(block.tool_use_id)
          if (!tool) continue
          const text = toolResultText(block)
          tool.state = block.is_error ? 'failed' : 'done'
          tool.error = block.is_error ? text.replace(/^Error: /, '') : null
          tool.deck = !block.is_error && tool.name === 'create_prospective_deck' ? createdDeckFrom(text) : null
        }
      }
      if (texts.length > 0) items.push({ kind: 'user', text: texts.join('\n\n'), deck })
      continue
    }
    for (const block of m.content) {
      if (block.type === 'text' && block.text !== '') items.push({ kind: 'text', text: block.text })
      else if (block.type === 'thinking' && block.thinking !== '') items.push({ kind: 'note', text: block.thinking })
      else if (block.type === 'fallback') items.push({ kind: 'fallback', from: block.from.model, to: block.to.model })
      else if (block.type === 'tool_use') {
        const tool: Extract<ChatItem, { kind: 'tool' }> = {
          kind: 'tool',
          id: block.id,
          name: block.name,
          activity: describe(block.name, block.input),
          state: 'running',
          error: null,
          deck: null,
        }
        tools.set(block.id, tool)
        items.push(tool)
      }
    }
    const stop = m.meta?.stopReason
    if (stop === 'refusal') items.push({ kind: 'notice', tone: 'error', text: NOTICE.refusal })
    else if (stop === 'max_tokens') items.push({ kind: 'notice', tone: 'info', text: NOTICE.cutOff })
    else if (stop === 'stopped') items.push({ kind: 'notice', tone: 'info', text: NOTICE.stopped })
  }
  return items
}
```

Create `src/server/ai/chat.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import type { ChatEvent } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'
import { deckDetail } from '../decks/analysis.ts'
import { ApiError } from '../http.ts'
import { AI_MODEL, describeAiError, type AiClient } from './client.ts'
import { canContinue, forReplay, NOTICE, replayMessages } from './history.ts'
import { deckContext, SYSTEM_PROMPT } from './prompt.ts'
import { appendMessages, getMessages, getThread, type ContentBlock, type MessageMeta } from './threads.ts'
import type { BrainstormTools } from './tools.ts'

/** Most requests one answer makes: each tool round is one. */
export const MAX_ROUNDS = 16
/** Room for Claude's thinking and answer in one request (spec §5.5: streamed, so no request timeout). */
export const MAX_TOKENS = 64_000
/**
 * How hard Claude thinks: Opus 5.5's default. On Opus 5.5, `medium` does better than Opus 5 did at `high`, and each
 * level up thinks longer and costs more (spec §5.5).
 */
export const EFFORT = 'medium'
/** Longest conversation title, taken from the first message. */
const TITLE_LENGTH = 60

export interface Brainstorm {
  /** Whether Claude is answering in this conversation right now. */
  busy(threadId: number): boolean
  /**
   * Throws the ApiError an answer would fail with before it starts: no API key, a missing conversation, one already
   * answering, or nothing to continue (`text` null) — so the route can answer with a status instead of a stream.
   */
  check(threadId: number, text: string | null): void
  /**
   * Answers the owner's message, or continues an answer that failed partway (`text` null), streaming what happens
   * through `emit`. Never throws: failures become an `error` event. `signal` stops it, keeping the text so far.
   */
  answer(threadId: number, text: string | null, emit: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void>
  /** Stops the answer in progress; false when there is none. */
  stop(threadId: number): boolean
}

/** A conversation's title: the first line of its first message, shortened. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]!.trim()
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
}

export function createBrainstorm(deps: { db: DB; ai: AiClient; tools: BrainstormTools; now?: () => Date }): Brainstorm {
  const { db, ai, tools } = deps
  const now = deps.now ?? (() => new Date())
  const active = new Map<number, AbortController>()

  function check(threadId: number, text: string | null) {
    if (!getThread(db, threadId)) throw new ApiError(404, 'not_found', 'Conversation not found')
    if (!ai.get()) throw new ApiError(409, 'no_key', 'Add an Anthropic API key in Settings to brainstorm with Claude')
    if (active.has(threadId)) throw new ApiError(409, 'busy', 'Claude is still answering in this conversation')
    if (text === null && !canContinue(getMessages(db, threadId))) throw new ApiError(409, 'nothing_to_continue', 'Claude has already answered')
  }

  /** Stores the owner's message, with the deck's summary before it when it opens a conversation about a deck. */
  function addQuestion(threadId: number, text: string, emit: (event: ChatEvent) => void) {
    const thread = getThread(db, threadId)!
    const content: ContentBlock[] = []
    let deckName: string | null = null
    if (thread.deck && getMessages(db, threadId).length === 0) {
      const deck = deckDetail(db, thread.deck.id)
      if (deck) {
        content.push({ type: 'text', text: deckContext(deck) })
        deckName = deck.name
      }
    }
    content.push({ type: 'text', text })
    appendMessages(db, threadId, [{ role: 'user', content }], titleFrom(text), now())
    emit({ type: 'item', item: { kind: 'user', text, deck: deckName } })
    if (thread.title === '') emit({ type: 'title', title: titleFrom(text) })
  }

  async function run(client: Anthropic, threadId: number, emit: (event: ChatEvent) => void, signal: AbortSignal) {
    const history = replayMessages(getMessages(db, threadId))
    let badJson = 0
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stream = client.beta.messages.stream(
        {
          model: AI_MODEL,
          max_tokens: MAX_TOKENS,
          // Opus 5.5 writes its notes between tool calls as thinking blocks: `updates` returns those notes (its reasoning
          // stays hidden). A thinking block replayed after the system prompt or tools changed (a Binder update) is
          // dropped rather than refused.
          thinking: { type: 'adaptive', display: 'updates', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
          output_config: { effort: EFFORT },
          betas: ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18', 'thinking-binding-controls-2026-08-01'],
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: tools.definitions,
          messages: history,
        },
        { signal },
      )
      const said: string[] = []
      let message: Anthropic.Beta.BetaMessage
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            const block = event.content_block
            if (block.type === 'text') {
              said.push('')
              emit({ type: 'item', item: { kind: 'text', text: '' } })
            } else if (block.type === 'thinking') {
              emit({ type: 'item', item: { kind: 'note', text: '' } })
            } else if (block.type === 'fallback') {
              emit({ type: 'item', item: { kind: 'fallback', from: block.from.model, to: block.to.model } })
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              said[said.length - 1] += event.delta.text
              emit({ type: 'delta', text: event.delta.text })
            } else if (event.delta.type === 'thinking_delta') {
              emit({ type: 'delta', text: event.delta.thinking })
            }
          }
        }
        message = await stream.finalMessage()
      } catch (err) {
        if (signal.aborted) {
          // Keep what Claude said so far; a partly written tool call or reasoning can't be sent back, so they go.
          const text = said.join('').trim()
          if (text !== '') {
            const meta: MessageMeta = { model: AI_MODEL, stopReason: 'stopped', usage: stream.currentMessage?.usage ?? null }
            appendMessages(db, threadId, [{ role: 'assistant', content: [{ type: 'text', text }], meta }], undefined, now())
          }
          emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.stopped } })
          return
        }
        // A tool input Claude streamed that isn't JSON at all: ask again, a couple of times at most.
        if (!(err instanceof Anthropic.APIError) && err instanceof Anthropic.AnthropicError && badJson++ < 2) {
          round--
          continue
        }
        throw err
      }
      badJson = 0
      const meta: MessageMeta = { model: message.model, stopReason: message.stop_reason ?? 'end_turn', usage: message.usage }
      if (message.stop_reason === 'refusal') {
        // Declined even after the fallbacks. What streamed is discarded; the record hides the question from now on.
        appendMessages(db, threadId, [{ role: 'assistant', content: [], meta }], undefined, now())
        emit({ type: 'item', item: { kind: 'notice', tone: 'error', text: NOTICE.refusal } })
        return
      }
      const content = forReplay(message.content as ContentBlock[])
      const calls = content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      if (calls.length === 0 || message.stop_reason === 'max_tokens') {
        // A tool call cut off by max_tokens may look complete; never run it.
        const kept = message.stop_reason === 'max_tokens' ? content.filter((b) => b.type === 'text') : content
        if (kept.length > 0) appendMessages(db, threadId, [{ role: 'assistant', content: kept, meta }], undefined, now())
        if (message.stop_reason === 'max_tokens') emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.cutOff } })
        return
      }
      for (const call of calls) {
        emit({
          type: 'item',
          item: { kind: 'tool', id: call.id, name: call.name, activity: tools.describe(call.name, call.input), state: 'running', error: null, deck: null },
        })
      }
      const results = await Promise.all(
        calls.map(async (call): Promise<ContentBlock> => {
          try {
            const outcome = await tools.run(call.name, call.input)
            emit({ type: 'tool_done', id: call.id, state: 'done', error: null, deck: outcome.deck })
            return { type: 'tool_result', tool_use_id: call.id, content: outcome.content }
          } catch (err) {
            const problem = err instanceof Error ? err.message : String(err)
            emit({ type: 'tool_done', id: call.id, state: 'failed', error: problem, deck: null })
            return { type: 'tool_result', tool_use_id: call.id, content: `Error: ${problem}`, is_error: true }
          }
        }),
      )
      // The call and its results are stored together (a tool may have made a deck), even when stopped meanwhile.
      appendMessages(db, threadId, [{ role: 'assistant', content, meta }, { role: 'user', content: results }], undefined, now())
      history.push({ role: 'assistant', content }, { role: 'user', content: results })
      if (signal.aborted) {
        emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.stopped } })
        return
      }
    }
    throw new Error(`Claude took more than ${MAX_ROUNDS} steps without finishing; Continue lets it go on`)
  }

  return {
    busy: (threadId) => active.has(threadId),
    check,
    async answer(threadId, text, emit, signal) {
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      signal?.addEventListener('abort', onAbort)
      active.set(threadId, controller)
      try {
        const client = ai.get()
        if (!client) throw new Error('Add an Anthropic API key in Settings to brainstorm with Claude')
        if (text !== null) addQuestion(threadId, text, emit)
        await run(client, threadId, emit, controller.signal)
      } catch (err) {
        const message = err instanceof Anthropic.AuthenticationError ? 'Anthropic refused the API key; check it in Settings' : describeAiError(err)
        emit({ type: 'error', message, canContinue: canContinue(getMessages(db, threadId)) })
      } finally {
        signal?.removeEventListener('abort', onAbort)
        active.delete(threadId)
        emit({ type: 'done' })
      }
    },
    stop(threadId) {
      const controller = active.get(threadId)
      controller?.abort()
      return controller !== undefined
    },
  }
}
```

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run tests/server/brainstorm.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; 716 tests pass.

---

### Task 4: The brainstorm API

**Files:**
- Create: `src/server/ai/routes.ts`
- Modify: `src/server/app.ts` (mount `/api/ai` when there is an AI client)
- Test: `tests/server/ai-api.test.ts`

**Interfaces:**
- Consumes (Task 3): `createBrainstorm`, the thread store, `chatItems`, `estimateCost`, `canContinue`; (Task 2)
  `createBrainstormTools`.
- Produces, under `/api/ai` behind the local-only guard:
  - `GET /threads` → `ThreadSummary[]`;
  - `POST /threads {deckId?}` → 201 `ThreadSummary`;
  - `GET /threads/:id` → `ThreadDetail`;
  - `PATCH /threads/:id {title}`;
  - `DELETE /threads/:id` → 204, or 409 `busy`;
  - `POST /threads/:id/messages {text}` and `POST /threads/:id/continue` → `text/event-stream`, one JSON `ChatEvent`
    per `data:` line. Problems found before streaming are JSON errors;
  - `POST /threads/:id/stop` → `{ stopped }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/ai-api.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { appendMessages, createThread, getMessages } from '../../src/server/ai/threads.ts'
import type { DB } from '../../src/server/db/index.ts'
import type { ChatEvent, ThreadDetail, ThreadSummary } from '../../src/shared/types.ts'
import { body, makeApp } from '../helpers/app.ts'
import { createTestDb } from '../helpers/db.ts'
import { fakeAiClient, fakeAnthropic, type FakeReply } from '../helpers/fake-anthropic.ts'
import { deck } from '../helpers/library.ts'

let db: DB

beforeEach(() => {
  db = createTestDb()
})

const answer: FakeReply = { content: [{ type: 'text', text: 'Hello there.' }], stop_reason: 'end_turn' }

async function appWith(...replies: FakeReply[]) {
  const fake = await fakeAnthropic(...replies)
  return { fake, app: makeApp({ db, ai: fakeAiClient(fake) }) }
}

const json = (value: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
})

/** The events of a server-sent-event response. */
async function events(res: Response): Promise<ChatEvent[]> {
  const text = await res.text()
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as ChatEvent)
}

describe('conversations', () => {
  it('creates, lists, renames, and deletes conversations', async () => {
    const { app } = await appWith()
    const burn = deck(db, 'Burn', 'built', 'modern')
    const created = await app.request('/api/ai/threads', json({}))
    expect(created.status).toBe(201)
    const plain = await body<ThreadSummary>(created)
    expect(plain).toMatchObject({ title: '', deck: null })
    const about = await body<ThreadSummary>(await app.request('/api/ai/threads', json({ deckId: burn })))
    expect(about.deck).toEqual({ id: burn, name: 'Burn' })

    await new Promise((resolve) => setTimeout(resolve, 5)) // so the rename is the latest change, not a same-millisecond tie
    const renamed = await app.request(`/api/ai/threads/${plain.id}`, json({ title: 'Elf ideas' }, 'PATCH'))
    expect(await body<ThreadSummary>(renamed)).toMatchObject({ title: 'Elf ideas' })
    const list = await body<ThreadSummary[]>(await app.request('/api/ai/threads'))
    expect(list.map((t) => t.id)).toEqual([plain.id, about.id])

    expect((await app.request(`/api/ai/threads/${about.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/api/ai/threads/${about.id}`)).status).toBe(404)
  })

  it('refuses a missing deck, unknown fields, and a blank title', async () => {
    const { app } = await appWith()
    expect((await app.request('/api/ai/threads', json({ deckId: 99 }))).status).toBe(404)
    expect((await app.request('/api/ai/threads', json({ deck: 1 }))).status).toBe(400)
    const id = createThread(db, null)
    expect((await app.request(`/api/ai/threads/${id}`, json({ title: '  ' }, 'PATCH'))).status).toBe(400)
    expect((await app.request('/api/ai/threads/abc')).status).toBe(404)
  })

  it('shows a conversation with its items, estimated cost, and whether it can continue', async () => {
    const { app } = await appWith()
    const id = createThread(db, null)
    appendMessages(db, id, [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }], 'Hi')
    const detail = await body<ThreadDetail>(await app.request(`/api/ai/threads/${id}`))
    expect(detail).toMatchObject({ title: 'Hi', items: [{ kind: 'user', text: 'Hi', deck: null }], costUsd: 0, canContinue: true, busy: false })
  })
})

describe('answers', () => {
  it('streams an answer as server-sent events', async () => {
    const { app } = await appWith(answer)
    const id = createThread(db, null)
    const res = await app.request(`/api/ai/threads/${id}/messages`, json({ text: 'Hi' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/)
    const received = await events(res)
    expect(received[0]).toEqual({ type: 'item', item: { kind: 'user', text: 'Hi', deck: null } })
    expect(received.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')).toBe('Hello there.')
    expect(received.at(-1)).toEqual({ type: 'done' })
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('answers errors found before streaming as JSON', async () => {
    const { app } = await appWith()
    const id = createThread(db, null)
    const empty = await app.request(`/api/ai/threads/${id}/messages`, json({ text: '   ' }))
    expect(empty.status).toBe(400)
    const nothing = await app.request(`/api/ai/threads/${id}/continue`, { method: 'POST' })
    expect(nothing.status).toBe(409)
    expect(await body(nothing)).toEqual({ error: { code: 'nothing_to_continue', message: 'Claude has already answered' } })
    expect((await app.request('/api/ai/threads/99/messages', json({ text: 'Hi' }))).status).toBe(404)
  })

  it('needs an API key', async () => {
    const fake = await fakeAnthropic()
    const app = makeApp({ db, ai: fakeAiClient(fake, null) })
    const id = createThread(db, null)
    const res = await app.request(`/api/ai/threads/${id}/messages`, json({ text: 'Hi' }))
    expect(res.status).toBe(409)
    expect(await body(res)).toMatchObject({ error: { code: 'no_key' } })
  })

  it('continues an answer that failed', async () => {
    const { app } = await appWith({ status: 500, type: 'api_error', message: 'boom' }, answer)
    const id = createThread(db, null)
    const failed = await events(await app.request(`/api/ai/threads/${id}/messages`, json({ text: 'Hi' })))
    expect(failed.at(-2)).toEqual({ type: 'error', message: 'Anthropic had a problem (500); try again shortly', canContinue: true })
    const retried = await events(await app.request(`/api/ai/threads/${id}/continue`, { method: 'POST' }))
    expect(retried.some((e) => e.type === 'error')).toBe(false)
    expect(getMessages(db, id).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('stops an answer, and says whether one was running', async () => {
    const { app } = await appWith({ content: [{ type: 'text', text: 'Thinking about your deck' }], hang: true })
    const id = createThread(db, null)
    const res = await app.request(`/api/ai/threads/${id}/messages`, json({ text: 'Go' }))
    const reader = res.body!.getReader()
    await reader.read() // the stream is open, so the answer is running
    const busy = await body<ThreadDetail>(await app.request(`/api/ai/threads/${id}`))
    expect(busy.busy).toBe(true)
    expect((await app.request(`/api/ai/threads/${id}`, { method: 'DELETE' })).status).toBe(409)
    expect(await body(await app.request(`/api/ai/threads/${id}/stop`, { method: 'POST' }))).toEqual({ stopped: true })
    while (!(await reader.read()).done) {
      // drain
    }
    expect(await body(await app.request(`/api/ai/threads/${id}/stop`, { method: 'POST' }))).toEqual({ stopped: false })
  })

  it('has no brainstorm routes without an AI client', async () => {
    const app = makeApp({ db })
    expect((await app.request('/api/ai/threads')).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/server/ai-api.test.ts`
Expected: FAIL: `/api/ai/threads` is 404 (no such routes).

- [ ] **Step 3: Implement**

Create `src/server/ai/routes.ts`:

```ts
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type { ChatEvent, ThreadDetail } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'
import { getDeckRow } from '../decks/repo.ts'
import { ApiError, parseWith, readJson } from '../http.ts'
import type { Brainstorm } from './chat.ts'
import { canContinue, chatItems, estimateCost } from './history.ts'
import { createThread, deleteThread, getMessages, getThread, listThreads, renameThread } from './threads.ts'
import type { BrainstormTools } from './tools.ts'

const CreateBody = z.object({ deckId: z.number().int().min(1).nullable().default(null) }).strict()
const RenameBody = z.object({ title: z.string().trim().min(1).max(100) }).strict()
const MessageBody = z.object({ text: z.string().trim().min(1).max(20_000) }).strict()
const Id = z.coerce.number().int().min(1)

function threadId(param: string): number {
  const parsed = Id.safeParse(param)
  if (!parsed.success) throw new ApiError(404, 'not_found', 'Conversation not found')
  return parsed.data
}

/** /api/ai (spec §5.5): brainstorm conversations, and Claude's answers streamed as server-sent events. */
export function aiRoutes(deps: { db: DB; brainstorm: Brainstorm; tools: BrainstormTools }): Hono {
  const { db, brainstorm, tools } = deps
  const routes = new Hono()

  function detail(id: number): ThreadDetail {
    const thread = getThread(db, id)
    if (!thread) throw new ApiError(404, 'not_found', 'Conversation not found')
    const messages = getMessages(db, id)
    return {
      ...thread,
      items: chatItems(messages, tools.describe),
      costUsd: estimateCost(messages),
      canContinue: canContinue(messages),
      busy: brainstorm.busy(id),
    }
  }

  /** Streams one answer. Problems found before it starts are ordinary JSON errors. */
  function answer(c: Context, id: number, text: string | null) {
    brainstorm.check(id, text)
    return streamSSE(c, async (stream) => {
      const controller = new AbortController()
      // Closing the page stops the answer, as Stop does.
      stream.onAbort(() => controller.abort())
      let writes = Promise.resolve()
      const emit = (event: ChatEvent) => {
        writes = writes.then(() => stream.writeSSE({ data: JSON.stringify(event) }))
      }
      await brainstorm.answer(id, text, emit, controller.signal)
      await writes
    })
  }

  routes.get('/threads', (c) => c.json(listThreads(db)))
  routes.post('/threads', async (c) => {
    const { deckId } = parseWith(CreateBody, await readJson(c.req))
    if (deckId !== null && !getDeckRow(db, deckId)) throw new ApiError(404, 'not_found', 'Deck not found')
    return c.json(getThread(db, createThread(db, deckId)), 201)
  })
  routes.get('/threads/:id', (c) => c.json(detail(threadId(c.req.param('id')))))
  routes.patch('/threads/:id', async (c) => {
    const id = threadId(c.req.param('id'))
    const { title } = parseWith(RenameBody, await readJson(c.req))
    if (!renameThread(db, id, title)) throw new ApiError(404, 'not_found', 'Conversation not found')
    return c.json(getThread(db, id))
  })
  routes.delete('/threads/:id', (c) => {
    const id = threadId(c.req.param('id'))
    if (brainstorm.busy(id)) throw new ApiError(409, 'busy', 'Stop Claude before deleting this conversation')
    if (!deleteThread(db, id)) throw new ApiError(404, 'not_found', 'Conversation not found')
    return c.body(null, 204)
  })
  routes.post('/threads/:id/messages', async (c) => {
    const id = threadId(c.req.param('id'))
    const { text } = parseWith(MessageBody, await readJson(c.req))
    return answer(c, id, text)
  })
  routes.post('/threads/:id/continue', (c) => answer(c, threadId(c.req.param('id')), null))
  routes.post('/threads/:id/stop', (c) => {
    const id = threadId(c.req.param('id'))
    if (!getThread(db, id)) throw new ApiError(404, 'not_found', 'Conversation not found')
    return c.json({ stopped: brainstorm.stop(id) })
  })
  return routes
}
```

In `src/server/app.ts`, replace:

```ts
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { AiClient } from './ai/client.ts'
import type { BulkImporter } from './bulk/import.ts'
import { bulkRoutes } from './bulk/routes.ts'
```

with:

```ts
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createBrainstorm } from './ai/chat.ts'
import type { AiClient } from './ai/client.ts'
import { aiRoutes } from './ai/routes.ts'
import { createBrainstormTools } from './ai/tools.ts'
import type { BulkImporter } from './bulk/import.ts'
import { bulkRoutes } from './bulk/routes.ts'
```

In `src/server/app.ts`, replace:

```ts
  /** The scan queue (spec §5.1); without it there are no /api/scan routes. */
  scanner?: ScanService
  /** The Anthropic API key and client (spec §5.6); without it there are no /api/settings/ai routes. */
  ai?: AiClient
  /** Built SPA directory. When set, non-API requests serve it, falling back to index.html. */
```

with:

```ts
  /** The scan queue (spec §5.1); without it there are no /api/scan routes. */
  scanner?: ScanService
  /** The Anthropic API key and client (spec §5.6); without it there are no /api/settings/ai or /api/ai routes. */
  ai?: AiClient
  /** Built SPA directory. When set, non-API requests serve it, falling back to index.html. */
```

In `src/server/app.ts`, replace:

```ts
  app.route('/api/settings', settingsRoutes(deps))
  if (deps.scanner) app.route('/api/scan', scanRoutes({ db: deps.db, scanner: deps.scanner }))
  app.all('/api/*', (c) =>
    c.json({ error: { code: 'not_found', message: `No API route for ${c.req.method} ${c.req.path}` } }, 404),
```

with:

```ts
  app.route('/api/settings', settingsRoutes(deps))
  if (deps.scanner) app.route('/api/scan', scanRoutes({ db: deps.db, scanner: deps.scanner }))
  if (deps.ai) {
    const tools = createBrainstormTools({ db: deps.db, scryfall: deps.scryfall })
    const brainstorm = createBrainstorm({ db: deps.db, ai: deps.ai, tools })
    app.route('/api/ai', aiRoutes({ db: deps.db, brainstorm, tools }))
  }
  app.all('/api/*', (c) =>
    c.json({ error: { code: 'not_found', message: `No API route for ${c.req.method} ${c.req.path}` } }, 404),
```

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run tests/server/ai-api.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; 725 tests pass.

---

### Task 5: The Brainstorm page

Conversations on the left, the open one on the right (spec §5.5). The answer streams in with `fetch` and a
reader (an `EventSource` can't POST). A small Markdown renderer, pure and tested, draws Claude's answers, with
`[[Card]]` links that open the card drawer; the page has no component tests, like the rest of the web app.

**Files:**
- Create: `src/web/lib/markdown.ts`, `src/web/lib/brainstorm.ts`
- Create: `src/web/components/brainstorm/Markdown.tsx`, `ChatItemView.tsx`, `Composer.tsx`, `ChatView.tsx`,
  `ThreadList.tsx`
- Create: `src/web/pages/BrainstormPage.tsx`
- Modify: `src/web/routes.tsx`, `src/web/components/Layout.tsx` (nav), `src/web/components/decks/DeckHeader.tsx`
  (Brainstorm with Claude)
- Test: `tests/web/brainstorm.test.ts`

**Interfaces:**
- Consumes (Task 4): the `/api/ai` routes; (Task 1) `GET /api/cards/named`; (M5) `useAiKey`.
- Produces:
  - `parseMarkdown(text): Block[]` and `parseInline(text): Inline[]`;
  - `splitEvents(buffer)` and `applyChatEvent(items, event)`;
  - the hooks `useThreads`, `useThread`, `useCreateThread`, `useRenameThread`, `useDeleteThread`, and
    `useAnswer(threadId) → { live, running, send, resume, stop }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/web/brainstorm.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../src/shared/types.ts'
import { applyChatEvent, splitEvents } from '../../src/web/lib/brainstorm.ts'
import { parseInline, parseMarkdown } from '../../src/web/lib/markdown.ts'

describe('Markdown', () => {
  it('reads card links, bold, italics, code, and links inline', () => {
    expect(parseInline('Add [[Llanowar Elves]] and **cheap _ramp_** like `{G}` — see [Scryfall](https://scryfall.com).')).toEqual([
      { kind: 'text', text: 'Add ' },
      { kind: 'card', name: 'Llanowar Elves' },
      { kind: 'text', text: ' and ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'cheap ' }, { kind: 'em', children: [{ kind: 'text', text: 'ramp' }] }] },
      { kind: 'text', text: ' like ' },
      { kind: 'code', text: '{G}' },
      { kind: 'text', text: ' — see ' },
      { kind: 'link', href: 'https://scryfall.com', children: [{ kind: 'text', text: 'Scryfall' }] },
      { kind: 'text', text: '.' },
    ])
  })

  it('leaves unsafe links, stray markers, and snake_case alone', () => {
    expect(parseInline('[x](javascript:alert(1)) 2 * 3 * 4 and search_my_library')).toEqual([
      { kind: 'text', text: '[x](javascript:alert(1)) 2 * 3 * 4 and search_my_library' },
    ])
  })

  it('reads headings, lists, tables, code, rules, and paragraphs', () => {
    const blocks = parseMarkdown(
      [
        '## Ramp',
        '- [[Sol Ring]]: fast mana',
        '- [[Arcane Signet]]',
        '  fixes colors',
        '',
        '1. First',
        '2. Second',
        '',
        '| Card | Price |',
        '|---|---:|',
        '| [[Sol Ring]] | $1 |',
        '',
        '```',
        'raw text',
        '```',
        '---',
        'A paragraph',
        'on two lines.',
      ].join('\n'),
    )
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list', 'list', 'table', 'code', 'rule', 'paragraph'])
    expect(blocks[1]).toEqual({
      kind: 'list',
      ordered: false,
      items: [
        [{ kind: 'card', name: 'Sol Ring' }, { kind: 'text', text: ': fast mana' }],
        [{ kind: 'card', name: 'Arcane Signet' }, { kind: 'text', text: ' fixes colors' }],
      ],
    })
    expect(blocks[2]).toMatchObject({ ordered: true, items: [[{ text: 'First' }], [{ text: 'Second' }]] })
    expect(blocks[3]).toMatchObject({ head: [[{ text: 'Card' }], [{ text: 'Price' }]], rows: [[[{ kind: 'card' }], [{ text: '$1' }]]] })
    expect(blocks[4]).toEqual({ kind: 'code', text: 'raw text' })
    expect(blocks[6]).toEqual({ kind: 'paragraph', content: [{ kind: 'text', text: 'A paragraph\non two lines.' }] })
  })
})

describe('answer events', () => {
  it('splits server-sent events, keeping an unfinished one', () => {
    expect(splitEvents('data: {"a":1}\n\ndata: {"b"')).toEqual({ data: ['{"a":1}'], rest: 'data: {"b"' })
    expect(splitEvents('event: x\r\ndata: 1\r\n\r\n: comment\n\n')).toEqual({ data: ['1'], rest: '' })
  })

  it('builds the live answer from events', () => {
    let items: ChatItem[] = []
    items = applyChatEvent(items, { type: 'item', item: { kind: 'user', text: 'Hi', deck: null } })
    items = applyChatEvent(items, { type: 'title', title: 'Hi' })
    items = applyChatEvent(items, { type: 'item', item: { kind: 'note', text: '' } })
    items = applyChatEvent(items, { type: 'delta', text: 'Plan' })
    items = applyChatEvent(items, { type: 'item', item: { kind: 'text', text: '' } })
    items = applyChatEvent(items, { type: 'delta', text: 'Hel' })
    items = applyChatEvent(items, { type: 'delta', text: 'lo' })
    items = applyChatEvent(items, {
      type: 'item',
      item: { kind: 'tool', id: 't1', name: 'get_card', activity: 'Looking up Sol Ring', state: 'running', error: null, deck: null },
    })
    items = applyChatEvent(items, { type: 'delta', text: 'ignored' })
    items = applyChatEvent(items, { type: 'tool_done', id: 't1', state: 'failed', error: 'No card', deck: null })
    items = applyChatEvent(items, { type: 'error', message: 'Anthropic had a problem (500); try again shortly', canContinue: true })
    items = applyChatEvent(items, { type: 'done' })
    expect(items).toEqual<ChatItem[]>([
      { kind: 'user', text: 'Hi', deck: null },
      { kind: 'note', text: 'Plan' },
      { kind: 'text', text: 'Hello' },
      { kind: 'tool', id: 't1', name: 'get_card', activity: 'Looking up Sol Ring', state: 'failed', error: 'No card', deck: null },
      { kind: 'notice', tone: 'error', text: 'Anthropic had a problem (500); try again shortly' },
    ])
  })
})
````

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/web/brainstorm.test.ts`
Expected: FAIL: `src/web/lib/brainstorm.ts` does not exist.

- [ ] **Step 3: Implement the parsers and hooks**

Create `src/web/lib/markdown.ts`:

````ts
/** A run of inline text in Claude's Markdown (spec §5.5): plain, bold, italic, code, a link, or a [[card]] link. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'card'; name: string }
  | { kind: 'link'; href: string; children: Inline[] }

/** A block of Claude's Markdown. Anything the parser doesn't know stays as paragraph text. */
export type Block =
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' }

// Tried in this order at each position; the earliest match wins, then the longest.
const INLINE: Array<{ re: RegExp; make: (m: RegExpExecArray) => Inline }> = [
  { re: /`([^`\n]+)`/, make: (m) => ({ kind: 'code', text: m[1]! }) },
  { re: /\[\[([^\]\n]{1,150})\]\]/, make: (m) => ({ kind: 'card', name: m[1]!.trim() }) },
  { re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/, make: (m) => ({ kind: 'link', href: m[2]!, children: parseInline(m[1]!) }) },
  // Emphasis markers hug their text, as in CommonMark: "2 * 3 * 4" stays text.
  { re: /\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/, make: (m) => ({ kind: 'strong', children: parseInline(m[1]!) }) },
  { re: /__(?!\s)([^_\n]+?)(?<!\s)__/, make: (m) => ({ kind: 'strong', children: parseInline(m[1]!) }) },
  { re: /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/, make: (m) => ({ kind: 'em', children: parseInline(m[1]!) }) },
  { re: /(?<!\w)_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/, make: (m) => ({ kind: 'em', children: parseInline(m[1]!) }) },
]

/** Parses bold, italic, inline code, http(s) links, and [[Card Name]] links; everything else is text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest !== '') {
    let best: { index: number; length: number; node: Inline } | null = null
    for (const { re, make } of INLINE) {
      const m = re.exec(rest)
      if (m && (best === null || m.index < best.index || (m.index === best.index && m[0].length > best.length))) {
        best = { index: m.index, length: m[0].length, node: make(m) }
      }
    }
    if (!best) {
      out.push({ kind: 'text', text: rest })
      break
    }
    if (best.index > 0) out.push({ kind: 'text', text: rest.slice(0, best.index) })
    out.push(best.node)
    rest = rest.slice(best.index + best.length)
  }
  return out
}

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()))

/** Parses the Markdown Claude writes: paragraphs, headings, lists, fenced code, tables, and rules. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    if (line.trimStart().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) body.push(lines[i++]!)
      i++ // the closing fence (or the end)
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, content: parseInline(heading[2]!.trim()) })
      i++
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!)) {
      const head = cells(line)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') rows.push(cells(lines[i++]!))
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    const listItem = BULLET.exec(line) ?? NUMBERED.exec(line)
    if (listItem) {
      const ordered = !BULLET.test(line)
      const items: string[] = []
      while (i < lines.length) {
        const current = lines[i]!
        const item = (ordered ? NUMBERED : BULLET).exec(current)
        if (item) items.push(item[1]!)
        else if (current.trim() !== '' && /^\s+/.test(current) && items.length > 0) items[items.length - 1] += ` ${current.trim()}`
        else break
        i++
      }
      blocks.push({ kind: 'list', ordered, items: items.map((item) => parseInline(item)) })
      continue
    }
    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !HEADING.test(lines[i]!) &&
      !BULLET.test(lines[i]!) &&
      !NUMBERED.test(lines[i]!) &&
      !lines[i]!.trimStart().startsWith('```')
    ) {
      paragraph.push(lines[i++]!.trim())
    }
    blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')) })
  }
  return blocks
}
````

Create `src/web/lib/brainstorm.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiErrorBody, ChatEvent, ChatItem, ThreadDetail, ThreadSummary } from '../../shared/types.ts'
import { apiGet, apiSend, ApiRequestError } from './api.ts'
import { invalidateCollection } from './collection.ts'
import { useToast } from './toast.tsx'

export function useThreads() {
  return useQuery({ queryKey: ['threads'], queryFn: ({ signal }) => apiGet<ThreadSummary[]>('/api/ai/threads', signal) })
}

export function useThread(id: number | null) {
  return useQuery({
    queryKey: ['thread', id],
    queryFn: ({ signal }) => apiGet<ThreadDetail>(`/api/ai/threads/${id}`, signal),
    enabled: id !== null,
    // Claude answering in another window: check back until it's done.
    refetchInterval: (query) => (query.state.data?.busy ? 2000 : false),
  })
}

/** Starts a conversation, about a deck when given one. */
export function useCreateThread() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (deckId: number | null) => apiSend<ThreadSummary>('POST', '/api/ai/threads', { deckId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['threads'] }),
    onError: (err) => toast.error(`Couldn't start a conversation: ${err.message}`),
  })
}

export function useRenameThread(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (title: string) => apiSend<ThreadSummary>('PATCH', `/api/ai/threads/${id}`, { title }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['threads'] }), queryClient.invalidateQueries({ queryKey: ['thread', id] })]),
    onError: (err) => toast.error(`Couldn't rename the conversation: ${err.message}`),
  })
}

export function useDeleteThread(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => apiSend<void>('DELETE', `/api/ai/threads/${id}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['thread', id] })
      return queryClient.invalidateQueries({ queryKey: ['threads'] })
    },
    onError: (err) => toast.error(`Couldn't delete the conversation: ${err.message}`),
  })
}

/** Splits server-sent-event text into each finished event's data, keeping an unfinished event for the next chunk. */
export function splitEvents(buffer: string): { data: string[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = parts.pop() ?? ''
  const data = parts.flatMap((part) => {
    const lines = part
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
    return lines.length > 0 ? [lines.join('\n')] : []
  })
  return { data, rest }
}

/** A conversation's items with one more answer event applied (spec §5.5). */
export function applyChatEvent(items: readonly ChatItem[], event: ChatEvent): ChatItem[] {
  switch (event.type) {
    case 'item':
      return [...items, event.item]
    case 'delta': {
      const last = items.at(-1)
      if (!last || (last.kind !== 'text' && last.kind !== 'note')) return [...items]
      return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
    }
    case 'tool_done':
      return items.map((item) =>
        item.kind === 'tool' && item.id === event.id ? { ...item, state: event.state, error: event.error, deck: event.deck } : item,
      )
    case 'error':
      return [...items, { kind: 'notice', tone: 'error', text: event.message }]
    case 'title':
    case 'done':
      return [...items]
  }
}

/** POSTs to an answer route and passes each server-sent event on. An error before the stream opens throws. */
async function streamAnswer(path: string, body: unknown, onEvent: (event: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let code = 'http_error'
    let message = `Request failed (${res.status})`
    try {
      const error = ((await res.json()) as ApiErrorBody).error
      code = error.code
      message = error.message
    } catch {
      // Not a JSON error; keep the generic message.
    }
    throw new ApiRequestError(res.status, code, message)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const split = splitEvents(buffer + value)
    buffer = split.rest
    for (const data of split.data) onEvent(JSON.parse(data) as ChatEvent)
  }
}

/**
 * Asking Claude in one conversation: `live` holds the answer as it streams (null when none is running), shown after
 * the stored items. When the answer ends, the conversation is refetched and `live` cleared.
 */
export function useAnswer(threadId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [live, setLive] = useState<ChatItem[] | null>(null)
  const controller = useRef<AbortController | null>(null)

  // Leaving the page (or the conversation) stops the answer; the server keeps what was said.
  useEffect(() => () => controller.current?.abort(), [threadId])

  const run = useCallback(
    async (path: string, body?: unknown) => {
      const ctrl = new AbortController()
      controller.current = ctrl
      setLive([])
      let madeDeck = false
      try {
        await streamAnswer(
          path,
          body,
          (event) => {
            if (event.type === 'tool_done' && event.deck) madeDeck = true
            if (event.type === 'title') {
              // Name the conversation now, not when the answer ends; its items stay as they are until then.
              queryClient.setQueryData<ThreadDetail>(['thread', threadId], (thread) => thread && { ...thread, title: event.title })
              void queryClient.invalidateQueries({ queryKey: ['threads'] })
            }
            setLive((items) => applyChatEvent(items ?? [], event))
          },
          ctrl.signal,
        )
      } catch (err) {
        if (!ctrl.signal.aborted) toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        if (madeDeck) invalidateCollection(queryClient, { keepScryfallSearches: true })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['thread', threadId] }),
          queryClient.invalidateQueries({ queryKey: ['threads'] }),
        ])
        if (controller.current === ctrl) {
          controller.current = null
          setLive(null)
        }
      }
    },
    [queryClient, threadId, toast],
  )

  return {
    live,
    running: live !== null,
    send: (text: string) => run(`/api/ai/threads/${threadId}/messages`, { text }),
    resume: () => run(`/api/ai/threads/${threadId}/continue`),
    stop: () => void apiSend('POST', `/api/ai/threads/${threadId}/stop`).catch(() => controller.current?.abort()),
  }
}
```

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run tests/web/brainstorm.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Build the page**

Create `src/web/components/brainstorm/Markdown.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { CardSummary } from '../../../shared/types.ts'
import { apiGet, ApiRequestError } from '../../lib/api.ts'
import { useCardDrawer } from '../../lib/card-drawer.tsx'
import { parseMarkdown, type Block, type Inline } from '../../lib/markdown.ts'
import { useToast } from '../../lib/toast.tsx'
import { ManaText } from '../ManaText.tsx'

/** A [[card]] name Claude wrote: opens that card's drawer. */
function CardLink({ name }: { name: string }) {
  const drawer = useCardDrawer()
  const toast = useToast()
  async function open() {
    try {
      const card = await apiGet<CardSummary>(`/api/cards/named?name=${encodeURIComponent(name)}`)
      drawer.open(card.cardId)
    } catch (err) {
      toast.error(err instanceof ApiRequestError && err.status === 404 ? `No card is named ${name}` : `Couldn't open ${name}`)
    }
  }
  return (
    <button onClick={() => void open()} className="font-medium text-amber-300 decoration-amber-300/40 hover:underline">
      {name}
    </button>
  )
}

function inlines(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'text':
        return <ManaText key={i} text={node.text} />
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-stone-50">
            {inlines(node.children)}
          </strong>
        )
      case 'em':
        return <em key={i}>{inlines(node.children)}</em>
      case 'code':
        return (
          <code key={i} className="rounded bg-stone-800 px-1 py-0.5 font-mono text-[0.85em] text-stone-100">
            {node.text}
          </code>
        )
      case 'card':
        return <CardLink key={i} name={node.name} />
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noreferrer" className="text-amber-300 underline decoration-amber-300/40">
            {inlines(node.children)}
          </a>
        )
    }
  })
}

const HEADING_CLASS = ['text-lg', 'text-base', 'text-sm']

function block(b: Block, i: number): ReactNode {
  switch (b.kind) {
    case 'paragraph':
      return (
        <p key={i} className="whitespace-pre-line">
          {inlines(b.content)}
        </p>
      )
    case 'heading':
      return (
        <p key={i} role="heading" aria-level={b.level + 2} className={`font-semibold text-stone-50 ${HEADING_CLASS[Math.min(b.level, 3) - 1]}`}>
          {inlines(b.content)}
        </p>
      )
    case 'list': {
      const items = b.items.map((item, j) => <li key={j}>{inlines(item)}</li>)
      return b.ordered ? (
        <ol key={i} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={i} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      )
    }
    case 'code':
      return (
        <pre key={i} className="overflow-x-auto rounded-md bg-stone-900 p-3 font-mono text-xs text-stone-200">
          {b.text}
        </pre>
      )
    case 'table':
      return (
        <div key={i} className="overflow-x-auto">
          <table className="text-left text-sm">
            <thead className="border-b border-stone-700 text-stone-400">
              <tr>
                {b.head.map((cell, j) => (
                  <th key={j} className="px-2 py-1 font-medium">
                    {inlines(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800">
              {b.rows.map((row, j) => (
                <tr key={j}>
                  {row.map((cell, k) => (
                    <td key={k} className="px-2 py-1 align-top">
                      {inlines(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr key={i} className="border-stone-800" />
  }
}

/** Claude's Markdown, with [[card]] links that open the card, and mana symbols as icons. */
export function Markdown({ text }: { text: string }) {
  return <div className="space-y-3 leading-relaxed">{parseMarkdown(text).map(block)}</div>
}
```

Create `src/web/components/brainstorm/ChatItemView.tsx`:

```tsx
import { Link } from 'react-router'
import { FORMATS } from '../../../shared/formats.ts'
import type { ChatItem, CreatedDeck } from '../../../shared/types.ts'
import { completionPercent } from '../../lib/deck-view.ts'
import { formatUsd, plural } from '../../lib/format.ts'
import { Markdown } from './Markdown.tsx'

const MODEL_NAMES: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-opus-5': 'Claude Opus 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-fable-5-1': 'Claude Fable 5.1',
}
const modelName = (id: string) => MODEL_NAMES[id] ?? id

/** An activity line with its `code` spans shown as code: "Searching your library for `t:elf`". */
function Activity({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]*`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          <code key={i} className="rounded bg-stone-800/80 px-1 font-mono text-xs text-stone-200">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

function DeckCard({ deck }: { deck: CreatedDeck }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-stone-50">{deck.name}</p>
        <p className="text-xs text-stone-400">
          {FORMATS[deck.format]?.label ?? deck.format} · prospective · {plural(deck.cardCount, 'card')} ·{' '}
          {completionPercent(deck.completion)}% owned · {formatUsd(deck.costToFinish)} to finish
        </p>
        {deck.unresolved.length > 0 && (
          <p className="text-xs text-amber-300/80">Left out (no card by that name): {deck.unresolved.join(', ')}</p>
        )}
      </div>
      <Link to={`/decks/${deck.id}`} className="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-stone-950 hover:bg-amber-400">
        Open in deckbuilder
      </Link>
    </div>
  )
}

/** One item of a conversation (spec §5.5). `live`: it's the item Claude is writing right now. */
export function ChatItemView({ item, live = false }: { item: ChatItem; live?: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-auto max-w-[85%] space-y-1 rounded-2xl rounded-br-sm bg-stone-800 px-4 py-2.5 text-stone-100">
          {item.deck !== null && <p className="text-xs text-amber-300/80">About the deck {item.deck}</p>}
          <p className="whitespace-pre-wrap">{item.text}</p>
        </div>
      )
    case 'text':
      return item.text === '' && live ? (
        <p className="animate-pulse text-stone-500">…</p>
      ) : (
        <div className="text-stone-200">
          <Markdown text={item.text} />
        </div>
      )
    case 'note':
      return item.text === '' && live ? (
        <p className="animate-pulse text-sm text-stone-500">Thinking…</p>
      ) : (
        <p className="border-l border-stone-800 pl-3 text-sm whitespace-pre-line text-stone-400">{item.text}</p>
      )
    case 'tool':
      return (
        <div className="text-sm">
          <p className={item.state === 'failed' ? 'text-rose-300' : 'text-stone-400'}>
            <span aria-hidden className={`mr-1.5 inline-block w-4 text-center ${item.state === 'running' ? 'animate-spin' : ''}`}>
              {item.state === 'running' ? '◌' : item.state === 'done' ? '✓' : '✕'}
            </span>
            <Activity text={item.activity} />
            {item.state === 'running' && '…'}
          </p>
          {item.error && <p className="ml-6 text-xs text-rose-300/80">{item.error}</p>}
          {item.deck && <DeckCard deck={item.deck} />}
        </div>
      )
    case 'fallback':
      return (
        <p className="text-xs text-stone-500">
          {modelName(item.from)} declined part of this; {modelName(item.to)} carried on.
        </p>
      )
    case 'notice':
      return <p className={`text-sm ${item.tone === 'error' ? 'text-rose-300' : 'text-stone-500'}`}>{item.text}</p>
  }
}
```

Create `src/web/components/brainstorm/Composer.tsx`:

```tsx
import { useState } from 'react'

/** The message box: Enter sends, Shift+Enter starts a new line; Stop replaces Send while Claude answers. */
export function Composer({
  onSend,
  onStop,
  running = false,
  disabled = false,
  placeholder = 'Ask Claude…',
}: {
  onSend: (text: string) => void
  onStop?: () => void
  running?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const typed = text.trim()
  function send() {
    if (!typed || running || disabled) return
    onSend(typed)
    setText('')
  }
  return (
    <div className="flex items-end gap-2 rounded-xl border border-stone-700 bg-stone-900 p-2 focus-within:border-amber-500/70">
      <textarea
        aria-label="Message"
        value={text}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
        className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-stone-100 outline-none placeholder:text-stone-500 disabled:opacity-50"
      />
      {running ? (
        <button onClick={onStop} className="rounded-lg border border-stone-600 px-4 py-2 text-sm text-stone-200 hover:bg-stone-800">
          Stop
        </button>
      ) : (
        <button
          onClick={send}
          disabled={!typed || disabled}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          Send
        </button>
      )}
    </div>
  )
}
```

Create `src/web/components/brainstorm/ChatView.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiRequestError } from '../../lib/api.ts'
import { useAnswer, useDeleteThread, useRenameThread, useThread } from '../../lib/brainstorm.ts'
import { formatUsd } from '../../lib/format.ts'
import { ChatItemView } from './ChatItemView.tsx'
import { Composer } from './Composer.tsx'

/** A message to send as soon as a new conversation opens (from the start page's box or an example). */
export interface OpenWith {
  ask?: string
}

/** One conversation (spec §5.5): its header, the items, and the message box. */
export function ChatView({ threadId, configured }: { threadId: number; configured: boolean }) {
  const { data: thread, error } = useThread(threadId)
  const answer = useAnswer(threadId)
  const rename = useRenameThread(threadId)
  const remove = useDeleteThread(threadId)
  const navigate = useNavigate()
  const location = useLocation()
  const [title, setTitle] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const asked = useRef(false)

  useEffect(() => setTitle(thread?.title ?? ''), [thread?.title])

  // A new conversation opened with a question sends it once, then forgets it (so going back doesn't ask again).
  const ask = (location.state as OpenWith | null)?.ask
  useEffect(() => {
    if (!ask || asked.current || !thread || !configured) return
    asked.current = true
    navigate(location.pathname, { replace: true, state: null })
    if (thread.items.length === 0) void answer.send(ask)
  }, [ask, thread, configured, answer, navigate, location.pathname])

  const items = [...(thread?.items ?? []), ...(answer.live ?? [])]
  const lastText = items.at(-1)
  // Follow the answer as it grows.
  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [items.length, lastText && 'text' in lastText ? lastText.text.length : 0])

  if (error) {
    return (
      <p role="alert" className="text-rose-300">
        {error instanceof ApiRequestError && error.status === 404 ? 'There is no such conversation.' : error.message}
      </p>
    )
  }
  if (!thread) return <p className="text-stone-500">Loading…</p>

  const busyElsewhere = thread.busy && !answer.running
  return (
    <section aria-label="Conversation" className="flex min-h-[70vh] min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-800 pb-3">
        <input
          aria-label="Conversation title"
          value={title}
          maxLength={100}
          placeholder="New conversation"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const trimmed = title.trim()
            if (trimmed === '') setTitle(thread.title)
            else if (trimmed !== thread.title) rename.mutate(trimmed)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-xl font-semibold text-stone-50 hover:border-stone-800 focus:border-stone-700 focus:outline-none"
        />
        {thread.deck && (
          <Link to={`/decks/${thread.deck.id}`} className="text-sm text-amber-300 hover:underline">
            {thread.deck.name}
          </Link>
        )}
        <span className="text-sm text-stone-500" title="Estimated from the tokens each answer used, at Claude Opus 5.5 prices">
          ≈ {formatUsd(thread.costUsd)}
        </span>
        {confirmingDelete ? (
          <span className="flex items-center gap-2 text-sm">
            Delete this conversation?
            <button
              onClick={() => remove.mutate(undefined, { onSuccess: () => navigate('/brainstorm') })}
              className="rounded-md border border-rose-900 px-2 py-0.5 text-rose-300 hover:bg-rose-950"
            >
              Delete
            </button>
            <button onClick={() => setConfirmingDelete(false)} className="rounded-md border border-stone-700 px-2 py-0.5 text-stone-300 hover:bg-stone-800">
              Keep
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={answer.running}
            className="text-sm text-stone-500 hover:text-rose-300 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </header>

      <div className="flex-1 space-y-4" aria-live="polite">
        {items.length === 0 && !answer.running && (
          <p className="text-stone-500">
            {thread.deck ? `Ask about ${thread.deck.name}: what to add, cut, or buy first.` : 'Ask Claude what to build, or how to improve a deck.'}
          </p>
        )}
        {items.map((item, i) => (
          <ChatItemView key={i} item={item} live={answer.running && i === items.length - 1} />
        ))}
        {!answer.running && thread.canContinue && configured && !busyElsewhere && (
          <p className="text-sm text-stone-400">
            Claude hasn't finished answering.{' '}
            <button onClick={() => void answer.resume()} className="text-amber-300 hover:underline">
              Continue
            </button>
          </p>
        )}
        {busyElsewhere && <p className="animate-pulse text-sm text-stone-500">Claude is answering in another window…</p>}
        <div ref={bottom} />
      </div>

      {configured ? (
        <Composer
          onSend={(text) => void answer.send(text)}
          onStop={answer.stop}
          running={answer.running}
          disabled={busyElsewhere}
          placeholder={thread.deck ? `Ask about ${thread.deck.name}…` : 'Ask Claude…'}
        />
      ) : (
        <p className="rounded-lg border border-stone-800 bg-stone-900/60 p-3 text-sm text-stone-400">
          Brainstorming needs an Anthropic API key.{' '}
          <Link to="/settings" className="text-amber-300 hover:underline">
            Add one in Settings
          </Link>
          .
        </p>
      )}
    </section>
  )
}
```

Create `src/web/components/brainstorm/ThreadList.tsx`:

```tsx
import { Link, NavLink } from 'react-router'
import { useThreads } from '../../lib/brainstorm.ts'

/** Every conversation, the most recent first, with a way to start a new one. */
export function ThreadList() {
  const { data: threads, error } = useThreads()
  return (
    <nav aria-label="Conversations" className="space-y-3">
      <Link to="/brainstorm" className="block rounded-md border border-stone-700 px-3 py-1.5 text-center text-sm text-stone-200 hover:bg-stone-800">
        New conversation
      </Link>
      {error && <p className="text-sm text-rose-300">Couldn't load conversations: {error.message}</p>}
      <ul className="space-y-0.5">
        {threads?.map((t) => (
          <li key={t.id}>
            <NavLink
              to={`/brainstorm/${t.id}`}
              className={({ isActive }) =>
                `block rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-stone-800 text-stone-50' : 'text-stone-400 hover:bg-stone-900 hover:text-stone-100'}`
              }
            >
              <span className="block truncate">{t.title || 'New conversation'}</span>
              {t.deck && <span className="block truncate text-xs text-amber-300/70">{t.deck.name}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

Create `src/web/pages/BrainstormPage.tsx`:

```tsx
import { Link, useNavigate, useParams } from 'react-router'
import { ChatView, type OpenWith } from '../components/brainstorm/ChatView.tsx'
import { Composer } from '../components/brainstorm/Composer.tsx'
import { ThreadList } from '../components/brainstorm/ThreadList.tsx'
import { useCreateThread } from '../lib/brainstorm.ts'
import { useAiKey } from '../lib/settings.ts'

const EXAMPLES = [
  'What could I build with the cards I already own?',
  'Suggest a Commander deck around my best green cards, and what I would need to buy.',
  'Which of my cards are worth building around?',
]

/** A new conversation: a box to ask in, and a few examples. Asking starts the conversation. */
function Start({ configured }: { configured: boolean }) {
  const create = useCreateThread()
  const navigate = useNavigate()
  const start = (ask: string) =>
    create.mutate(null, { onSuccess: (thread) => navigate(`/brainstorm/${thread.id}`, { state: { ask } satisfies OpenWith }) })
  return (
    <section aria-label="New conversation" className="space-y-5">
      <p className="text-stone-400">
        Brainstorm decks with Claude, grounded in what you own: it searches your library and Scryfall, reads your decks, and
        can save an idea to the deckbuilder as a prospective deck.
      </p>
      {configured ? (
        <>
          <Composer onSend={start} running={create.isPending} placeholder="What should I build next?" />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => start(example)}
                disabled={create.isPending}
                className="rounded-full border border-stone-700 px-3 py-1 text-left text-sm text-stone-300 hover:bg-stone-800 disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-stone-800 bg-stone-900/60 p-4 text-stone-300">
          Brainstorming uses Claude through Anthropic's API, with your own API key.{' '}
          <Link to="/settings" className="text-amber-300 hover:underline">
            Add a key in Settings
          </Link>{' '}
          to start. Scanning never uses it.
        </p>
      )}
    </section>
  )
}

/** Brainstorm with Claude (spec §5.5): the conversations on the left, the open one on the right. */
export function BrainstormPage() {
  const param = useParams().threadId
  const threadId = param === undefined ? null : Number(param)
  const { data: key } = useAiKey()
  const configured = key?.configured ?? true
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-semibold text-stone-50">Brainstorm</h1>
      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <ThreadList />
        {threadId === null || !Number.isInteger(threadId) ? (
          <Start configured={configured} />
        ) : (
          <ChatView key={threadId} threadId={threadId} configured={configured} />
        )}
      </div>
    </div>
  )
}
```

In `src/web/routes.tsx`, replace:

```tsx
import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout.tsx'
import { DeckEditorPage } from './pages/DeckEditorPage.tsx'
import { DecksPage } from './pages/DecksPage.tsx'
```

with:

```tsx
import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout.tsx'
import { BrainstormPage } from './pages/BrainstormPage.tsx'
import { DeckEditorPage } from './pages/DeckEditorPage.tsx'
import { DecksPage } from './pages/DecksPage.tsx'
```

In `src/web/routes.tsx`, replace:

```tsx
      { path: 'decks', element: <DecksPage /> },
      { path: 'decks/:id', element: <DeckEditorPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
```

with:

```tsx
      { path: 'decks', element: <DecksPage /> },
      { path: 'decks/:id', element: <DeckEditorPage /> },
      { path: 'brainstorm', element: <BrainstormPage /> },
      { path: 'brainstorm/:threadId', element: <BrainstormPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
```

In `src/web/components/Layout.tsx`, replace:

```tsx
  { to: '/scan', label: 'Scan', end: false },
  { to: '/decks', label: 'Decks', end: false },
  { to: '/settings', label: 'Settings', end: false },
]
```

with:

```tsx
  { to: '/scan', label: 'Scan', end: false },
  { to: '/decks', label: 'Decks', end: false },
  { to: '/brainstorm', label: 'Brainstorm', end: false },
  { to: '/settings', label: 'Settings', end: false },
]
```

In `src/web/components/decks/DeckHeader.tsx`, replace:

```tsx
import { useEffect, useRef, useState } from 'react'
import { FORMAT_IDS, FORMATS } from '../../../shared/formats.ts'
import type { DeckDetail, DeckStatus, DeckSummary, FormatId } from '../../../shared/types.ts'
import { apiSend } from '../../lib/api.ts'
import { completionPercent, shortCards } from '../../lib/deck-view.ts'
import { BOARD_LABEL, BOARD_ORDER, useDeckChange } from '../../lib/decks.ts'
```

with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FORMAT_IDS, FORMATS } from '../../../shared/formats.ts'
import type { DeckDetail, DeckStatus, DeckSummary, FormatId } from '../../../shared/types.ts'
import { apiSend } from '../../lib/api.ts'
import { useCreateThread } from '../../lib/brainstorm.ts'
import { completionPercent, shortCards } from '../../lib/deck-view.ts'
import { BOARD_LABEL, BOARD_ORDER, useDeckChange } from '../../lib/decks.ts'
```

In `src/web/components/decks/DeckHeader.tsx`, replace:

```tsx
  const [confirmingBuilt, setConfirmingBuilt] = useState(false)
  const save = useDeckChange((fields: DeckFields) => apiSend<DeckSummary>('PATCH', `/api/decks/${deck.id}`, fields), "Couldn't save the deck")
  const short = shortCards(deck.lines)
  const warningCount = deck.warnings.length + deck.lines.filter((l) => l.warnings.length > 0).length
```

with:

```tsx
  const [confirmingBuilt, setConfirmingBuilt] = useState(false)
  const save = useDeckChange((fields: DeckFields) => apiSend<DeckSummary>('PATCH', `/api/decks/${deck.id}`, fields), "Couldn't save the deck")
  const brainstorm = useCreateThread()
  const navigate = useNavigate()
  const short = shortCards(deck.lines)
  const warningCount = deck.warnings.length + deck.lines.filter((l) => l.warnings.length > 0).length
```

In `src/web/components/decks/DeckHeader.tsx`, replace:

```tsx
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-stone-400">
```

with:

```tsx
          ))}
        </div>
        <button
          onClick={() => brainstorm.mutate(deck.id, { onSuccess: (thread) => navigate(`/brainstorm/${thread.id}`) })}
          disabled={brainstorm.isPending}
          className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-800 disabled:opacity-50"
        >
          Brainstorm with Claude
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-stone-400">
```

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: typecheck clean; 730 tests pass; the build succeeds.

---

### Task 6: End-to-end check on a copy of the real library, and docs

The real app on a `/tmp` copy of the owner's library, driven in headless Chrome. Claude is played by a
scripted local fake, so no key is needed and nothing reaches Anthropic. The copy is at migration 003, so its start also
shows the pre-upgrade backup that the owner's next start will make before migration 004.

**Never touch `data/`** beyond the read-only copy command. Use ports 4455 (app) and 9444 (Chrome), not the owner's
4321.

**Files:**
- Scripts in `/tmp/binder-m6-e2e-scripts/` (not in the project; deleted at the end)
- Modify: `docs/specs/2026-09-26-binder-design.md` (§4.1, §5.5, §6, §7), `README.md` (Brainstorm),
  `docs/plans/m5-followups.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the scripts**

Create `/tmp/binder-m6-e2e-scripts/cdp.ts` (a minimal Chrome DevTools Protocol driver):

```ts
// Minimal Chrome DevTools Protocol driver (Node 24 global WebSocket, no dependencies).
import fs from 'node:fs'

export interface Page {
  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>
  eval<T = any>(expression: string): Promise<T>
  waitFor(expression: string, timeoutMs?: number): Promise<any>
  goto(url: string): Promise<void>
  click(selector: string): Promise<void>
  type(text: string): Promise<void>
  key(key: string, code?: string, keyCode?: number): Promise<void>
  shot(file: string): Promise<void>
  close(): Promise<void>
}

export async function openPage(port = 9333): Promise<Page> {
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string; id: string }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let nextId = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${msg.error.message}`))
      else p.resolve(msg.result)
    }
  }
  const send = <T,>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression: string) => {
    const r = await send<any>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${expression}`)
    return r.result.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false })
  const page: Page = {
    send,
    eval: evaluate,
    async waitFor(expression, timeoutMs = 8000) {
      const start = Date.now()
      for (;;) {
        const v = await evaluate(`!!(${expression})`).catch(() => undefined)
        if (v) return v
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${expression}`)
        await new Promise((r) => setTimeout(r, 100))
      }
    },
    async goto(url) {
      await send('Page.navigate', { url })
      await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('#root > *')`)
    },
    async click(selector) {
      const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2} })()`)
      if (!box) throw new Error(`no element ${selector}`)
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
      }
    },
    async type(text) {
      await send('Input.insertText', { text })
    },
    async key(key, code = key, keyCode = 0) {
      if (key === 'Enter') await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: 13, text: '\r' })
      else await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode })
      if (key.length === 1) await send('Input.dispatchKeyEvent', { type: 'char', text: key, key })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
    },
    async shot(file) {
      const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
    },
    async close() {
      ws.close()
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`)
    },
  }
  return page
}
```

Create `/tmp/binder-m6-e2e-scripts/server.ts`. It is the app as `main.ts` builds it, with the AI client pointed at a
fake Messages API that answers from the conversation so far:

```ts
// The Brainstorm check's server: Binder's own app on a /tmp copy of the library, with Claude played by a scripted
// local fake (no key, no Anthropic call). Loads the project's modules and packages from BINDER_ROOT.
// Usage: BINDER_DATA_DIR=/tmp/binder-m6-e2e BINDER_ROOT=<project> node server.ts
import http from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'

if (!process.env.BINDER_DATA_DIR?.startsWith('/tmp/')) throw new Error('BINDER_DATA_DIR must be a /tmp copy')
const ROOT = process.env.BINDER_ROOT ?? '/Users/kasonsuchow/Documents/localdev/binder'
const packages = createRequire(`${ROOT}/package.json`)
const load = (spec: string) => import(pathToFileURL(packages.resolve(spec)).href)
const source = (file: string) => import(pathToFileURL(`${ROOT}/src/server/${file}`).href)
const { serve } = await load('@hono/node-server')
const Anthropic = (await load('@anthropic-ai/sdk')).default
const { createAiClient } = await source('ai/client.ts')
const { createApp } = await source('app.ts')
const { BACKUP_DIR, DB_PATH, WEB_DIST_DIR } = await source('config.ts')
const { openLibrary } = await source('db/index.ts')
const { createScryfallClient } = await source('scryfall/client.ts')

type Msg = { role: string; content: Array<Record<string, any>> | string }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let requests = 0

/** Decides what "Claude" says next from the conversation so far. */
function plan(body: { messages: Msg[] }): { blocks: Array<Record<string, any>>; stop: string; slow?: boolean } {
  const last = body.messages.at(-1)!
  const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content
  const results = blocks.filter((b) => b.type === 'tool_result')
  if (results.length > 0) {
    const content = String(results[0]!.content)
    if (content.startsWith('Error')) return { blocks: [{ type: 'text', text: `That didn't work: ${content}` }], stop: 'end_turn' }
    const data = JSON.parse(content)
    if (data.deck_id) {
      return { blocks: [{ type: 'text', text: `Saved **${data.name}**: ${data.cards} cards, ${data.completion_percent}% of them yours already, **$${data.cost_to_finish_usd}** to finish.` }], stop: 'end_turn' }
    }
    if (data.cards && data.format) {
      return { blocks: [{ type: 'text', text: `**${data.name}** is ${data.format}, ${data.completion_percent}% complete. The main gaps:\n\n${data.cards.filter((c: any) => c.status !== 'owned').slice(0, 5).map((c: any) => `- [[${c.name}]] (${c.status})`).join('\n')}` }], stop: 'end_turn' }
    }
    const cards = (data.cards ?? []) as Array<{ name: string; free: number; owned: number }>
    return {
      blocks: [
        {
          type: 'text',
          text: `You own ${data.total} green creatures. A **Commander** shell around them:\n\n${cards
            .slice(0, 6)
            .map((c) => `- [[${c.name}]] — ${c.free} free of ${c.owned}`)
            .join('\n')}\n\n| Role | Pick |\n|---|---|\n| Ramp | [[Llanowar Elves]] |\n| Mana rock | [[Sol Ring]] |\n\nWant me to save it as a deck?`,
        },
      ],
      stop: 'end_turn',
    }
  }
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  const deckId = /Deck id: (\d+)/.exec(text)?.[1]
  if (deckId) {
    return {
      blocks: [
        { type: 'thinking', thinking: 'The owner wants to improve this deck. Read it first.' },
        { type: 'tool_use', id: `toolu_${requests}`, name: 'get_deck', input: { deck_id: Number(deckId) } },
      ],
      stop: 'tool_use',
    }
  }
  if (/slowly/i.test(text)) return { blocks: [{ type: 'text', text: 'Let me think about this at length. '.repeat(40) }], stop: 'end_turn', slow: true }
  if (/save/i.test(text)) {
    return {
      blocks: [
        { type: 'text', text: 'Saving it now.' },
        {
          type: 'tool_use',
          id: `toolu_${requests}`,
          name: 'create_prospective_deck',
          input: {
            name: 'Green Stompy',
            format: 'commander',
            notes: 'Go wide with mana elves, then big creatures.',
            cards: [
              { name: 'Omnath, Locus of Creation', quantity: 1, board: 'commander' },
              { name: 'Llanowar Elves', quantity: 1, category: 'Ramp' },
              { name: 'Elvish Mystic', quantity: 1, category: 'Ramp' },
              { name: 'Sol Ring', quantity: 1, category: 'Ramp' },
              { name: 'Craterhoof Behemoth', quantity: 1, category: 'Finisher' },
              { name: 'Zzyzx Elf Overlord', quantity: 1 },
            ],
          },
        },
      ],
      stop: 'tool_use',
    }
  }
  return {
    blocks: [
      { type: 'thinking', thinking: 'Look at what green creatures they own before suggesting anything.' },
      { type: 'text', text: 'Let me look at your green creatures.' },
      { type: 'tool_use', id: `toolu_${requests}`, name: 'search_my_library', input: { query: 't:creature c:g' } },
    ],
    stop: 'tool_use',
  }
}

const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    requests++
    const body = JSON.parse(raw)
    const { blocks, stop, slow } = plan(body)
    let closed = false
    res.on('close', () => (closed = true))
    const send = (event: string, data: unknown) => !closed && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    send('message_start', { type: 'message_start', message: { id: `msg_${requests}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3200, output_tokens: 1, cache_creation_input_tokens: 2800, cache_read_input_tokens: 0 } } })
    for (const [index, block] of blocks.entries()) {
      if (block.type === 'text') {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
        for (const part of block.text.match(/[\s\S]{1,6}/g) ?? []) {
          send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } })
          await sleep(slow ? 120 : 8)
          if (closed) return
        }
      } else if (block.type === 'thinking') {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } })
        send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } })
        send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: `sig${requests}` } })
        await sleep(300)
      } else {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } })
        const json = JSON.stringify(block.input)
        for (const part of json.match(/[\s\S]{1,20}/g) ?? []) send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: part } })
      }
      send('content_block_stop', { type: 'content_block_stop', index })
    }
    send('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 850 } })
    send('message_stop', { type: 'message_stop' })
    res.end()
  })
})
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r))
const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`

let key: string | null = 'sk-ant-fake-e2e-0000'
const ai = createAiClient(
  { read: () => key, write: (next: string | null) => void (key = next) },
  (apiKey: string) => new Anthropic({ apiKey, baseURL: fakeUrl, authToken: null, maxRetries: 0 }),
)
// Opened as the server does: the copy is at migration 003, so 004 runs after a pre-upgrade backup.
const db = openLibrary(DB_PATH, BACKUP_DIR)
const app = createApp({
  db,
  bulk: { status: () => ({ state: 'idle', processed: 0, error: null, updatedAt: null, sourceUpdatedAt: null, cardCount: 0 }), isStale: () => false, start: () => Promise.resolve() },
  scryfall: createScryfallClient(),
  ai,
  webDistDir: WEB_DIST_DIR,
})
serve({ fetch: app.fetch, port: 4455, hostname: '127.0.0.1' }, () => console.log(`e2e server on 4455 (db ${DB_PATH}, fake Claude ${fakeUrl})`))
```

Create `/tmp/binder-m6-e2e-scripts/check.ts`:

```ts
// Drives the Brainstorm page in headless Chrome (DevTools on 9444) against server.ts on 4455.
// Usage: node check.ts <screenshots dir>
import fs from 'node:fs'
import { openPage } from './cdp.ts'

const shots = process.argv[2] ?? '/tmp/binder-m6-shots'
fs.mkdirSync(shots, { recursive: true })
const base = 'http://127.0.0.1:4455'
const api = async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', origin: base },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}
const cardId = async (name: string) => (await api<Array<{ cardId: string; name: string }>>('GET', `/api/cards/autocomplete?q=${encodeURIComponent(name)}&limit=1`))[0]!.cardId
const log = (...args: unknown[]) => console.log('•', ...args)

// Seed the copy: a few owned green cards, and a built deck that holds one Llanowar Elves.
for (const [name, qty] of [['Llanowar Elves', 2], ['Elvish Mystic', 1], ['Sol Ring', 1], ['Craterhoof Behemoth', 1], ['Birds of Paradise', 1], ['Beast Whisperer', 1]] as const) {
  await api('POST', '/api/collection/adjust', { cardId: await cardId(name), finish: 'nonfoil', delta: qty })
}
const elfBall = await api<{ id: number }>('POST', '/api/decks', { name: 'Elf Ball', format: 'commander', status: 'built' })
await api('POST', `/api/decks/${elfBall.id}/cards`, { cardId: await cardId('Llanowar Elves'), board: 'main', delta: 1 })
await api('POST', `/api/decks/${elfBall.id}/cards`, { cardId: await cardId('Ezuri, Renegade Leader'), board: 'commander', delta: 1 })
log('seeded library and deck', elfBall.id)

const page = await openPage(9444)
const errors: string[] = []
await page.send('Log.enable')
const text = () => page.eval<string>('document.body.innerText')
const shot = async (name: string) => {
  // Wait for images (Scryfall mana symbols) before the screenshot.
  await page.waitFor("[...document.images].every((i) => i.complete)", 8000).catch(() => undefined)
  await page.shot(`${shots}/${name}.png`)
  log('shot', name)
}

// 1. The start page.
await page.goto(`${base}/brainstorm`)
await page.waitFor(`document.body.innerText.includes('What could I build with the cards I already own?')`)
await shot('1-start')

// 2. An example question: a tool call runs, then the answer with card links and a table.
await page.click('section[aria-label="New conversation"] button.rounded-full')
await page.waitFor(`location.pathname.startsWith('/brainstorm/')`)
await page.waitFor(`document.body.innerText.includes('Want me to save it as a deck?')`, 15000)
await page.waitFor(`!document.body.innerText.includes('Thinking…')`)
const first = await text()
if (!first.includes('Searching your library for')) throw new Error('no tool activity line')
if (!/free of/.test(first)) throw new Error('no search results in the answer')
const threadPath = await page.eval<string>('location.pathname')
await shot('2-answer')

// 3. Ask to save it: Claude makes a prospective deck; the card has Open in deckbuilder.
await page.click('textarea[aria-label="Message"]')
await page.type('Save it as a deck')
await page.key('Enter')
await page.waitFor(`[...document.querySelectorAll('a')].some((a) => a.textContent === 'Open in deckbuilder')`, 15000)
await page.waitFor(`document.body.innerText.includes('to finish.')`)
const saved = await text()
if (!saved.includes('Left out (no card by that name): Zzyzx Elf Overlord')) throw new Error('unresolved name not shown')
await shot('3-deck-saved')

// 4. A [[card]] link opens the card drawer.
await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Sol Ring').click()`)
await page.waitFor(`document.querySelector('[aria-modal="true"]')?.innerText.includes('Sol Ring')`)
await shot('4-card-link')
await page.key('Escape')
await page.waitFor(`!document.querySelector('[aria-modal="true"]')`)

// 5. Open the saved deck in the deckbuilder.
await page.eval(`[...document.querySelectorAll('a')].find((a) => a.textContent === 'Open in deckbuilder').click()`)
await page.waitFor(`location.pathname.startsWith('/decks/') && document.body.innerText.includes('Omnath, Locus of Creation')`)
const deckPage = await text()
if ((await page.eval<string>(`document.querySelector('input[aria-label="Deck name"]').value`)) !== 'Green Stompy') throw new Error('wrong deck name')
for (const needle of ['Craterhoof Behemoth', 'Ramp']) if (!deckPage.includes(needle)) throw new Error(`deck page lacks ${needle}`)
await shot('5-deck-editor')

// 6. Brainstorm about a deck from the editor: the deck goes with the first message; Claude reads it with get_deck.
await page.goto(`${base}/decks/${elfBall.id}`)
await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Brainstorm with Claude')`)
await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Brainstorm with Claude').click()`)
await page.waitFor(`location.pathname.startsWith('/brainstorm/') && document.body.innerText.includes('Ask about Elf Ball')`)
await page.click('textarea[aria-label="Message"]')
await page.type('How can I finish this deck?')
await page.key('Enter')
await page.waitFor(`document.body.innerText.includes('The main gaps')`, 15000)
const deckChat = await text()
if (!deckChat.includes('About the deck Elf Ball')) throw new Error('deck not shown on the first message')
if (!deckChat.includes('Reading Elf Ball')) throw new Error('get_deck activity line missing')
await shot('6-deck-conversation')

// 7. Stop an answer partway: the text so far stays, marked Stopped.
await page.goto(`${base}/brainstorm`)
await page.click('textarea[aria-label="Message"]')
await page.type('Answer slowly please')
await page.key('Enter')
await page.waitFor(`document.body.innerText.includes('Let me think about this at length.')`, 15000)
await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Stop').click()`)
await page.waitFor(`document.body.innerText.includes('Stopped.')`, 8000)
await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Send')`)
await shot('7-stopped')

// 8. Reloading shows the stored conversation, Claude's notes, and the cost estimate.
await page.goto(base + threadPath)
await page.waitFor(`document.body.innerText.includes('Want me to save it as a deck?')`)
const reloaded = await text()
for (const needle of ['Look at what green creatures they own', 'Open in deckbuilder', '≈ $']) if (!reloaded.includes(needle)) throw new Error(`reload lacks ${needle}`)
const titles = await page.eval<string[]>(`[...document.querySelectorAll('nav[aria-label="Conversations"] li')].map((li) => li.innerText)`)
log('conversations:', JSON.stringify(titles))
await shot('8-reloaded')

// 9. Rename, then delete a conversation (with its confirmation).
await page.eval(`(() => { const i = document.querySelector('input[aria-label="Conversation title"]'); i.focus(); i.select() })()`)
await page.type('Green ideas')
await page.key('Enter')
await page.waitFor(`[...document.querySelectorAll('nav[aria-label="Conversations"] li')].some((li) => li.innerText.startsWith('Green ideas'))`)
await page.eval(`[...document.querySelectorAll('header button')].find((b) => b.textContent === 'Delete').click()`)
await page.waitFor(`document.body.innerText.includes('Delete this conversation?')`)
await shot('9-delete-confirm')
await page.eval(`[...document.querySelectorAll('header button')].find((b) => b.textContent === 'Delete' && b.className.includes('rose')).click()`)
await page.waitFor(`location.pathname === '/brainstorm' && ![...document.querySelectorAll('nav[aria-label="Conversations"] li')].some((li) => li.innerText.startsWith('Green ideas'))`)

// 10. Without a key the page says how to add one.
await api('PUT', '/api/settings/ai', { apiKey: null })
await page.goto(`${base}/brainstorm`)
await page.waitFor(`document.body.innerText.includes('Add a key in Settings')`)
await shot('10-no-key')

const leftovers = await page.eval<string[]>(`[...document.querySelectorAll('[class*="animate-pulse"]')].map((e) => e.textContent)`)
log('pulsing elements at the end:', JSON.stringify(leftovers))
const threads = await api<Array<{ title: string }>>('GET', '/api/ai/threads')
log('threads:', JSON.stringify(threads.map((t) => t.title)))
await page.close()
console.log(errors.length === 0 ? 'e2e check passed' : `console errors: ${errors.join('\n')}`)
```

- [ ] **Step 2: Copy the library, build, and start the app and Chrome**

```bash
lsof -nP -iTCP:4455 -iTCP:9444 -sTCP:LISTEN   # must print nothing
mkdir -p /tmp/binder-m6-e2e
sqlite3 -readonly data/binder.db ".backup /tmp/binder-m6-e2e/binder.db"
pnpm build
(cd /tmp/binder-m6-e2e-scripts && BINDER_DATA_DIR=/tmp/binder-m6-e2e nohup node server.ts > /tmp/binder-m6-e2e/server.log 2>&1 & echo $! > /tmp/binder-m6-e2e/server.pid)
("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9444 \
  --user-data-dir=/tmp/binder-m6-e2e/chrome --no-first-run --no-default-browser-check about:blank \
  > /tmp/binder-m6-e2e/chrome.log 2>&1 & echo $! > /tmp/binder-m6-e2e/chrome.pid)
cat /tmp/binder-m6-e2e/server.log
```
Expected in `server.log`: `[backup] Backing up the database before upgrading it…`, then
`[backup] Saved /tmp/binder-m6-e2e/backups/binder-YYYY-MM-DD-before-004.db before upgrading the database`, then
`e2e server on 4455 …`.

- [ ] **Step 3: Run the check**

```bash
node /tmp/binder-m6-e2e-scripts/check.ts /tmp/binder-m6-e2e/shots
sqlite3 /tmp/binder-m6-e2e/backups/binder-*-before-004.db "SELECT group_concat(version) FROM schema_migrations"
sqlite3 /tmp/binder-m6-e2e/binder.db "SELECT group_concat(version) FROM schema_migrations"
```
Expected:
- The check ends with `e2e check passed` and writes screenshots 1–10.
- The copy made before the upgrade holds `1,2,3`, and the library copy holds `1,2,3,4`.

Look at every screenshot. In particular:
- the answer shows `[[card]]` links and the table;
- the saved deck lists its left-out name;
- the deck conversation says "About the deck Elf Ball";
- a stopped answer keeps its text.

- [ ] **Step 4: Stop everything and clean up**

```bash
kill "$(cat /tmp/binder-m6-e2e/server.pid)" "$(cat /tmp/binder-m6-e2e/chrome.pid)"
rm -rf /tmp/binder-m6-e2e /tmp/binder-m6-e2e-scripts
lsof -nP -iTCP:4455 -iTCP:9444 -iTCP:4321 -iTCP:9333 -sTCP:LISTEN   # must print nothing
ls -la data data/backups                                             # only binder.db-shm may have changed
```

- [ ] **Step 5: Update the docs**

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
| Card data | Local mirror of Scryfall **`default_cards`** bulk data (every printing, English or only-printed language; ~110k rows). Global search proxies the live Scryfall API. |
| Recognition | **On-device**: Apple Vision OCR via a Swift helper, matched against the local mirror. Scans it can't settle go to review. Scanning never calls Claude or any other service (the owner's choice, 2026-09-27: the Anthropic API is for deckbuilding help). |
| Claude model | `claude-opus-5` for brainstorm, with server-side refusal fallbacks enabled (`fallbacks: "default"`). |
| Allocation granularity | By card identity (`oracle_id`), not by physical copy or printing. |
| Port | `127.0.0.1:4321` (localhost only). |
```

with:

```markdown
| Card data | Local mirror of Scryfall **`default_cards`** bulk data (every printing, English or only-printed language; ~110k rows). Global search proxies the live Scryfall API. |
| Recognition | **On-device**: Apple Vision OCR via a Swift helper, matched against the local mirror. Scans it can't settle go to review. Scanning never calls Claude or any other service (the owner's choice, 2026-09-27: the Anthropic API is for deckbuilding help). |
| Claude model | `claude-opus-5-5` for brainstorm (the owner's choice, 2026-09-27), with server-side refusal fallbacks enabled (`fallbacks: "default"`). |
| Allocation granularity | By card identity (`oracle_id`), not by physical copy or printing. |
| Port | `127.0.0.1:4321` (localhost only). |
```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
**`scan_items`**: `id`, `image_path`, `status` (`queued`/`identifying`/`confident`/`review`/`committed`/`discarded`), `method` (`ocr`/`manual`; the schema also allows `claude`, unused since scanning is on-device only), `ocr_json`, `candidates` (JSON array of `{card_id, score}`), `card_id` (chosen), `finish`, `quantity` (default 1), `confidence` REAL, `error`, `created_at`, `updated_at`, `reason` (why a `review` scan needs a look: `printing` or `unsure`), `auto` (1 for auto-mode captures).

**`ai_threads`**: `id`, `title`, `deck_id` (nullable), `created_at`, `updated_at`.
**`ai_messages`**: `id`, `thread_id` FK, `role`, `content` (JSON array of content blocks, stored verbatim including thinking blocks), `created_at`.

**`meta`**: key/value. Holds `bulk_updated_at`, `bulk_source_updated_at`, `card_data_version` (the mapping version that imported `cards`), `card_names_version` (the default-printing rule that built `card_names`), `last_backup_at`, and settings (`scan_auto_commit`, `scan_default_finish`, `scan_accept_uncertain_printing`, `buylist_ignore_basics`).
```

with:

```markdown
**`scan_items`**: `id`, `image_path`, `status` (`queued`/`identifying`/`confident`/`review`/`committed`/`discarded`), `method` (`ocr`/`manual`; the schema also allows `claude`, unused since scanning is on-device only), `ocr_json`, `candidates` (JSON array of `{card_id, score}`), `card_id` (chosen), `finish`, `quantity` (default 1), `confidence` REAL, `error`, `created_at`, `updated_at`, `reason` (why a `review` scan needs a look: `printing` or `unsure`), `auto` (1 for auto-mode captures).

**`ai_threads`**: `id`, `title` (empty until the first message names it), `deck_id` (nullable; a deleted deck unlinks it), `created_at`, `updated_at`.
**`ai_messages`**: `id`, `thread_id` FK, `role`, `content` (JSON array of content blocks, stored verbatim including thinking blocks), `meta` (JSON, for an assistant message: the model that wrote it, why it stopped, and its token usage; added by migration 004), `created_at`.

**`meta`**: key/value. Holds `bulk_updated_at`, `bulk_source_updated_at`, `card_data_version` (the mapping version that imported `cards`), `card_names_version` (the default-printing rule that built `card_names`), `last_backup_at`, and settings (`scan_auto_commit`, `scan_default_finish`, `scan_accept_uncertain_printing`, `buylist_ignore_basics`).
```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown

### 5.5 Brainstorm (`/brainstorm`, `/brainstorm/:threadId`)
- A thread list plus a chat view. `POST /api/ai/threads/:id/messages` streams the response over SSE (text deltas, tool-call activity lines like "Searching your library for `t:elf id:g`…", and final message persistence).
- Model `claude-opus-5`, adaptive thinking, effort `high`, streaming, and server-side refusal fallbacks. The system prompt (stable, prompt-cached) explains the formats, the ownership rules, and when to use the tools. The tool runner drives the loop.
- **Tools** (Zod schemas):
  - `search_my_library(query, limit?)`: the local compiler, returning compact rows (name, type, mana cost, mana value, owned, free).
  - `search_scryfall(query, limit?)`: the live API, compact rows with ownership.
  - `get_card(name)`: the full oracle card plus ownership.
  - `get_deck(deck_id)`: the deck list with status per line and short counts.
  - `create_prospective_deck(name, format, notes, cards[{name, quantity, board, category?}])`: resolves names (reporting unresolved ones back to Claude), creates the deck, and returns the id and a summary (owned vs. buy counts, cost to finish). The UI renders an "Open in deckbuilder" button.
- **Deck-scoped threads**: "Brainstorm with Claude" from the editor creates a thread with `deck_id`. The deck summary goes into the first user turn, not the system prompt, so the cache stays stable.
- Messages are stored as full content-block arrays and replayed verbatim.
- With no key, the page shows setup instructions linking to Settings.

### 5.6 Settings (`/settings`)
```

with:

```markdown

### 5.5 Brainstorm (`/brainstorm`, `/brainstorm/:threadId`)
- A conversation list plus a chat view. `POST /api/ai/threads/:id/messages` streams Claude's answer as server-sent events: text and reasoning-summary deltas, a line per tool call ("Searching your library for `t:elf id:g`"), and how each call went. Each tool round is stored as it completes (the call with its results, in one transaction), so a failure keeps everything before it.
- Model `claude-opus-5-5` with adaptive thinking at effort `medium` (Opus 5.5's default, which does better than Opus 5 at `high`), up to 64k output tokens, streaming, and server-side refusal fallbacks (`fallbacks: "default"`; the chat notes when another model carried on). Thinking display `updates` returns Claude's short notes between tool calls, shown in the chat; its reasoning stays hidden. A replayed thinking block whose conversation no longer matches (the system prompt or tools changed in a Binder update) is dropped rather than refused (`block_binding.prefix_mismatch_behavior: "drop_block"`). The system prompt never changes between requests, so it stays cached with the tools. It explains the formats, the ownership rules, the tools and search syntax, and asks for card names as `[[Name]]`, brief answers, and a few words before each lookup.
- Binder runs the loop with the SDK's streaming Messages API: each request streams; then Binder validates and runs the tool calls, stores the round, and asks again, up to 16 requests per answer. (The SDK's tool runner can't store a round atomically, or drop what a declining model wrote before a fallback, without Binder taking over its history.) Tool inputs stream as Claude writes them; one that isn't JSON at all is asked for again, twice at most.
- **Tools** (Zod schemas, checked before running; a failed call goes back to Claude as an error result):
  - `search_my_library(query, limit?)`: the local compiler over the owner's collection. Compact rows: name, mana cost, type, power/toughness or loyalty, price, owned, free, and the decks using it. A query Binder can't parse comes back as an error to fix.
  - `search_scryfall(query, limit?)`: Scryfall's search, most-played first (EDHREC rank), with the same rows.
  - `get_card(name)`: the Oracle text (each face), mana value, color identity, the formats it's legal in, price, and the owner's copies and decks. Names resolve like decklist import (exact, face, fuzzy ≥ 0.92); an unknown name suggests close ones.
  - `get_deck(deck_id)`: format, status, notes, boards, completion, cost to finish, warnings, and every line with its board, category, and status.
  - `create_prospective_deck(name, format, notes?, cards[{name, quantity, board?, category?}])`: resolves names like decklist import and leaves out (and reports) names that match no card; with none matched, no deck is made. Creates a prospective deck with those lines and categories and returns its id, completion, and cost to finish. The chat shows the deck with **Open in deckbuilder**.
- **Deck-scoped conversations**: "Brainstorm with Claude" in the deck editor starts a conversation with `deck_id`. The deck's summary (every line with its status) goes into a text block before the first message, not into the system prompt, so the cache holds; `get_deck` reads the deck again later.
- Messages are stored as the content blocks sent and received, and replayed verbatim, with two exceptions: before a fallback partway through an answer only text is kept (the API's rule for sending such an answer back), and a question Claude declined, with its refusal, is left out of later requests. A stopped answer keeps its text. An answer that fails partway can be continued: Continue asks again from what's stored.
- One answer at a time per conversation; **Stop**, or leaving the page, stops it. `[[Card]]` links in answers open the card's drawer (`GET /api/cards/named`). Each conversation shows an estimated cost, from each answer's token usage at Claude Opus 5.5's prices.
- With no key, the page explains and links to Settings; stored conversations stay readable.

### 5.6 Settings (`/settings`)
```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
- **Scryfall client**: every request sends `User-Agent: Binder/0.1 (personal)` and `Accept: application/json`. A single-flight queue enforces ≥ 100 ms between requests. On 429, back off exponentially (1 s, 2 s, 4 s) and give up after 3 tries. Network errors are marked `offline` for UI messaging.
- **Bulk import**: staging table plus atomic swap (§4.2). On failure the old data stays live and `meta.bulk_error` is set and shown in Settings.
- **Anthropic**: typed error handling with the SDK's error classes. A 401 prompts "check API key". 429/5xx rely on SDK retries (default 2), then show an error with a retry button. A `refusal` stop reason is shown as such.
- **OCR helper**: timeout or crash restarts the process, and the item goes to review with the error.
- **API responses**: errors are JSON `{error: {code, message}}` with the right HTTP status. The SPA shows toasts for mutations and inline errors for queries.
```

with:

```markdown
- **Scryfall client**: every request sends `User-Agent: Binder/0.1 (personal)` and `Accept: application/json`. A single-flight queue enforces ≥ 100 ms between requests. On 429, back off exponentially (1 s, 2 s, 4 s) and give up after 3 tries. Network errors are marked `offline` for UI messaging.
- **Bulk import**: staging table plus atomic swap (§4.2). On failure the old data stays live and `meta.bulk_error` is set and shown in Settings.
- **Anthropic**: typed error handling with the SDK's error classes. A refused key (401) says to check it in Settings. Rate limits, overload (529), timeouts, and server errors are retried by the SDK (twice), then shown in the chat with Continue. A `refusal` stop reason (after the fallbacks) is shown as such. A tool call cut off by `max_tokens` is never run; the answer's text is kept and marked as cut off.
- **OCR helper**: timeout or crash restarts the process, and the item goes to review with the error.
- **API responses**: errors are JSON `{error: {code, message}}` with the right HTTP status. The SPA shows toasts for mutations and inline errors for queries.
```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
- **Matcher**: synthetic OCR outputs → decisions (exact set+number, name-only, ambiguous, junk).
- **Routes**: Hono `app.request()` against an in-memory database seeded from fixtures. Covers collection CRUD, deck CRUD, buy list, library search, and scan item lifecycle (with the OCR client stubbed).
- **Manual**: the scanner end-to-end with the iPhone, and brainstorm with a real key.

```

with:

```markdown
- **Matcher**: synthetic OCR outputs → decisions (exact set+number, name-only, ambiguous, junk).
- **Routes**: Hono `app.request()` against an in-memory database seeded from fixtures. Covers collection CRUD, deck CRUD, buy list, library search, and scan item lifecycle (with the OCR client stubbed).
- **Brainstorm**: a local fake of the Messages API (`tests/helpers/fake-anthropic.ts`) streams scripted answers in the wire format the SDK parses, so the chat loop, the tools, and the routes are tested without a key or any call to Anthropic.
- **Manual**: the scanner end-to-end with the iPhone, and brainstorm with a real key.

```

In `README.md`, replace:

```markdown
Any card's details also offer **Add to deck**.

## Scanning

```

with:

```markdown
Any card's details also offer **Add to deck**.

## Brainstorm

Open **Brainstorm** to ask Claude what to build next, or how to improve a deck. Claude searches your library and
Scryfall, reads your decks, and can save an idea as a prospective deck (**Open in deckbuilder**). In a deck, **Brainstorm
with Claude** starts a conversation about that deck. Card names in answers open the card, and Claude's notes show what
it's checking as it works.

Brainstorming needs your Anthropic API key (Settings → Anthropic API key) and uses Claude Opus 5.5. Each conversation
shows an estimate of what it has cost so far. **Stop** ends an answer early and keeps what it said; when an answer fails
partway, **Continue** asks again.

## Scanning

```

In `docs/plans/m5-followups.md`, replace:

```markdown

Before relying on them:
- **Model.** Confirm the model (`AI_MODEL = 'claude-opus-5'`) and its settings for brainstorming.
- (Done before M6.) **Key UX:**
  - Remove deletes the key with one click and no confirmation, and Anthropic shows a key only once.
```

with:

```markdown

Before relying on them:
- (Done in M6: the owner chose `claude-opus-5-5`; adaptive thinking at effort `medium`; see the M6 plan's Decisions.)
  **Model.** Confirm the model (`AI_MODEL = 'claude-opus-5'`) and its settings for brainstorming.
- (Done before M6.) **Key UX:**
  - Remove deletes the key with one click and no confirmation, and Anthropic shows a key only once.
```

In `docs/plans/m5-followups.md`, replace:

```markdown
    `gcTime: 0`.
- **`describeAiError`:**
  - It prints raw JSON with the status twice.
  - It calls a timeout a connection problem.
  - `POST /api/settings/ai/test` validates the body before its 404.
- **Key-store edge cases:**
```

with:

```markdown
    `gcTime: 0`.
- **`describeAiError`:**
  - (Done in M6.) It prints raw JSON with the status twice.
  - (Done in M6.) It calls a timeout a connection problem.
  - `POST /api/settings/ai/test` validates the body before its 404.
- **Key-store edge cases:**
```

In `docs/plans/m5-followups.md`, replace:

```markdown
  dirs per run, and the db tests leak `binder-db-*`. About 5,000 have piled up in `$TMPDIR`. Clean them up with
  `onTestFinished`, as the M5 tests do.
```

with:

```markdown
  dirs per run, and the db tests leak `binder-db-*`. About 5,000 have piled up in `$TMPDIR`. Clean them up with
  `onTestFinished`, as the M5 tests do.
- From the pre-M6 cleanup's review:
  - The "no stack" test for a failed library open (`tests/server/backup.test.ts`) checks one `console.error` call
    whose first argument has no newline, so printing the stack as a second argument would still pass. Assert the
    whole call list.
  - `bareKey`'s final `trim()` (`src/server/settings-routes.ts`) is untested (`" sk-… "`, `ANTHROPIC_API_KEY= sk-…`),
    and so is the key's 300-character limit.
```

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: typecheck clean; 730 tests pass; the build succeeds.

---
