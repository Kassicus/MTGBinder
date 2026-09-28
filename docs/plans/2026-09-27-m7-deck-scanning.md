# Binder M7 (Deck scanning and polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan a physical deck so every card goes into the collection and the deck at once, add Settings → Backups,
and make the fixes the owner's first use of Brainstorm asked for.

**Architecture:**
- **Scans that go to a deck (server).** `scan_items` gains `deck_id`, `board` and `auto_committed` (migration 005).
  - A capture records where it goes.
  - Committing adds to the collection and, in the same transaction, to the deck. Scanned copies first fill the copies
    the deck already lists on that board, counted from the scans already committed to it; only extras are added.
  - The "same card as the scan before it" mark moves to the server, which can see added scans and bare-mat captures.
- **The Scan page (web).** A "Scanning into" bar (the collection only, a deck and board, or **New deck…**), where each
  scan goes on its row with **Change**, Add and toast wording that count decks, and announcements of what auto-commit
  adds. The deck editor opens the Scan page for a deck.
- **Backups.** `backupNow` and `backupStatus` in `backup.ts`, `/api/settings/backups`, and a Settings section.
- **Brainstorm fixes.**
  - A `working` event while Claude writes a tool call.
  - Scrolling that follows only downward but brings an opened conversation into view.
  - Costs at each model's prices.
  - A notice for a conversation too long for Claude.
  - Stop in the first instant.
  - A stopped answer keeps its fallback marker.
  - Reuse of an empty conversation.

**Tech Stack:** Same as M1–M6: Node 24 running TypeScript directly, Hono 4, better-sqlite3 13, zod 4, React 19, React
Router 8, TanStack Query 5, Tailwind 4, Vite 8, Vitest 5, `@anthropic-ai/sdk` 0.128.0. No new dependencies.

**Spec:** `docs/specs/2026-09-26-binder-design.md`. This plan is milestone 7 of §8 as the owner rescoped it
(2026-09-27): "Deck scanning and polish". It covers:
- scanning into a deck (§5.1.3, amended by Task 5);
- §5.6's Backups;
- the M6 follow-ups the first real use asked for, and the scanner follow-ups deck scanning makes more likely
  (`docs/plans/m5-followups.md`, `m6-followups.md`).

Everything else from the follow-up files becomes M8.

**How this plan was made:** Every code block was prototyped in a scratch copy of the project. Replaying this plan
task by task onto the current project reproduces that prototype exactly, and every checkpoint passes (794
tests at the end, typecheck clean, build clean).

The prototype ran Task 5's end-to-end check on a copy of the real library: headless Chrome, Chrome's fake camera, the
real OCR helper, and a scripted fake Claude. It found and fixed one bug on the way: a row's board change sent the deck
name along, and the server refused it.

| Check | Result |
|---|---|
| Upgrading the copy (at 004) | "Backing up the database before upgrading it…", then `binder-…-before-005.db` holding 1,2,3,4; the library at 1,2,3,4,5 |
| Auto mode, into Goblins (listing one Rabblemaster) | Rabblemaster, Rabblemaster, Ash confident; the 4th Edition Bolt "Check the printing"; none marked as a double capture |
| Add, with Ash moved to the sideboard and the Bolt's 4ED printing picked | "Added 4 cards to your collection, with 4 for Goblins."; Rabblemaster 2 (the listed one filled, one beyond), Ash side 1, Bolt main 1 (4ED) |
| New built deck, then a capture with auto-commit on | "Added Shiko, Paragon of the Way to your collection, for Scanned Elves." |
| Back up now | "Saved binder-YYYY-MM-DD.db." (about 0.2 s for the full library) |
| Brainstorm, saving a deck | "Thinking…" under "Saving it now." while the call is written |
| 45 more conversations | opening the oldest from the bottom of the list shows it; scrolling down while an answer streams stays down |
| Leaving mid-answer | the answer stops ("Stopped.") |
| Console | no errors or warnings |

**Decisions made while prototyping (flagged for review):**
1. **"Fill the list first" counts from the scans the deck already got,** not from a new deck column. A deck that lists
   4 and has had 4 scanned into it takes a 5th as an extra copy. Editing the deck after scanning isn't tracked:
   - lowering a line below what was scanned means later scans of it are all extras;
   - moving a line to another board means it fills again on the new board.
2. **A capture for a deck deleted meanwhile is kept, for the collection only,** rather than refused. Refusing would
   lose the capture ("nothing a person captures is lost silently"); the row shows it has no deck.
3. **The same-card mark moves to the server and looks further back.** It checks the scan before it, whether in the
   queue or already added, taken within a minute.
   - Scans the owner discarded are skipped.
   - A bare-mat capture between them (the card was lifted) means another copy, so scanning a deck's four copies of a
     card isn't flagged.
   - A copy placed faster than auto mode can capture the mat (0.6 s) is still flagged.
4. **Auto-commit's announcements** come from the queue response. It lists what auto-commit added in the last minute,
   marked by a new `auto_committed` column. The page toasts what it hasn't seen, once per poll.
5. **Decks made on the Scan page are built** (their cards are in hand). A deck chosen from the list keeps its status.
   The Commander board is offered only for commander decks.
6. **Back up now** writes today's backup, or `binder-YYYY-MM-DD-N.db` numbered after the last copy kept that day. These
   count toward the 7 kept. The numbering fix applies to pre-upgrade copies too (see Task 2).
7. **The cost estimate uses each model's prices** from the Opus 5.5 guidance. An attempt before the last with no output
   is taken to be declined before it wrote anything, so it isn't billed. That comes from the SDK's types and the
   guidance, not yet seen live. The estimate is a lower bound again: stopped, garbled and failed requests are
   undercounted.
8. **"Thinking…" while Claude writes a tool call** comes from a new `working` event, emitted when a `tool_use` block
   starts, which lasts until the next item. Every tool call gets it, not only a deck's.
9. **Too long for Claude:** an answer cut off by the context window gets its own notice. A 400 "prompt is too long"
   says the same and offers no Continue.
10. **Starting a conversation reuses the newest one of the same deck (or of none) that nothing has been said in,** and
    moves it to the top of the list. This also makes a double click on "Brainstorm with Claude" harmless.

## Global Constraints

Everything from M1–M6 still applies:
- **Server and imports.**
  - The server listens on `127.0.0.1:4321`, and `/api/*` sits behind the local-only guard.
  - Node `>=24`.
  - Every relative import has an explicit `.ts`/`.tsx` extension.
  - Erasable TypeScript only.
  - Exact pinned dependency versions. **M7 adds none.**
- **API and SQL.**
  - API errors are JSON `{ "error": { "code", "message" } }`.
  - Every change goes through a POST, PUT, PATCH, or DELETE whose body is validated by zod. A body that isn't JSON is
    a 400 `bad_request`; a capture is a JPEG body of at most 15 MB.
  - Every user-supplied value in SQL is a bound parameter.
- **UI:** dark `stone` palette with an `amber` accent, Tailwind utilities only.
- **Not a git repository:** every task ends with a checkpoint (`pnpm typecheck && pnpm test`, plus `pnpm build` for web
  tasks), never a commit.
- **Never write to `data/`.** End-to-end checks use a copy in `/tmp`.
- **Scanning never calls Anthropic** (the owner's ruling). The API key is for Claude's deckbuilding help.
- **The API key never leaves the server.**
- **No real Anthropic calls in tests or checks.**

New in M7:
- **A scan goes where it was captured for.** The deck and board are recorded on the scan. Nothing but the owner's
  **Change** moves a scan to another deck, and a deleted deck leaves its scans for the collection only.
- **One transaction per commit** for the collection and the decks: either all of a commit's scans land, or none do.
- **Nothing a person captures is lost silently** (from M5), for captures made for a deck too.

## Review Focus

1. **A 60-card deck scanned in auto mode, with 4-ofs.**
   - Each copy counts, and none is flagged as a double capture when the card was lifted between copies.
   - Filling works across several commits and within one.
   - *Tests: Task 1 "adds a scan to its deck… filling the copies the deck lists before adding more", "fills each board
     on its own…", "doesn't mark a card after a bare-mat capture…"; Task 5's two Rabblemasters.*
2. **The wrong deck chosen, or a deck deleted mid-session.**
   - Scans keep their own deck, and one can be changed on its row.
   - A deleted deck's scans go to the collection only, and a capture for it is kept.
   - *Tests: Task 1 "changes where a scan goes, even while it is being identified…", "leaves the scans of a deleted
     deck…", "captures for a deck and board…" (deck 999); Task 5 moving Ash to the sideboard.*
3. **A deck planned first (by Claude or by hand), then built and scanned.**
   - Nothing is doubled.
   - A new line shows the printing scanned, and an existing line keeps its printing.
   - *Tests: Task 1's fill tests; Task 5's Goblins deck.*
4. **Back up now pressed several times in a day, and pruning.** No backup is replaced, and the newest is never the one
   pruned. *Tests: Task 2 "keeps the newest 7 backups counting its copies…", "numbers a new copy after the last one
   kept…".*
5. **Claude saving a big deck.**
   - "Thinking…" shows from the moment the call starts until its line appears, so the owner doesn't press Stop on a
     working answer.
   - Stop pressed early still stops.
   - *Tests: Task 4 "shows Claude is at work while it writes a tool call…", the server's `working` event; Task 5's
     screenshot 6.*

---

## File map

```
src/server/db/migrations/005_deck_scans.sql   scan_items.deck_id, board, auto_committed
src/shared/types.ts                 ScanBoard, ScanTarget, ScanItem.target/sameCardAsBefore, AutoAddedScan, ScanQueue,
                                    ScanCommitResult, BackupStatus, ChatEvent 'working'
src/server/
  scanner/repo.ts, routes.ts, worker.ts    targets, fill-first commit, same-card mark, auto-added list
  backup.ts, settings-routes.ts, app.ts, main.ts   Back up now, /api/settings/backups
  ai/chat.ts, client.ts, history.ts, threads.ts, routes.ts   working event, costs per model, too long, reuse
src/web/
  lib/scan.ts, lib/scan-queue.ts    capture targets, remembered target, Add label, toasts
  components/scan/ScanTarget.tsx    Scanning into, target picker, new deck
  components/scan/ScanQueue.tsx, ScanRow.tsx, pages/ScanPage.tsx, components/decks/DeckHeader.tsx
  lib/settings.ts, pages/SettingsPage.tsx   Backups
  lib/brainstorm.ts, components/brainstorm/ChatView.tsx   writing, Stop, scrolling
tests/
  server/scan-api, backup, settings-api, brainstorm, ai-api; web/scan-queue, brainstorm
docs/specs/2026-09-26-binder-design.md, README.md, docs/plans/m1…m6-followups.md
```

---

### Task 1: Scans that go to a deck (server)

A scan can go to a deck's board as well as the collection (spec §5.1.3 as amended in Task 5). The target is recorded on
the scan when it's captured, so changing the Scan page's choice later doesn't move scans already taken. Committing
adds to both in one transaction, filling the copies the deck already lists before adding more. The "same card as the
scan before it" mark moves to the server, where it can see scans already added and bare-mat captures.

**Files:**
- Create: `src/server/db/migrations/005_deck_scans.sql`
- Modify: `src/shared/types.ts` (scan targets, the queue's `added` list, the commit result)
- Modify: `src/server/scanner/repo.ts`, `src/server/scanner/routes.ts`, `src/server/scanner/worker.ts`
- Test: `tests/server/scan-api.test.ts`; `tests/web/scan-queue.test.ts` (its fixture gains the two new fields)

**Interfaces:**
- Consumes: `addToDeck(db, deckId, cardId, board, delta, now)` (`src/server/decks/repo.ts`, M4), which adds copies to a
  deck line and gives a new line the printing it came from; `adjustCopies` (collection); the scan queue from M5.
- Produces:
  - `ScanBoard = Exclude<Board, 'maybe'>`, `ScanTarget { deckId: number; board: ScanBoard }`.
  - `ScanItem.target: (ScanTarget & { deckName: string }) | null` and `ScanItem.sameCardAsBefore: boolean` (computed
    on the server now).
  - `AutoAddedScan { id, name, copies, deckName: string | null }`, `ScanQueue { items: ScanItem[]; added:
    AutoAddedScan[] }` (the body of `GET /api/scan/items`).
  - `ScanCommitResult { items, copies, decks: Array<{ id, name, copies }> }` (the body of `POST /api/scan/commit`).
  - `addScan(db, scansDir, jpeg, options: CaptureOptions = {}, now)` with `CaptureOptions { auto?; target? }`.
  - `updateScan` takes `target?: ScanTarget | null` and can answer `'no_deck'`.
  - `commitScans(db, scansDir, ids?, now, { auto })`, `listAutoAdded(db, now)`, `AUTO_ADDED_MS` (60 000).
  - Routes: `POST /api/scan?auto=1&deck=<id>&board=<main|side|commander>`; `PATCH /api/scan/items/:id` accepts
    `{ target: { deckId, board } | null }` (400 `no_deck` for a deck that doesn't exist).

- [ ] **Step 1: Write the failing tests**

The commit tests gain the `decks` field of the result; new tests cover scanning into a deck and the same-card
mark. The web test's scan fixture gains the two new fields, so it still type-checks.

In `tests/server/scan-api.test.ts`, replace:

```ts
import type { CardLookups } from '../../src/server/scanner/matcher.ts'
import type { OcrLine, OcrResult } from '../../src/server/scanner/ocr-client.ts'
import { MAX_SCAN_BYTES } from '../../src/server/scanner/routes.ts'
import { createScanWorker, type ScanWorker } from '../../src/server/scanner/worker.ts'
import { updateSettings } from '../../src/server/settings.ts'
import type { ApiErrorBody, ScanItem } from '../../src/shared/types.ts'
import { body, makeApp } from '../helpers/app.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'

const line = (text: string, y: number, x = 0.08): OcrLine => ({ text, confidence: 1, box: { x, y, w: 0.5, h: 0.02 } })
```

with:

```ts
import type { CardLookups } from '../../src/server/scanner/matcher.ts'
import type { OcrLine, OcrResult } from '../../src/server/scanner/ocr-client.ts'
import { AUTO_ADDED_MS, listAutoAdded } from '../../src/server/scanner/repo.ts'
import { MAX_SCAN_BYTES } from '../../src/server/scanner/routes.ts'
import { createScanWorker, type ScanWorker } from '../../src/server/scanner/worker.ts'
import { updateSettings } from '../../src/server/settings.ts'
import type { ApiErrorBody, ScanCommitResult, ScanItem, ScanQueue } from '../../src/shared/types.ts'
import { body, makeApp } from '../helpers/app.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'
import { deck, inDeck } from '../helpers/library.ts'

const line = (text: string, y: number, x = 0.08): OcrLine => ({ text, confidence: 1, box: { x, y, w: 0.5, h: 0.02 } })
```

In `tests/server/scan-api.test.ts`, replace:

```ts
})

const capture = (name: string, auto = false) =>
  app.request(`/api/scan${auto ? '?auto=1' : ''}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: photo(name) })
const send = (method: string, url: string, json?: unknown) =>
  app.request(url, json === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
const items = async () => (await body<{ items: ScanItem[] }>(await app.request('/api/scan/items'))).items
/** Captures a photo and waits until it's identified. */
async function scan(name: string, auto = false): Promise<ScanItem> {
  const res = await capture(name, auto)
  expect(res.status).toBe(201)
  const { id } = await body<ScanItem>(res)
```

with:

```ts
})

const capture = (name: string, auto = false, query = '') =>
  app.request(`/api/scan?${auto ? 'auto=1&' : ''}${query}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: photo(name) })
const send = (method: string, url: string, json?: unknown) =>
  app.request(url, json === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
const items = async () => (await body<{ items: ScanItem[] }>(await app.request('/api/scan/items'))).items
/** Captures a photo and waits until it's identified; `query` adds to the capture's query (`deck=3&board=side`). */
async function scan(name: string, auto = false, query = ''): Promise<ScanItem> {
  const res = await capture(name, auto, query)
  expect(res.status).toBe(201)
  const { id } = await body<ScanItem>(res)
```

In `tests/server/scan-api.test.ts`, replace:

```ts
    await scan('bolt-sta')
    await scan('mystery')
    expect(await body(await send('POST', '/api/scan/commit'))).toEqual({ items: 3, copies: 5 })
    expect(owned()).toEqual(
      [
```

with:

```ts
    await scan('bolt-sta')
    await scan('mystery')
    expect(await body(await send('POST', '/api/scan/commit'))).toEqual({ items: 3, copies: 5, decks: [] })
    expect(owned()).toEqual(
      [
```

In `tests/server/scan-api.test.ts`, replace:

```ts
    expect((await items()).map((i) => i.reason)).toEqual(['unsure'])
    expect(fs.existsSync(path.join(scansDir, `${a.id}.jpg`))).toBe(false)
    expect(await body(await send('POST', '/api/scan/commit'))).toEqual({ items: 0, copies: 0 })
  })

```

with:

```ts
    expect((await items()).map((i) => i.reason)).toEqual(['unsure'])
    expect(fs.existsSync(path.join(scansDir, `${a.id}.jpg`))).toBe(false)
    expect(await body(await send('POST', '/api/scan/commit'))).toEqual({ items: 0, copies: 0, decks: [] })
  })

```

In `tests/server/scan-api.test.ts`, replace:

```ts
    const later = await scan('bolt')
    await send('PATCH', `/api/scan/items/${later.id}`, { confirm: true })
    expect(await body(await send('POST', '/api/scan/commit', { ids: [counted.id] }))).toEqual({ items: 1, copies: 1 })
    expect(owned()).toEqual([{ card_id: fixtureCard('Lightning Bolt', 'm11').id, finish: 'nonfoil', quantity: 1 }])
    expect((await items()).map((i) => [i.id, i.status])).toEqual([[later.id, 'confident']])
```

with:

```ts
    const later = await scan('bolt')
    await send('PATCH', `/api/scan/items/${later.id}`, { confirm: true })
    expect(await body(await send('POST', '/api/scan/commit', { ids: [counted.id] }))).toEqual({ items: 1, copies: 1, decks: [] })
    expect(owned()).toEqual([{ card_id: fixtureCard('Lightning Bolt', 'm11').id, finish: 'nonfoil', quantity: 1 }])
    expect((await items()).map((i) => [i.id, i.status])).toEqual([[later.id, 'confident']])
```

In `tests/server/scan-api.test.ts`, replace:

```ts
    expect((await items()).map((i) => [i.id, i.status])).toEqual([[later.id, 'confident']])
  })
})
```

with:

```ts
    expect((await items()).map((i) => [i.id, i.status])).toEqual([[later.id, 'confident']])
  })
})

describe('scanning into a deck', () => {
  /** The deck's lines as [name, board, quantity, the printing it shows when not the default]. */
  const lines = (deckId: number) =>
    db
      .prepare(
        `SELECT c.name, dc.board, dc.quantity, dc.preferred_card_id AS preferred FROM deck_cards dc
         JOIN card_names c ON c.oracle_id = dc.oracle_id WHERE dc.deck_id = ? ORDER BY c.name, dc.board`,
      )
      .all(deckId)
  const commit = async () => body<ScanCommitResult>(await send('POST', '/api/scan/commit'))

  it('captures for a deck and board, and lists where each scan goes', async () => {
    const elves = deck(db, 'Elf Ball', 'built')
    expect((await scan('bolt-m11', false, `deck=${elves}&board=side`)).target).toEqual({ deckId: elves, board: 'side', deckName: 'Elf Ball' })
    expect((await scan('bolt-m11', false, `deck=${elves}`)).target).toEqual({ deckId: elves, board: 'main', deckName: 'Elf Ball' })
    expect((await scan('bolt-m11')).target).toBeNull()
    // A deck deleted in another window: the capture is kept, for the collection only.
    expect((await scan('bolt-m11', false, 'deck=999')).target).toBeNull()
    expect(await code(await capture('bolt-m11', false, `deck=${elves}&board=maybe`))).toEqual([400, 'bad_request'])
    expect(await code(await capture('bolt-m11', false, 'deck=abc'))).toEqual([400, 'bad_request'])
    expect((await items()).length).toBe(4)
  })

  it("adds a scan to its deck as well as the collection, filling the copies the deck lists before adding more", async () => {
    const elves = deck(db, 'Elf Ball', 'built', 'modern')
    inDeck(db, elves, 'Lightning Bolt', 4)
    const m11 = fixtureCard('Lightning Bolt', 'm11').id
    const two = await scan('bolt-m11', false, `deck=${elves}`)
    await send('PATCH', `/api/scan/items/${two.id}`, { quantity: 2 })
    expect(await commit()).toEqual({ items: 1, copies: 2, decks: [{ id: elves, name: 'Elf Ball', copies: 2 }] })
    expect(owned()).toEqual([{ card_id: m11, finish: 'nonfoil', quantity: 2 }])
    expect(lines(elves)).toEqual([{ name: 'Lightning Bolt', board: 'main', quantity: 4, preferred: null }])
    // Two more fill the list; a fifth goes beyond it.
    await scan('bolt-m11', false, `deck=${elves}`)
    await scan('bolt-m11', false, `deck=${elves}`)
    await commit()
    expect(lines(elves)).toEqual([{ name: 'Lightning Bolt', board: 'main', quantity: 4, preferred: null }])
    await scan('bolt-m11', false, `deck=${elves}`)
    expect(await commit()).toEqual({ items: 1, copies: 1, decks: [{ id: elves, name: 'Elf Ball', copies: 1 }] })
    expect(lines(elves)).toEqual([{ name: 'Lightning Bolt', board: 'main', quantity: 5, preferred: null }])
    expect(owned()).toEqual([{ card_id: m11, finish: 'nonfoil', quantity: 5 }])
  })

  it('fills each board on its own, and gives a new line the printing scanned', async () => {
    const elves = deck(db, 'Elf Ball', 'built', 'modern')
    inDeck(db, elves, 'Lightning Bolt', 1, 'side')
    await scan('bolt-sta', false, `deck=${elves}`)
    await scan('bolt-sta', false, `deck=${elves}&board=side`)
    await scan('bolt-sta', false, `deck=${elves}&board=side`)
    // The first two of one commit fill in id order: one fills the sideboard's copy, the next goes beyond it.
    expect(await commit()).toEqual({ items: 3, copies: 3, decks: [{ id: elves, name: 'Elf Ball', copies: 3 }] })
    expect(lines(elves)).toEqual([
      { name: 'Lightning Bolt', board: 'main', quantity: 1, preferred: fixtureCard('Lightning Bolt', 'sta').id },
      { name: 'Lightning Bolt', board: 'side', quantity: 2, preferred: null },
    ])
  })

  it('counts the copies for each deck of one commit', async () => {
    const elves = deck(db, 'Elf Ball', 'built')
    const burn = deck(db, 'Burn', 'prospective', 'modern')
    await scan('bolt-m11', false, `deck=${elves}`)
    await scan('bolt-sta', false, `deck=${burn}`)
    await scan('bolt-sta', false, `deck=${burn}`)
    await scan('bolt-m11')
    expect(await commit()).toEqual({
      items: 4,
      copies: 4,
      decks: [
        { id: elves, name: 'Elf Ball', copies: 1 },
        { id: burn, name: 'Burn', copies: 2 },
      ],
    })
    expect(lines(burn)).toEqual([{ name: 'Lightning Bolt', board: 'main', quantity: 2, preferred: fixtureCard('Lightning Bolt', 'sta').id }])
  })

  it('changes where a scan goes, even while it is being identified, and refuses a deck that no longer exists', async () => {
    const elves = deck(db, 'Elf Ball', 'built')
    const ready = await scan('bolt-m11')
    const moved = await body<ScanItem>(await send('PATCH', `/api/scan/items/${ready.id}`, { target: { deckId: elves, board: 'commander' } }))
    expect(moved.target).toEqual({ deckId: elves, board: 'commander', deckName: 'Elf Ball' })
    expect((await body<ScanItem>(await send('PATCH', `/api/scan/items/${ready.id}`, { target: null }))).target).toBeNull()
    expect(await code(await send('PATCH', `/api/scan/items/${ready.id}`, { target: { deckId: 999, board: 'main' } }))).toEqual([400, 'no_deck'])
    expect(await code(await send('PATCH', `/api/scan/items/${ready.id}`, { target: { deckId: elves, board: 'maybe' } }))).toEqual([400, 'bad_request'])
    expect(await code(await send('PATCH', `/api/scan/items/${ready.id}`, { target: { deckId: elves } }))).toEqual([400, 'bad_request'])
    let release!: () => void
    gate = new Promise((resolve) => (release = resolve))
    const { id } = await body<ScanItem>(await capture('bolt-m11'))
    expect((await body<ScanItem>(await send('PATCH', `/api/scan/items/${id}`, { target: { deckId: elves, board: 'main' } }))).target?.deckId).toBe(elves)
    // Only where it goes: the rest waits until it's identified.
    expect(await code(await send('PATCH', `/api/scan/items/${id}`, { target: null, quantity: 2 }))).toEqual([409, 'busy'])
    release()
    await worker.idle()
    expect((await items()).find((i) => i.id === id)?.target?.deckId).toBe(elves)
  })

  it('leaves the scans of a deleted deck to the collection only', async () => {
    const elves = deck(db, 'Elf Ball', 'built')
    await scan('bolt-m11', false, `deck=${elves}`)
    db.prepare('DELETE FROM decks WHERE id = ?').run(elves)
    expect((await items())[0]!.target).toBeNull()
    expect(await commit()).toEqual({ items: 1, copies: 1, decks: [] })
    expect(owned()).toEqual([{ card_id: fixtureCard('Lightning Bolt', 'm11').id, finish: 'nonfoil', quantity: 1 }])
  })

  it('adds to the deck when auto-commit adds a scan, and lists what it added for a minute', async () => {
    updateSettings(db, { scanAutoCommit: true })
    const elves = deck(db, 'Elf Ball', 'built')
    // Added as soon as they're identified, so they're gone from the queue by then.
    const added = await body<ScanItem>(await capture('bolt-m11', false, `deck=${elves}`))
    await capture('bolt-sta')
    await worker.idle()
    const queue = await body<ScanQueue>(await app.request('/api/scan/items'))
    expect(queue.items).toEqual([])
    expect(queue.added).toEqual([
      { id: added.id, name: 'Lightning Bolt', copies: 1, deckName: 'Elf Ball' },
      { id: added.id + 1, name: 'Lightning Bolt', copies: 1, deckName: null },
    ])
    expect(lines(elves)).toEqual([{ name: 'Lightning Bolt', board: 'main', quantity: 1, preferred: null }])
    expect(listAutoAdded(db, new Date(Date.now() + AUTO_ADDED_MS + 1000))).toEqual([])
    // Scans the owner added aren't listed: the page that added them has said so.
    updateSettings(db, { scanAutoCommit: false })
    await scan('bolt-m11')
    await commit()
    expect((await body<ScanQueue>(await app.request('/api/scan/items'))).added.map((a) => a.id)).toEqual([added.id, added.id + 1])
  })
})

describe('the same card caught twice', () => {
  /** Whether each scan in the queue is marked, by id. */
  const marks = async () => Object.fromEntries((await items()).map((i) => [i.id, i.sameCardAsBefore]))

  it('marks an auto capture of the same printing as the auto capture before it, even one already added', async () => {
    const a = await scan('bolt-m11', true)
    const b = await scan('bolt-m11', true)
    expect(await marks()).toEqual({ [a.id]: false, [b.id]: true })
    await send('POST', '/api/scan/commit', { ids: [a.id] })
    expect(await marks()).toEqual({ [b.id]: true })
  })

  it("doesn't mark a card after a bare-mat capture: the card was lifted, so this is another copy", async () => {
    await scan('bolt-m11', true)
    await capture('blank', true)
    await worker.idle()
    const next = await scan('bolt-m11', true)
    expect((await marks())[next.id]).toBe(false)
  })

  it('skips scans the owner discarded, and marks nothing across a manual capture, another printing, or a minute', async () => {
    const a = await scan('bolt-m11', true)
    const b = await scan('bolt-m11', true)
    await send('DELETE', `/api/scan/items/${b.id}`)
    const c = await scan('bolt-m11', true)
    expect((await marks())[c.id]).toBe(true)
    const manual = await scan('bolt-m11')
    const d = await scan('bolt-m11', true)
    const sta = await scan('bolt-sta', true)
    expect(await marks()).toEqual({ [a.id]: false, [c.id]: true, [manual.id]: false, [d.id]: false, [sta.id]: false })
    const later = await scan('bolt-sta', true)
    db.prepare('UPDATE scan_items SET created_at = ? WHERE id = ?').run(new Date(Date.now() + 61_000).toISOString(), later.id)
    expect((await marks())[later.id]).toBe(false)
  })

  it('marks nothing when a scan before it has no card yet', async () => {
    const unknown = await scan('mystery', true)
    const next = await scan('bolt-m11', true)
    expect(await marks()).toEqual({ [unknown.id]: false, [next.id]: false })
  })
})
```

In `tests/web/scan-queue.test.ts`, replace:

```ts
    error: null,
    createdAt: '2026-09-27T12:00:00.000Z',
  }
}
```

with:

```ts
    error: null,
    createdAt: '2026-09-27T12:00:00.000Z',
    target: null,
    sameCardAsBefore: false,
  }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/server/scan-api.test.ts`
Expected: FAIL: `listAutoAdded` and `AUTO_ADDED_MS` are not exported yet.

- [ ] **Step 3: Add the migration and the types**

Create `src/server/db/migrations/005_deck_scans.sql`:

```sql
-- Scanning into a deck (spec §4.1, §5.1.3): a scan can go to a deck's board as well as the collection. A deleted deck
-- leaves its scans for the collection only.
ALTER TABLE scan_items ADD COLUMN deck_id INTEGER REFERENCES decks (id) ON DELETE SET NULL;
ALTER TABLE scan_items ADD COLUMN board TEXT CHECK (board IN ('commander', 'main', 'side'));
-- 1 for a scan the worker added to the collection by itself (auto-commit), so the Scan page can say so.
ALTER TABLE scan_items ADD COLUMN auto_committed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX scan_items_deck ON scan_items (deck_id, board) WHERE deck_id IS NOT NULL;
```

In `src/shared/types.ts`, replace:

```ts
}

/** One captured card in the scan queue (spec §5.1.2). */
export interface ScanItem {
```

with:

```ts
}

/** The boards a scan can go to: a physical deck has no maybe board. */
export type ScanBoard = Exclude<Board, 'maybe'>

/** Where a scan goes besides the collection (spec §5.1.3): a deck's board. */
export interface ScanTarget {
  deckId: number
  board: ScanBoard
}

/** One captured card in the scan queue (spec §5.1.2). */
export interface ScanItem {
```

In `src/shared/types.ts`, replace:

```ts
  error: string | null
  createdAt: string
}

```

with:

```ts
  error: string | null
  createdAt: string
  /** The deck and board it goes to besides the collection, or null for the collection only. */
  target: (ScanTarget & { deckName: string }) | null
  /**
   * An auto-mode capture of the same printing as the auto-mode capture before it, with no bare-mat capture between:
   * auto mode may have caught one card twice (spec §5.1.3).
   */
  sameCardAsBefore: boolean
}

/** A scan the worker added by itself (auto-commit), for the Scan page to announce. */
export interface AutoAddedScan {
  id: number
  name: string
  copies: number
  deckName: string | null
}

/** The scan queue, and the scans auto-commit added in the last minute. */
export interface ScanQueue {
  items: ScanItem[]
  added: AutoAddedScan[]
}

/** What a commit added: scans, copies, and per deck the copies that went to it. */
export interface ScanCommitResult {
  items: number
  copies: number
  decks: Array<{ id: number; name: string; copies: number }>
}

```

- [ ] **Step 4: Record the target on a scan, and fill the deck when committing**

`addToTargetDeck` is the "fill the list first" rule: the copies of the card the deck lists on that board,
minus the copies earlier committed scans put there, are filled first; only what's beyond goes onto the line through
`addToDeck` (which gives a new line the printing scanned). `isSameCardAsBefore` replaces the web's
`likelyDoubleCaptures` (removed in Task 3).

In `src/server/scanner/repo.ts`, replace:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { Finish, ScanCandidate, ScanCard, ScanItem, ScanStatus } from '../../shared/types.ts'
import { adjustCopies } from '../collection/repo.ts'
import type { DB } from '../db/index.ts'

export interface ScanRow {
```

with:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type {
  AutoAddedScan,
  Finish,
  ScanBoard,
  ScanCandidate,
  ScanCard,
  ScanCommitResult,
  ScanItem,
  ScanStatus,
  ScanTarget,
} from '../../shared/types.ts'
import { adjustCopies } from '../collection/repo.ts'
import type { DB } from '../db/index.ts'
import { addToDeck } from '../decks/repo.ts'

export interface ScanRow {
```

In `src/server/scanner/repo.ts`, replace:

```ts
  created_at: string
  updated_at: string
}

```

with:

```ts
  created_at: string
  updated_at: string
  deck_id: number | null
  board: ScanBoard | null
  auto_committed: number
}

```

In `src/server/scanner/repo.ts`, replace:

```ts
/** Scans still in the queue (spec §5.1.3); committed and discarded ones are done with. */
const ACTIVE = "('queued', 'identifying', 'confident', 'review')"

function toItem(db: DB, row: ScanRow): ScanItem {
```

with:

```ts
/** Scans still in the queue (spec §5.1.3); committed and discarded ones are done with. */
const ACTIVE = "('queued', 'identifying', 'confident', 'review')"

/** How close together two auto-mode captures must be for the second to look like the first caught again. */
const DOUBLE_CAPTURE_MS = 60_000

/**
 * Whether an auto-mode capture looks like auto mode caught the card before it again (spec §5.1.3): the scan before it
 * is an auto-mode capture of the same printing, taken within a minute, whether it's still in the queue or already
 * added. Scans the owner discarded are skipped, but a bare-mat capture the worker dropped (never identified) means the
 * card was lifted in between, so the next copy of it is a new card.
 */
function isSameCardAsBefore(db: DB, row: ScanRow): boolean {
  if (row.auto !== 1 || !row.card_id) return false
  const before = db
    .prepare(
      `SELECT auto, card_id, status, created_at FROM scan_items
       WHERE id < ? AND NOT (status = 'discarded' AND method IS NOT NULL) ORDER BY id DESC LIMIT 1`,
    )
    .get(row.id) as Pick<ScanRow, 'auto' | 'card_id' | 'status' | 'created_at'> | undefined
  return (
    before !== undefined &&
    before.status !== 'discarded' &&
    before.auto === 1 &&
    before.card_id === row.card_id &&
    Date.parse(row.created_at) - Date.parse(before.created_at) <= DOUBLE_CAPTURE_MS
  )
}

function toItem(db: DB, row: ScanRow): ScanItem {
```

In `src/server/scanner/repo.ts`, replace:

```ts
    error: row.error,
    createdAt: row.created_at,
  }
}

const getRow = (db: DB, id: number) =>
```

with:

```ts
    error: row.error,
    createdAt: row.created_at,
    target: targetOf(db, row),
    sameCardAsBefore: isSameCardAsBefore(db, row),
  }
}

/** The deck and board a scan goes to, with the deck's name; null for the collection only. */
function targetOf(db: DB, row: ScanRow): ScanItem['target'] {
  if (row.deck_id === null) return null
  const name = db.prepare('SELECT name FROM decks WHERE id = ?').pluck().get(row.deck_id) as string | undefined
  return name === undefined ? null : { deckId: row.deck_id, board: row.board ?? 'main', deckName: name }
}

const deckExists = (db: DB, id: number) => db.prepare('SELECT 1 FROM decks WHERE id = ?').get(id) !== undefined

const getRow = (db: DB, id: number) =>
```

In `src/server/scanner/repo.ts`, replace:

```ts
  row.image_path ? path.join(scansDir, row.image_path) : null

/** Saves a captured JPEG as `<scansDir>/<id>.jpg` and queues it (spec §5.1.2). `auto`: taken by auto mode. */
export function addScan(db: DB, scansDir: string, jpeg: Uint8Array, auto = false, now = new Date()): ScanItem {
  fs.mkdirSync(scansDir, { recursive: true })
  const at = now.toISOString()
  const id = db.transaction(() => {
    const newId = Number(
      db
        .prepare("INSERT INTO scan_items (status, auto, created_at, updated_at) VALUES ('queued', ?, ?, ?)")
        .run(auto ? 1 : 0, at, at).lastInsertRowid,
    )
    const file = `${newId}.jpg`
```

with:

```ts
  row.image_path ? path.join(scansDir, row.image_path) : null

export interface CaptureOptions {
  /** Taken by auto mode. */
  auto?: boolean
  /** The deck and board it goes to besides the collection. A deck that no longer exists leaves it for the collection. */
  target?: ScanTarget | null
}

/** Saves a captured JPEG as `<scansDir>/<id>.jpg` and queues it (spec §5.1.2). */
export function addScan(db: DB, scansDir: string, jpeg: Uint8Array, options: CaptureOptions = {}, now = new Date()): ScanItem {
  fs.mkdirSync(scansDir, { recursive: true })
  const at = now.toISOString()
  const target = options.target && deckExists(db, options.target.deckId) ? options.target : null
  const id = db.transaction(() => {
    const newId = Number(
      db
        .prepare(
          "INSERT INTO scan_items (status, auto, deck_id, board, created_at, updated_at) VALUES ('queued', ?, ?, ?, ?, ?)",
        )
        .run(options.auto ? 1 : 0, target?.deckId ?? null, target?.board ?? null, at, at).lastInsertRowid,
    )
    const file = `${newId}.jpg`
```

In `src/server/scanner/repo.ts`, replace:

```ts
  /** Accepts a review scan as it is. */
  confirm?: true
}

export type ScanUpdate = ScanItem | 'no_scan' | 'busy' | 'no_card' | 'bad_finish'

/**
 * Edits a scan in the queue (spec §5.1.3). Choosing a card makes it confident and marks it as picked by hand; a
 * finish the printing doesn't come in is refused, and a new printing keeps the finish only if it comes in it. A scan
 * the owner settles (by choosing a card or confirming it) drops its old error, which no longer applies.
 */
export function updateScan(db: DB, id: number, patch: ScanPatch, now = new Date()): ScanUpdate {
```

with:

```ts
  /** Accepts a review scan as it is. */
  confirm?: true
  /** Another deck and board for it, or null for the collection only. */
  target?: ScanTarget | null
}

export type ScanUpdate = ScanItem | 'no_scan' | 'busy' | 'no_card' | 'bad_finish' | 'no_deck'

/**
 * Edits a scan in the queue (spec §5.1.3). Choosing a card makes it confident and marks it as picked by hand; a
 * finish the printing doesn't come in is refused, and a new printing keeps the finish only if it comes in it. A scan
 * the owner settles (by choosing a card or confirming it) drops its old error, which no longer applies. Where it goes
 * (its deck and board) can change while it's still being identified; nothing else can.
 */
export function updateScan(db: DB, id: number, patch: ScanPatch, now = new Date()): ScanUpdate {
```

In `src/server/scanner/repo.ts`, replace:

```ts
    const row = getRow(db, id)
    if (!row || row.status === 'committed' || row.status === 'discarded') return 'no_scan'
    if (row.status === 'queued' || row.status === 'identifying') return 'busy'
    const next = { ...row }
    if (patch.cardId !== undefined) {
      if (!db.prepare('SELECT 1 FROM cards WHERE id = ?').get(patch.cardId)) return 'no_card'
```

with:

```ts
    const row = getRow(db, id)
    if (!row || row.status === 'committed' || row.status === 'discarded') return 'no_scan'
    const { target, ...rest } = patch
    const busy = row.status === 'queued' || row.status === 'identifying'
    if (busy && Object.values(rest).some((value) => value !== undefined)) return 'busy'
    const next = { ...row }
    if (target !== undefined) {
      if (target !== null && !deckExists(db, target.deckId)) return 'no_deck'
      next.deck_id = target?.deckId ?? null
      next.board = target?.board ?? null
    }
    if (patch.cardId !== undefined) {
      if (!db.prepare('SELECT 1 FROM cards WHERE id = ?').get(patch.cardId)) return 'no_card'
```

In `src/server/scanner/repo.ts`, replace:

```ts
    db.prepare(
      `UPDATE scan_items SET card_id = @card_id, finish = @finish, method = @method, status = @status, reason = @reason,
         quantity = @quantity, error = @error, updated_at = @at WHERE id = @id`,
    ).run({ ...next, at: now.toISOString() })
    return toItem(db, getRow(db, id)!)
```

with:

```ts
    db.prepare(
      `UPDATE scan_items SET card_id = @card_id, finish = @finish, method = @method, status = @status, reason = @reason,
         quantity = @quantity, error = @error, deck_id = @deck_id, board = @board, updated_at = @at WHERE id = @id`,
    ).run({ ...next, at: now.toISOString() })
    return toItem(db, getRow(db, id)!)
```

In `src/server/scanner/repo.ts`, replace:

```ts

/**
 * Adds confident scans to the collection (spec §5.1.3), all of them or just those with the given ids: each adds its
 * quantity of its printing in its finish. They become committed and their images are deleted.
 */
export function commitScans(
```

with:

```ts

/**
 * Adds a committing scan's copies to its deck (spec §5.1.3). They first fill the copies the deck lists on that board
 * that earlier scans into it haven't: scanning a deck that was planned first doesn't list its cards twice. Only the
 * copies beyond those are added to the line; a new line shows the printing scanned.
 */
function addToTargetDeck(db: DB, row: ScanRow, now: Date): void {
  const deckId = row.deck_id!
  const board = row.board ?? 'main'
  const oracleId = db.prepare('SELECT oracle_id FROM cards WHERE id = ?').pluck().get(row.card_id) as string
  const listed =
    (db
      .prepare('SELECT quantity FROM deck_cards WHERE deck_id = ? AND oracle_id = ? AND board = ?')
      .pluck()
      .get(deckId, oracleId, board) as number | undefined) ?? 0
  const scanned = db
    .prepare(
      `SELECT COALESCE(SUM(s.quantity), 0) FROM scan_items s JOIN cards c ON c.id = s.card_id
       WHERE s.status = 'committed' AND s.deck_id = ? AND COALESCE(s.board, 'main') = ? AND c.oracle_id = ?`,
    )
    .pluck()
    .get(deckId, board, oracleId) as number
  const beyond = row.quantity - Math.min(row.quantity, Math.max(0, listed - scanned))
  if (beyond > 0) addToDeck(db, deckId, row.card_id!, board, beyond, now)
}

/**
 * Adds confident scans to the collection (spec §5.1.3), all of them or just those with the given ids: each adds its
 * quantity of its printing in its finish, and a scan with a deck adds to that deck too, in the same transaction. They
 * become committed and their images are deleted. `auto`: the worker is adding a scan by itself (auto-commit).
 */
export function commitScans(
```

In `src/server/scanner/repo.ts`, replace:

```ts
  ids?: readonly number[],
  now = new Date(),
): { items: number; copies: number } {
  const rows = db.transaction(() => {
    const all = db
```

with:

```ts
  ids?: readonly number[],
  now = new Date(),
  { auto = false }: { auto?: boolean } = {},
): ScanCommitResult {
  const rows = db.transaction(() => {
    const all = db
```

In `src/server/scanner/repo.ts`, replace:

```ts
      .all() as ScanRow[]
    const confident = all.filter((row) => !ids || ids.includes(row.id))
    const done = db.prepare("UPDATE scan_items SET status = 'committed', updated_at = ? WHERE id = ?")
    for (const row of confident) {
      adjustCopies(db, row.card_id!, row.finish, row.quantity, now)
      done.run(now.toISOString(), row.id)
    }
    return confident
  })()
  for (const row of rows) deleteImage(scansDir, row)
  return { items: rows.length, copies: rows.reduce((sum, row) => sum + row.quantity, 0) }
}
```

with:

```ts
      .all() as ScanRow[]
    const confident = all.filter((row) => !ids || ids.includes(row.id))
    const done = db.prepare("UPDATE scan_items SET status = 'committed', auto_committed = ?, updated_at = ? WHERE id = ?")
    for (const row of confident) {
      adjustCopies(db, row.card_id!, row.finish, row.quantity, now)
      if (row.deck_id !== null) addToTargetDeck(db, row, now)
      done.run(auto ? 1 : 0, now.toISOString(), row.id)
    }
    return confident
  })()
  for (const row of rows) deleteImage(scansDir, row)
  const decks = new Map<number, ScanCommitResult['decks'][number]>()
  for (const row of rows) {
    if (row.deck_id === null) continue
    const name = db.prepare('SELECT name FROM decks WHERE id = ?').pluck().get(row.deck_id) as string
    const deck = decks.get(row.deck_id) ?? { id: row.deck_id, name, copies: 0 }
    deck.copies += row.quantity
    decks.set(row.deck_id, deck)
  }
  return { items: rows.length, copies: rows.reduce((sum, row) => sum + row.quantity, 0), decks: [...decks.values()] }
}

/** How long a scan auto-commit added stays in the queue's `added` list, for the Scan page to announce. */
export const AUTO_ADDED_MS = 60_000

/** The scans auto-commit added in the last minute, oldest first. */
export function listAutoAdded(db: DB, now = new Date()): AutoAddedScan[] {
  const since = new Date(now.getTime() - AUTO_ADDED_MS).toISOString()
  return db
    .prepare(
      `SELECT s.id, c.name, s.quantity AS copies, d.name AS deckName FROM scan_items s
       JOIN cards c ON c.id = s.card_id LEFT JOIN decks d ON d.id = s.deck_id
       WHERE s.status = 'committed' AND s.auto_committed = 1 AND s.updated_at >= ? ORDER BY s.id`,
    )
    .all(since) as AutoAddedScan[]
}
```

In `src/server/scanner/routes.ts`, replace:

```ts
  discardScan,
  getScanItem,
  listScanItems,
  retryScan,
```

with:

```ts
  discardScan,
  getScanItem,
  listAutoAdded,
  listScanItems,
  retryScan,
```

In `src/server/scanner/routes.ts`, replace:

```ts

const Id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const Patch = z
  .object({
```

with:

```ts

const Id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const ScanBoard = z.enum(['commander', 'main', 'side'])
/** A capture's query: `auto=1` from auto mode, and the deck (and board, main by default) it goes to. */
const CaptureQuery = z.object({ auto: z.string().optional(), deck: Id.optional(), board: ScanBoard.optional() })
const Target = z.object({ deckId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), board: ScanBoard }).strict()
const Patch = z
  .object({
```

In `src/server/scanner/routes.ts`, replace:

```ts
    quantity: z.number().int().min(1).max(999).optional(),
    confirm: z.literal(true).optional(),
  })
  .strict()
```

with:

```ts
    quantity: z.number().int().min(1).max(999).optional(),
    confirm: z.literal(true).optional(),
    target: Target.nullable().optional(),
  })
  .strict()
```

In `src/server/scanner/routes.ts`, replace:

```ts
      const bytes = new Uint8Array(await c.req.arrayBuffer())
      if (!isJpeg(bytes)) throw new ApiError(400, 'bad_request', 'A capture must be a JPEG image')
      const item = addScan(db, scanner.scansDir, bytes, c.req.query('auto') === '1')
      scanner.worker.kick()
      return c.json(item, 201)
```

with:

```ts
      const bytes = new Uint8Array(await c.req.arrayBuffer())
      if (!isJpeg(bytes)) throw new ApiError(400, 'bad_request', 'A capture must be a JPEG image')
      const query = parseWith(CaptureQuery, c.req.query())
      const target = query.deck === undefined ? null : { deckId: query.deck, board: query.board ?? 'main' }
      const item = addScan(db, scanner.scansDir, bytes, { auto: query.auto === '1', target })
      scanner.worker.kick()
      return c.json(item, 201)
```

In `src/server/scanner/routes.ts`, replace:

```ts
  )

  routes.get('/items', (c) => c.json({ items: listScanItems(db) }))

  routes.get('/items/:id/image', (c) => {
```

with:

```ts
  )

  routes.get('/items', (c) => c.json({ items: listScanItems(db), added: listAutoAdded(db) }))

  routes.get('/items/:id/image', (c) => {
```

In `src/server/scanner/routes.ts`, replace:

```ts
    if (result === 'no_card') throw new ApiError(400, 'no_card', 'Choose a card first')
    if (result === 'bad_finish') throw new ApiError(400, 'bad_finish', "That printing doesn't come in that finish")
    return c.json(result)
  })
```

with:

```ts
    if (result === 'no_card') throw new ApiError(400, 'no_card', 'Choose a card first')
    if (result === 'bad_finish') throw new ApiError(400, 'bad_finish', "That printing doesn't come in that finish")
    if (result === 'no_deck') throw new ApiError(400, 'no_deck', 'That deck no longer exists')
    return c.json(result)
  })
```

In `src/server/scanner/worker.ts`, replace:

```ts
    if (saved && result.status === 'confident' && settings.scanAutoCommit && row.auto !== 1) {
      try {
        commitScans(db, deps.scansDir, [row.id], now())
      } catch (err) {
        // The scan stays ready in the queue, so it can still be added by hand.
```

with:

```ts
    if (saved && result.status === 'confident' && settings.scanAutoCommit && row.auto !== 1) {
      try {
        commitScans(db, deps.scansDir, [row.id], now(), { auto: true })
      } catch (err) {
        // The scan stays ready in the queue, so it can still be added by hand.
```

- [ ] **Step 5: Run the scan tests**

Run: `pnpm vitest run tests/server/scan-api.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass (786 tests).

---

### Task 2: Settings → Backups

Spec §5.6's Backups section, never built: the last backup, **Back up now**, and the folder. Prototyping it found a bug
in how another copy of a day is named, which also affects the copies made before a migration: the first free name
(`binder-…-before-005.db` once pruning has removed it) sorts as the oldest, so pruning removed the new copy at once. A
new copy is now numbered after the last one kept.

**Files:**
- Modify: `src/server/backup.ts` (`backupNow`, `backupStatus`, and copy numbering that pruning can't undo)
- Modify: `src/server/settings-routes.ts`, `src/server/app.ts`, `src/server/main.ts`, `src/shared/types.ts`
- Modify: `src/web/lib/settings.ts`, `src/web/pages/SettingsPage.tsx`
- Test: `tests/server/backup.test.ts`, `tests/server/settings-api.test.ts`

**Interfaces:**
- Consumes: `backupIfDue`, `backupBeforeUpgrade`, `copyDatabase`, `removeOldBackups` (M4, and the batch before M6).
- Produces:
  - `backupNow(db, dir, now): string` (the file's path) and `backupStatus(db, dir): BackupStatus`.
  - `BackupStatus { lastBackupAt: string | null; folder: string }`.
  - `AppDeps.backupDir?: string`; `GET /api/settings/backups` and `POST /api/settings/backups` (the status plus
    `file`, the new backup's name; 500 `backup_failed` with the reason).
  - `useBackups()`, `useBackUpNow()` in `src/web/lib/settings.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/server/backup.test.ts`, replace:

```ts
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { backupIfDue, KEEP_BACKUPS, KEEP_UPGRADE_BACKUPS } from '../../src/server/backup.ts'
import { openDb, openFailureLine, openLibrary, type DB } from '../../src/server/db/index.ts'
import { getMeta, setMeta } from '../../src/server/db/meta.ts'
```

with:

```ts
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { backupIfDue, backupNow, KEEP_BACKUPS, KEEP_UPGRADE_BACKUPS } from '../../src/server/backup.ts'
import { openDb, openFailureLine, openLibrary, type DB } from '../../src/server/db/index.ts'
import { getMeta, setMeta } from '../../src/server/db/meta.ts'
```

In `tests/server/backup.test.ts`, replace:

```ts
    expect(fs.readdirSync(dir())).toEqual(['binder-2026-09-25.db'])
    expect(getMeta(db, 'last_backup_at')).toBe(day(25).toISOString()) // so the next start tries again
  })
})
```

with:

```ts
    expect(fs.readdirSync(dir())).toEqual(['binder-2026-09-25.db'])
    expect(getMeta(db, 'last_backup_at')).toBe(day(25).toISOString()) // so the next start tries again
  })
})

describe('backupNow (Settings → Back up now)', () => {
  it("writes today's backup, or another copy of it, never replacing one, and records the time", () => {
    backupIfDue(db, dir(), day(26))
    db.prepare("INSERT INTO decks (name, format, status, created_at, updated_at) VALUES ('Tron', 'modern', 'built', 't', 't')").run()
    const later = new Date(2026, 8, 26, 15, 0, 0)
    expect(backupNow(db, dir(), later)).toBe(path.join(dir(), 'binder-2026-09-26-2.db'))
    expect(backupNow(db, dir(), later)).toBe(path.join(dir(), 'binder-2026-09-26-3.db'))
    const copy = new Database(path.join(dir(), 'binder-2026-09-26-2.db'), { readonly: true })
    expect(copy.prepare('SELECT name FROM decks ORDER BY name').pluck().all()).toEqual(['Burn', 'Tron'])
    copy.close()
    expect(getMeta(db, 'last_backup_at')).toBe(later.toISOString())
    // The daily backup waits a day from it.
    expect(backupIfDue(db, dir(), new Date(later.getTime() + 23 * 3600_000))).toBeNull()
    expect(backupNow(db, dir(), day(27))).toBe(path.join(dir(), 'binder-2026-09-27.db'))
  })

  it("keeps the newest 7 backups counting its copies, the newest by date and then copy, and leaves others' files", () => {
    fs.mkdirSync(dir(), { recursive: true })
    fs.writeFileSync(path.join(dir(), 'binder-2026-09-01-before-004.db'), 'an upgrade copy')
    for (let d = 1; d <= 5; d++) backupIfDue(db, dir(), day(d))
    for (let n = 1; n <= 11; n++) backupNow(db, dir(), day(6))
    expect(fs.readdirSync(dir()).sort()).toEqual([
      'binder-2026-09-01-before-004.db',
      'binder-2026-09-06-10.db',
      'binder-2026-09-06-11.db',
      'binder-2026-09-06-5.db',
      'binder-2026-09-06-6.db',
      'binder-2026-09-06-7.db',
      'binder-2026-09-06-8.db',
      'binder-2026-09-06-9.db',
    ])
    expect(fs.readdirSync(dir()).filter((f) => f.startsWith('binder-2026-09-06'))).toHaveLength(KEEP_BACKUPS)
  })
})
```

In `tests/server/backup.test.ts`, replace:

```ts
  })

  it('keeps the newest 3 copies, apart from the daily backups', () => {
    upgrade({ now: day(1) })
```

with:

```ts
  })

  it('numbers a new copy after the last one kept, even once the first of the day was pruned', () => {
    upgrade()
    addMigration('002_second.sql', 'CREATE TABLE second (y INTEGER);')
    fs.mkdirSync(dir())
    for (const suffix of ['-2', '-3', '-4']) fs.writeFileSync(path.join(dir(), `binder-2026-09-27-before-002${suffix}.db`), 'earlier')
    const saved: string[] = []
    upgrade({ onBackup: (file) => saved.push(file) })
    // Not the free first name, which pruning would take for the oldest and remove at once.
    expect(saved).toEqual([path.join(dir(), 'binder-2026-09-27-before-002-5.db')])
    expect(backups()).toEqual(['binder-2026-09-27-before-002-3.db', 'binder-2026-09-27-before-002-4.db', 'binder-2026-09-27-before-002-5.db'])
  })

  it('keeps the newest 3 copies, apart from the daily backups', () => {
    upgrade({ now: day(1) })
```

In `tests/server/settings-api.test.ts`, replace:

```ts
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { createAiClient } from '../../src/server/ai/client.ts'
import { createKeyStore } from '../../src/server/ai/key-store.ts'
import type { AiKeyStatus, ApiErrorBody, Settings } from '../../src/shared/types.ts'
import { body, makeApp } from '../helpers/app.ts'

const send = (app: ReturnType<typeof makeApp>, method: string, url: string, json: unknown) =>
```

with:

```ts
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createAiClient } from '../../src/server/ai/client.ts'
import { createKeyStore } from '../../src/server/ai/key-store.ts'
import type { AiKeyStatus, ApiErrorBody, BackupStatus, Settings } from '../../src/shared/types.ts'
import { body, makeApp } from '../helpers/app.ts'
import { createTestDb } from '../helpers/db.ts'

const send = (app: ReturnType<typeof makeApp>, method: string, url: string, json: unknown) =>
```

In `tests/server/settings-api.test.ts`, replace:

```ts
    expect((await send(fresh, 'PATCH', '/api/settings', { scanAutoCommit: true, typo: 1 })).status).toBe(400)
    expect((await body<Settings>(await fresh.request('/api/settings'))).scanAutoCommit).toBe(false) // nothing was changed
  })
})
```

with:

```ts
    expect((await send(fresh, 'PATCH', '/api/settings', { scanAutoCommit: true, typo: 1 })).status).toBe(400)
    expect((await body<Settings>(await fresh.request('/api/settings'))).scanAutoCommit).toBe(false) // nothing was changed
  })
})

describe('backups (spec §5.6)', () => {
  it('says when the last backup was made and where they are, and backs up now', async () => {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-backups-'))
    onTestFinished(() => fs.rmSync(backupDir, { recursive: true, force: true }))
    const app = makeApp({ db: createTestDb(), backupDir })
    expect(await body<BackupStatus>(await app.request('/api/settings/backups'))).toEqual({ lastBackupAt: null, folder: backupDir })
    const res = await app.request('/api/settings/backups', { method: 'POST' })
    expect(res.status).toBe(200)
    const made = await body<BackupStatus & { file: string }>(res)
    expect(made).toEqual({ lastBackupAt: expect.any(String), folder: backupDir, file: expect.stringMatching(/^binder-\d{4}-\d{2}-\d{2}\.db$/) })
    expect(fs.readdirSync(backupDir)).toEqual([made.file])
    expect((await body<BackupStatus>(await app.request('/api/settings/backups'))).lastBackupAt).toBe(made.lastBackupAt)
  })

  it('explains a backup that fails, and has no backup routes without a backups folder', async () => {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-backups-'))
    onTestFinished(() => fs.rmSync(backupDir, { recursive: true, force: true }))
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device')
    })
    onTestFinished(() => rename.mockRestore())
    const res = await makeApp({ db: createTestDb(), backupDir }).request('/api/settings/backups', { method: 'POST' })
    expect(res.status).toBe(500)
    expect((await body<ApiErrorBody>(res)).error).toEqual({ code: 'backup_failed', message: "Couldn't back up: ENOSPC: no space left on device" })
    expect(fs.readdirSync(backupDir)).toEqual([])
    expect((await makeApp().request('/api/settings/backups')).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/server/backup.test.ts tests/server/settings-api.test.ts`
Expected: FAIL: `backupNow` is not exported yet (the whole backup file fails).

- [ ] **Step 3: Back up now, number copies after the last one kept, and add the routes**

A full-size copy of the owner's library backs up in about 0.2 s, so the request simply waits for it.

In `src/server/backup.ts`, replace:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './db/index.ts'
import { getMeta, setMeta } from './db/meta.ts'
```

with:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { BackupStatus } from '../shared/types.ts'
import type { DB } from './db/index.ts'
import { getMeta, setMeta } from './db/meta.ts'
```

In `src/server/backup.ts`, replace:

```ts
/** Backups kept (spec §6). */
export const KEEP_BACKUPS = 7
const BACKUP_FILE = /^binder-\d{4}-\d{2}-\d{2}\.db$/
/** Copies saved before upgrading the database kept, apart from the daily backups. */
export const KEEP_UPGRADE_BACKUPS = 3
```

with:

```ts
/** Backups kept (spec §6). */
export const KEEP_BACKUPS = 7
/** `binder-YYYY-MM-DD.db`, or `…-N.db` for another backup that day (Back up now). */
const BACKUP_FILE = /^binder-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.db$/
/** Copies saved before upgrading the database kept, apart from the daily backups. */
export const KEEP_UPGRADE_BACKUPS = 3
```

In `src/server/backup.ts`, replace:

```ts
    console.error(`[backup] Couldn't remove an old backup: ${messageOf(err)}`)
  }
}

/**
 * Writes a compact copy of the database (VACUUM INTO, about half the live file's size) to `file`, under a temporary
```

with:

```ts
    console.error(`[backup] Couldn't remove an old backup: ${messageOf(err)}`)
  }
}

/**
 * `<dir>/<name>.db`, or when copies by that name exist, `<name>-N.db` numbered after the last of them: an earlier
 * backup is never replaced, and a new copy is never numbered below one kept, which pruning would take for older.
 */
function unusedFile(dir: string, name: string): string {
  const copyOf = new RegExp(`^${name}(?:-(\\d+))?\\.db$`)
  let last = 0
  for (const file of fs.readdirSync(dir)) {
    const match = copyOf.exec(file)
    if (match) last = Math.max(last, Number(match[1] ?? 1))
  }
  return path.join(dir, last === 0 ? `${name}.db` : `${name}-${last + 1}.db`)
}

/**
 * Orders backup files named by `pattern` oldest first. The pattern's groups are the date, any others (the migration of
 * a pre-upgrade copy), and last which copy of that day it is: by date, the others, then the copy (the first has none).
 */
const byDateThenCopy =
  (pattern: RegExp) =>
  (a: string, b: string): number => {
    const key = (file: string) => {
      const [, date, ...rest] = pattern.exec(file) ?? []
      const copy = rest.at(-1) ?? '1'
      return `${date} ${rest.slice(0, -1).join(' ')} ${copy.padStart(6, '0')}`
    }
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0
  }

/**
 * Writes a compact copy of the database (VACUUM INTO, about half the live file's size) to `file`, under a temporary
```

In `src/server/backup.ts`, replace:

```ts
  copyDatabase(db, file)
  setMeta(db, 'last_backup_at', now.toISOString())
  removeOldBackups(dir, BACKUP_FILE, KEEP_BACKUPS)
  return { status: 'saved', file }
}

/** Orders pre-upgrade copies oldest first: by date, then migration, then which copy of that day. */
function byUpgradeOrder(a: string, b: string): number {
  const key = (name: string) => {
    const [, date, version, copy = '1'] = UPGRADE_BACKUP_FILE.exec(name) ?? []
    return `${date} ${version} ${copy.padStart(6, '0')}`
  }
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0
}

```

with:

```ts
  copyDatabase(db, file)
  setMeta(db, 'last_backup_at', now.toISOString())
  removeOldBackups(dir, BACKUP_FILE, KEEP_BACKUPS, byDateThenCopy(BACKUP_FILE))
  return { status: 'saved', file }
}

/**
 * Backs up the database now (Settings → Back up now, spec §5.6): today's backup, `<dir>/binder-YYYY-MM-DD.db`, or when
 * that exists (it's never replaced) `…-2.db` and on. Keeps the newest 7 backups, these included, and records the time,
 * so the next start's daily backup waits a day from it. It first removes partial copies interrupted backups left.
 * Returns the backup's path.
 */
export function backupNow(db: DB, dir: string, now = new Date()): string {
  fs.mkdirSync(dir, { recursive: true })
  removePartialCopies(dir)
  const file = unusedFile(dir, `binder-${localDate(now)}`)
  copyDatabase(db, file)
  setMeta(db, 'last_backup_at', now.toISOString())
  removeOldBackups(dir, BACKUP_FILE, KEEP_BACKUPS, byDateThenCopy(BACKUP_FILE))
  return file
}

/** When the last backup was made, and where they are kept (Settings → Backups). */
export function backupStatus(db: DB, dir: string): BackupStatus {
  return { lastBackupAt: getMeta(db, 'last_backup_at'), folder: dir }
}

```

In `src/server/backup.ts`, replace:

```ts
  fs.mkdirSync(dir, { recursive: true })
  removePartialCopies(dir)
  const name = `binder-${localDate(now)}-before-${version}`
  let file = path.join(dir, `${name}.db`)
  for (let copy = 2; fs.existsSync(file); copy++) file = path.join(dir, `${name}-${copy}.db`)
  copyDatabase(db, file)
  removeOldBackups(dir, UPGRADE_BACKUP_FILE, KEEP_UPGRADE_BACKUPS, byUpgradeOrder)
  return file
}
```

with:

```ts
  fs.mkdirSync(dir, { recursive: true })
  removePartialCopies(dir)
  const file = unusedFile(dir, `binder-${localDate(now)}-before-${version}`)
  copyDatabase(db, file)
  removeOldBackups(dir, UPGRADE_BACKUP_FILE, KEEP_UPGRADE_BACKUPS, byDateThenCopy(UPGRADE_BACKUP_FILE))
  return file
}
```

In `src/shared/types.ts`, replace:

```ts
}

/** The boards a scan can go to: a physical deck has no maybe board. */
export type ScanBoard = Exclude<Board, 'maybe'>
```

with:

```ts
}

/** Settings → Backups (spec §5.6): when the last backup was made, and the folder backups are kept in. */
export interface BackupStatus {
  lastBackupAt: string | null
  folder: string
}

/** The boards a scan can go to: a physical deck has no maybe board. */
export type ScanBoard = Exclude<Board, 'maybe'>
```

In `src/server/settings-routes.ts`, replace:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { describeAiError, type AiClient } from './ai/client.ts'
import type { DB } from './db/index.ts'
import { ApiError, parseWith, readJson } from './http.ts'
```

with:

```ts
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { describeAiError, type AiClient } from './ai/client.ts'
import { backupNow, backupStatus } from './backup.ts'
import type { DB } from './db/index.ts'
import { ApiError, parseWith, readJson } from './http.ts'
```

In `src/server/settings-routes.ts`, replace:

```ts
const TestBody = z.object({ apiKey: ApiKey.optional() })

export function settingsRoutes(deps: { db: DB; ai?: AiClient }): Hono {
  const routes = new Hono()
  routes.get('/', (c) => c.json(getSettings(deps.db)))
```

with:

```ts
const TestBody = z.object({ apiKey: ApiKey.optional() })

export function settingsRoutes(deps: { db: DB; ai?: AiClient; backupDir?: string }): Hono {
  const routes = new Hono()
  routes.get('/', (c) => c.json(getSettings(deps.db)))
```

In `src/server/settings-routes.ts`, replace:

```ts
    return c.json({ ok: true })
  })
  return routes
}
```

with:

```ts
    return c.json({ ok: true })
  })

  // Backups (spec §5.6): when the last one was made, where they are, and one now.
  const backupDir = () => {
    if (!deps.backupDir) throw new ApiError(404, 'not_found', 'No backup settings here')
    return deps.backupDir
  }
  routes.get('/backups', (c) => c.json(backupStatus(deps.db, backupDir())))
  routes.post('/backups', (c) => {
    let file: string
    try {
      file = backupNow(deps.db, backupDir())
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new ApiError(500, 'backup_failed', `Couldn't back up: ${err instanceof Error ? err.message : String(err)}`)
    }
    return c.json({ ...backupStatus(deps.db, backupDir()), file: path.basename(file) })
  })
  return routes
}
```

In `src/server/app.ts`, replace:

```ts
  /** The Anthropic API key and client (spec §5.6); without it there are no /api/settings/ai or /api/ai routes. */
  ai?: AiClient
  /** Built SPA directory. When set, non-API requests serve it, falling back to index.html. */
  webDistDir?: string
```

with:

```ts
  /** The Anthropic API key and client (spec §5.6); without it there are no /api/settings/ai or /api/ai routes. */
  ai?: AiClient
  /** Where backups are kept (spec §5.6); without it there are no /api/settings/backups routes. */
  backupDir?: string
  /** Built SPA directory. When set, non-API requests serve it, falling back to index.html. */
  webDistDir?: string
```

In `src/server/main.ts`, replace:

```ts
  ai,
  scanner: { scansDir: SCANS_DIR, worker },
  webDistDir: fs.existsSync(WEB_DIST_DIR) ? WEB_DIST_DIR : undefined,
})
```

with:

```ts
  ai,
  scanner: { scansDir: SCANS_DIR, worker },
  backupDir: BACKUP_DIR,
  webDistDir: fs.existsSync(WEB_DIST_DIR) ? WEB_DIST_DIR : undefined,
})
```

- [ ] **Step 4: Run the backup tests**

Run: `pnpm vitest run tests/server/backup.test.ts tests/server/settings-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Backups section to Settings**

In `src/web/lib/settings.ts`, replace:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { AiKeyStatus, Settings } from '../../shared/types.ts'
import { apiGet, apiSend } from './api.ts'
import { invalidateCollection } from './collection.ts'
```

with:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { AiKeyStatus, BackupStatus, Settings } from '../../shared/types.ts'
import { apiGet, apiSend } from './api.ts'
import { invalidateCollection } from './collection.ts'
```

In `src/web/lib/settings.ts`, replace:

```ts
    gcTime: 0,
  })
}
```

with:

```ts
    gcTime: 0,
  })
}

/** When the last backup was made, and the folder backups are kept in (spec §5.6). */
export function useBackups() {
  return useQuery({ queryKey: ['backups'], queryFn: ({ signal }) => apiGet<BackupStatus>('/api/settings/backups', signal) })
}

/** Backs up the library now, saying which file it saved. */
export function useBackUpNow() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => apiSend<BackupStatus & { file: string }>('POST', '/api/settings/backups'),
    onSuccess: ({ file, ...status }) => {
      queryClient.setQueryData(['backups'], status)
      toast.success(`Saved ${file}.`)
    },
    onError: (err) => toast.error(err.message),
  })
}
```

In `src/web/pages/SettingsPage.tsx`, replace:

```tsx
import { apiPost } from '../lib/api.ts'
import { formatDate } from '../lib/format.ts'
import { useAiKey, useSaveAiKey, useSettings, useTestAiKey, useUpdateSettings } from '../lib/settings.ts'
import { isBulkRunning, useBulkStatus } from '../lib/use-bulk-status.ts'

```

with:

```tsx
import { apiPost } from '../lib/api.ts'
import { formatDate } from '../lib/format.ts'
import { useAiKey, useBackUpNow, useBackups, useSaveAiKey, useSettings, useTestAiKey, useUpdateSettings } from '../lib/settings.ts'
import { isBulkRunning, useBulkStatus } from '../lib/use-bulk-status.ts'

```

In `src/web/pages/SettingsPage.tsx`, replace:

```tsx
      <ApiKeySettings />
      <DeckbuilderSettings />
    </div>
  )
```

with:

```tsx
      <ApiKeySettings />
      <DeckbuilderSettings />
      <BackupSettings />
    </div>
  )
```

In `src/web/pages/SettingsPage.tsx`, replace:

```tsx
const section = 'rounded-xl border border-stone-800 bg-stone-900/40 p-6'
const checkbox = 'accent-amber-500'

/** Spec §5.6 "Deckbuilder": whether buy lists leave out basic lands. */
```

with:

```tsx
const section = 'rounded-xl border border-stone-800 bg-stone-900/40 p-6'
const checkbox = 'accent-amber-500'

/** Spec §5.6 "Backups": when the last backup was made, Back up now, and the folder they're kept in. */
function BackupSettings() {
  const { data: backups, error } = useBackups()
  const backUp = useBackUpNow()
  return (
    <section className={section}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-100">Backups</h2>
          <p className="mt-1 text-sm text-stone-400">
            Binder saves a compact copy of your library when it starts and the last one is more than a day old, and
            keeps the newest 7. To restore one, stop Binder and copy it over <code>binder.db</code> in the folder above
            it, deleting <code>binder.db-wal</code> and <code>binder.db-shm</code>.
          </p>
        </div>
        <button
          onClick={() => backUp.mutate()}
          disabled={backUp.isPending}
          className="shrink-0 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {backUp.isPending ? 'Backing up…' : 'Back up now'}
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-rose-300">Couldn't load the backups: {error.message}</p>
      ) : (
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-stone-400">Last backup</dt>
          <dd className="text-stone-100">{backups ? formatDate(backups.lastBackupAt) : '…'}</dd>
          <dt className="text-stone-400">Folder</dt>
          <dd className="min-w-0 break-all font-mono text-xs text-stone-300">{backups?.folder ?? '…'}</dd>
        </dl>
      )}
    </section>
  )
}

/** Spec §5.6 "Deckbuilder": whether buy lists leave out basic lands. */
```

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: no type errors, all tests pass (791 tests), and the build succeeds.

---

### Task 3: Scanning into a deck on the Scan page

The Scan page gains "Scanning into" above the camera: the collection only, a deck and board, or **New deck…** (created
built). The choice is remembered like the camera and cleared when its deck disappears. Each row says where its scan
goes, with **Change**. The Add button and its toast count what goes to decks, and the page announces what auto-commit
adds while it's open.

**Files:**
- Create: `src/web/components/scan/ScanTarget.tsx` (the "Scanning into" bar, the deck and board picker, the new-deck
  form)
- Replace: `src/web/lib/scan.ts`, `src/web/pages/ScanPage.tsx`
- Modify: `src/web/lib/scan-queue.ts` (`addLabel`, `autoAddedToast`, decks in `commitInChunks` and `commitToast`;
  `likelyDoubleCaptures` goes)
- Modify: `src/web/components/scan/ScanQueue.tsx`, `src/web/components/scan/ScanRow.tsx`,
  `src/web/components/decks/DeckHeader.tsx`
- Test: `tests/web/scan-queue.test.ts`

**Interfaces:**
- Consumes: Task 1's routes and types; `useDecks`, `useDeckChange` (`src/web/lib/decks.ts`); `invalidateCollection`.
- Produces:
  - `addLabel(ready)`, `autoAddedToast(added)`, `commitToast` with decks (`src/web/lib/scan-queue.ts`).
  - `useScanItems()`, `useAnnounceAutoAdded()`, `captureQuery(auto, target)`, `useCapture()` taking `target`,
    `ScanEdit.target`, `parseTarget(value)`, `useScanTarget()` (`src/web/lib/scan.ts`).
  - `TargetPicker`, `ScanTargetBar` (`src/web/components/scan/ScanTarget.tsx`).
  - "Scan cards into this deck" in the deck editor opens `/scan?deck=<id>`.

- [ ] **Step 1: Write the failing tests**

`likelyDoubleCaptures`' tests go with it (Task 1 moved the rule to the server, with its tests).

In `tests/web/scan-queue.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest'
import { MAX_COMMIT_IDS } from '../../src/server/scanner/routes.ts'
import type { ScanItem } from '../../src/shared/types.ts'
import { commitInChunks, commitToast, COMMIT_CHUNK_SIZE, likelyDoubleCaptures } from '../../src/web/lib/scan-queue.ts'

/** A ready scan: `printing` is its card's id (the same letter is the same card, "b" and "b2" are two printings of it). */
function scan(id: number, auto: boolean, printing: string | null): ScanItem {
  return {
    id,
```

with:

```ts
import { describe, expect, it } from 'vitest'
import { MAX_COMMIT_IDS } from '../../src/server/scanner/routes.ts'
import type { ScanItem, ScanTarget } from '../../src/shared/types.ts'
import { captureQuery, parseTarget } from '../../src/web/lib/scan.ts'
import { addLabel, autoAddedToast, commitInChunks, commitToast, COMMIT_CHUNK_SIZE } from '../../src/web/lib/scan-queue.ts'

/** A ready scan: `printing` is its card's id (the same letter is the same card, "b" and "b2" are two printings of it). */
function scan(id: number, auto: boolean, printing: string | null, quantity = 1, deck: string | null = null): ScanItem {
  return {
    id,
```

In `tests/web/scan-queue.test.ts`, replace:

```ts
      : null,
    finish: 'nonfoil',
    quantity: 1,
    confidence: 1,
    candidates: [],
    error: null,
    createdAt: '2026-09-27T12:00:00.000Z',
    target: null,
    sameCardAsBefore: false,
  }
}
const marked = (...items: ScanItem[]) => [...likelyDoubleCaptures(items)].sort((a, b) => a - b)

describe('likelyDoubleCaptures', () => {
  it('marks an auto capture of the same printing as the auto capture just before it', () => {
    expect(marked(scan(1, true, 'a'), scan(2, true, 'a'))).toEqual([2])
    expect(marked(scan(1, true, 'a'), scan(2, true, 'a'), scan(3, true, 'a'))).toEqual([2, 3])
    // The scan before it in the queue: one committed or discarded in between is gone from the list.
    expect(marked(scan(4, true, 'a'), scan(9, true, 'a'))).toEqual([9])
  })

  it('marks nothing when a manual capture comes between them', () => {
    expect(marked(scan(1, true, 'a'), scan(2, false, 'a'), scan(3, true, 'a'))).toEqual([])
  })

  it('marks nothing for two printings of the same card, or two different cards', () => {
    expect(marked(scan(1, true, 'b'), scan(2, true, 'b2'))).toEqual([])
    expect(marked(scan(1, true, 'a'), scan(2, true, 'c'))).toEqual([])
  })

  it('marks nothing when either capture is manual', () => {
    expect(marked(scan(1, false, 'a'), scan(2, false, 'a'))).toEqual([])
    expect(marked(scan(1, false, 'a'), scan(2, true, 'a'))).toEqual([])
    expect(marked(scan(1, true, 'a'), scan(2, false, 'a'))).toEqual([])
  })

  it('marks nothing for scans without a card, or next to one', () => {
    expect(marked(scan(1, true, null), scan(2, true, null))).toEqual([])
    expect(marked(scan(1, true, null), scan(2, true, 'a'))).toEqual([])
    expect(marked(scan(1, true, 'a'), scan(2, true, null), scan(3, true, 'a'))).toEqual([])
  })

  it('goes by id, whatever order the list is in', () => {
    expect(marked(scan(2, true, 'a'), scan(1, true, 'a'))).toEqual([2])
  })
})
```

with:

```ts
      : null,
    finish: 'nonfoil',
    quantity,
    confidence: 1,
    candidates: [],
    error: null,
    createdAt: '2026-09-27T12:00:00.000Z',
    target: deck === null ? null : { deckId: deck.length, board: 'main', deckName: deck },
    sameCardAsBefore: false,
  }
}
describe('addLabel', () => {
  it('counts the ready copies, and how many go to a deck as well', () => {
    expect(addLabel([scan(1, false, 'a', 2), scan(2, false, 'b')])).toBe('Add 3 cards to collection')
    expect(addLabel([scan(1, false, 'a')])).toBe('Add 1 card to collection')
    expect(addLabel([scan(1, false, 'a', 2, 'Elf Ball'), scan(2, false, 'b')])).toBe('Add 3 cards (2 also to Elf Ball)')
    expect(addLabel([scan(1, false, 'a', 1, 'Elf Ball'), scan(2, false, 'b', 1, 'Burn'), scan(3, false, 'c')])).toBe(
      'Add 3 cards (2 also to 2 decks)',
    )
    expect(addLabel([])).toBe('Add 0 cards to collection')
  })
})

describe('captureQuery and parseTarget', () => {
  it("puts auto mode and the deck and board in a capture's query", () => {
    expect(captureQuery(false, null)).toBe('')
    expect(captureQuery(true, null)).toBe('?auto=1')
    expect(captureQuery(true, { deckId: 3, board: 'side' })).toBe('?auto=1&deck=3&board=side')
  })

  it('reads back a remembered target, and nothing that is not one', () => {
    const good: ScanTarget = { deckId: 3, board: 'commander' }
    expect(parseTarget(JSON.parse(JSON.stringify(good)))).toEqual(good)
    expect(parseTarget({ deckId: 3, board: 'maybe' })).toEqual({ deckId: 3, board: 'main' })
    for (const bad of [null, 'x', { deckId: '3' }, { deckId: 0 }, { deckId: 1.5, board: 'main' }]) expect(parseTarget(bad)).toBeNull()
  })
})
```

In `tests/web/scan-queue.test.ts`, replace:

```ts
      running--
      if (sent.length === fail) throw new Error('Request failed (500)')
      return { items: chunk.length, copies: chunk.length * 2 }
    }
    return { send, sent, overlapped: () => overlapped }
```

with:

```ts
      running--
      if (sent.length === fail) throw new Error('Request failed (500)')
      // Every request's first scan goes to deck 7 as well.
      return { items: chunk.length, copies: chunk.length * 2, decks: chunk.length > 0 ? [{ id: 7, name: 'Elf Ball', copies: 2 }] : [] }
    }
    return { send, sent, overlapped: () => overlapped }
```

In `tests/web/scan-queue.test.ts`, replace:

```ts
  ])('commits %i ids in requests of %j, one after another, and sums what they added', async (n, sizes) => {
    const fake = fakeSend()
    expect(await commitInChunks(ids(n), fake.send)).toEqual({ items: n, copies: 2 * n, error: null })
    expect(fake.sent.map((chunk) => chunk.length)).toEqual(sizes)
    expect(fake.sent.flat()).toEqual(ids(n))
```

with:

```ts
  ])('commits %i ids in requests of %j, one after another, and sums what they added', async (n, sizes) => {
    const fake = fakeSend()
    const decks = sizes.length === 0 ? [] : [{ id: 7, name: 'Elf Ball', copies: 2 * sizes.length }]
    expect(await commitInChunks(ids(n), fake.send)).toEqual({ items: n, copies: 2 * n, decks, error: null })
    expect(fake.sent.map((chunk) => chunk.length)).toEqual(sizes)
    expect(fake.sent.flat()).toEqual(ids(n))
```

In `tests/web/scan-queue.test.ts`, replace:

```ts
    const fake = fakeSend(2)
    const result = await commitInChunks(ids(2500), fake.send)
    expect(result).toEqual({ items: 1000, copies: 2000, error: new Error('Request failed (500)') })
    expect(fake.sent.map((chunk) => chunk.length)).toEqual([1000, 1000])
  })
```

with:

```ts
    const fake = fakeSend(2)
    const result = await commitInChunks(ids(2500), fake.send)
    expect(result).toEqual({ items: 1000, copies: 2000, decks: [{ id: 7, name: 'Elf Ball', copies: 2 }], error: new Error('Request failed (500)') })
    expect(fake.sent.map((chunk) => chunk.length)).toEqual([1000, 1000])
  })
```

In `tests/web/scan-queue.test.ts`, replace:

```ts
  it('reports a failing first request with nothing added', async () => {
    const result = await commitInChunks(ids(3), fakeSend(1).send)
    expect(result).toEqual({ items: 0, copies: 0, error: new Error('Request failed (500)') })
  })
})
```

with:

```ts
  it('reports a failing first request with nothing added', async () => {
    const result = await commitInChunks(ids(3), fakeSend(1).send)
    expect(result).toEqual({ items: 0, copies: 0, decks: [], error: new Error('Request failed (500)') })
  })
})
```

In `tests/web/scan-queue.test.ts`, replace:

```ts
describe('commitToast', () => {
  it('says how many cards were added, in one toast', () => {
    expect(commitToast({ items: 2500, copies: 2600, error: null })).toEqual({
      tone: 'success',
      message: 'Added 2,600 cards to your collection.',
```

with:

```ts
describe('commitToast', () => {
  it('says how many cards were added, in one toast', () => {
    expect(commitToast({ items: 2500, copies: 2600, decks: [], error: null })).toEqual({
      tone: 'success',
      message: 'Added 2,600 cards to your collection.',
```

In `tests/web/scan-queue.test.ts`, replace:

```ts
  })

  it('says what was added before a failure, and that the rest are still ready', () => {
    expect(commitToast({ items: 1000, copies: 1000, error: new Error('Request failed (500)') })).toEqual({
      tone: 'error',
      message: "Added 1,000 cards to your collection, but couldn't add the rest: Request failed (500). They're still ready in the queue.",
    })
    expect(commitToast({ items: 0, copies: 0, error: new Error('Request failed (500)') })).toEqual({
      tone: 'error',
      message: "Couldn't add the scans: Request failed (500)",
```

with:

```ts
  })

  it('says how many went to each deck as well', () => {
    const decks = [
      { id: 1, name: 'Elf Ball', copies: 40 },
      { id: 2, name: 'Burn', copies: 1 },
    ]
    expect(commitToast({ items: 60, copies: 60, decks, error: null }).message).toBe('Added 60 cards to your collection, with 40 for Elf Ball and 1 for Burn.')
    expect(commitToast({ items: 60, copies: 60, decks: decks.slice(0, 1), error: new Error('Request failed (500)') }).message).toBe(
      "Added 60 cards to your collection, with 40 for Elf Ball, but couldn't add the rest: Request failed (500). They're still ready in the queue.",
    )
  })

  it('says what was added before a failure, and that the rest are still ready', () => {
    expect(commitToast({ items: 1000, copies: 1000, decks: [], error: new Error('Request failed (500)') })).toEqual({
      tone: 'error',
      message: "Added 1,000 cards to your collection, but couldn't add the rest: Request failed (500). They're still ready in the queue.",
    })
    expect(commitToast({ items: 0, copies: 0, decks: [], error: new Error('Request failed (500)') })).toEqual({
      tone: 'error',
      message: "Couldn't add the scans: Request failed (500)",
```

In `tests/web/scan-queue.test.ts`, replace:

```ts
    })
  })
})
```

with:

```ts
    })
  })
})

describe('autoAddedToast', () => {
  it('names one card, or counts several, and says which decks they went to', () => {
    const bolt = { id: 1, name: 'Lightning Bolt', copies: 1, deckName: null }
    expect(autoAddedToast([bolt])).toBe('Added Lightning Bolt to your collection.')
    expect(autoAddedToast([{ ...bolt, deckName: 'Elf Ball' }])).toBe('Added Lightning Bolt to your collection, for Elf Ball.')
    expect(autoAddedToast([{ ...bolt, copies: 3 }])).toBe('Added 3 cards to your collection.')
    expect(
      autoAddedToast([
        { ...bolt, deckName: 'Elf Ball' },
        { ...bolt, id: 2, deckName: 'Burn' },
        { ...bolt, id: 3, deckName: 'Elf Ball' },
      ]),
    ).toBe('Added 3 cards to your collection, for Elf Ball and Burn.')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/web/scan-queue.test.ts`
Expected: FAIL: `captureQuery` and the other new helpers are not exported yet.

- [ ] **Step 3: Write the scan helpers**

Replace the whole of `src/web/lib/scan-queue.ts`:

```ts
import type { AutoAddedScan, ScanCommitResult, ScanItem } from '../../shared/types.ts'
import { plural } from './format.ts'

/** "a", "a and b", "a, b and c". */
function joinAnd(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/**
 * The Add button's words for the ready scans (spec §5.1.3): how many cards, and how many of them go to decks as well.
 * "Add 60 cards to collection", "Add 60 cards (60 also to Elf Ball)", "Add 60 cards (45 also to 2 decks)".
 */
export function addLabel(ready: readonly ScanItem[]): string {
  const copies = ready.reduce((sum, i) => sum + i.quantity, 0)
  const toDecks = ready.filter((i) => i.target !== null)
  if (toDecks.length === 0) return `Add ${plural(copies, 'card')} to collection`
  const deckCopies = toDecks.reduce((sum, i) => sum + i.quantity, 0).toLocaleString('en-US')
  const names = new Set(toDecks.map((i) => i.target!.deckId))
  const where = names.size === 1 ? toDecks[0]!.target!.deckName : `${names.size} decks`
  return `Add ${plural(copies, 'card')} (${deckCopies} also to ${where})`
}

/** The most scans one commit request can name: `POST /api/scan/commit` refuses more (MAX_COMMIT_IDS). */
export const COMMIT_CHUNK_SIZE = 1000

/**
 * What a commit added, summed over its requests (the copies for each deck too); `error` is why it stopped early, or
 * null when every request worked.
 */
export interface CommitOutcome extends ScanCommitResult {
  error: Error | null
}

/**
 * Commits the scans with these ids in requests of at most COMMIT_CHUNK_SIZE ids, one after another. Stops at the first
 * request that fails and reports what the requests before it added, with the error; the scans it didn't add stay
 * ready in the queue.
 */
export async function commitInChunks(
  ids: readonly number[],
  send: (ids: number[]) => Promise<ScanCommitResult>,
): Promise<CommitOutcome> {
  const outcome: CommitOutcome = { items: 0, copies: 0, decks: [], error: null }
  for (let start = 0; start < ids.length; start += COMMIT_CHUNK_SIZE) {
    try {
      const added = await send(ids.slice(start, start + COMMIT_CHUNK_SIZE))
      outcome.items += added.items
      outcome.copies += added.copies
      for (const deck of added.decks) {
        const seen = outcome.decks.find((d) => d.id === deck.id)
        if (seen) seen.copies += deck.copies
        else outcome.decks.push({ ...deck })
      }
    } catch (err) {
      outcome.error = err instanceof Error ? err : new Error(String(err))
      break
    }
  }
  return outcome
}

/**
 * The one toast a commit shows: what it added, and for which decks, and if it stopped early, why. "Added 60 cards to
 * your collection, with 40 for Elf Ball and 20 for Burn."
 */
export function commitToast(outcome: CommitOutcome): { tone: 'success' | 'error'; message: string } {
  const decks = outcome.decks.map((d) => `${d.copies.toLocaleString('en-US')} for ${d.name}`)
  const added = `Added ${plural(outcome.copies, 'card')} to your collection${decks.length > 0 ? `, with ${joinAnd(decks)}` : ''}`
  if (outcome.error === null) return { tone: 'success', message: `${added}.` }
  if (outcome.items === 0) return { tone: 'error', message: `Couldn't add the scans: ${outcome.error.message}` }
  return {
    tone: 'error',
    message: `${added}, but couldn't add the rest: ${outcome.error.message}. They're still ready in the queue.`,
  }
}

/** What auto-commit added since the last look, in one toast: "Added Lightning Bolt to your collection, for Elf Ball." */
export function autoAddedToast(added: readonly AutoAddedScan[]): string {
  const copies = added.reduce((sum, a) => sum + a.copies, 0)
  const decks = [...new Set(added.flatMap((a) => (a.deckName === null ? [] : [a.deckName])))]
  const what = added.length === 1 && copies === 1 ? added[0]!.name : plural(copies, 'card')
  return `Added ${what} to your collection${decks.length > 0 ? `, for ${joinAnd(decks)}` : ''}.`
}
```

Replace the whole of `src/web/lib/scan.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { Finish, ScanBoard, ScanCommitResult, ScanItem, ScanQueue, ScanTarget } from '../../shared/types.ts'
import { apiGet, apiSend, apiUpload } from './api.ts'
import { invalidateCollection } from './collection.ts'
import { useDecks } from './decks.ts'
import { autoAddedToast, commitInChunks, commitToast } from './scan-queue.ts'
import { useToast } from './toast.tsx'

/** How often the queue is fetched while the Scan page is open (spec §5.1.1). */
export const SCAN_POLL_MS = 1000

/** The queue, refreshed every second: one request serves every hook that reads it. */
const scanQueue = {
  queryKey: ['scan-items'],
  queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<ScanQueue>('/api/scan/items', signal),
  refetchInterval: SCAN_POLL_MS,
} as const

/** The scans in the queue. */
export function useScanItems() {
  return useQuery({ ...scanQueue, select: (queue: ScanQueue) => queue.items })
}

/**
 * Announces what auto-commit adds while the page is open (spec §5.1.3), in one toast per look at the queue, and
 * refetches what it changed. What it added before the page opened is old news.
 */
export function useAnnounceAutoAdded() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: added } = useQuery({ ...scanQueue, select: (queue: ScanQueue) => queue.added })
  const seen = useRef<Set<number> | null>(null)
  useEffect(() => {
    if (!added) return
    if (seen.current === null) {
      seen.current = new Set(added.map((a) => a.id))
      return
    }
    const fresh = added.filter((a) => !seen.current!.has(a.id))
    if (fresh.length === 0) return
    for (const a of fresh) seen.current.add(a.id)
    toast.success(autoAddedToast(fresh))
    invalidateCollection(queryClient)
  }, [added, queryClient, toast])
}

/** A change to the queue: refetches it afterwards; failures show as a toast starting with `failure`. */
function useScanChange<Input, Result>(send: (input: Input) => Promise<Result>, failure: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: send,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scan-items'] }),
    onError: (err) => toast.error(`${failure}: ${err.message}`),
  })
}

/** A capture's query: `auto=1` from auto mode, and the deck and board it goes to. */
export function captureQuery(auto: boolean, target: ScanTarget | null): string {
  const params = new URLSearchParams()
  if (auto) params.set('auto', '1')
  if (target) {
    params.set('deck', String(target.deckId))
    params.set('board', target.board)
  }
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/** Sends a capture to be identified. `auto`: taken by auto mode; `target`: the deck it goes to as well. */
export function useCapture() {
  return useScanChange(
    ({ jpeg, auto, target }: { jpeg: Blob; auto: boolean; target: ScanTarget | null }) =>
      apiUpload<ScanItem>(`/api/scan${captureQuery(auto, target)}`, jpeg),
    "Couldn't save the capture",
  )
}

export interface ScanEdit {
  cardId?: string
  finish?: Finish
  quantity?: number
  confirm?: true
  target?: ScanTarget | null
}

export function useEditScan(id: number) {
  return useScanChange((edit: ScanEdit) => apiSend<ScanItem>('PATCH', `/api/scan/items/${id}`, edit), "Couldn't change the scan")
}

export function useDiscardScan(id: number) {
  return useScanChange(() => apiSend<void>('DELETE', `/api/scan/items/${id}`), "Couldn't discard the scan")
}

export function useRetryScan(id: number) {
  return useScanChange(() => apiSend<ScanItem>('POST', `/api/scan/items/${id}/retry`), "Couldn't identify it again")
}

/**
 * Adds ready scans to the collection, and to their decks (spec §5.1.3): the ones with these ids, which the Add button
 * counted. A scan that became ready after the count waits for the next commit. More than the server takes in one
 * request go in several, one after another, with one toast for them all; a failed request stops the rest, which stay
 * ready.
 */
export function useCommitScans() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (ids: number[]) => commitInChunks(ids, (chunk) => apiSend<ScanCommitResult>('POST', '/api/scan/commit', { ids: chunk })),
    onSuccess: (outcome) => {
      const { tone, message } = commitToast(outcome)
      toast[tone](message)
      if (outcome.items > 0) invalidateCollection(queryClient)
      // Stays pending until the queue has refetched, so a second click can't commit (and toast) nothing.
      return queryClient.invalidateQueries({ queryKey: ['scan-items'] })
    },
    onError: (err) => toast.error(`Couldn't add the scans: ${err.message}`),
  })
}

const TARGET_KEY = 'binder.scan.target'
const BOARDS: readonly ScanBoard[] = ['commander', 'main', 'side']

/** A stored or linked target, if it's well formed. */
export function parseTarget(value: unknown): ScanTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const { deckId, board } = value as Record<string, unknown>
  if (typeof deckId !== 'number' || !Number.isInteger(deckId) || deckId < 1) return null
  return { deckId, board: BOARDS.includes(board as ScanBoard) ? (board as ScanBoard) : 'main' }
}

function storedTarget(): ScanTarget | null {
  try {
    return parseTarget(JSON.parse(localStorage.getItem(TARGET_KEY) ?? 'null'))
  } catch {
    return null
  }
}

function storeTarget(target: ScanTarget | null) {
  try {
    if (target) localStorage.setItem(TARGET_KEY, JSON.stringify(target))
    else localStorage.removeItem(TARGET_KEY)
  } catch {
    // Private windows can refuse storage; the choice just isn't remembered.
  }
}

/**
 * Where the Scan page's captures go (spec §5.1.3): the collection only (null), or a deck's board as well. It starts
 * from `?deck=` (the deck editor's "Scan cards into this deck"), else the last choice, remembered like the camera. A
 * deck that no longer exists counts as the collection only.
 */
export function useScanTarget(): { target: ScanTarget | null; setTarget: (target: ScanTarget | null) => void } {
  const [params, setParams] = useSearchParams()
  const [chosen, setChosen] = useState<ScanTarget | null>(() => {
    const linked = Number(params.get('deck'))
    return Number.isInteger(linked) && linked > 0 ? { deckId: linked, board: 'main' } : storedTarget()
  })
  const { data: decks } = useDecks()
  // Remember a linked deck, and drop it from the address so a reload keeps later choices.
  useEffect(() => {
    if (!params.has('deck')) return
    storeTarget(chosen)
    setParams({}, { replace: true })
  }, [params, setParams, chosen])
  const exists = chosen !== null && decks?.some((d) => d.id === chosen.deckId) === true
  return {
    target: exists ? chosen : null,
    setTarget: (target) => {
      setChosen(target)
      storeTarget(target)
    },
  }
}
```

- [ ] **Step 4: Run the web scan tests**

Run: `pnpm vitest run tests/web/scan-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the page**

`TargetPicker` sends only the deck and board (the server's `Target` is strict, and a scan's `target` also
carries the deck's name). Commander is offered only for a commander deck, or when already chosen.

Create `src/web/components/scan/ScanTarget.tsx`:

```tsx
import { useState } from 'react'
import { Link } from 'react-router'
import { FORMAT_IDS, FORMATS } from '../../../shared/formats.ts'
import type { DeckSummary, FormatId, ScanBoard, ScanTarget } from '../../../shared/types.ts'
import { apiSend } from '../../lib/api.ts'
import { useDeckChange, useDecks } from '../../lib/decks.ts'

const control = 'rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-100 disabled:opacity-50'
const BOARD_NAMES: Record<ScanBoard, string> = { main: 'Main', side: 'Sideboard', commander: 'Commander' }

/**
 * Chooses where scans go: the collection only, or a deck and one of its boards. Commander is offered for commander
 * decks (or when already chosen). With `onNewDeck`, the list ends with "New deck…".
 */
export function TargetPicker({
  label,
  target,
  onChange,
  onNewDeck,
  disabled = false,
}: {
  label: string
  target: ScanTarget | null
  onChange: (target: ScanTarget | null) => void
  onNewDeck?: () => void
  disabled?: boolean
}) {
  const { data: decks = [] } = useDecks()
  const deck = target ? decks.find((d) => d.id === target.deckId) : undefined
  const group = (status: DeckSummary['status']) => decks.filter((d) => d.status === status)
  return (
    <>
      <select
        aria-label={label}
        value={target ? String(target.deckId) : 'collection'}
        disabled={disabled}
        onChange={(e) => {
          const value = e.target.value
          if (value === 'new') onNewDeck?.()
          else if (value === 'collection') onChange(null)
          else onChange({ deckId: Number(value), board: target?.board ?? 'main' })
        }}
        className={`max-w-full ${control}`}
      >
        <option value="collection">Your collection only</option>
        {(['built', 'prospective'] as const).map(
          (status) =>
            group(status).length > 0 && (
              <optgroup key={status} label={status === 'built' ? 'Built decks' : 'Prospective decks'}>
                {group(status).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            ),
        )}
        {onNewDeck && <option value="new">New deck…</option>}
      </select>
      {target && (
        <select
          aria-label={`${label}: board`}
          value={target.board}
          disabled={disabled}
          onChange={(e) => onChange({ deckId: target.deckId, board: e.target.value as ScanBoard })}
          className={control}
        >
          {(['main', 'side', 'commander'] as const)
            .filter((b) => b !== 'commander' || deck?.format === 'commander' || target.board === 'commander')
            .map((b) => (
              <option key={b} value={b}>
                {BOARD_NAMES[b]}
              </option>
            ))}
        </select>
      )}
    </>
  )
}

/** A deck made for scanning a physical one into: built, since its cards are in hand. */
function NewDeckForm({ onCreated, onCancel }: { onCreated: (deck: DeckSummary) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [format, setFormat] = useState<FormatId>('commander')
  const create = useDeckChange(
    (fields: { name: string; format: FormatId }) => apiSend<DeckSummary>('POST', '/api/decks', { ...fields, status: 'built' }),
    "Couldn't create the deck",
  )
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate({ name: name.trim(), format }, { onSuccess: onCreated })
      }}
      className="flex w-full flex-wrap items-center gap-2"
    >
      <input
        aria-label="New deck's name"
        placeholder="Deck name"
        autoFocus
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={`min-w-48 flex-1 ${control}`}
      />
      <select aria-label="New deck's format" value={format} onChange={(e) => setFormat(e.target.value as FormatId)} className={control}>
        {FORMAT_IDS.map((f) => (
          <option key={f} value={f}>
            {FORMATS[f].label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={name.trim() === '' || create.isPending}
        className="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
      >
        Create built deck
      </button>
      <button type="button" onClick={onCancel} className="rounded-md border border-stone-700 px-3 py-1 text-sm text-stone-300 hover:bg-stone-800">
        Cancel
      </button>
    </form>
  )
}

/**
 * "Scanning into" (spec §5.1.3): where the next captures go besides the collection. Each scan remembers the deck it
 * was captured for, so changing this doesn't move scans already taken.
 */
export function ScanTargetBar({ target, onChange }: { target: ScanTarget | null; onChange: (target: ScanTarget | null) => void }) {
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-stone-800 bg-stone-900/40 px-4 py-3 text-sm">
      <span className="text-stone-400">Scanning into</span>
      <TargetPicker label="Scanning into" target={target} onChange={onChange} onNewDeck={() => setCreating(true)} />
      {target && (
        <Link to={`/decks/${target.deckId}`} className="text-amber-300 hover:underline">
          Open deck
        </Link>
      )}
      {target && <span className="text-stone-500">Cards go to your collection and fill the deck's list first.</span>}
      {creating && (
        <NewDeckForm
          onCreated={(deck) => {
            onChange({ deckId: deck.id, board: 'main' })
            setCreating(false)
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  )
}
```

In `src/web/components/scan/ScanQueue.tsx`, replace:

```tsx
import { plural } from '../../lib/format.ts'
import { useCommitScans, useScanItems } from '../../lib/scan.ts'
import { likelyDoubleCaptures } from '../../lib/scan-queue.ts'
import { ScanRow } from './ScanRow.tsx'

/**
 * The scan queue (spec §5.1.3), newest first, with Commit for everything that's ready (the rows it counts). Auto mode's
 * likely second captures of one card are marked.
 */
export function ScanQueue() {
  const { data: items, error } = useScanItems()
  const commit = useCommitScans()
  const doubles = likelyDoubleCaptures(items ?? [])
  const ready = items?.filter((i) => i.status === 'confident') ?? []
  const toCheck = items?.filter((i) => i.status === 'review').length ?? 0
```

with:

```tsx
import { useCommitScans, useScanItems } from '../../lib/scan.ts'
import { addLabel } from '../../lib/scan-queue.ts'
import { ScanRow } from './ScanRow.tsx'

/**
 * The scan queue (spec §5.1.3), newest first, with Add for everything that's ready (the rows it counts), to the
 * collection and each scan's deck. Auto mode's likely second captures of one card are marked.
 */
export function ScanQueue() {
  const { data: items, error } = useScanItems()
  const commit = useCommitScans()
  const ready = items?.filter((i) => i.status === 'confident') ?? []
  const toCheck = items?.filter((i) => i.status === 'review').length ?? 0
```

In `src/web/components/scan/ScanQueue.tsx`, replace:

```tsx
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {commit.isPending ? 'Adding…' : `Add ${plural(copies, 'card')} to collection`}
        </button>
      </div>
```

with:

```tsx
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {commit.isPending ? 'Adding…' : addLabel(ready)}
        </button>
      </div>
```

In `src/web/components/scan/ScanQueue.tsx`, replace:

```tsx
      <ul className="divide-y divide-stone-800">
        {[...(items ?? [])].reverse().map((item) => (
          <ScanRow key={item.id} item={item} sameCardAsBefore={doubles.has(item.id)} />
        ))}
      </ul>
```

with:

```tsx
      <ul className="divide-y divide-stone-800">
        {[...(items ?? [])].reverse().map((item) => (
          <ScanRow key={item.id} item={item} />
        ))}
      </ul>
```

In `src/web/components/scan/ScanRow.tsx`, replace:

```tsx
import { apiGet } from '../../lib/api.ts'
import { useCardDrawer } from '../../lib/card-drawer.tsx'
import { useDiscardScan, useEditScan, useRetryScan } from '../../lib/scan.ts'
import { useDebounced } from '../../lib/use-debounced.ts'

const FINISH_LABEL: Record<Finish, string> = { nonfoil: 'Nonfoil', foil: 'Foil', etched: 'Etched' }
```

with:

```tsx
import { apiGet } from '../../lib/api.ts'
import { useCardDrawer } from '../../lib/card-drawer.tsx'
import { useDecks } from '../../lib/decks.ts'
import { useDiscardScan, useEditScan, useRetryScan } from '../../lib/scan.ts'
import { useDebounced } from '../../lib/use-debounced.ts'
import { TargetPicker } from './ScanTarget.tsx'

const FINISH_LABEL: Record<Finish, string> = { nonfoil: 'Nonfoil', foil: 'Foil', etched: 'Etched' }
```

In `src/web/components/scan/ScanRow.tsx`, replace:

```tsx
}

/**
 * One scan in the queue (spec §5.1.3): the capture next to Scryfall's image, what it was identified as, and the
 * controls to correct the printing, finish, and quantity, confirm it, pick another card (any review row), or discard
 * it. `sameCardAsBefore`: auto mode may have captured this card twice (see likelyDoubleCaptures).
 */
export function ScanRow({ item, sameCardAsBefore = false }: { item: ScanItem; sameCardAsBefore?: boolean }) {
  const edit = useEditScan(item.id)
  const discard = useDiscardScan(item.id)
```

with:

```tsx
}

const BOARD_NAMES = { main: 'Main', side: 'Sideboard', commander: 'Commander' } as const

/** Where one scan goes besides the collection, and a way to change it: for a scan captured with the wrong deck chosen. */
function ScanRowTarget({ item }: { item: ScanItem }) {
  const { data: decks } = useDecks()
  const edit = useEditScan(item.id)
  const [changing, setChanging] = useState(false)
  if (!item.target && !decks?.length) return null
  if (changing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <TargetPicker
          label={`Deck for ${item.card?.name ?? 'this scan'}`}
          target={item.target}
          disabled={edit.isPending}
          onChange={(target) => edit.mutate({ target }, { onSuccess: () => setChanging(false) })}
        />
        <button onClick={() => setChanging(false)} className={small}>
          Done
        </button>
      </div>
    )
  }
  return (
    <p className="text-xs text-stone-400">
      {item.target ? (
        <>
          For <span className="text-stone-200">{item.target.deckName}</span> · {BOARD_NAMES[item.target.board]}{' '}
        </>
      ) : (
        'Collection only '
      )}
      <button onClick={() => setChanging(true)} className="text-amber-300 hover:underline">
        {item.target ? 'Change' : 'Add to a deck…'}
      </button>
    </p>
  )
}

/**
 * One scan in the queue (spec §5.1.3): the capture next to Scryfall's image, what it was identified as, where it goes,
 * and the controls to correct the printing, finish, and quantity, confirm it, pick another card (any review row), or
 * discard it. A mark says when auto mode may have captured this card twice.
 */
export function ScanRow({ item }: { item: ScanItem }) {
  const edit = useEditScan(item.id)
  const discard = useDiscardScan(item.id)
```

In `src/web/components/scan/ScanRow.tsx`, replace:

```tsx
        </div>

        {sameCardAsBefore && !busy && (
          <p className="text-xs text-amber-300">Same card as the scan before it. Discard it if the camera caught one card twice.</p>
        )}
```

with:

```tsx
        </div>

        <ScanRowTarget item={item} />

        {item.sameCardAsBefore && !busy && (
          <p className="text-xs text-amber-300">Same card as the scan before it. Discard it if the camera caught one card twice.</p>
        )}
```

Replace the whole of `src/web/pages/ScanPage.tsx`:

```tsx
import { CameraPanel } from '../components/scan/CameraPanel.tsx'
import { ScanQueue } from '../components/scan/ScanQueue.tsx'
import { ScanTargetBar } from '../components/scan/ScanTarget.tsx'
import { useAnnounceAutoAdded, useCapture, useScanTarget } from '../lib/scan.ts'

/**
 * Scan cards into the collection, and into a deck as well (spec §5.1): where they go at the top, the camera on the
 * left, and the queue on the right.
 */
export function ScanPage() {
  const capture = useCapture()
  const { target, setTarget } = useScanTarget()
  useAnnounceAutoAdded()
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-semibold text-stone-50">Scan</h1>
      <ScanTargetBar target={target} onChange={setTarget} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CameraPanel onCapture={(jpeg, auto) => capture.mutate({ jpeg, auto, target })} />
        <ScanQueue />
      </div>
    </div>
  )
}
```

In `src/web/components/decks/DeckHeader.tsx`, replace:

```tsx
          Brainstorm with Claude
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-stone-400">
```

with:

```tsx
          Brainstorm with Claude
        </button>
        <button
          onClick={() => navigate(`/scan?deck=${deck.id}`)}
          className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-800"
        >
          Scan cards into this deck
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-stone-400">
```

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: no type errors, all tests pass (790 tests), and the build succeeds.

---

### Task 4: Brainstorm fixes from first use

The M6 follow-ups the owner's first use made worth doing now (`docs/plans/m6-followups.md`):
- "Thinking…" while Claude writes a tool call (a whole deck can take tens of seconds);
- following the answer only downward, while still bringing a conversation into view when it opens;
- the cost estimate at each model's prices;
- a clear notice when a conversation outgrows the context window;
- Stop in the first instant of an answer;
- a stopped answer keeps its fallback marker;
- "Brainstorm with Claude" reuses the deck's empty conversation.

**Files:**
- Modify: `src/shared/types.ts` (`ChatEvent` `working`)
- Modify: `src/server/ai/chat.ts`, `client.ts`, `history.ts`, `threads.ts`, `routes.ts`
- Modify: `src/web/lib/brainstorm.ts`, `src/web/components/brainstorm/ChatView.tsx`
- Test: `tests/server/brainstorm.test.ts`, `tests/server/ai-api.test.ts`, `tests/web/brainstorm.test.ts`

**Interfaces:**
- Consumes: M6's chat loop, history, routes, and web hooks.
- Produces:
  - `ChatEvent` `{ type: 'working' }`, emitted when Claude starts writing a tool call; `AnswerState.writing`;
    `awaitingClaude({ live, ended, writing })`.
  - `NOTICE.tooLong`, `cutOffNotice(stopReason)`, `isPromptTooLong(err)` (`client.ts`), `keepStopped(said)`
    (`chat.ts`).
  - `estimateCost` prices each message, and each attempt of a fallback, at its own model's rates, leaving out an
    attempt declined before it wrote anything.
  - `startThread(db, deckId, now): { id, reused }`; `POST /api/ai/threads` answers 200 for a reused conversation,
    201 for a new one.

- [ ] **Step 1: Write the failing tests**

In `tests/server/brainstorm.test.ts`, replace:

```ts
      'delta',
      'delta',
      'item:tool',
      'tool_done',
```

with:

```ts
      'delta',
      'delta',
      'working',
      'item:tool',
      'tool_done',
```

In `tests/server/brainstorm.test.ts`, replace:

```ts
    expect(events.some((e) => e.type === 'item' && e.item.kind === 'tool')).toBe(false)
    expect(count(db, 'decks')).toBe(0)
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.cutOff } })
    expect(getMessages(db, id)[1]!.content).toEqual([{ type: 'text', text: 'Here is the plan' }])
    expect(chatItems(getMessages(db, id), tools.describe).at(-1)).toEqual({ kind: 'notice', tone: 'info', text: NOTICE.cutOff })
  })

```

with:

```ts
    expect(events.some((e) => e.type === 'item' && e.item.kind === 'tool')).toBe(false)
    expect(count(db, 'decks')).toBe(0)
    // The conversation has outgrown Claude's context window: said as such, not as a long answer.
    expect(events).toContainEqual({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.tooLong } })
    expect(getMessages(db, id)[1]!.content).toEqual([{ type: 'text', text: 'Here is the plan' }])
    expect(chatItems(getMessages(db, id), tools.describe).at(-1)).toEqual({ kind: 'notice', tone: 'info', text: NOTICE.tooLong })
  })

  it("says when a conversation is too long for Claude to take at all, and doesn't offer Continue", async () => {
    const { brainstorm } = await setup({ status: 400, type: 'invalid_request_error', message: 'prompt is too long: 1000012 tokens > 1000000 maximum' })
    const id = createThread(db, null)
    const events = await ask(brainstorm, id, 'One more thing')
    expect(events.at(-2)).toEqual({ type: 'error', message: NOTICE.tooLong, canContinue: false })
  })

```

In `tests/server/brainstorm.test.ts`, replace:

```ts
  })

  it('estimates spend from every attempt the usage lists', async () => {
    const attempt = { cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    const { brainstorm } = await setup({
      content: [{ type: 'text', text: 'Here you go' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 2000,
        output_tokens: 300,
        iterations: [
          { ...attempt, type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 50 },
          { ...attempt, type: 'fallback_message', model: 'claude-opus-5', input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 500 },
        ],
      },
    })
    const id = createThread(db, null)
    await ask(brainstorm, id, 'Hi')
    // Per million tokens: (1000 + 2000) × $4 + (50 + 300) × $20 + 500 × $0.20. The top-level usage counts only the last attempt.
    expect(estimateCost(getMessages(db, id))).toBe(0.0191)
  })

```

with:

```ts
  })

  it('estimates spend from every attempt the usage lists, each at its own model\'s prices', async () => {
    const attempt = { cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    const fellBack = (declined: number): FakeReply => ({
      content: [{ type: 'text', text: 'Here you go' }],
      stop_reason: 'end_turn',
      model: 'claude-opus-5',
      usage: {
        input_tokens: 2000,
        output_tokens: 300,
        iterations: [
          { ...attempt, type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: declined },
          { ...attempt, type: 'fallback_message', model: 'claude-opus-5', input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 400 },
        ],
      },
    })
    const { brainstorm } = await setup(fellBack(50), fellBack(0))
    const partway = createThread(db, null)
    await ask(brainstorm, partway, 'Hi')
    // Per million tokens: Opus 5.5 declined partway, 1000 × $4 + 50 × $20; Opus 5 answered, 2000 × $5 + 300 × $25 +
    // 400 × $0.50. The top-level usage counts only the last attempt.
    expect(estimateCost(getMessages(db, partway))).toBe(0.0227)
    // Declined before it wrote anything: not billed.
    const before = createThread(db, null)
    await ask(brainstorm, before, 'Hi')
    expect(estimateCost(getMessages(db, before))).toBe(0.0177)
  })

```

In `tests/server/brainstorm.test.ts`, replace:

```ts
    expect(brainstorm.stop(id)).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

```

with:

```ts
    expect(brainstorm.stop(id)).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('keeps where another model took over when an answer is stopped', async () => {
    const { brainstorm, tools } = await setup({
      content: [
        { type: 'text', text: 'Elves love' },
        { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' },
        { type: 'text', text: 'Here is a safer take' },
      ],
      hang: true,
    })
    const id = createThread(db, null)
    const controller = new AbortController()
    let texts = 0
    await brainstorm.answer(
      id,
      'Go',
      (e) => {
        if (e.type === 'item' && e.item.kind === 'text') texts++
        else if (e.type === 'delta' && texts === 2) controller.abort()
      },
      controller.signal,
    )
    const stored = getMessages(db, id)[1]!
    expect(stored.content).toEqual([
      { type: 'text', text: 'Elves love' },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
      { type: 'text', text: 'Here is a safer take' },
    ])
    expect(stored.meta).toMatchObject({ model: 'claude-opus-5', stopReason: 'stopped' })
    // After a reload, the fallback line shows where it happened, rather than a note that another model answered.
    expect(chatItems(getMessages(db, id), tools.describe).slice(1)).toEqual<ChatItem[]>([
      { kind: 'text', text: 'Elves love' },
      { kind: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5' },
      { kind: 'text', text: 'Here is a safer take' },
      { kind: 'notice', tone: 'info', text: NOTICE.stopped },
    ])
  })

```

In `tests/server/brainstorm.test.ts`, replace:

```ts
  })

  it('estimates spend from recorded usage at Claude Opus 5.5 prices', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 2_000_000 }
    const messages = [{ ...message('assistant', [{ type: 'text', text: 'x' }], 'end_turn'), meta: { model: 'claude-opus-5-5', stopReason: 'end_turn', usage } }]
    // 4 + 2 + 1 + 0.4
    expect(estimateCost(messages as StoredMessage[])).toBe(7.4)
  })
})
```

with:

```ts
  })

  it("estimates spend from recorded usage at the prices of the model that wrote it", () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 2_000_000 }
    const by = (model: string) => [{ ...message('assistant', [{ type: 'text', text: 'x' }], 'end_turn'), meta: { model, stopReason: 'end_turn', usage } }]
    // Opus 5.5: 4 + 2 + 1 + 0.4
    expect(estimateCost(by('claude-opus-5-5') as StoredMessage[])).toBe(7.4)
    // Opus 5, after a fallback: 5 + 2.5 + 1.25 + 1; a model Binder doesn't know is priced the same.
    expect(estimateCost(by('claude-opus-5') as StoredMessage[])).toBe(9.75)
    expect(estimateCost(by('claude-opus-5-20261101') as StoredMessage[])).toBe(9.75)
    expect(estimateCost(by('claude-next') as StoredMessage[])).toBe(9.75)
  })
})
```

In `tests/server/ai-api.test.ts`, replace:

```ts
    expect((await app.request(`/api/ai/threads/${about.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/api/ai/threads/${about.id}`)).status).toBe(404)
  })

```

with:

```ts
    expect((await app.request(`/api/ai/threads/${about.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/api/ai/threads/${about.id}`)).status).toBe(404)
  })

  it("reuses a deck's conversation that nothing has been said in, rather than starting another", async () => {
    const { app } = await appWith()
    const burn = deck(db, 'Burn', 'built', 'modern')
    const elves = deck(db, 'Elves', 'built')
    const start = async (deckId: number | null) => {
      const res = await app.request('/api/ai/threads', json({ deckId }))
      return [res.status, (await body<ThreadSummary>(res)).id]
    }
    const [created, first] = await start(burn)
    expect(created).toBe(201)
    expect(await start(burn)).toEqual([200, first])
    // Another deck's, or none, is its own; and once something is said in it, the next start is a new one.
    const [, forElves] = await start(elves)
    expect(forElves).not.toBe(first)
    const [, plain] = await start(null)
    expect(await start(null)).toEqual([200, plain])
    appendMessages(db, first!, [{ role: 'user', content: [{ type: 'text', text: 'Faster?' }] }], 'Faster?')
    const [again, second] = await start(burn)
    expect([again, second === first]).toEqual([201, false])
    expect(new Set([first, forElves, plain, second]).size).toBe(4)
  })

```

In `tests/web/brainstorm.test.ts`, replace:

```ts
    answer = answerReducer(answer, event({ type: 'done' }))
    answer = answerReducer(answer, { type: 'end' })
    expect(answer).toEqual({ live: null, before: [], lastError: 'Anthropic refused the API key; check it in Settings', ended: false })
    expect(answerReducer(answer, { type: 'start', stored })).toEqual({ live: [], before: stored, lastError: null, ended: false })
    expect(asSentence('Anthropic refused the API key; check it in Settings')).toBe('Anthropic refused the API key; check it in Settings.')
    expect(asSentence('Stopped.')).toBe('Stopped.')
```

with:

```ts
    answer = answerReducer(answer, event({ type: 'done' }))
    answer = answerReducer(answer, { type: 'end' })
    expect(answer).toEqual({ live: null, before: [], lastError: 'Anthropic refused the API key; check it in Settings', ended: false, writing: false })
    expect(answerReducer(answer, { type: 'start', stored })).toEqual({ live: [], before: stored, lastError: null, ended: false, writing: false })
    expect(asSentence('Anthropic refused the API key; check it in Settings')).toBe('Anthropic refused the API key; check it in Settings.')
    expect(asSentence('Stopped.')).toBe('Stopped.')
```

In `tests/web/brainstorm.test.ts`, replace:

```ts
    expect(answer.ended).toBe(true)
    expect(awaitingClaude(answer)).toBe(false)
  })
})
```

with:

```ts
    expect(answer.ended).toBe(true)
    expect(awaitingClaude(answer)).toBe(false)
  })

  it('shows Claude is at work while it writes a tool call, until the call appears or the answer ends', () => {
    const user: ChatItem = { kind: 'user', text: 'Save it', deck: null }
    let answer = answerReducer(NO_ANSWER, { type: 'start', stored: [] })
    answer = answerReducer(answer, event({ type: 'item', item: user }))
    answer = answerReducer(answer, event({ type: 'item', item: { kind: 'text', text: '' } }))
    answer = answerReducer(answer, event({ type: 'delta', text: 'Saving it now.' }))
    expect(awaitingClaude(answer)).toBe(false)
    answer = answerReducer(answer, event({ type: 'working' }))
    expect([answer.writing, awaitingClaude(answer)]).toEqual([true, true])
    expect(answer.live).toEqual([user, { kind: 'text', text: 'Saving it now.' }])
    const tool: ChatItem = { kind: 'tool', id: 't', name: 'create_prospective_deck', activity: 'Saving Elves', state: 'running', error: null, deck: null }
    answer = answerReducer(answer, event({ type: 'item', item: tool }))
    expect([answer.writing, awaitingClaude(answer)]).toEqual([false, false])
    // Stopped or failed while writing: the answer is over.
    answer = answerReducer(answer, event({ type: 'working' }))
    answer = answerReducer(answer, event({ type: 'error', message: 'Anthropic had a problem (500); try again shortly', canContinue: true }))
    expect(answer.writing).toBe(false)
    answer = answerReducer(answer, event({ type: 'working' }))
    answer = answerReducer(answer, event({ type: 'done' }))
    expect([answer.writing, awaitingClaude(answer)]).toEqual([false, false])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/server/brainstorm.test.ts tests/server/ai-api.test.ts tests/web/brainstorm.test.ts`
Expected: FAIL: no `working` event yet, `NOTICE.tooLong` is undefined, costs are at Opus 5.5 prices, and a second start makes another conversation.

- [ ] **Step 3: Fix the server**

Prices per million tokens come from the Opus 5.5 guidance: Opus 5.5 $4 / $20, cache writes $5, reads $0.20;
Opus 5 and Opus 4.8 $5 / $25, $6.25, $0.50; Fable 5.1 $10 / $50, $12.50, $0.25. A model Binder doesn't know is priced
as Opus 5, the usual fallback. Each entry of `usage.iterations` names its model; one before the last with no output
is an attempt declined before it wrote anything, which isn't billed.

In `src/shared/types.ts`, replace:

```ts
  | { type: 'title'; title: string }
  | { type: 'tool_done'; id: string; state: 'done' | 'failed'; error: string | null; deck: CreatedDeck | null }
  /** The answer failed; with `canContinue`, Continue asks again. */
  | { type: 'error'; message: string; canContinue: boolean }
```

with:

```ts
  | { type: 'title'; title: string }
  | { type: 'tool_done'; id: string; state: 'done' | 'failed'; error: string | null; deck: CreatedDeck | null }
  /** Claude has started writing a tool call; its line appears once the call is written. */
  | { type: 'working' }
  /** The answer failed; with `canContinue`, Continue asks again. */
  | { type: 'error'; message: string; canContinue: boolean }
```

In `src/server/ai/client.ts`, replace:

```ts

/** A short explanation of an Anthropic API failure, for the key test and Claude's answers (spec §6). */
export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was refused'
```

with:

```ts

/** A short explanation of an Anthropic API failure, for the key test and Claude's answers (spec §6). */
/** Whether Anthropic refused a request because the conversation no longer fits Claude's context window. */
export function isPromptTooLong(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError) || err.status !== 400) return false
  const body = err.error as { error?: { message?: unknown } } | undefined
  return /prompt is too long/i.test(typeof body?.error?.message === 'string' ? body.error.message : err.message)
}

export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was refused'
```

In `src/server/ai/history.ts`, replace:

```ts
import { createdDeckFrom } from './tools.ts'

/** US dollars per million tokens at Claude Opus 5.5's prices: input, output, 5-minute cache writes, and cache reads. */
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }

export const NOTICE = {
  refusal: "Claude declined to answer this. Asking another way usually works; this part of the conversation won't be sent to Claude again.",
  cutOff: 'The answer was cut off because it got too long.',
  stopped: 'Stopped.',
  /** Shown live only: the garbled attempt isn't stored, so the conversation reloads without it. */
```

with:

```ts
import { createdDeckFrom } from './tools.ts'

/** US dollars per million tokens: input, output, 5-minute cache writes, and cache reads. */
interface Price {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/**
 * Each model's prices: Binder's, and those a refusal falls back to. Cache writes are 1.25 times input; reads are 0.05
 * times on Opus 5.5, 0.1 times on the others, and $0.25 on Fable 5.1.
 */
const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
}
/** A model Binder doesn't know is priced as Claude Opus 5, the usual fallback. */
const priceOf = (model: string | null | undefined): Price => PRICES[baseModel(model ?? AI_MODEL)] ?? PRICES['claude-opus-5']!

export const NOTICE = {
  refusal: "Claude declined to answer this. Asking another way usually works; this part of the conversation won't be sent to Claude again.",
  cutOff: 'The answer was cut off because it got too long.',
  tooLong: 'This conversation has grown too long for Claude. Start a new one to go on.',
  stopped: 'Stopped.',
  /** Shown live only: the garbled attempt isn't stored, so the conversation reloads without it. */
```

In `src/server/ai/history.ts`, replace:

```ts
/** Stop reasons that cut an answer off partway: its text is kept, and a tool call in it is never run. */
export const isCutOff = (stopReason: string | null | undefined) => stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded'

const isRefusal = (m: StoredMessage) => m.role === 'assistant' && m.meta?.stopReason === 'refusal'
```

with:

```ts
/** Stop reasons that cut an answer off partway: its text is kept, and a tool call in it is never run. */
export const isCutOff = (stopReason: string | null | undefined) => stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded'

/** The notice for an answer cut off: too long an answer, or a conversation grown too long for Claude's context window. */
export const cutOffNotice = (stopReason: string | null | undefined) =>
  stopReason === 'model_context_window_exceeded' ? NOTICE.tooLong : NOTICE.cutOff

const isRefusal = (m: StoredMessage) => m.role === 'assistant' && m.meta?.stopReason === 'refusal'
```

In `src/server/ai/history.ts`, replace:

```ts

/**
 * Estimated spend in US dollars, from each answer's recorded token usage. When the usage lists each attempt that went
 * into an answer (a refusal fallback's, say), those are added up: the top-level counts can leave some out.
 */
export function estimateCost(messages: readonly StoredMessage[]): number {
```

with:

```ts

/**
 * Estimated spend in US dollars, from each answer's recorded token usage, at the prices of the model that wrote it.
 * When the usage lists each attempt that went into an answer (a refusal fallback's, say), those are added up, each at
 * its own model's prices: the top-level counts can leave some out. An attempt declined before it wrote anything isn't
 * billed, so it's left out.
 */
export function estimateCost(messages: readonly StoredMessage[]): number {
```

In `src/server/ai/history.ts`, replace:

```ts
    const u = m.meta?.usage
    if (!u) continue
    for (const part of u.iterations?.length ? u.iterations : [u]) {
      usd +=
        (part.input_tokens * PRICE.input +
          part.output_tokens * PRICE.output +
          (part.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
          (part.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
        1_000_000
    }
```

with:

```ts
    const u = m.meta?.usage
    if (!u) continue
    const attempts = u.iterations?.length ? u.iterations : null
    for (const [i, part] of (attempts ?? [u]).entries()) {
      if (attempts && i < attempts.length - 1 && part.output_tokens === 0) continue
      const price = priceOf(attempts && 'model' in part && part.model ? part.model : m.meta?.model)
      usd +=
        (part.input_tokens * price.input +
          part.output_tokens * price.output +
          (part.cache_creation_input_tokens ?? 0) * price.cacheWrite +
          (part.cache_read_input_tokens ?? 0) * price.cacheRead) /
        1_000_000
    }
```

In `src/server/ai/history.ts`, replace:

```ts
    const stop = m.meta?.stopReason
    if (stop === 'refusal') items.push({ kind: 'notice', tone: 'error', text: NOTICE.refusal })
    else if (isCutOff(stop)) items.push({ kind: 'notice', tone: 'info', text: NOTICE.cutOff })
    else if (stop === 'stopped') items.push({ kind: 'notice', tone: 'info', text: NOTICE.stopped })
  }
```

with:

```ts
    const stop = m.meta?.stopReason
    if (stop === 'refusal') items.push({ kind: 'notice', tone: 'error', text: NOTICE.refusal })
    else if (isCutOff(stop)) items.push({ kind: 'notice', tone: 'info', text: cutOffNotice(stop) })
    else if (stop === 'stopped') items.push({ kind: 'notice', tone: 'info', text: NOTICE.stopped })
  }
```

In `src/server/ai/chat.ts`, replace:

```ts
import { deckDetail } from '../decks/analysis.ts'
import { ApiError } from '../http.ts'
import { AI_MODEL, describeAiError, type AiClient } from './client.ts'
import { canContinue, forReplay, isCutOff, NOTICE, replayMessages } from './history.ts'
import { deckContext, SYSTEM_PROMPT } from './prompt.ts'
import { appendMessages, getMessages, getThread, type ContentBlock, type MessageMeta } from './threads.ts'
```

with:

```ts
import { deckDetail } from '../decks/analysis.ts'
import { ApiError } from '../http.ts'
import { AI_MODEL, describeAiError, isPromptTooLong, type AiClient } from './client.ts'
import { canContinue, cutOffNotice, forReplay, isCutOff, NOTICE, replayMessages } from './history.ts'
import { deckContext, SYSTEM_PROMPT } from './prompt.ts'
import { appendMessages, getMessages, getThread, type ContentBlock, type MessageMeta } from './threads.ts'
```

In `src/server/ai/chat.ts`, replace:

```ts
  /** Stops the answer in progress; false when there is none. */
  stop(threadId: number): boolean
}

```

with:

```ts
  /** Stops the answer in progress; false when there is none. */
  stop(threadId: number): boolean
}

/**
 * What a stopped answer keeps: its text, each run of text blocks joined a paragraph apart, and the fallback blocks
 * between them, so the chat still shows where another model took over.
 */
export function keepStopped(said: ReadonlyArray<{ type: 'text'; text: string } | Extract<ContentBlock, { type: 'fallback' }>>): ContentBlock[] {
  const kept: ContentBlock[] = []
  let run: string[] = []
  const endRun = () => {
    if (run.length > 0) kept.push({ type: 'text', text: run.join('\n\n') })
    run = []
  }
  for (const block of said) {
    if (block.type === 'text') {
      if (block.text.trim() !== '') run.push(block.text.trim())
    } else {
      endRun()
      kept.push(block)
    }
  }
  endRun()
  return kept
}

```

In `src/server/ai/chat.ts`, replace:

```ts
        { signal },
      )
      const said: string[] = []
      // Whether the thinking block streaming now has shown a note: reasoning blocks stay empty, so only a note shows.
      let noted = false
```

with:

```ts
        { signal },
      )
      // What Claude has said so far, in order: its text, and where another model took over. Kept if the owner stops it.
      const said: Array<{ type: 'text'; text: string } | Extract<ContentBlock, { type: 'fallback' }>> = []
      // Whether the thinking block streaming now has shown a note: reasoning blocks stay empty, so only a note shows.
      let noted = false
```

In `src/server/ai/chat.ts`, replace:

```ts
            noted = false
            if (block.type === 'text') {
              said.push('')
              emit({ type: 'item', item: { kind: 'text', text: '' } })
            } else if (block.type === 'fallback') {
              emit({ type: 'item', item: { kind: 'fallback', from: block.from.model, to: block.to.model } })
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              said[said.length - 1] += event.delta.text
              emit({ type: 'delta', text: event.delta.text })
            } else if (event.delta.type === 'thinking_delta' && event.delta.thinking !== '') {
```

with:

```ts
            noted = false
            if (block.type === 'text') {
              said.push({ type: 'text', text: '' })
              emit({ type: 'item', item: { kind: 'text', text: '' } })
            } else if (block.type === 'fallback') {
              said.push({ type: 'fallback', from: block.from, to: block.to })
              emit({ type: 'item', item: { kind: 'fallback', from: block.from.model, to: block.to.model } })
            } else if (block.type === 'tool_use') {
              // Its line appears once the whole call is written, which can take a while (a deck's every card).
              emit({ type: 'working' })
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              const last = said.at(-1)
              if (last?.type === 'text') last.text += event.delta.text
              emit({ type: 'delta', text: event.delta.text })
            } else if (event.delta.type === 'thinking_delta' && event.delta.thinking !== '') {
```

In `src/server/ai/chat.ts`, replace:

```ts
      } catch (err) {
        if (signal.aborted) {
          // Keep what Claude said so far; a partly written tool call or reasoning can't be sent back, so they go.
          const text = said
            .map((part) => part.trim())
            .filter((part) => part !== '')
            .join('\n\n')
          if (text !== '') {
            // The model this request went to: after a refusal fallback, Anthropic may keep answering with another one.
            const meta: MessageMeta = { model: stream.currentMessage?.model ?? AI_MODEL, stopReason: 'stopped', usage: stream.currentMessage?.usage ?? null }
            appendMessages(db, threadId, [{ role: 'assistant', content: [{ type: 'text', text }], meta }], undefined, now())
          }
          emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.stopped } })
```

with:

```ts
      } catch (err) {
        if (signal.aborted) {
          // Keep what Claude said so far, and where another model took over; a partly written tool call or reasoning
          // can't be sent back, so they go.
          const content = keepStopped(said)
          if (content.some((b) => b.type === 'text')) {
            // The model this request went to: after a refusal fallback, Anthropic may keep answering with another one.
            const meta: MessageMeta = { model: stream.currentMessage?.model ?? AI_MODEL, stopReason: 'stopped', usage: stream.currentMessage?.usage ?? null }
            appendMessages(db, threadId, [{ role: 'assistant', content, meta }], undefined, now())
          }
          emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.stopped } })
```

In `src/server/ai/chat.ts`, replace:

```ts
        const kept = content.filter((b) => (cutOff ? b.type === 'text' : b.type !== 'tool_use'))
        if (worthKeeping(kept)) appendMessages(db, threadId, [{ role: 'assistant', content: kept, meta }], undefined, now())
        if (cutOff) emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: NOTICE.cutOff } })
        return
      }
```

with:

```ts
        const kept = content.filter((b) => (cutOff ? b.type === 'text' : b.type !== 'tool_use'))
        if (worthKeeping(kept)) appendMessages(db, threadId, [{ role: 'assistant', content: kept, meta }], undefined, now())
        if (cutOff) emit({ type: 'item', item: { kind: 'notice', tone: 'info', text: cutOffNotice(message.stop_reason) } })
        return
      }
```

In `src/server/ai/chat.ts`, replace:

```ts
        await run(client, threadId, emit, controller.signal)
      } catch (err) {
        const message = err instanceof Anthropic.AuthenticationError ? 'Anthropic refused the API key; check it in Settings' : describeAiError(err)
        emit({ type: 'error', message, canContinue: canContinue(getMessages(db, threadId)) })
      } finally {
        signal?.removeEventListener('abort', onAbort)
```

with:

```ts
        await run(client, threadId, emit, controller.signal)
      } catch (err) {
        // A conversation too long for Claude: asking again would only send it again.
        const tooLong = isPromptTooLong(err)
        const message =
          err instanceof Anthropic.AuthenticationError
            ? 'Anthropic refused the API key; check it in Settings'
            : tooLong
              ? NOTICE.tooLong
              : describeAiError(err)
        emit({ type: 'error', message, canContinue: !tooLong && canContinue(getMessages(db, threadId)) })
      } finally {
        signal?.removeEventListener('abort', onAbort)
```

In `src/server/ai/threads.ts`, replace:

```ts
}

/** Every conversation, the most recently active first. */
export function listThreads(db: DB): ThreadSummary[] {
```

with:

```ts
}

/**
 * Opens a conversation to start brainstorming (spec §5.5): the newest one about the same deck (or about none) that
 * nothing has been said in yet, or a new one. Clicking "Brainstorm with Claude" again, or twice, doesn't pile up empty
 * conversations. A reused one moves to the top of the list.
 */
export function startThread(db: DB, deckId: number | null, now = new Date()): { id: number; reused: boolean } {
  const empty = db
    .prepare(
      `SELECT id FROM ai_threads t WHERE t.deck_id IS ? AND NOT EXISTS (SELECT 1 FROM ai_messages m WHERE m.thread_id = t.id)
       ORDER BY t.id DESC LIMIT 1`,
    )
    .pluck()
    .get(deckId) as number | undefined
  if (empty === undefined) return { id: createThread(db, deckId, now), reused: false }
  db.prepare('UPDATE ai_threads SET updated_at = ? WHERE id = ?').run(now.toISOString(), empty)
  return { id: empty, reused: true }
}

/** Every conversation, the most recently active first. */
export function listThreads(db: DB): ThreadSummary[] {
```

In `src/server/ai/routes.ts`, replace:

```ts
import type { Brainstorm } from './chat.ts'
import { canContinue, chatItems, estimateCost } from './history.ts'
import { createThread, deleteThread, getMessages, getThread, listThreads, renameThread } from './threads.ts'
import type { BrainstormTools } from './tools.ts'

```

with:

```ts
import type { Brainstorm } from './chat.ts'
import { canContinue, chatItems, estimateCost } from './history.ts'
import { deleteThread, getMessages, getThread, listThreads, renameThread, startThread } from './threads.ts'
import type { BrainstormTools } from './tools.ts'

```

In `src/server/ai/routes.ts`, replace:

```ts
    const { deckId } = parseWith(CreateBody, await readJson(c.req))
    if (deckId !== null && !getDeckRow(db, deckId)) throw new ApiError(404, 'not_found', 'Deck not found')
    return c.json(getThread(db, createThread(db, deckId)), 201)
  })
  routes.get('/threads/:id', (c) => c.json(detail(threadId(c.req.param('id')))))
```

with:

```ts
    const { deckId } = parseWith(CreateBody, await readJson(c.req))
    if (deckId !== null && !getDeckRow(db, deckId)) throw new ApiError(404, 'not_found', 'Deck not found')
    const { id, reused } = startThread(db, deckId)
    return c.json(getThread(db, id), reused ? 200 : 201)
  })
  routes.get('/threads/:id', (c) => c.json(detail(threadId(c.req.param('id')))))
```

- [ ] **Step 4: Fix the page**

In `src/web/lib/brainstorm.ts`, replace:

```ts
      return [...items, { kind: 'notice', tone: 'error', text: event.message }]
    case 'title':
    case 'done':
      return [...items]
```

with:

```ts
      return [...items, { kind: 'notice', tone: 'error', text: event.message }]
    case 'title':
    case 'working':
    case 'done':
      return [...items]
```

In `src/web/lib/brainstorm.ts`, replace:

```ts
 * `before`, the conversation's items when it began. `lastError` is why the last answer failed: the server doesn't keep
 * a failure, so it stays here until the next answer starts. `ended`: the server has said the answer is over, and its
 * items stay on screen until the conversation is fetched again.
 */
export interface AnswerState {
```

with:

```ts
 * `before`, the conversation's items when it began. `lastError` is why the last answer failed: the server doesn't keep
 * a failure, so it stays here until the next answer starts. `ended`: the server has said the answer is over, and its
 * items stay on screen until the conversation is fetched again. `writing`: Claude is writing a tool call, whose line
 * appears only once it's written.
 */
export interface AnswerState {
```

In `src/web/lib/brainstorm.ts`, replace:

```ts
  lastError: string | null
  ended: boolean
}

export const NO_ANSWER: AnswerState = { live: null, before: [], lastError: null, ended: false }

export type AnswerAction = { type: 'start'; stored: readonly ChatItem[] } | { type: 'event'; event: ChatEvent } | { type: 'end' }
```

with:

```ts
  lastError: string | null
  ended: boolean
  writing: boolean
}

export const NO_ANSWER: AnswerState = { live: null, before: [], lastError: null, ended: false, writing: false }

export type AnswerAction = { type: 'start'; stored: readonly ChatItem[] } | { type: 'event'; event: ChatEvent } | { type: 'end' }
```

In `src/web/lib/brainstorm.ts`, replace:

```ts
  switch (action.type) {
    case 'start':
      return { live: [], before: action.stored, lastError: null, ended: false }
    case 'event': {
      const { event } = action
```

with:

```ts
  switch (action.type) {
    case 'start':
      return { live: [], before: action.stored, lastError: null, ended: false, writing: false }
    case 'event': {
      const { event } = action
```

In `src/web/lib/brainstorm.ts`, replace:

```ts
        lastError: event.type === 'error' ? event.message : state.lastError,
        ended: state.ended || event.type === 'done',
      }
    }
    case 'end':
      return { ...state, live: null, before: [], ended: false }
  }
}
```

with:

```ts
        lastError: event.type === 'error' ? event.message : state.lastError,
        ended: state.ended || event.type === 'done',
        // Until the next thing to show: the call's line, or whatever ends the answer.
        writing: event.type === 'working' || (state.writing && event.type !== 'item' && event.type !== 'error' && event.type !== 'done'),
      }
    }
    case 'end':
      return { ...state, live: null, before: [], ended: false, writing: false }
  }
}
```

In `src/web/lib/brainstorm.ts`, replace:

```ts

/**
 * Whether Claude is working with nothing to show for it: before its first word, after each round of tools, and after
 * a notice or a fallback line partway through (a garbled message asked again, another model carrying on). A notice
 * that closes an answer (Stopped., an error) comes just before the server's `done`, so an ended answer never waits.
 */
export function awaitingClaude({ live, ended }: Pick<AnswerState, 'live' | 'ended'>): boolean {
  if (live === null || ended) return false
  const last = live.at(-1)
  if (last === undefined || last.kind === 'user' || last.kind === 'notice' || last.kind === 'fallback') return true
```

with:

```ts

/**
 * Whether Claude is working with nothing to show for it: before its first word, while it writes a tool call, after
 * each round of tools, and after a notice or a fallback line partway through (a garbled message asked again, another
 * model carrying on). A notice that closes an answer (Stopped., an error) comes just before the server's `done`, so an
 * ended answer never waits.
 */
export function awaitingClaude({ live, ended, writing = false }: Pick<AnswerState, 'live' | 'ended'> & { writing?: boolean }): boolean {
  if (live === null || ended) return false
  if (writing) return true
  const last = live.at(-1)
  if (last === undefined || last.kind === 'user' || last.kind === 'notice' || last.kind === 'fallback') return true
```

In `src/web/lib/brainstorm.ts`, replace:

```ts
    send: (text: string) => run(`/api/ai/threads/${threadId}/messages`, { text }),
    resume: () => run(`/api/ai/threads/${threadId}/continue`),
    stop: () => void apiSend('POST', `/api/ai/threads/${threadId}/stop`).catch(() => controller.current?.abort()),
  }
}
```

with:

```ts
    send: (text: string) => run(`/api/ai/threads/${threadId}/messages`, { text }),
    resume: () => run(`/api/ai/threads/${threadId}/continue`),
    // A Stop that reaches the server before the answer has begun there finds nothing to stop; leaving the stream stops
    // it instead, as it does when the request fails.
    stop: () =>
      void apiSend<{ stopped: boolean }>('POST', `/api/ai/threads/${threadId}/stop`)
        .then(({ stopped }) => {
          if (!stopped) controller.current?.abort()
        })
        .catch(() => controller.current?.abort()),
  }
}
```

In `src/web/components/brainstorm/ChatView.tsx`, replace:

```tsx
  }, [])
  const last = items.at(-1)
  useLayoutEffect(() => {
    if (following.current) bottom.current?.scrollIntoView({ block: 'end' })
  }, [items.length, last && 'text' in last ? last.text.length : 0, thinking, answer.running])

```

with:

```tsx
  }, [])
  const last = items.at(-1)
  // On opening, bring the conversation into view (the window may be scrolled down a long list of conversations); after
  // that, follow only downward: with the end already in view, scrolling to it would pull the window back up.
  const shown = useRef(false)
  useLayoutEffect(() => {
    const end = bottom.current?.getBoundingClientRect().bottom
    if (end === undefined) return
    if (!shown.current || (following.current && end > window.innerHeight)) bottom.current!.scrollIntoView({ block: 'end' })
    shown.current = true
  }, [items.length, last && 'text' in last ? last.text.length : 0, thinking, answer.running])

```

- [ ] **Step 5: Run the brainstorm tests**

Run: `pnpm vitest run tests/server/brainstorm.test.ts tests/server/ai-api.test.ts tests/web/brainstorm.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: no type errors, all tests pass (794 tests), and the build succeeds.

---

### Task 5: End-to-end check on a copy of the real library, and docs

The real app on a `/tmp` copy of the owner's library, driven in headless Chrome:
- **Scanning.** Chrome's fake camera plays a feed of real card images through the real OCR helper:
  - Goblin Rabblemaster twice, with the bare mat between;
  - Ash, Party Crasher;
  - a 4th Edition Lightning Bolt, which comes back as "Check the printing".
- **Brainstorm.** Claude is played by a scripted local fake, so no key is needed and nothing reaches Anthropic.
- **The upgrade.** The copy is at migration 004, so its start also shows the pre-upgrade backup that the owner's next
  start makes before migration 005.
- **Console errors.** The check fails on any.

**Never touch `data/`** beyond the read-only copy command. Use ports 4455 (app) and 9444 (Chrome), not the owner's
4321.

**Files:**
- Scripts in `/tmp/binder-m7-e2e-scripts/` (not in the project; deleted at the end)
- Modify: `docs/specs/2026-09-26-binder-design.md` (§4.1, §5.1.1, §5.1.3, §5.4.2, §5.5, §5.6, §6, §8), `README.md`
- Modify: `docs/plans/m1-followups.md` to `m6-followups.md` (M7's items marked done; the rest become M8)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the scripts**

Create `/tmp/binder-m7-e2e-scripts/make-frames.swift`, which builds the fake camera's feed:

```swift
// Builds a Motion JPEG "camera feed" for Chrome's fake camera: the bare mat, a card placed in the Scan page's guide,
// the mat again, the next card, and so on, then a long stretch of bare mat so the loop doesn't start over while the
// check works. usage: make-frames <out.mjpeg> <card.jpg>...
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let out = args[1]
let cards = args.dropFirst(2).map { URL(fileURLWithPath: $0) }
let width = 1280, height = 960
let space = CGColorSpace(name: CGColorSpace.sRGB)!

func frame(_ card: CGImage?) -> Data {
  let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 0.22, green: 0.2, blue: 0.18, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
  if let card {
    // A little inside the Scan page's guide, which is card-shaped, centered, and 82% of the frame's height.
    let h = Double(height) * 0.8, w = h * 63 / 88
    ctx.draw(card, in: CGRect(x: (Double(width) - w) / 2, y: (Double(height) - h) / 2, width: w, height: h))
  }
  let data = NSMutableData()
  let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
  CGImageDestinationFinalize(dest)
  return data as Data
}

let empty = frame(nil)
var video = Data()
for url in cards {
  let source = CGImageSourceCreateWithURL(url as CFURL, nil)!
  let card = frame(CGImageSourceCreateImageAtIndex(source, 0, nil)!)
  // A second and a half of bare mat at 30 fps: long enough for auto mode to capture it (the card was lifted).
  for _ in 0..<45 { video.append(empty) }
  for _ in 0..<60 { video.append(card) }  // two seconds of the card
}
for _ in 0..<600 { video.append(empty) }  // twenty seconds of bare mat before the feed starts over
try video.write(to: URL(fileURLWithPath: out))
print("wrote \(video.count) bytes")
```

Create `/tmp/binder-m7-e2e-scripts/cdp.ts`, a minimal Chrome DevTools Protocol driver whose events reach `on`
handlers, and whose waits await promises:

```ts
// Minimal Chrome DevTools Protocol driver (Node 24 global WebSocket, no dependencies). Events go to `on` handlers.
import fs from 'node:fs'

export interface Page {
  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>
  on(method: string, handler: (params: any) => void): void
  eval<T = any>(expression: string): Promise<T>
  waitFor(expression: string, timeoutMs?: number): Promise<any>
  goto(url: string): Promise<void>
  click(selector: string): Promise<void>
  type(text: string): Promise<void>
  key(key: string, code?: string, keyCode?: number): Promise<void>
  shot(file: string): Promise<void>
  close(): Promise<void>
}

export async function openPage(port = 9444): Promise<Page> {
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string; id: string }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let nextId = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  const handlers = new Map<string, Array<(params: any) => void>>()
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${msg.error.message}`))
      else p.resolve(msg.result)
    } else if (msg.method) {
      for (const handler of handlers.get(msg.method) ?? []) handler(msg.params)
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
    on(method, handler) {
      handlers.set(method, [...(handlers.get(method) ?? []), handler])
    },
    eval: evaluate,
    async waitFor(expression, timeoutMs = 8000) {
      const start = Date.now()
      for (;;) {
        const v = await evaluate(`Promise.resolve(${expression}).then((v) => !!v)`).catch(() => undefined)
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

Create `/tmp/binder-m7-e2e-scripts/server.ts`. It is the app as `main.ts` builds it: the scan worker with the real OCR
helper, and backups. The AI client points at a fake Messages API that answers from the conversation so far:

```ts
// The M7 check's server: Binder's own app on a /tmp copy of the library, as main.ts builds it (the scan worker with the
// real OCR helper, backups), with Claude played by a scripted local fake (no key, no Anthropic call). Loads the
// project's modules and packages from BINDER_ROOT.
// Usage: BINDER_DATA_DIR=/tmp/binder-m7-e2e BINDER_ROOT=<project> node server.ts
import http from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

if (!process.env.BINDER_DATA_DIR?.startsWith('/tmp/')) throw new Error('BINDER_DATA_DIR must be a /tmp copy')
const ROOT = process.env.BINDER_ROOT ?? '/Users/kasonsuchow/Documents/localdev/binder'
const packages = createRequire(`${ROOT}/package.json`)
const load = (spec: string) => import(pathToFileURL(packages.resolve(spec)).href)
const source = (file: string) => import(pathToFileURL(`${ROOT}/src/server/${file}`).href)
const { serve } = await load('@hono/node-server')
// The SDK's ES-module build, as the app loads it, so its error classes are the app's.
const Anthropic = (await import(pathToFileURL(path.join(path.dirname(packages.resolve('@anthropic-ai/sdk')), 'index.mjs')).href)).default
const { createAiClient } = await source('ai/client.ts')
const { createApp } = await source('app.ts')
const { BACKUP_DIR, DB_PATH, OCR_BINARY, OCR_SOURCE, SCANS_DIR, WEB_DIST_DIR } = await source('config.ts')
const { openLibrary } = await source('db/index.ts')
const { createCardLookups } = await source('scanner/lookups.ts')
const { buildOcrHelper, createOcrClient } = await source('scanner/ocr-client.ts')
const { createScanWorker } = await source('scanner/worker.ts')
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
    const data = JSON.parse(String(results[0]!.content))
    return { blocks: [{ type: 'text', text: `Saved **${data.name}**: ${data.cards} cards, ${data.completion_percent}% of them yours already.` }], stop: 'end_turn' }
  }
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  if (/^Filler/.test(text)) return { blocks: [{ type: 'text', text: 'Noted.' }], stop: 'end_turn' }
  if (/slowly/i.test(text)) return { blocks: [{ type: 'text', text: 'Let me think about this at length. '.repeat(40) }], stop: 'end_turn', slow: true }
  // Saving a deck: a short sentence, then the whole deck written into the tool call, which takes a while.
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
          cards: [
            { name: 'Llanowar Elves', quantity: 1, category: 'Ramp' },
            { name: 'Elvish Mystic', quantity: 1, category: 'Ramp' },
            { name: 'Sol Ring', quantity: 1, category: 'Ramp' },
            { name: 'Craterhoof Behemoth', quantity: 1, category: 'Finisher' },
          ],
        },
      },
    ],
    stop: 'tool_use',
  }
}

const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    requests++
    const { blocks, stop, slow } = plan(JSON.parse(raw))
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
      } else {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } })
        // Written slowly, as a long deck is: the page should say Claude is still at work meanwhile.
        for (const part of JSON.stringify(block.input).match(/[\s\S]{1,10}/g) ?? []) {
          send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: part } })
          await sleep(100)
          if (closed) return
        }
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
// Opened as the server does: the copy is at migration 004, so 005 runs after a pre-upgrade backup.
const db = openLibrary(DB_PATH, BACKUP_DIR)
const ocr = createOcrClient({
  command: [OCR_BINARY],
  prepare: async () => {
    if (await buildOcrHelper(OCR_SOURCE, OCR_BINARY)) console.log('[scan] Built the OCR helper')
  },
})
const worker = createScanWorker({ db, scansDir: SCANS_DIR, ocr, lookups: createCardLookups(db) })
worker.recover()
const app = createApp({
  db,
  bulk: { status: () => ({ state: 'idle', processed: 0, error: null, updatedAt: null, sourceUpdatedAt: null, cardCount: 0 }), isStale: () => false, start: () => Promise.resolve() },
  scryfall: createScryfallClient(),
  ai,
  scanner: { scansDir: SCANS_DIR, worker },
  backupDir: BACKUP_DIR,
  webDistDir: WEB_DIST_DIR,
})
serve({ fetch: app.fetch, port: 4455, hostname: '127.0.0.1' }, () => console.log(`e2e server on 4455 (db ${DB_PATH}, fake Claude ${fakeUrl})`))
```

Create `/tmp/binder-m7-e2e-scripts/check.ts`:

```ts
// Drives M7's changes in headless Chrome (DevTools on 9444) against server.ts on 4455, with Chrome's fake camera
// playing make-frames' feed (Goblin Rabblemaster, the same again, Ash, Party Crasher, and a 4th Edition Lightning
// Bolt, each after bare mat): scanning into a deck, Back up now, and Brainstorm's fixes. It fails on any console error.
// Usage: node check.ts <screenshots dir> <card images dir>
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { openPage } from './cdp.ts'

const B = 'http://localhost:4455'
const SHOTS = process.argv[2]!
const CARDS = process.argv[3]!
const api = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${B}${path}`, init)
  return res.status === 204 ? null : res.json()
}
const post = (path: string, body: unknown) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (path: string, body: unknown) => api(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const items = async () => (await api('/api/scan/items')).items as any[]
const settled = async () => (await items()).filter((i) => i.status !== 'queued' && i.status !== 'identifying')

const page = await openPage()
const errors: string[] = []
await page.send('Log.enable')
page.on('Log.entryAdded', ({ entry }) => {
  if (entry.level === 'error') errors.push(`log: ${entry.text} ${entry.url ?? ''}`)
  else if (entry.level === 'warning') console.log(`warning: ${entry.text}`)
})
page.on('Runtime.consoleAPICalled', ({ type, args }) => {
  const text = args.map((a: any) => a.value ?? a.description).join(' ')
  if (type === 'error' || type === 'assert') errors.push(`console.${type}: ${text}`)
  else if (type === 'warning') console.log(`warning: ${text}`)
})
page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => errors.push(`exception: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`))

const button = (text: string) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`
const rows = `[...document.querySelectorAll('section[aria-label="Scans"] li')]`
const row = (name: string) => `${rows}.find((li) => li.textContent.includes(${JSON.stringify(name)}))`
const choose = (selector: string, value: string) =>
  page.eval(`(() => { const s = document.querySelector(${JSON.stringify(selector)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
const bodyText = (text: string) => `document.body.textContent.includes(${JSON.stringify(text)})`

// 1. A deck planned before it was built: one Goblin Rabblemaster listed. Its editor opens the Scan page for it.
const goblins = await post('/api/decks', { name: 'Goblins', format: 'modern', status: 'built' })
const rabblemaster = await api('/api/cards/named?name=Goblin%20Rabblemaster')
await post(`/api/decks/${goblins.id}/cards`, { cardId: rabblemaster.cardId, board: 'main', delta: 1 })
await page.goto(`${B}/decks/${goblins.id}`)
await page.eval(`${button('Scan cards into this deck')}.click()`)
await page.waitFor(`location.pathname === '/scan' && location.search === '' && document.querySelector('select[aria-label="Scanning into"]')?.value === '${goblins.id}'`)
await page.waitFor(`${button('Capture')} && !${button('Capture')}.disabled`, 15000)
await page.shot(`${SHOTS}/1-scanning-into.png`)

// 2. Auto mode catches each card once it holds still; the bare mat between is dropped.
await page.eval(`${button('Auto')}.click()`)
await page.waitFor(`fetch('/api/scan/items').then((r) => r.json()).then((q) => q.items.filter((i) => i.status === 'confident' || i.status === 'review').length >= 4)`, 40000)
await page.eval(`${button('Manual')}.click()`)
let list = await settled()
console.log('queue:', list.map((i) => [i.status, i.reason, i.card?.name, i.card?.setCode, i.target?.deckName, i.target?.board, i.sameCardAsBefore]))
assert.deepEqual(list.map((i) => i.card?.name), ['Goblin Rabblemaster', 'Goblin Rabblemaster', 'Ash, Party Crasher', 'Lightning Bolt'])
assert.deepEqual(list.map((i) => i.status), ['confident', 'confident', 'confident', 'review'])
assert.ok(list.every((i) => i.target?.deckId === goblins.id && i.target.board === 'main'), 'every scan goes to Goblins')
// The mat between the two Rabblemasters says the card was lifted: the second is another copy, not a double capture.
assert.ok(list.every((i) => !i.sameCardAsBefore), 'no scan is marked as a double capture')
await page.waitFor(`${rows}.filter((li) => li.textContent.includes('For Goblins · Main')).length >= 4 && ${bodyText('Check the printing')}`)
await page.waitFor(`!${bodyText('Same card as the scan before it')}`)
await page.shot(`${SHOTS}/2-queue.png`)

// 3. Ash goes to the sideboard instead. The old Bolt can't be told from its reprints: pick its 4th Edition printing.
await page.eval(`[...${row('Ash, Party Crasher')}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Change').click()`)
await page.waitFor(`document.querySelector('select[aria-label="Deck for Ash, Party Crasher: board"]')`)
await choose('select[aria-label="Deck for Ash, Party Crasher: board"]', 'side')
await page.waitFor(`fetch('/api/scan/items').then((r) => r.json()).then((q) => q.items.find((i) => i.card?.name === 'Ash, Party Crasher').target.board === 'side')`)
await page.waitFor(`${row('Ash, Party Crasher')}.textContent.includes('For Goblins · Sideboard')`)
await page.waitFor(`[...document.querySelector('select[aria-label="Printing of Lightning Bolt"]').options].some((o) => o.textContent.startsWith('4ED'))`)
const fourth = await page.eval(`[...document.querySelector('select[aria-label="Printing of Lightning Bolt"]').options].find((o) => o.textContent.startsWith('4ED')).value`)
await choose('select[aria-label="Printing of Lightning Bolt"]', fourth)
await page.waitFor(`${row('Lightning Bolt')}.textContent.includes('Ready · picked')`)
await page.waitFor(`${button('Add 4 cards (4 also to Goblins)')}`)

// 4. Add: the collection gets all four; the deck's listed Rabblemaster is filled first, the second goes beyond it.
await page.eval(`${button('Add 4 cards (4 also to Goblins)')}.click()`)
await page.waitFor(bodyText('Added 4 cards to your collection, with 4 for Goblins.'))
await page.shot(`${SHOTS}/3-added.png`)
const deck = await api(`/api/decks/${goblins.id}`)
const lines = deck.lines.map((l: any) => [l.name, l.board, l.quantity]).sort()
console.log('Goblins:', lines)
assert.deepEqual(lines, [
  ['Ash, Party Crasher', 'side', 1],
  ['Goblin Rabblemaster', 'main', 2],
  ['Lightning Bolt', 'main', 1],
])
// A new line shows the printing scanned; the Rabblemaster line keeps the one it was planned with.
assert.equal(deck.lines.find((l: any) => l.name === 'Lightning Bolt').cardId, fourth)
assert.equal(deck.lines.find((l: any) => l.name === 'Goblin Rabblemaster').cardId, rabblemaster.cardId)
assert.equal(deck.completion, 1)
assert.deepEqual(await items(), [])

// 5. A new built deck from the Scan page, and auto-commit adding to it, announced on the page.
await choose('select[aria-label="Scanning into"]', 'new')
await page.click('input[aria-label="New deck\'s name"]')
await page.type('Scanned Elves')
await page.eval(`${button('Create built deck')}.click()`)
const elves = await (async () => {
  for (let i = 0; i < 50; i++) {
    const found = ((await api('/api/decks')) as any[]).find((d) => d.name === 'Scanned Elves')
    if (found) return found
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('the new deck was not made')
})()
assert.equal(elves.status, 'built')
await page.waitFor(`document.querySelector('select[aria-label="Scanning into"]').value === '${elves.id}'`)
await patch('/api/settings', { scanAutoCommit: true })
const shiko = fs.readFileSync(`${CARDS}/tdm-223.jpg`)
await api(`/api/scan?deck=${elves.id}&board=main`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: shiko })
await page.waitFor(bodyText('Added Shiko, Paragon of the Way to your collection, for Scanned Elves.'), 20000)
await page.shot(`${SHOTS}/4-auto-added.png`)
assert.deepEqual((await api(`/api/decks/${elves.id}`)).lines.map((l: any) => [l.name, l.quantity]), [['Shiko, Paragon of the Way', 1]])
await patch('/api/settings', { scanAutoCommit: false })

// 6. Settings → Backups: Back up now.
await page.goto(`${B}/settings`)
await page.waitFor(`${button('Back up now')} && ${bodyText('Last backup')}`)
await page.eval(`${button('Back up now')}.click()`)
await page.waitFor(`/Saved binder-\\d{4}-\\d{2}-\\d{2}(-\\d+)?\\.db\\./.test(document.body.textContent)`, 20000)
const backups = await api('/api/settings/backups')
console.log('backups:', backups)
await page.waitFor(`!${bodyText('Last backupnever')}`)
await page.eval(`[...document.querySelectorAll('h2')].find((h) => h.textContent === 'Backups').scrollIntoView({ block: 'center' })`)
await page.shot(`${SHOTS}/5-backups.png`)

// 7. Brainstorm: "Thinking…" while Claude writes out a deck to save.
const thread = await post('/api/ai/threads', { deckId: null })
await page.goto(`${B}/brainstorm/${thread.id}`)
await page.click('textarea[aria-label="Message"]')
await page.type('Please save that as a deck')
await page.key('Enter')
await page.waitFor(bodyText('Saving it now.'))
await page.waitFor(`${bodyText('Thinking…')} && !${bodyText('Saving Green Stompy')}`, 3000)
await page.shot(`${SHOTS}/6-writing-a-deck.png`)
await page.waitFor(`${bodyText('Open in deckbuilder')} && !${bodyText('Thinking…')}`, 20000)

// 8. A long list of conversations: opening one from low in the list brings it into view, and while an answer streams
// the page can still be scrolled down.
for (let i = 1; i <= 45; i++) {
  const t = await post('/api/ai/threads', { deckId: null })
  await fetch(`${B}/api/ai/threads/${t.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `Filler ${i}` }) }).then((r) => r.text())
}
await page.goto(`${B}/brainstorm`)
await page.waitFor(`[...document.querySelectorAll('nav[aria-label="Conversations"] a')].some((a) => a.textContent.trim() === 'Filler 1')`)
await page.eval(`window.scrollTo(0, document.body.scrollHeight)`)
assert.ok((await page.eval(`scrollY`)) > 500, 'the list of conversations is longer than the window')
await page.eval(`[...document.querySelectorAll('nav[aria-label="Conversations"] a')].find((a) => a.textContent.trim() === 'Filler 1').click()`)
await page.waitFor(`(() => { const r = document.querySelector('section[aria-label="Conversation"]')?.getBoundingClientRect(); return r && r.top < innerHeight && r.bottom > 0 && document.body.textContent.includes('Noted.') })()`)
await page.shot(`${SHOTS}/7-opened-from-low.png`)
await page.click('textarea[aria-label="Message"]')
await page.type('Answer slowly please')
await page.key('Enter')
await page.waitFor(bodyText('Let me think about this'))
await page.eval(`window.scrollTo(0, document.body.scrollHeight)`)
const down = await page.eval(`scrollY`)
await new Promise((r) => setTimeout(r, 1000))
const stillDown = await page.eval(`scrollY`)
console.log('scroll while streaming:', { down, stillDown })
assert.ok(down > 0 && stillDown >= down - 5, 'the page stays scrolled down while the answer streams')
await page.eval(`${button('Stop')}.click()`)
await page.waitFor(bodyText('Stopped.'))

// 9. Leaving the page mid-answer stops Claude.
const leave = await post('/api/ai/threads', { deckId: null })
await page.goto(`${B}/brainstorm/${leave.id}`)
await page.click('textarea[aria-label="Message"]')
await page.type('Answer slowly please')
await page.key('Enter')
await page.waitFor(bodyText('Let me think about this'))
await page.eval(`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Decks').click()`)
await page.waitFor(`fetch('/api/ai/threads/${leave.id}').then((r) => r.json()).then((t) => !t.busy && t.items.at(-1)?.text === 'Stopped.')`, 10000)
console.log(`leaving stopped the answer in conversation ${leave.id}`)

await page.close()
if (errors.length > 0) {
  console.log('console errors:\n' + errors.join('\n'))
  console.log('FAILED')
  process.exit(1)
}
console.log('e2e check passed')
```

- [ ] **Step 2: Copy the library, fetch the card images, and build the feed**

```bash
mkdir -p /tmp/binder-m7-e2e/shots /tmp/binder-m7-e2e-scripts/cards
sqlite3 -readonly data/binder.db ".backup /tmp/binder-m7-e2e/binder.db"
sqlite3 /tmp/binder-m7-e2e/binder.db "select group_concat(version) from schema_migrations"   # 1,2,3,4
cd /tmp/binder-m7-e2e-scripts/cards
for card in m15/145 woe/201 tdm/223 4ed/208; do
  curl -sL -A 'Binder/0.1 (personal)' -o "${card/\//-}.jpg" "https://api.scryfall.com/cards/$card?format=image&version=large"
  sleep 0.2
done
cd ..
swiftc -O make-frames.swift -o make-frames
./make-frames feed.mjpeg cards/m15-145.jpg cards/m15-145.jpg cards/woe-201.jpg cards/4ed-208.jpg
```
Record the migration versions in the report. The feed is about 79 MB: 34 seconds at 30 frames a second, looping.
Each card follows 1.5 seconds of bare mat, long enough for auto mode to capture the mat, which the server drops. The
feed ends with 20 seconds of mat, so the loop doesn't start over while the check works.

- [ ] **Step 3: Build, then start the server and Chrome**

```bash
pnpm build
(cd /tmp/binder-m7-e2e-scripts && BINDER_DATA_DIR=/tmp/binder-m7-e2e BINDER_ROOT=/Users/kasonsuchow/Documents/localdev/binder nohup node server.ts > /tmp/binder-m7-e2e/server.log 2>&1 & echo $! > /tmp/binder-m7-e2e/server.pid)
```

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9444 \
  --user-data-dir=/tmp/binder-m7-e2e/chrome --no-first-run --no-default-browser-check --window-size=1400,1000 \
  --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
  --use-file-for-fake-video-capture=/tmp/binder-m7-e2e-scripts/feed.mjpeg --autoplay-policy=no-user-gesture-required \
  about:blank > /tmp/binder-m7-e2e/chrome.log 2>&1 & echo $! > /tmp/binder-m7-e2e/chrome.pid
```
Wait until `curl -s http://127.0.0.1:4455/api/health` and `curl -s http://127.0.0.1:9444/json/version` both answer.

`server.log` must show "Backing up the database before upgrading it…", then
"Saved /tmp/binder-m7-e2e/backups/binder-YYYY-MM-DD-before-005.db before upgrading the database", then the server
line. Check the versions:
- `sqlite3 /tmp/binder-m7-e2e/backups/binder-*-before-005.db "select group_concat(version) from schema_migrations"`
  gives `1,2,3,4`;
- the same query on `/tmp/binder-m7-e2e/binder.db` gives `1,2,3,4,5`.

- [ ] **Step 4: Drive the pages**

Run: `node /tmp/binder-m7-e2e-scripts/check.ts /tmp/binder-m7-e2e/shots /tmp/binder-m7-e2e-scripts/cards | tee /tmp/binder-m7-e2e/check.log`

Expected output, ending in `e2e check passed`:
- **`queue:`** the two Goblin Rabblemasters and Ash, Party Crasher are `confident`. The Lightning Bolt is `review` for
  its `printing`. Every scan goes to Goblins, main, and none is marked as the same card as the scan before it.
- **`Goblins:`** Ash, Party Crasher, side, 1; Goblin Rabblemaster, main, 2 (the one listed, filled, and one beyond
  it); Lightning Bolt, main, 1.
- **`backups:`** a `lastBackupAt` from the run, and the `/tmp` folder.
- **`scroll while streaming:`** equal numbers, both above 0.
- **`leaving stopped the answer in conversation N`.**

Look at the seven screenshots and describe them in the report:
1. the Scan page opened from the deck, "Scanning into" Goblins;
2. the queue: four rows each "For Goblins · Main", the Bolt "Check the printing" with **Looks right** and
   **Different card…**, and the button "Add 3 cards (3 also to Goblins)";
3. after Add, the toast "Added 4 cards to your collection, with 4 for Goblins.";
4. "Scanning into" Scanned Elves, and the auto-commit toast for Shiko;
5. Settings → Backups after **Back up now**;
6. "Saving it now." with "Thinking…" under it while the deck is written;
7. Filler 1 in view after being opened from the bottom of a long list of conversations.

- [ ] **Step 5: Stop everything**

```bash
kill $(cat /tmp/binder-m7-e2e/server.pid) $(cat /tmp/binder-m7-e2e/chrome.pid)
```
Confirm that:
- nothing listens on 4321, 4400, 4455, 5173, 9333 or 9444;
- `pgrep -f remote-debugging-port=9444` and `pgrep -f bin/ocr` print nothing;
- `ls -la data/` shows `binder.db` and `binder.db-wal` with the dates they had before (only `binder.db-shm`'s changes,
  from the read-only copy).

Copy the screenshots, `server.log`, and `check.log` from `/tmp/binder-m7-e2e` to wherever your brief asks for evidence.
Then `rm -rf /tmp/binder-m7-e2e /tmp/binder-m7-e2e-scripts`.

- [ ] **Step 6: Update the docs**

The spec describes M7 as built:
- scanning into a deck and the fill rule;
- the same-card mark's new reach;
- auto-commit's announcement;
- Back up now and its naming;
- the Brainstorm changes;
- the milestones: M7 is "Deck scanning and polish", and the rest becomes M8.

The README explains scanning a deck and Back up now. The follow-up files mark what M7 did, and their "M7 (polish)"
sections become "M8 (polish)".

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
**`deck_cards`**: `id`, `deck_id` FK (cascade), `oracle_id`, `preferred_card_id` (nullable FK→cards.id, used for the image and price display), `quantity`, `board` (`commander`/`main`/`side`/`maybe`), `category` (nullable free text). UNIQUE(`deck_id`, `oracle_id`, `board`).

**`scan_items`**: `id`, `image_path`, `status` (`queued`/`identifying`/`confident`/`review`/`committed`/`discarded`), `method` (`ocr`/`manual`; the schema also allows `claude`, unused since scanning is on-device only), `ocr_json`, `candidates` (JSON array of `{card_id, score}`), `card_id` (chosen), `finish`, `quantity` (default 1), `confidence` REAL, `error`, `created_at`, `updated_at`, `reason` (why a `review` scan needs a look: `printing` or `unsure`), `auto` (1 for auto-mode captures).

**`ai_threads`**: `id`, `title` (empty until the first message names it), `deck_id` (nullable; a deleted deck unlinks it), `created_at`, `updated_at`.
```

with:

```markdown
**`deck_cards`**: `id`, `deck_id` FK (cascade), `oracle_id`, `preferred_card_id` (nullable FK→cards.id, used for the image and price display), `quantity`, `board` (`commander`/`main`/`side`/`maybe`), `category` (nullable free text). UNIQUE(`deck_id`, `oracle_id`, `board`).

**`scan_items`**: `id`, `image_path`, `status` (`queued`/`identifying`/`confident`/`review`/`committed`/`discarded`), `method` (`ocr`/`manual`; the schema also allows `claude`, unused since scanning is on-device only), `ocr_json`, `candidates` (JSON array of `{card_id, score}`), `card_id` (chosen), `finish`, `quantity` (default 1), `confidence` REAL, `error`, `created_at`, `updated_at`, `reason` (why a `review` scan needs a look: `printing` or `unsure`), `auto` (1 for auto-mode captures), `deck_id` (nullable FK→decks; the deck it goes to besides the collection, set null when that deck is deleted) and `board` (`commander`/`main`/`side`), `auto_committed` (1 when auto-commit added it). Migrations 003 and 005 added the last five.

**`ai_threads`**: `id`, `title` (empty until the first message names it), `deck_id` (nullable; a deleted deck unlinks it), `created_at`, `updated_at`.
```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
**5.1.1 Capture (browser)**
- A camera picker lists `enumerateDevices()` video inputs, and the choice is remembered in `localStorage`. The iPhone appears as "<name> Camera" once Continuity Camera is active. The page shows a short help note if no such device is found.
- Live `<video>` preview with a card-shaped guide overlay (63:88 aspect ratio). Capture crops the guide region, plus an 8% margin on each side so a card placed a little off the guide stays whole, from the full-resolution frame, encodes JPEG at quality 0.92, and POSTs it to `/api/scan` (with `?auto=1` from auto mode).
- **Manual mode**: Space or a button captures.
- **Auto mode**: the page samples the frame every 150 ms at low resolution and computes the mean absolute pixel difference. It captures after the frame has been stable for 600 ms following a change larger than the threshold, then disarms until the next large change (card removed or swapped). Captures give audio and visual feedback.
```

with:

```markdown
**5.1.1 Capture (browser)**
- A camera picker lists `enumerateDevices()` video inputs, and the choice is remembered in `localStorage`. The iPhone appears as "<name> Camera" once Continuity Camera is active. The page shows a short help note if no such device is found.
- Live `<video>` preview with a card-shaped guide overlay (63:88 aspect ratio). Capture crops the guide region, plus an 8% margin on each side so a card placed a little off the guide stays whole, from the full-resolution frame, encodes JPEG at quality 0.92, and POSTs it to `/api/scan` (with `?auto=1` from auto mode, and `deck` and `board` when scanning into a deck, §5.1.3).
- **Manual mode**: Space or a button captures.
- **Auto mode**: the page samples the frame every 150 ms at low resolution and computes the mean absolute pixel difference. It captures after the frame has been stable for 600 ms following a change larger than the threshold, then disarms until the next large change (card removed or swapped). Captures give audio and visual feedback.
```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
Each row shows the captured thumbnail next to the Scryfall image, the name, set and number, a confidence badge, a printing dropdown (all printings of that oracle card, newest first, with set name and number), a finish toggle (options limited to the printing's `finishes`, default from settings, preset to foil when the foil star was read: `★`, which on-device OCR reads as `*`), a quantity stepper, and a discard button.

- A `review` row with a card offers **Looks right**, which accepts it as it is. A "Check the printing" row also offers **Different card…**, and a "Not sure" row lists its candidates; both give a search box to pick any card by hand.
- A row whose OCR failed shows the error and **Try again**, which reads it again.
- An auto-mode capture of the same printing as the auto-mode capture just before it is marked: "Same card as the scan before it. Discard it if the camera caught one card twice." A hand reaching in, or a nudge to straighten the card, can make auto mode capture one card twice.
- **Commit** ("Add N cards to collection") adds the ready rows the button counted: the `confident` rows, including `review` rows I've confirmed. A row that became ready after the count waits for the next commit. It upserts into `collection`, incrementing quantity, sets the rows to `committed`, and deletes their images.
- The `scan_auto_commit` setting (default off) commits a manual capture as soon as it's `confident`. Auto-mode captures always wait in the queue, so a double capture is never committed unseen.
- Discarding also deletes the image.

```

with:

```markdown
Each row shows the captured thumbnail next to the Scryfall image, the name, set and number, a confidence badge, a printing dropdown (all printings of that oracle card, newest first, with set name and number), a finish toggle (options limited to the printing's `finishes`, default from settings, preset to foil when the foil star was read: `★`, which on-device OCR reads as `*`), a quantity stepper, and a discard button.

- **Scanning into a deck.** Above the camera, "Scanning into" chooses where captures go besides the collection: the collection only, one of my decks and a board (Main, Sideboard, or Commander for a commander deck), or **New deck…**, which creates a built deck (its cards are in hand). The choice is remembered like the camera; a deck's **Scan cards into this deck** opens the page with that deck chosen. Each scan keeps the deck it was captured for, and its row says so ("For Elf Ball · Main", with **Change** to move that one scan), so switching decks never moves scans already taken. A capture for a deck deleted meanwhile goes to the collection only.
- A `review` row with a card offers **Looks right**, which accepts it as it is. A "Check the printing" row also offers **Different card…**, and a "Not sure" row lists its candidates; both give a search box to pick any card by hand.
- A row whose OCR failed shows the error and **Try again**, which reads it again.
- An auto-mode capture of the same printing as the scan before it, itself an auto-mode capture (still in the queue or already added) taken within a minute, is marked: "Same card as the scan before it. Discard it if the camera caught one card twice." A hand reaching in, or a nudge to straighten the card, can make auto mode capture one card twice. Scans I discarded are skipped, but a bare-mat capture between the two (dropped, §5.1.2) means the card was lifted: the next copy of the same card, as when scanning a deck's four, isn't marked.
- **Commit** ("Add N cards to collection", or "Add N cards (M also to Elf Ball)") adds the ready rows the button counted: the `confident` rows, including `review` rows I've confirmed. A row that became ready after the count waits for the next commit. It upserts into `collection`, incrementing quantity, sets the rows to `committed`, and deletes their images. A scan with a deck also goes to that deck, in the same transaction: its copies first fill the copies of that card the deck lists on that board that earlier scans into it haven't (so scanning a deck planned first doesn't list its cards twice), and only the copies beyond those are added to the line; a new line shows the printing scanned. The toast says how many went to each deck.
- The `scan_auto_commit` setting (default off) commits a manual capture as soon as it's `confident`, to its deck too. Auto-mode captures always wait in the queue, so a double capture is never committed unseen. While the Scan page is open it says what auto-commit added (the queue lists what it added in the last minute) and refreshes the collection and decks.
- Discarding also deletes the image.

```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
- **Left: search.** Scope toggle (All cards / My library), local name autocomplete (FTS), and a results list with "+" buttons that add to the selected board. Search results show owned/free badges.
- **Right: deck.** Grouped by board, then by type (Creature, Planeswalker, Instant, Sorcery, Artifact, Enchantment, Battle, Land) or by category (toggle). Each line has: quantity stepper, name (hover shows the image), mana cost, status icon (✅ owned / ⚠️ in another built deck / 🛒 buy), price, and a menu (move board, set category, choose printing, remove).
- **Header**: name, format, status toggle, card count per board, cost to finish, warnings count.
- **Panels**: Deck health (format warnings), Mana curve (bar chart of main-board nonland mana values), Type counts.
- **Buy list tab**: table of short lines (quantity, name, cheapest price, link) and total. "Copy as text" (`4 Lightning Bolt` per line). A toggle to ignore basics.
```

with:

```markdown
- **Left: search.** Scope toggle (All cards / My library), local name autocomplete (FTS), and a results list with "+" buttons that add to the selected board. Search results show owned/free badges.
- **Right: deck.** Grouped by board, then by type (Creature, Planeswalker, Instant, Sorcery, Artifact, Enchantment, Battle, Land) or by category (toggle). Each line has: quantity stepper, name (hover shows the image), mana cost, status icon (✅ owned / ⚠️ in another built deck / 🛒 buy), price, and a menu (move board, set category, choose printing, remove).
- **Header**: name, format, status toggle, card count per board, cost to finish, warnings count, **Brainstorm with Claude** (§5.5), and **Scan cards into this deck** (§5.1.3).
- **Panels**: Deck health (format warnings), Mana curve (bar chart of main-board nonland mana values), Type counts.
- **Buy list tab**: table of short lines (quantity, name, cheapest price, link) and total. "Copy as text" (`4 Lightning Bolt` per line). A toggle to ignore basics.
```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
  - `create_prospective_deck(name, format, notes?, cards[{name, quantity, board?, category?}])`: resolves names like decklist import. Names that match no card are left out and reported, and names matched only approximately (fuzzy) are reported with the card they became; with none matched, no deck is made. Creates a prospective deck with those lines and categories and returns its id, name, format, card count, completion, cost to finish (and how many cards to buy have no price), the deck's own format warnings, and up to 10 of its cards'. The chat shows the deck (and any names left out) with **Open in deckbuilder**; approximate matches reach the owner through Claude's answer.
  - Every tool checks its input with its schema before running. A problem comes back as a short, readable error (at most 5 problems listed), and the chat's activity line never fails, whatever Claude sent.
- **Deck-scoped conversations**: "Brainstorm with Claude" in the deck editor starts a conversation with `deck_id`. The deck's summary (every line with its status) goes into a text block before the first message, not into the system prompt, so the cache holds; `get_deck` reads the deck again later.
- Messages are stored as the content blocks sent and received, and replayed verbatim, with these exceptions: an answer cut off (`max_tokens` or the context window) keeps only its text; before a fallback partway through an answer only text is kept (the API's rule for sending such an answer back); and a declined turn (everything after Claude's last finished answer, up to its refusal: the question, any tool rounds, and any earlier unanswered question) is left out of later requests, though the chat still shows it. A stopped answer keeps the text of the request in progress (that request's notes and any partly written tool call go; earlier tool rounds are already stored with theirs); a tool round already running when Stop comes finishes and is stored. An answer that fails partway, or is stopped before Claude wrote anything, can be continued: Continue asks again from what's stored. The reason an answer failed shows beside Continue in the window that saw it; after a reload the page says only that Claude hasn't finished answering.
- While Claude works with nothing new to show (before its first words, after each tool round, after a notice), the chat shows "Thinking…".
- One answer at a time per conversation; **Stop**, or leaving the page, stops it. A window that opens the conversation while Claude answers in another shows "Claude is answering in another window…" until it finishes; a window already open on it isn't told, and a message sent from it is refused as busy. A conversation can't be deleted while it answers. `[[Card]]` links in answers open the card's drawer (`GET /api/cards/named`, which settles names that collide once punctuation is ignored the way the tools do: the whole written name first, then an exact name, then a card from a regular set). Each conversation shows an estimated cost, from each answer's token usage at Claude Opus 5.5's prices, updated when an answer ends. It is an estimate, off in both directions: a stopped request counts little more than its input (or nothing, if stopped before Claude wrote any text), a request that came through garbled or failed partway isn't counted, and a fallback model's tokens are priced as Opus 5.5's, though its own rates may be higher; an attempt declined before any output is priced although it isn't billed.
- With no key, the page explains and links to Settings; stored conversations stay readable.

```

with:

```markdown
  - `create_prospective_deck(name, format, notes?, cards[{name, quantity, board?, category?}])`: resolves names like decklist import. Names that match no card are left out and reported, and names matched only approximately (fuzzy) are reported with the card they became; with none matched, no deck is made. Creates a prospective deck with those lines and categories and returns its id, name, format, card count, completion, cost to finish (and how many cards to buy have no price), the deck's own format warnings, and up to 10 of its cards'. The chat shows the deck (and any names left out) with **Open in deckbuilder**; approximate matches reach the owner through Claude's answer.
  - Every tool checks its input with its schema before running. A problem comes back as a short, readable error (at most 5 problems listed), and the chat's activity line never fails, whatever Claude sent.
- **Deck-scoped conversations**: "Brainstorm with Claude" in the deck editor starts a conversation with `deck_id`, or reopens the deck's newest one that nothing has been said in yet, so clicking it again doesn't pile up empty conversations (the start page does the same for conversations about no deck). The deck's summary (every line with its status) goes into a text block before the first message, not into the system prompt, so the cache holds; `get_deck` reads the deck again later.
- Messages are stored as the content blocks sent and received, and replayed verbatim, with these exceptions: an answer cut off (`max_tokens` or the context window) keeps only its text; before a fallback partway through an answer only text is kept (the API's rule for sending such an answer back); and a declined turn (everything after Claude's last finished answer, up to its refusal: the question, any tool rounds, and any earlier unanswered question) is left out of later requests, though the chat still shows it. A stopped answer keeps the text of the request in progress and where another model took over (that request's notes and any partly written tool call go; earlier tool rounds are already stored with theirs); a tool round already running when Stop comes finishes and is stored. An answer that fails partway, or is stopped before Claude wrote anything, can be continued: Continue asks again from what's stored. The reason an answer failed shows beside Continue in the window that saw it; after a reload the page says only that Claude hasn't finished answering.
- While Claude works with nothing new to show (before its first words, while it writes a tool call, after each tool round, after a notice), the chat shows "Thinking…". A tool call's line appears only once the call is written, which for a whole deck can take a while, so the stream says when Claude starts one.
- A conversation that outgrows Claude's context window says so ("This conversation has grown too long for Claude. Start a new one to go on."), whether an answer was cut off by it or the conversation can't be sent at all; the latter offers no Continue, which would only send it again.
- One answer at a time per conversation; **Stop**, or leaving the page, stops it. A Stop in the first instant, before the server has begun the answer, drops the page's stream instead, which stops it the same way. A window that opens the conversation while Claude answers in another shows "Claude is answering in another window…" until it finishes; a window already open on it isn't told, and a message sent from it is refused as busy. A conversation can't be deleted while it answers. `[[Card]]` links in answers open the card's drawer (`GET /api/cards/named`, which settles names that collide once punctuation is ignored the way the tools do: the whole written name first, then an exact name, then a card from a regular set). Each conversation shows an estimated cost, from each answer's token usage at the prices of the model that wrote it (each attempt of a refusal fallback at its own model's; an attempt declined before it wrote anything isn't billed, so it isn't counted), updated when an answer ends. It is a lower bound: a stopped request counts little more than its input (or nothing, if stopped before Claude wrote any text), and a request that came through garbled or failed partway isn't counted.
- With no key, the page explains and links to Settings; stored conversations stay readable.

```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
- **Scanner**: auto-commit (manual captures only; auto mode's captures wait in the queue), default finish, accept uncertain printing (never a reading that contradicted the title).
- **Deckbuilder**: ignore basics in buy lists.
- **Backups**: last backup, "Back up now", folder path.

## 6. Error handling
```

with:

```markdown
- **Scanner**: auto-commit (manual captures only; auto mode's captures wait in the queue), default finish, accept uncertain printing (never a reading that contradicted the title).
- **Deckbuilder**: ignore basics in buy lists.
- **Backups**: last backup, "Back up now" (today's backup, or when that exists another copy of it, §6), folder path.

## 6. Error handling
```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
- **Backups**: compact copies made with `VACUUM INTO` (about half the live file's size), written under a temporary name and renamed when complete; a failed copy's temporary file is removed, and each backup first removes the partial copies (`binder-*.db.tmp`) that interrupted ones left. Removing old backups is best effort: one that can't be removed is logged and tried again next time. Restore one by stopping Binder and copying it over `data/binder.db` (deleting `binder.db-wal` and `binder.db-shm`).
  - **Daily**: at server start, if `last_backup_at` is more than 24 h old, or dated in the future (the clock was once set ahead), write `data/backups/binder-YYYY-MM-DD.db` (local date) and keep the newest 7. An existing backup for today is never replaced (after a restore it may hold newer data); the start logs that it's already there. A failed backup is logged and doesn't stop the app; the next start tries again.
  - **Before upgrading**: when the server start, `pnpm run setup`, or `pnpm ocr:bench` finds a migration pending on a database that already has migrations applied, it first logs "Backing up the database before upgrading it…" and writes `data/backups/binder-YYYY-MM-DD-before-NNN.db`, NNN being the first pending migration (another copy that day is `…-before-NNN-2.db`, and so on: an earlier copy is never replaced). The newest 3 of these are kept, apart from the daily 7. If the copy fails, the database isn't changed: the server (or script) prints one line saying why and exits with status 1 rather than upgrade a library it couldn't back up. A new, empty database is migrated without a copy.
- **Validation**: all request bodies and query params are validated with Zod at the route boundary.

```

with:

```markdown
- **Backups**: compact copies made with `VACUUM INTO` (about half the live file's size), written under a temporary name and renamed when complete; a failed copy's temporary file is removed, and each backup first removes the partial copies (`binder-*.db.tmp`) that interrupted ones left. Removing old backups is best effort: one that can't be removed is logged and tried again next time. Restore one by stopping Binder and copying it over `data/binder.db` (deleting `binder.db-wal` and `binder.db-shm`).
  - **Daily**: at server start, if `last_backup_at` is more than 24 h old, or dated in the future (the clock was once set ahead), write `data/backups/binder-YYYY-MM-DD.db` (local date) and keep the newest 7. An existing backup for today is never replaced (after a restore it may hold newer data); the start logs that it's already there. A failed backup is logged and doesn't stop the app; the next start tries again.
  - **Back up now** (Settings): writes today's backup, or when it exists `binder-YYYY-MM-DD-N.db`, numbered after the last copy kept that day; these count toward the 7, newest by date and then copy. It records `last_backup_at`, so the next daily backup waits a day from it. A failure is shown, not logged.
  - **Before upgrading**: when the server start, `pnpm run setup`, or `pnpm ocr:bench` finds a migration pending on a database that already has migrations applied, it first logs "Backing up the database before upgrading it…" and writes `data/backups/binder-YYYY-MM-DD-before-NNN.db`, NNN being the first pending migration (another copy that day is `…-before-NNN-2.db`, and so on, numbered after the last one kept: an earlier copy is never replaced, and a new one is never numbered below one kept, which pruning would take for older). The newest 3 of these are kept, apart from the daily 7. If the copy fails, the database isn't changed: the server (or script) prints one line saying why and exits with status 1 rather than upgrade a library it couldn't back up. A new, empty database is migrated without a copy.
- **Validation**: all request bodies and query params are validated with Zod at the route boundary.

```

In `docs/specs/2026-09-26-binder-design.md`, replace:

```markdown
5. **Scanner**: capture UI, OCR helper, matcher, benchmark, queue, commit. Plus the API key setting, for brainstorm.
6. **Brainstorm**: threads, streaming chat, tools, save-to-deck.
7. **Polish**: backups, remaining Settings, empty states, keyboard shortcuts.

Implementation plans are written per milestone.
```

with:

```markdown
5. **Scanner**: capture UI, OCR helper, matcher, benchmark, queue, commit. Plus the API key setting, for brainstorm.
6. **Brainstorm**: threads, streaming chat, tools, save-to-deck.
7. **Deck scanning and polish**: scanning into a deck, the Settings backups section, and the fixes first use asked for.
8. **Polish**: the follow-ups left in `docs/plans/m*-followups.md`, empty states, keyboard shortcuts.

Implementation plans are written per milestone.
```

In `README.md`, replace:

```markdown

Brainstorming needs your Anthropic API key (Settings → Anthropic API key) and uses Claude Opus 5.5. Each conversation
shows an estimate of what it has cost so far. Every message sends the whole conversation again; Anthropic caches it for
5 minutes, and the first message after a pause pays to cache it again. So a long conversation costs more per message:
start a new one for a new idea. A conversation answers one message at a time. **Stop** ends an answer early and keeps
what it said; so does leaving the page, opening another conversation, or following a deck link while Claude answers.
When an answer fails partway, **Continue** asks again.

## Scanning
```

with:

```markdown

Brainstorming needs your Anthropic API key (Settings → Anthropic API key) and uses Claude Opus 5.5. Each conversation
shows an estimate of what it has cost so far (a little under what Anthropic bills). Every message sends the whole
conversation again; Anthropic caches it for 5 minutes, and the first message after a pause pays to cache it again. So a
long conversation costs more per message: start a new one for a new idea. A conversation answers one message at a time.
**Stop** ends an answer early and keeps what it said; so does leaving the page, opening another conversation, or
following a deck link while Claude answers. When an answer fails partway, **Continue** asks again.

## Scanning
```

In `README.md`, replace:

```markdown
when its printing comes in foil.
Auto mode can capture one card twice when a hand reaches in or the card is nudged; the second row then says "Same card
as the scan before it. Discard it if the camera caught one card twice."

Scanning happens entirely on this Mac. Settings → Scanner can **Add manual captures to the collection as soon as
```

with:

```markdown
when its printing comes in foil.
Auto mode can capture one card twice when a hand reaches in or the card is nudged; the second row then says "Same card
as the scan before it. Discard it if the camera caught one card twice." Lifting the card between two copies of it
keeps them apart.

To scan a deck you own, choose it (or **New deck…**) under **Scanning into**, or press **Scan cards into this deck** in
the deck. Its cards go to your collection and the deck at once: they first fill the copies the deck already lists, so a
deck you planned first isn't doubled, and only extra copies are added. Each row says which deck and board it goes to,
with **Change** for a scan taken while the wrong deck was chosen.

Scanning happens entirely on this Mac. Settings → Scanner can **Add manual captures to the collection as soon as
```

In `README.md`, replace:

```markdown
Everything lives in `data/` (database, downloads, and backups in `data/backups`: a backup is written when Binder
starts and the last one is over 24 hours old, and the newest 7 are kept).
Before a Binder update changes the database's structure, it also saves `binder-YYYY-MM-DD-before-NNN.db` there (the
newest 3 are kept); if it can't, it doesn't start, and the database is left as it was.
```

with:

```markdown
Everything lives in `data/` (database, downloads, and backups in `data/backups`: a backup is written when Binder
starts and the last one is over 24 hours old, and the newest 7 are kept).
Settings → Backups shows the last backup and the folder, and **Back up now** saves one on demand.
Before a Binder update changes the database's structure, it also saves `binder-YYYY-MM-DD-before-NNN.db` there (the
newest 3 are kept); if it can't, it doesn't start, and the database is left as it was.
```

In `docs/plans/m1-followups.md`, replace:

```markdown
- **Printings list:** it shows the foil price as the regular price with no label, and etched-only printings show "—".

## M7 (polish)
- **Database compaction:** `data/binder.db` carries about 200 MB of free pages left by the pre-fix staging table. Add a maintenance step that runs `VACUUM` and then rebuilds `card_names_fts`. VACUUM can renumber `card_names`' implicit rowids, which would desync the external-content FTS index.
- **Setup errors:** `scripts/setup.ts` passes no `log`. If both the refresh and the `bulk_error` write fail, it prints "import failed: null". Keep the last error in memory as a fallback for `status().error`.
```

with:

```markdown
- **Printings list:** it shows the foil price as the regular price with no label, and etched-only printings show "—".

## M8 (polish)
- **Database compaction:** `data/binder.db` carries about 200 MB of free pages left by the pre-fix staging table. Add a maintenance step that runs `VACUUM` and then rebuilds `card_names_fts`. VACUUM can renumber `card_names`' implicit rowids, which would desync the external-content FTS index.
- **Setup errors:** `scripts/setup.ts` passes no `log`. If both the refresh and the `bulk_error` write fail, it prints "import failed: null". Keep the last error in memory as a fallback for `status().error`.
```

In `docs/plans/m2-followups.md`, replace:

```markdown
- (Done before M6: `openDb` registers it on every connection.) **`faces_include` registration:** the SQL function is emitted by `compile.ts` but registered only in `run.ts`. Register it wherever `compileFilter` can be called, before brainstorm tools use the compiler.

## M7 (polish)
- **Scryfall client:**
  - `downloadTimeoutMs` is a 10-minute cap on the whole 80 MB download. Use an idle timeout plus a generous overall cap.
```

with:

```markdown
- (Done before M6: `openDb` registers it on every connection.) **`faces_include` registration:** the SQL function is emitted by `compile.ts` but registered only in `run.ts`. Register it wherever `compileFilter` can be called, before brainstorm tools use the compiler.

## M8 (polish)
- **Scryfall client:**
  - `downloadTimeoutMs` is a 10-minute cap on the whole 80 MB download. Use an idle timeout plus a generous overall cap.
```

In `docs/plans/m3-followups.md`, replace:

```markdown
  - Decide whether scans should use `DEFAULT_PRINTING_ORDER` (the v3 rule that skips special products) instead.

## M7 (polish)
- **Card data upkeep** (`src/server/bulk/import.ts`, `src/server/cards/repo.ts`):
  - Hoist the kept-file path instead of rebuilding it in the error handler.
```

with:

```markdown
  - Decide whether scans should use `DEFAULT_PRINTING_ORDER` (the v3 rule that skips special products) instead.

## M8 (polish)
- **Card data upkeep** (`src/server/bulk/import.ts`, `src/server/cards/repo.ts`):
  - Hoist the kept-file path instead of rebuilding it in the error handler.
```

In `docs/plans/m4-followups.md`, replace:

```markdown
  - Prefer English printings in `DEFAULT_PRINTING_ORDER` before scans start relying on it.

## M7 (polish)
- **Backups** (`src/server/backup.ts`, `src/server/main.ts`):
  - Settings UI: last backup, "Back up now", folder path (spec §5.6).
  - (Done before M6 for migrations: an existing library is copied to `binder-YYYY-MM-DD-before-NNN.db` before a
    migration upgrades it. The card-name rebuild still runs before the daily backup.) Migrations and the card-name
```

with:

```markdown
  - Prefer English printings in `DEFAULT_PRINTING_ORDER` before scans start relying on it.

## M8 (polish)
- **Backups** (`src/server/backup.ts`, `src/server/main.ts`):
  - (Done in M7.) Settings UI: last backup, "Back up now", folder path (spec §5.6).
  - (Done before M6 for migrations: an existing library is copied to `binder-YYYY-MM-DD-before-NNN.db` before a
    migration upgrades it. The card-name rebuild still runs before the daily backup.) Migrations and the card-name
```

In `docs/plans/m5-followups.md`, replace:

```markdown
  matters.

## M7 (polish)
- **Matching** (`src/server/scanner/matcher.ts`, `lookups.ts`):
  - The title ignores OCR confidence, and stray sleeve text can become the title.
```

with:

```markdown
  matters.

## M8 (polish)
- **Matching** (`src/server/scanner/matcher.ts`, `lookups.ts`):
  - The title ignores OCR confidence, and stray sleeve text can become the title.
```

In `docs/plans/m5-followups.md`, replace:

```markdown
    discarding is the only way out. Nothing is lost. Since auto-mode captures no longer auto-commit, a long auto
    session goes through Add. Chunk the ids in `useCommitScans`, or send the first 1000 and let the rest wait.
  - The same-card marker compares only rows still in the queue. If the first of a double capture is added before the
    second is identified, the second isn't marked.
  - If deleting an image fails after a commit (for example EACCES), the worker logs "auto-commit failed" for rows that
    were in fact committed.
```

with:

```markdown
    discarding is the only way out. Nothing is lost. Since auto-mode captures no longer auto-commit, a long auto
    session goes through Add. Chunk the ids in `useCommitScans`, or send the first 1000 and let the rest wait.
  - (Done in M7: the scan before it counts whether it's still in the queue or added, and a bare-mat capture between
    two copies of one card keeps them apart.) The same-card marker compares only rows still in the queue. If the first
    of a double capture is added before the second is identified, the second isn't marked.
  - If deleting an image fails after a commit (for example EACCES), the worker logs "auto-commit failed" for rows that
    were in fact committed.
```

In `docs/plans/m5-followups.md`, replace:

```markdown
    - the probe reopening the camera on every `devicechange`.
  - One `AudioContext` per mount, never closed. Beeps scheduled while it's suspended all play at once on resume.
  - Auto-commit (now manual captures only) gives no feedback on the Scan page, and doesn't refresh collection caches.
  - Accessibility:
    - per-row labels lack the card name;
```

with:

```markdown
    - the probe reopening the camera on every `devicechange`.
  - One `AudioContext` per mount, never closed. Beeps scheduled while it's suspended all play at once on resume.
  - (Done in M7.) Auto-commit (now manual captures only) gives no feedback on the Scan page, and doesn't refresh
    collection caches.
  - Accessibility:
    - per-row labels lack the card name;
```

In `docs/plans/m5-followups.md`, replace:

```markdown
    - reset while armed;
    - a one-sided clamp.
  - There are no component tests, and the browser check has never shown a review row. Add one to the next end-to-end
    feed. Its Chrome helper's waits must await promises; a `!!(expr)` check passes at once on a `fetch`.
- **Settings page:**
  - Scanner toggles invalidate collection caches they can't affect.
```

with:

```markdown
    - reset while armed;
    - a one-sided clamp.
  - (Done in M7 for the browser check: its feed has an old card that comes back as a review row, and its waits await
    promises.) There are no component tests, and the browser check has never shown a review row. Add one to the next
    end-to-end feed. Its Chrome helper's waits must await promises; a `!!(expr)` check passes at once on a `fetch`.
- **Settings page:**
  - Scanner toggles invalidate collection caches they can't affect.
```

In `docs/plans/m6-followups.md`, replace:

```markdown
Everything in M6 was tested against a local fake of Anthropic's Messages API. No real request has been sent.

- **Send one short message, then one that makes Claude use a tool** ("What elves do I own?"). Binder's request
  combines several Opus 5.5 features:
  - three betas;
```

with:

```markdown
Everything in M6 was tested against a local fake of Anthropic's Messages API. No real request has been sent.

- (Done 2026-09-27: the owner brainstormed with a real key, and Claude built and saved a deck.) **Send one short message, then one that makes Claude use a tool** ("What elves do I own?"). Binder's request
  combines several Opus 5.5 features:
  - three betas;
```

In `docs/plans/m6-followups.md`, replace:

```markdown
  field. The fix is one line in the request in `src/server/ai/chat.ts` (`run`). Settings → **Test** checks only the key
  and model access, not this request.
- **Save a deck idea** ("save that as a deck"), and open it with **Open in deckbuilder**.
- **Saving an API key.** Check that the browser doesn't offer to save it as a password (carried over from M5; a
  headless browser can't show that prompt).
```

with:

```markdown
  field. The fix is one line in the request in `src/server/ai/chat.ts` (`run`). Settings → **Test** checks only the key
  and model access, not this request.
- (Done 2026-09-27.) **Save a deck idea** ("save that as a deck"), and open it with **Open in deckbuilder**.
- **Saving an API key.** Check that the browser doesn't offer to save it as a password (carried over from M5; a
  headless browser can't show that prompt).
```

In `docs/plans/m6-followups.md`, replace:

```markdown
- **Fallback models.** Whether the fallback model under `fallbacks: "default"` accepts `display: "updates"` and
  `block_binding`. If it doesn't, a refusal is shown as a refusal rather than rescued by another model.
- **Declined attempts in `usage.iterations`.** How the live API lists an attempt declined before any output. The
  cost estimate currently prices it, although such an attempt isn't billed.
- **Prices.** The five-minute cache write ($5 per million tokens) is derived from the 1.25× multiplier, which the
  guidance marks "confirm at launch". `PRICE` is in `src/server/ai/history.ts`.

## M7 (polish)
- **Do this first: show that Claude is working while it writes a tool call.**
  - Where: `src/server/ai/chat.ts` (`content_block_start` for `tool_use` emits nothing, and `input_json_delta` is
    ignored); `src/web/lib/brainstorm.ts` (`awaitingClaude` is false after a text or note item).
```

with:

```markdown
- **Fallback models.** Whether the fallback model under `fallbacks: "default"` accepts `display: "updates"` and
  `block_binding`. If it doesn't, a refusal is shown as a refusal rather than rescued by another model.
- (Answered in M7 from the SDK's types and Anthropic's guidance: each attempt in `usage.iterations` names its model,
  and one declined before any output isn't billed. The estimate now prices each attempt at its model's rates and
  leaves those out.) **Declined attempts in `usage.iterations`.** How the live API lists an attempt declined before any
  output. The cost estimate currently prices it, although such an attempt isn't billed.
- **Prices.** The five-minute cache write ($5 per million tokens) is derived from the 1.25× multiplier, which the
  guidance marks "confirm at launch". `PRICES` is in `src/server/ai/history.ts`.

## M8 (polish)
- (Done in M7.) **Do this first: show that Claude is working while it writes a tool call.**
  - Where: `src/server/ai/chat.ts` (`content_block_start` for `tool_use` emits nothing, and `input_json_delta` is
    ignored); `src/web/lib/brainstorm.ts` (`awaitingClaude` is false after a text or note item).
```

In `docs/plans/m6-followups.md`, replace:

```markdown
    - the reducer sets a flag that `awaitingClaude` honours until the next item;
    - add a test in each suite.
- **While an answer streams, the page can't be scrolled below the conversation's end.**
  - Where: `src/web/components/brainstorm/ChatView.tsx`, the follow effect.
  - The problem: the follow effect scrolls to the end on every delta, even when the end is above the window's bottom.
```

with:

```markdown
    - the reducer sets a flag that `awaitingClaude` honours until the next item;
    - add a test in each suite.
- (Done in M7, with the fix below.) **While an answer streams, the page can't be scrolled below the conversation's end.**
  - Where: `src/web/components/brainstorm/ChatView.tsx`, the follow effect.
  - The problem: the follow effect scrolls to the end on every delta, even when the end is above the window's bottom.
```

In `docs/plans/m6-followups.md`, replace:

```markdown
    - streaming with a short list: the page follows the answer;
    - opening an older conversation from low in a list of 45 or more: `section[aria-label="Conversation"]` is in view.
- **The cost estimate** (`estimateCost`, `src/server/ai/history.ts`):
  - price each message at its own model's rates (`meta.model`); a fallback model's are Opus 5 and 4.8 at $5/$25;
  - skip a `usage.iterations` entry that produced no output when a later entry exists (not billed). Confirm first
```

with:

```markdown
    - streaming with a short list: the page follows the answer;
    - opening an older conversation from low in a list of 45 or more: `section[aria-label="Conversation"]` is in view.
- (Done in M7.) **The cost estimate** (`estimateCost`, `src/server/ai/history.ts`):
  - price each message at its own model's rates (`meta.model`); a fallback model's are Opus 5 and 4.8 at $5/$25;
  - skip a `usage.iterations` entry that produced no output when a later entry exists (not billed). Confirm first
```

In `docs/plans/m6-followups.md`, replace:

```markdown

  Until then the spec calls the figure an estimate, off in both directions.
- **The context window.** When a conversation nears 1M tokens, every answer ends with "The answer was cut off because
  it got too long." (`NOTICE.cutOff`, used for `model_context_window_exceeded`). A prompt already over the window
  returns a 400 that Continue repeats.
  - Give it its own notice: "This conversation has grown too long for Claude; start a new one."
  - Optionally show the conversation's size, from the last `meta.usage`.
- **Stop racing the start of an answer** (`src/web/lib/brainstorm.ts`, `stop`). A Stop that reaches the server before
  it has registered the answer gets `{stopped: false}`, and nothing happens. Fix:
  `.then((r) => { if (!r.stopped) controller.current?.abort() })`.
```

with:

```markdown

  Until then the spec calls the figure an estimate, off in both directions.
- (Done in M7.) **The context window.** When a conversation nears 1M tokens, every answer ends with "The answer was cut off because
  it got too long." (`NOTICE.cutOff`, used for `model_context_window_exceeded`). A prompt already over the window
  returns a 400 that Continue repeats.
  - Give it its own notice: "This conversation has grown too long for Claude; start a new one."
  - Optionally show the conversation's size, from the last `meta.usage`.
- (Done in M7.) **Stop racing the start of an answer** (`src/web/lib/brainstorm.ts`, `stop`). A Stop that reaches the server before
  it has registered the answer gets `{stopped: false}`, and nothing happens. Fix:
  `.then((r) => { if (!r.stopped) controller.current?.abort() })`.
```

In `docs/plans/m6-followups.md`, replace:

```markdown
  - The fix: navigate from `mutate`'s own `onSuccess` and keep the deferred removal. Re-run the delete probe under
    20× CPU throttle, because the ordering relies on react-router's transitions.
- **A stopped answer loses its fallback marker.** Only its text is stored, but with the fallback model in `meta.model`.
  After a reload, the chat shows the model notice ("Claude Opus 5 answered from here: after a refusal…") instead of
  the fallback line. After a fallback partway through, that notice sits above text Opus 5.5 partly wrote. Fix: keep
  the `fallback` block in the stored text-only content; it is an audit marker the API ignores.
- **Empty conversations pile up.** Every click on **Brainstorm with Claude** makes a conversation, and a double click
  in one frame makes two. Either reuse the deck's newest empty conversation, or create a conversation on its first
  message.
```

with:

```markdown
  - The fix: navigate from `mutate`'s own `onSuccess` and keep the deferred removal. Re-run the delete probe under
    20× CPU throttle, because the ordering relies on react-router's transitions.
- (Done in M7.) **A stopped answer loses its fallback marker.** Only its text is stored, but with the fallback model in `meta.model`.
  After a reload, the chat shows the model notice ("Claude Opus 5 answered from here: after a refusal…") instead of
  the fallback line. After a fallback partway through, that notice sits above text Opus 5.5 partly wrote. Fix: keep
  the `fallback` block in the stored text-only content; it is an audit marker the API ignores.
- (Done in M7: starting one reuses the newest that nothing has been said in, which also covers a double click.)
  **Empty conversations pile up.** Every click on **Brainstorm with Claude** makes a conversation, and a double click
  in one frame makes two. Either reuse the deck's newest empty conversation, or create a conversation on its first
  message.
```

In `docs/plans/m6-followups.md`, replace:

```markdown
    - one step leaves for `/decks` mid-answer and waits for "Stopped.".

    Reuse it for M7's chat work with those changes.
  - **The model-change notice** has unit and stream tests only; the browser check's fake always answers as
    `claude-opus-5-5`.
```

with:

```markdown
    - one step leaves for `/decks` mid-answer and waits for "Stopped.".

    Reuse it for M7's chat work with those changes. (Done in M7: its check has all three, and covers scanning too.)
  - **The model-change notice** has unit and stream tests only; the browser check's fake always answers as
    `claude-opus-5-5`.
```

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass (794 tests).

---
