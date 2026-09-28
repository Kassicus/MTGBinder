# M6 follow-ups

These are deferred findings from milestone 6 (Brainstorm). They were triaged by:
- the task reviews;
- the final whole-milestone review;
- that review's fix wave.

Fold each one into its milestone's plan when you write it. None of them blocks M6.

## Checks for the owner (the first real use)
Everything in M6 was tested against a local fake of Anthropic's Messages API. No real request has been sent.

- (Done 2026-09-27: the owner brainstormed with a real key, and Claude built and saved a deck.) **Send one short
  message, then one that makes Claude use a tool** ("What elves do I own?"). Binder's request combines several Opus 5.5
  features:
  - three betas;
  - `fallbacks: "default"`;
  - thinking display `updates`;
  - `block_binding`;
  - `eager_input_streaming`;
  - top-level `cache_control`.

  If the API refuses any of them, **every** answer fails with "Anthropic answered with an error (400): …" naming the
  field. The fix is one line in the request in `src/server/ai/chat.ts` (`run`). Settings → **Test** checks only the key
  and model access, not this request.
- (Done 2026-09-27.) **Save a deck idea** ("save that as a deck"), and open it with **Open in deckbuilder**.
- **Saving an API key.** Check that the browser doesn't offer to save it as a password (carried over from M5; a
  headless browser can't show that prompt).
- **Rate limits.** If early answers fail with 429s, lower `MAX_TOKENS` (64000) in `chat.ts` first. A new key's tier
  may count `max_tokens` against its output limit.
- **Leftover test directories.** `rm -rf $TMPDIR/binder-*` clears about 5,000 of them, all from M1–M4 runs.

## Open questions about the API (answer from the first real use)
- **Fallback models.** Whether the fallback model under `fallbacks: "default"` accepts `display: "updates"` and
  `block_binding`. If it doesn't, a refusal is shown as a refusal rather than rescued by another model.
- (Assumed in M7 from the SDK's types and Anthropic's guidance, not yet seen live: each attempt in `usage.iterations`
  names its model, and one declined before any output isn't billed. The estimate now prices each attempt at its model's
  rates and leaves those out.) **Declined attempts in `usage.iterations`.** How the live API lists an attempt declined
  before any output. The cost estimate currently prices it, although such an attempt isn't billed.
- **Prices.** The five-minute cache write ($5 per million tokens) is derived from the 1.25× multiplier, which the
  guidance marks "confirm at launch". `PRICES` is in `src/server/ai/history.ts`.

## Later (left after M8)
M8 did the items marked done; the rest wait for a later milestone.
- (Done in M7.) **Do this first: show that Claude is working while it writes a tool call.**
  - Where: `src/server/ai/chat.ts` (`content_block_start` for `tool_use` emits nothing, and `input_json_delta` is
    ignored); `src/web/lib/brainstorm.ts` (`awaitingClaude` is false after a text or note item).
  - The problem: in "save it as a deck", Claude writes the whole deck into the tool call before the tool line
    appears, which takes tens of seconds for 60–100 cards. The page shows a still "Saving it now." with no
    "Thinking…". The owner may think it has stalled and press Stop, which drops the half-written call.
  - The fix:
    - add a `ChatEvent` (`{type: 'working'}`, or `tool_start`) emitted at a `tool_use` block's start;
    - the reducer sets a flag that `awaitingClaude` honours until the next item;
    - add a test in each suite.
- (Done in M7, with the fix below.) **While an answer streams, the page can't be scrolled below the conversation's
  end.**
  - Where: `src/web/components/brainstorm/ChatView.tsx`, the follow effect.
  - The problem: the follow effect scrolls to the end on every delta, even when the end is above the window's bottom.
    With a conversation list longer than the chat, the window is pulled back up.
  - The final fix wave tried "scroll only downward" and reverted it: that stops the scroll that brings a conversation
    into view when it opens. Opening an older conversation from low in a long list then left the chat off-screen.
  - A fix tested in a scratch build (opening in view; a long list stays down; a short list follows):

    ```tsx
    const shown = useRef(false)
    useLayoutEffect(() => {
      const end = bottom.current?.getBoundingClientRect().bottom
      if (end === undefined) return
      if (!shown.current || (following.current && end > window.innerHeight)) bottom.current!.scrollIntoView({ block: 'end' })
      shown.current = true
    }, [items.length, last && 'text' in last ? last.text.length : 0, thinking, answer.running])
    ```

    Check three cases in the browser:
    - streaming with a long list: the window stays scrolled down;
    - streaming with a short list: the page follows the answer;
    - opening an older conversation from low in a list of 45 or more: `section[aria-label="Conversation"]` is in view.
- (Done in M7.) **The cost estimate** (`estimateCost`, `src/server/ai/history.ts`):
  - price each message at its own model's rates (`meta.model`); a fallback model's are Opus 5 and 4.8 at $5/$25;
  - skip a `usage.iterations` entry that produced no output when a later entry exists (not billed). Confirm first
    how the live API reports it; see the open questions.
- (Done in M7.) **The context window.** When a conversation nears 1M tokens, every answer ends with "The answer was cut
  off because it got too long." (`NOTICE.cutOff`, used for `model_context_window_exceeded`). A prompt already over the
  window returns a 400 that Continue repeats.
  - Give it its own notice: "This conversation has grown too long for Claude; start a new one."
  - Optionally show the conversation's size, from the last `meta.usage`.
- (Done in M7.) **Stop racing the start of an answer** (`src/web/lib/brainstorm.ts`, `stop`). A Stop that reaches the
  server before it has registered the answer gets `{stopped: false}`, and nothing happens. Fix:
  `.then((r) => { if (!r.stopped) controller.current?.abort() })`.
- **A late delete success navigates away from a conversation opened meanwhile.**
  - Where: `useDeleteThread`'s `onSuccess` runs after ChatView unmounts.
  - It is practically unreachable on localhost.
  - The fix: navigate from `mutate`'s own `onSuccess` and keep the deferred removal. Re-run the delete probe under
    20× CPU throttle, because the ordering relies on react-router's transitions.
- (Done in M7.) **A stopped answer loses its fallback marker.** Only its text is stored, but with the fallback model in
  `meta.model`. After a reload, the chat shows the model notice ("Claude Opus 5 answered from here: after a refusal…")
  instead of the fallback line. After a fallback partway through, that notice sits above text Opus 5.5 partly wrote.
  Fix: keep the `fallback` block in the stored text-only content; it is an audit marker the API ignores.
- (Done in M7: starting one reuses the newest that nothing has been said in, which also covers a double click.)
  **Empty conversations pile up.** Every click on **Brainstorm with Claude** makes a conversation, and a double click
  in one frame makes two. Either reuse the deck's newest empty conversation, or create a conversation on its first
  message.
- **Chat UI:**
  - `lastError` (the reason beside Continue) can be stale in a window that didn't see the failure.
  - A closing notice and `done` that arrive in separate reads can flash "Thinking…" for one render.
  - A double click in one frame fires Delete twice.
  - The text typed for a message is lost when sending fails before the answer starts.
  - `aria-live` wraps the whole conversation.
  - Phone width: every page is about 666 px wide because of the Layout nav (pre-existing).
  - Multi-line tool errors collapse into one line (use `whitespace-pre-line` on `item.error` in `ChatItemView.tsx`).
  - Empty text items can show live briefly.
  - `parseInline` cost on adversarial 20–60 KB single lines (0.1–1.8 s). Claude's answers are nowhere near that.
- **Tools** (`src/server/ai/tools.ts`):
  - `describe` with a missing field reads "Reading " / "Looking up ".
  - The unknown-deck list is alphabetical and cut at 20, so a near miss can be left off.
  - A front-half match ("Fire // Garbage") isn't reported as approximate (decklist-import behaviour).
  - The activity line for `create_prospective_deck` counts the cards Claude asked for, including names left out
    ("(6 cards)"), while the deck card counts the cards saved.
- **The chat loop** (`src/server/ai/chat.ts`), none of which the real API produces:
  - an unparseable SSE line is called a dropped connection;
  - a stream that closes cleanly without `message_stop` is treated as garbled;
  - there's no test that tools don't run on a stop reason that is neither `tool_use` nor a cut-off.
- **Card names** (`findCardByName`, `src/server/cards/repo.ts`):
  - test gaps: the face-collision test can't tell `specialPrintingSql` from name order; the tier swap, the final
    tie-break and `toSummary`'s `imageSmall` are untested;
  - SQLite `lower()` folds ASCII only;
  - `' // '` is split differently from `cardNameIndex`'s bare `'//'`;
  - `POST /import` ignores `category` (no caller sends one).
- **Routes:**
  - (Done in M8.) ids alias (`0x1`, `1e0`), app-wide as in M5;
  - the page-close test helper needs an exact text match, so a longer scripted reply times out rather than failing
    fast.
- **Tests:**
  - **Leaving the page mid-answer** has no automated test; only the milestone's browser check covered it. The project
    has no DOM tests, and adding them needs a dev dependency.
  - **The browser check** is in the M6 plan's Task 6. It ran with three changes that the plan's copy lacks:
    - the launcher imports the SDK's ES-module build (`index.mjs`), so its error classes match the app's;
    - `cdp.ts` passes events on, and the check fails on any `Log.entryAdded` error, `console.error`/`console.assert`,
      or `Runtime.exceptionThrown`;
    - one step leaves for `/decks` mid-answer and waits for "Stopped.".

    Reuse it for M7's chat work with those changes. (Done in M7: its check has all three, and covers scanning too.)
  - **The model-change notice** has unit and stream tests only; the browser check's fake always answers as
    `claude-opus-5-5`.
