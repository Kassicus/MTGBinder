# Binder: MTG Card Library Tool (Design Spec)

**Date:** 2026-09-26
**Status:** Approved in conversation; pending written-spec review

## 1. Purpose

Binder is a personal, single-user Magic: The Gathering collection manager that runs locally on this Mac. It answers three questions quickly:

1. **Do I own this card?** How many, which printings, and are they already in decks?
2. **What do I need to buy to finish this deck?** Account for cards committed to other built decks.
3. **What should I build next?** Brainstorm with Claude, grounded in what I actually own.

Cards get into the library mainly by **scanning them with an iPhone camera** connected over USB.

### Success criteria
- Scanning a stack is pleasant: capture about one card per 2 seconds, with identification running in the background. At least 90% of modern-frame cards are identified correctly, on this Mac alone.
- Local library search returns in under 150 ms for typical queries.
- The deckbuilder's owned / in-another-deck / need-to-buy status and buy list are always correct under the allocation rules in §4.3.
- Brainstormed decks can be saved straight into the deckbuilder as prospective decks.

### Out of scope
Multi-user, remote or network access, deployment, price history, trade or sale tracking, tracking card condition or language, offline card images (images load from Scryfall's CDN), a mobile-first UI.

## 2. Decisions

| Topic | Decision |
|---|---|
| Phone | iPhone via macOS **Continuity Camera** (USB or wireless). The browser on the Mac sees it as a camera via `getUserMedia`. Nothing is installed on the phone. |
| Formats | Mixed. Each deck has a format, and the deckbuilder applies that format's rules. |
| Stack | TypeScript. **Vite + React** SPA, **Hono** server on **Node 24**, **SQLite** via `better-sqlite3`. |
| Card data | Local mirror of Scryfall **`default_cards`** bulk data (every printing, English or only-printed language; ~110k rows). Global search proxies the live Scryfall API. |
| Recognition | **On-device**: Apple Vision OCR via a Swift helper, matched against the local mirror. Scans it can't settle go to review. Scanning never calls Claude or any other service (the owner's choice, 2026-09-27: the Anthropic API is for deckbuilding help). |
| Claude model | `claude-opus-5-5` for brainstorm (the owner's choice, 2026-09-27), with server-side refusal fallbacks enabled (`fallbacks: "default"`). |
| Allocation granularity | By card identity (`oracle_id`), not by physical copy or printing. |
| Port | `127.0.0.1:4321` (localhost only). |

## 3. Architecture

```
iPhone ──USB (Continuity Camera)──► Mac camera ──► Browser (React SPA)
                                                      │  HTTP + SSE
                                                      ▼
                        Hono server (Node 24) ── SQLite  data/binder.db
                          ├── Scryfall API     (live search, bulk-data download)
                          ├── bin/ocr          (Swift, Apple Vision; persistent child process)
                          └── Anthropic API    (brainstorm)
```

### 3.1 Project layout
```
binder/
  package.json            single pnpm package
  .env                    ANTHROPIC_API_KEY (written by Settings page, chmod 600)
  native/ocr.swift        Vision OCR helper source
  bin/ocr                 compiled helper (built by `pnpm setup`)
  src/shared/             types + pure logic shared by server and web (search AST, ownership math, decklist parsing, format rules)
  src/server/             Hono app: routes, db, migrations, scryfall, search compiler, scanner, ai
  src/web/                React SPA
  tests/                  Vitest: unit, integration, fixtures
  scripts/                ocr-benchmark, fixture fetcher
  data/                   binder.db, scans/, bulk/, backups/   (gitignore-style: never hand-edited)
  docs/specs/             this document
```

### 3.2 Commands
- `pnpm setup`: install dependencies, compile `bin/ocr` with `swiftc`, run migrations, run the first Scryfall bulk import.
- `pnpm dev`: Vite dev server plus the server (via `tsx watch`), with the Vite proxy forwarding `/api` to the server.
- `pnpm start`: build the SPA, then serve it and the API from the Hono server at `http://localhost:4321`.
- `pnpm test`: Vitest.
- `pnpm ocr:bench`: OCR benchmark (§5.1.6).

### 3.3 Key dependencies
`hono`, `@hono/node-server`, `better-sqlite3`, `@anthropic-ai/sdk`, `zod`, `react`, `react-router`, `@tanstack/react-query`, `tailwindcss` v4, `vitest`.

## 4. Data model

SQLite runs in WAL mode with `foreign_keys=ON`. Migrations are numbered SQL files applied at startup and tracked in `schema_migrations`. An existing library is backed up before a migration upgrades it (§6).

### 4.1 Tables

**`cards`** is the Scryfall mirror, one row per printing.
| column | notes |
|---|---|
| `id` TEXT PK | Scryfall card id |
| `oracle_id` TEXT | card identity; indexed. For reversible cards without a top-level `oracle_id`, use the first face's |
| `name` TEXT | full name (`A // B` for multi-face) |
| `face_names` TEXT | face names separated by a newline, for OCR matching of the front face |
| `lang`, `layout`, `released_at` | |
| `set_code`, `set_name`, `collector_number` | index on (`set_code`, `collector_number`) |
| `rarity` | common, uncommon, rare, mythic, special, bonus |
| `mana_cost`, `cmc` REAL | multi-face: faces' costs joined with ` // ` |
| `type_line`, `oracle_text`, `flavor_text` | multi-face: faces joined with `\n//\n` |
| `power`, `toughness`, `loyalty` | TEXT (can be `*`, `1+*`), plus numeric shadow columns `power_num` etc. (NULL if non-numeric) |
| `colors`, `color_identity` | TEXT of WUBRG letters in canonical order (`''` = colorless) |
| `keywords` | JSON array |
| `legalities` | JSON object |
| `games`, `finishes` | JSON arrays |
| `artist` | |
| `prices` | JSON `{usd, usd_foil, usd_etched}` |
| `image_normal`, `image_small`, `image_art_crop` | front-face URIs (multi-face: first face) |
| `card_faces` | JSON (for rendering back faces) |
| `purchase_uris`, `scryfall_uri` | |
| `is_promo`, `is_digital` INTEGER | |

Also `card_names`, one row per card identity (`oracle_id`): `name`, `face_names`, `search_name` (the name lowercased, without punctuation or diacritics), and `default_card_id`, the printing shown by default (not a promo, not dated in the future, not a special product, English, newest). Its FTS5 index `card_names_fts` (`tokenize='trigram'`, external content over `card_names.search_name`) serves name autocomplete when the query has a word of 3 or more characters; shorter queries use `LIKE` prefix matching. Nothing indexes rules text: `o:` and name terms in the query language scan `cards` with `instr` over `oracle_text` and `search_name`. OCR candidates don't come from the index either: they come from the fuzzy name search over `card_names` (§5.1.2).

**`collection`** holds what I own.
| column | notes |
|---|---|
| `id` INTEGER PK | |
| `card_id` TEXT FK→cards.id | printing |
| `finish` TEXT | `nonfoil`, `foil`, or `etched` |
| `quantity` INTEGER | > 0 (rows at 0 are deleted) |
| `added_at`, `updated_at` | |
UNIQUE(`card_id`, `finish`).

**`decks`**: `id`, `name`, `format`, `status` (`prospective`/`built`), `notes`, `created_at`, `updated_at`.

**`deck_cards`**: `id`, `deck_id` FK (cascade), `oracle_id`, `preferred_card_id` (nullable FK→cards.id, used for the image and price display), `quantity`, `board` (`commander`/`main`/`side`/`maybe`), `category` (nullable free text). UNIQUE(`deck_id`, `oracle_id`, `board`).

**`scan_items`**: `id`, `image_path`, `status` (`queued`/`identifying`/`confident`/`review`/`committed`/`discarded`), `method` (`ocr`/`manual`; the schema also allows `claude`, unused since scanning is on-device only), `ocr_json`, `candidates` (JSON array of `{card_id, score}`), `card_id` (chosen), `finish`, `quantity` (default 1), `confidence` REAL, `error`, `created_at`, `updated_at`, `reason` (why a `review` scan needs a look: `printing` or `unsure`), `auto` (1 for auto-mode captures), `deck_id` (nullable FK→decks; the deck it goes to besides the collection, set null when that deck is deleted) and `board` (`commander`/`main`/`side`), `auto_committed` (1 when auto-commit added it), `lifted` (1 for an auto-mode capture taken after auto mode saw the empty mat: the card before it was lifted). Migrations 003, 005, and 006 added the last six.

**`ai_threads`**: `id`, `title` (empty until the first message names it), `deck_id` (nullable; a deleted deck unlinks it), `created_at`, `updated_at`.
**`ai_messages`**: `id`, `thread_id` FK, `role`, `content` (JSON array of content blocks, stored verbatim including thinking blocks, except as §5.5 says: a declined answer is stored empty, as is the marker that a conversation has grown too long for Claude, a stopped one as its text and any fallback markers, a cut-off one as its text, one that fell back partway with only text before the fallback, and empty text blocks are dropped), `meta` (JSON, for an assistant message: the model that wrote it, why it stopped (the API's stop reason, or `stopped` when the owner stopped it), and its token usage; added by migration 004), `created_at`.

**`meta`**: key/value. Holds `bulk_updated_at`, `bulk_source_updated_at`, `card_data_version` (the mapping version that imported `cards`), `card_names_version` (the default-printing rule that built `card_names`), `last_backup_at`, and settings (`scan_auto_commit`, `scan_default_finish`, `scan_accept_uncertain_printing`, `buylist_ignore_basics`).

### 4.2 Bulk import
1. `GET https://api.scryfall.com/bulk-data/default-cards` and read `jsonl_download_uri` (gzipped JSONL, ~79 MB compressed as of 2026-09-26). If that field is missing, fail with a clear error that names the fields actually present. Stream the download to `data/bulk/default-cards.jsonl.gz`.
2. Parse via `zlib.createGunzip()` → `readline`, one card JSON per line. Skip `is_digital` cards and cards where `games` lacks `paper`. Insert rows into a fresh `cards_staging` table in batched transactions.
3. In **one transaction** (WAL readers keep seeing the old snapshot until commit):
   - Upsert staging into `cards` with `INSERT … ON CONFLICT(id) DO UPDATE`. Never use `REPLACE` or table renames, which would disturb foreign keys from `collection` and `deck_cards`.
   - Delete `cards` rows absent from staging **unless** they're referenced by `collection.card_id`, `deck_cards.preferred_card_id`, or `scan_items.card_id`, or are printings of a card (`oracle_id`) that a deck line uses and that's missing from staging altogether. Printings that Scryfall removes but that I own, chose for a deck line, or have in the scan queue are kept, and so is every printing of a deck's card that's gone from the new data (a line on the default printing names only the card). A dropped printing of a deck's card that's still in the data is deleted, so its frozen price can't win the buy list.
   - Rebuild `card_names` (with each card's default printing) and its `card_names_fts` index, drop `cards_staging`, and update `meta`.

Refresh happens automatically in the background at server start if `bulk_updated_at` is older than 7 days or `card_data_version` shows the card data was imported by an older Binder mapping, and on demand from Settings. When Scryfall's `updated_at` matches `bulk_source_updated_at` and the downloaded file is still there, a refresh re-imports that file instead of downloading it again. Progress is exposed via `GET /api/bulk/status`.

### 4.3 Ownership and allocation rules (in `src/shared/ownership.ts`)
For a card identity `o` (`oracle_id`):
- **owned(o)** = Σ `collection.quantity` over every printing and finish with `oracle_id = o`.
- **allocated(o)** = Σ `deck_cards.quantity` for `o` across **built** decks (all boards except `maybe`).
- **free(o)** = owned(o) − allocated(o). This can be negative if built decks over-claim; the UI shows it as a conflict.
- **wantedBy(o)** = the prospective decks containing `o` (boards except `maybe`).

For a deck `D` and a card `o`, let `n` = the copies of `o` in `D` summed across all boards except `maybe`. Ownership is computed per card identity at the deck level, and every line of `o` in `D` shows the same status.
- If `D` is **built**: `available = free(o) + n` (D's own allocation counts toward itself).
- If `D` is **prospective**: `available = free(o)`.
- **short** = max(0, n − max(0, available)).
- **Line status**:
  - `owned` if short = 0.
  - `in_other_deck` if short > 0 and owned(o) ≥ n (the copies exist but other built decks hold them).
  - `buy` if short > 0 and owned(o) < n.
  
  The line always shows "own X, Y in other built decks".
- **Maybe board**: lines show status computed as if prospective with `n` = that line's quantity. They're excluded from allocation, completion %, and the buy list.
- **Buy list** = all lines with short > 0: quantity = short, price = the cheapest `usd` across that card's paper printings, leaving out memorabilia (gold-bordered World Championship cards, Collectors' Edition, 30th Anniversary Edition) unless nothing else has a price (fall back to `usd_foil`, then `usd_etched`), plus a TCGplayer link from `purchase_uris`. Basic lands are excluded when `buylist_ignore_basics` is on (default on).
- **Mark as built**: compute short for every line. If any are > 0, show the list and require confirmation. Marking built never changes `collection`.

### 4.4 Format rules (in `src/shared/formats.ts`)
| format | deck size | max copies | sideboard | commander | legality key |
|---|---|---|---|---|---|
| commander | exactly 100 incl. commander(s) | 1 | none | 1–2 (partner/background) | `commander` |
| standard / pioneer / modern / legacy / vintage / pauper | min 60 | 4 (vintage: restricted = 1) | ≤ 15 | none | same name |
| casual | none | none | any | optional (not checked) | none |

Basic lands, and cards whose oracle text says "A deck can have any number of cards named", are exempt from copy limits. Commander color identity: every card's `color_identity` must be a subset of the union of the commanders' identities. Violations appear as warnings on lines and in a deck-health panel. They never block edits.

## 5. Features

### 5.1 Scanner (`/scan`)

**5.1.1 Capture (browser)**
- A camera picker lists `enumerateDevices()` video inputs, and the choice is remembered in `localStorage`. The iPhone appears as "<name> Camera" once Continuity Camera is active, named after the phone (so a renamed one needn't say "iPhone"). With no choice remembered, the page picks an iPhone, else any camera that isn't the Mac's own (FaceTime, MacBook, iMac, Studio Display), else the Mac's; Desk View and virtual cameras come last. It shows a short help note when it finds only the Mac's own cameras. A camera plugged in or out updates the list without opening a camera.
- A camera that stops (unplugged, or the iPhone moved away) says so and stays the chosen camera: the page doesn't switch to another one by itself, and Capture is off meanwhile. While that camera is still listed, **Start it again** (which a camera error offers too) restarts it; once it's gone from the list, the page says it starts again by itself when it's back (and, with other cameras listed, that another can be chosen above). Choosing another camera in the list uses that one, and a reload while the page waits opens the best-ranked camera present. A camera that stops sending pictures for a while says so until it picks up. A resized picture (an iPhone turned) keeps the guide in place.
- Live `<video>` preview with a card-shaped guide overlay (63:88 aspect ratio). Capture crops the guide region, plus an 8% margin on each side so a card placed a little off the guide stays whole, from the full-resolution frame, encodes JPEG at quality 0.92, and POSTs it to `/api/scan` (with `?auto=1` from auto mode, `lifted=1` when auto mode saw the empty mat since its last capture, and `deck` and `board` when scanning into a deck, §5.1.3).
- **Manual mode**: Space or a button captures. The `a` key switches between Auto and Manual (§5.7).
- **Auto mode**: every 150 ms the page samples the guide region at low resolution, each dot the average of a block of pixels (so a one-pixel camera wobble over a card's text isn't movement), and compares samples with any overall brightness shift taken out (so the camera adjusting its exposure isn't either). The first picture that holds still for 600 ms is the empty mat (the line under the camera says "clear the guide to start" until then; choosing Auto again, or starting the camera again, learns it again). A picture that holds still for 600 ms and differs clearly from the empty mat is a card, and is captured, unless it's the card captured last, still lying there: the empty mat not seen since and the picture about the same. So a hand passing over a card doesn't capture it again, a card moved or swapped is captured, and the empty mat itself is never captured; a still picture close to the empty mat updates it, following slow changes in the light. A capture after the empty mat showed says the card before it was lifted (`lifted=1`). The line under the camera says what auto mode is doing: learning the empty mat, ready for a card, waiting for the card to hold still, or captured. A capture by hand (Capture or Space) in auto mode counts as its capture of the card showing. The thresholds were measured with an iPhone over a mat: a card lying still changes by at most about 6 from sample to sample, and differs from the empty mat by about 60. Captures give audio and visual feedback; a beep that can't play within a quarter second (before the page has been clicked, the browser holds sound back) is left out rather than played late.
- The queue list updates live by polling `/api/scan/items` (the whole queue, which stays small) every 1 s. Polling was chosen over SSE here because it's simpler and fast enough.

**5.1.2 Pipeline (server)**
`POST /api/scan` saves the image to `data/scans/<id>.jpg`, inserts a `scan_items` row with status `queued`, and returns immediately. A worker processes the queue (OCR concurrency 2):

1. **OCR**: send the image path to the persistent `bin/ocr` process. The response lists text lines with normalized bounding boxes and confidences.
2. **Match** (`src/server/scanner/matcher.ts`, pure and unit-tested):
   - Positions are measured over the card's text (from the top of the highest line to the bottom of the lowest), so a card that doesn't fill the capture still reads right.
   - **Collector line**: from lines in the bottom 20% of the card, parse the collector number ("145/269 R", "U 0201", or, on 2003–2014 cards, the "66/350" at the end of the copyright line; never the power/toughness box), the set code (a 3–5 character alphanumeric token next to `•`/`★` and a language code like `EN`), and the copyright year ("© 1993-2009" gives 2009). A `★` in place of `•` marks a foil. On-device OCR reads the `★` as `*`, so either one presets the finish to foil.
   - **Title**: lines in the top 12% of the card. Take the longest text, normalized (lowercase, strip punctuation, fold diacritics).
   - **Scoring**: candidates come from (a) an exact `(set_code, collector_number)` lookup (when it finds nothing, set codes one character away are tried, for OCR slips like TDM read as TOM) and (b) the exhaustive name search shared with decklist import (every name scoring ≥ 0.75), top 5. Each candidate is scored by name similarity (Jaro-Winkler against the name and each face name).
   - **Decision**:
     - `confident` if the set code and a collector number read name exactly one printing that passes the name check. When the title names a card (exactly, or with similarity ≥ 0.92 and a gap of ≥ 0.05 to the next *different* oracle card; a name several card identities share names all of them), the hit must be that card. Otherwise its name must be ≥ 0.80 similar to the title, or its full name (for a multi-face card, two of its face names) must be printed exactly as a line: split cards print their names sideways, and flavor-name cards print the real name small. Every collector-number candidate on the collector line is tried.
     - Otherwise the title must name one card: exactly (its full name or a face's), or with similarity ≥ 0.92 and a gap of ≥ 0.05 to the next *different* oracle card. A name several card identities share is low confidence, with all of them as candidates. Then the printings are narrowed: English ones only (OCR reads English titles; a card with none keeps them all but can't be `confident`), then by the set code, the collector number, and the copyright year (that year or the next) when read. A filter that would leave none contradicts the rest, so the printing stays uncertain. `confident` when one printing is left and nothing contradicted.
     - `review` (printing uncertain) when more are left; the scan takes the first of them in the default printing order (not a promo, not dated in the future, not a special product, English, newest). If the `scan_accept_uncertain_printing` setting is on (default off, useful when scanning a stack of old-frame cards whose printing I don't care about), these become `confident` with that printing instead. It never accepts a reading that contradicted the title (a filter that would have left none): that is the one sign the title may be misread, so the scan stays in `review`.
     - Anything else is **low confidence**: `review`, with the candidates attached (the likeliest first).
   - The thresholds are constants tuned with the benchmark (§5.1.6).
3. **OCR failure** (the helper missing, crashing, or timing out): `review`, with `error` set ("OCR failed: …"; a failure of the matcher itself says "Couldn't match the card: …"). The capture is never dropped, except an auto-mode capture in which OCR finds no line with at least three letters: the bare scanning area, which auto mode captures only when it took something else for the empty mat. It's kept discarded with its OCR result as the mark (§5.1.3), and the queue notes how many such captures it skipped in the last minute.
4. **A result that can't be saved at all** (the database failing, so not even for review) is logged and tried again: after 5 s, then twice as long each time, up to 5 minutes, until it's saved. The scan never stays identifying for good.

**5.1.3 Queue UI**
Each row shows the captured thumbnail next to the Scryfall image, the name, set and number, a confidence badge, a printing dropdown (all printings of that oracle card, newest first, with set name and number), a finish toggle (options limited to the printing's `finishes`, default from settings, preset to foil when the foil star was read: `★`, which on-device OCR reads as `*`), a quantity stepper, and a discard button.

- **Scanning into a deck.** Above the camera, "Scanning into" chooses where captures go besides the collection: the collection only, one of my decks and a board (Main, Sideboard, or Commander for a Commander or Casual deck), or **New deck…**, which creates a built deck (its cards are in hand). The choice is remembered for the rest of a scanning session (8 hours; a reload or a visit to another page keeps it), with the deck's creation time, so a new deck that reuses a deleted deck's id never inherits it, and forgotten once its deck is gone; a deck's **Scan cards into this deck** opens the page with that deck chosen. Each scan keeps the deck it was captured for, and its row says so ("For Elf Ball · Main", with **Change** to move that one scan), so switching decks never moves scans already taken. A capture for a deck deleted meanwhile goes to the collection only.
- A `review` row with a card offers **Looks right**, which accepts it as it is; like a card picked by hand, it then reads "Ready · confirmed". A "Check the printing" row also offers **Different card…**, and a "Not sure" row lists its candidates; both give a search box to pick any card by hand.
- A row whose OCR failed shows the error and **Try again**, which reads it again.
- **Send every scan here to…** (above the queue) moves every scan in the queue to one deck and board, or to the collection only, for a session begun with the wrong deck. It starts from where new captures go, and new captures then go where it sent the scans.
- An auto-mode capture of the same printing as the scan before it, itself an auto-mode capture (still in the queue or already added) taken within a minute, is marked: "Same card as the scan before it. Discard it if the camera caught one card twice." A hand reaching in, or a nudge to straighten the card, can make auto mode capture one card twice. Scans I discarded after they were read are skipped, so discarding a scan between two copies can mark the second; a capture auto mode took after seeing the empty mat (`lifted`, §5.1.1), a bare-mat capture between the two (dropped, §5.1.2), or a scan I discarded before it was read, means the card was lifted: the next copy of the same card, as when scanning a deck's four, isn't marked.
- **Commit** ("Add N cards to collection", or "Add N cards (M also to Elf Ball)") adds the ready rows the button counted: the `confident` rows, including `review` rows I've confirmed. A row that became ready after the count waits for the next commit. It upserts into `collection`, incrementing quantity, sets the rows to `committed`, and deletes their images (an image that can't be deleted is logged; the cards were added all the same). A scan with a deck also goes to that deck, in the same transaction: its copies first fill the copies of that card the deck lists on that board that earlier scans into it haven't (so scanning a deck planned first doesn't list its cards twice), and only the copies beyond those are added to the line; a new line shows the printing scanned. The toast says how many went to each deck.
- The `scan_auto_commit` setting (default off) commits a manual capture as soon as it's `confident`, to its deck too. Auto-mode captures always wait in the queue, so a double capture is never committed unseen. While the Scan page is open it says what auto-commit added (the queue lists what it added in the last minute) and refreshes the collection and decks.
- Discarding also deletes the image.

**5.1.4 OCR helper (`native/ocr.swift`)**
A persistent process that reads one JSON request per line on stdin (`{"id": "...", "path": "..."}`) and writes one JSON response per line on stdout:
```json
{"id":"...","width":1234,"height":1720,"lines":[{"text":"Lightning Bolt","confidence":0.98,"box":{"x":0.06,"y":0.04,"w":0.5,"h":0.04}}]}
```
- It uses `VNRecognizeTextRequest` with `recognitionLevel = .accurate`, `usesLanguageCorrection = false`, and `recognitionLanguages = ["en-US"]`.
- Boxes are normalized with the origin at the top-left.
- Errors produce `{"id":..., "error": "..."}`.
- The Node side (`ocr-client.ts`) keeps the process alive and sends it one image at a time, so each image's 10 s timeout starts when the helper starts on it: a slow image never times out the one behind it. A crash or a timeout fails the image being read and restarts the process; the images waiting go to the new one. An answer with no id (a request the helper couldn't read) is about the image being read, and a result the helper can't encode (a NaN) comes back as an error rather than not at all.

**5.1.5 Continuity Camera notes (shown in UI help)**
Both devices must be signed into the same Apple ID with Wi-Fi and Bluetooth on. For a USB connection, plug the iPhone in and trust the Mac. The iPhone should be locked, stationary, and in landscape orientation to be offered as a camera. Mount it over the scanning area.

**5.1.6 Benchmark (`pnpm ocr:bench`)**
Downloads about 70 Scryfall `large` images across frame eras (the 1993, 1997, 2003, and 2015 frames, 2020 and later, showcase/borderless, and split/DFC/adventure), runs OCR and the matcher, and prints accuracy per era and per decision. It also lists every card read as foil. Scryfall's image of a printing that comes in nonfoil shows the nonfoil card, so only foil-only printings should be listed. Only the modern collector line prints the `★`; an older foil-only printing prints none, so it isn't read as foil either. Used to tune §5.1.2 thresholds. Real phone captures will be noisier; the thresholds get re-checked with my own scans.

### 5.2 Search (`/search`; `/library` is the same page locked to My library with a stats header)

**5.2.1 Scopes**
- **All cards**: `GET /api/search/scryfall?q=&page=` proxies `GET https://api.scryfall.com/cards/search` with `unique=cards`. Results are annotated with ownership (owned, free, decks) by looking up `oracle_id` locally. Digital-only cards are left out of each page, so Scryfall's total counts some cards the pages don't show: beyond one page it reads "About N". A page past the last is empty, with a way back to the first. Library-only terms (`in:`, `free`, `qty`, `is:wanted`) get a hint that Scryfall reads them its own way, with a button to search My library.
- **My library**: `GET /api/search/library?q=&view=cards|printings&sort=&page=` runs the local compiler over `collection ⋈ cards`. Filters evaluate per owned printing and finish row. The `cards` view groups by `oracle_id`, summing quantities; the `printings` view shows each owned row.
- **Offline fallback**: if Scryfall is unreachable, All cards offers "Search local card data instead", which runs the same compiler over `cards`, on what's typed in the search box, with library-only filters disallowed.

**5.2.2 Query language (Scryfall-compatible subset), in `src/shared/search/` (parser) and `src/server/search/compile.ts` (AST → parameterized SQL)**

| syntax | meaning |
|---|---|
| bare words, `"quoted phrase"` | name contains (each term ANDed) |
| `!"Exact Name"` | exact name |
| `o:` / `oracle:` | rules text contains; `~` stands in for the card's own name |
| `t:` / `type:` | type line contains |
| `c:` / `color:` with `: = >= <= > < !=` | colors. `:` means `>=` (including). Values: `wubrg` letters, color names, guild/shard/wedge names, `c`/`colorless`, `m`/`multicolor` |
| `id:` / `identity:` / `ci:` | color identity. **`:` means `<=`** (fits within), matching Scryfall |
| `m:` / `mana:` | mana cost contains these symbols (`m:{G}{G}`, `m:2WW`) |
| `mv` / `cmc`, `pow` / `power`, `tou` / `toughness`, `loy` / `loyalty` with `= != < <= > >=` or `:` | numeric comparisons (on numeric shadow columns) |
| `r:` / `rarity:` with comparisons | common < uncommon < rare < mythic |
| `s:` / `set:` / `e:` / `edition:` | set code |
| `f:` / `format:` / `legal:`, `banned:`, `restricted:` | legality |
| `a:` / `artist:`, `ft:` / `flavor:`, `kw:` / `keyword:` | artist, flavor text, keyword |
| `usd` with comparisons | price (nonfoil usd) |
| `is:` | `commander` (legendary creature, or text says it can be your commander), `permanent`, `spell`, `dfc`, `split`, `promo` |
| `a b`, `a or b`, `-a`, `( … )` | AND (implicit), OR, NOT, grouping. OR binds looser than AND |
| **Library only:** `in:deck`, `in:built`, `in:prospective`, `in:"Deck Name"` | card identity appears in any, built, prospective, or named deck |
| **Library only:** `free`, `qty` / `own` with comparisons | free(o), owned(o) |
| **Library only:** `is:foil`, `is:nonfoil`, `is:etched` | finish of the owned row |
| **Library only:** `is:wanted` | in a prospective deck with short > 0 |

Unsupported keys produce an error that names the key. They are never silently ignored. The parser returns positioned errors for malformed input, which the UI underlines.

**5.2.3 Advanced form (Gatherer-style)**
Fields: Name, Rules text, Type (chips for supertypes, types, and subtypes with an autocomplete of known types), Colors plus mode (exactly / including / at most), Color identity plus the same modes, Mana cost, Mana value, Power, Toughness, Loyalty (each with a comparator), Rarity (multi-select), Set (autocomplete from `cards`), Format plus legal/banned/restricted, Artist, Flavor text, Keywords. In library scope it adds: In deck, Free copies, Quantity, Finish.

The form serializes to the query language, and the generated string is shown and editable live. Parsing a hand-typed query back into the form is **not** supported. Editing the text detaches the form, with a "Reset form" button.

**5.2.4 Results**
Before anything is typed, Search offers a few example queries. Grid view (card images) or list view (name, cost, type, set, P/T, price, owned/free, decks). Sort by name, mana value, price, color, rarity, or, in My library, date added or quantity (all matching copies of a card in the cards view, each row's copies in the printings view), either way round. Pagination is 60 per page for local results and follows Scryfall's pages for All cards.

**5.2.5 Card detail drawer** (opens from any card anywhere)
Large image with a flip button for DFCs, oracle text, legalities, and prices.

- **Your copies**: per owned printing and finish, with +/− steppers.
- **Add a copy**: printing picker and finish.
- **Decks**: the decks containing this card, with their status and copies, those on a maybe board too.
- **Add to deck**: a deck picker.

### 5.3 Collection management
- Manual add and remove via the detail drawer.
- The `/library` stats header shows total cards, unique cards, total value (Σ quantity × price for each finish), and the last-added date.
- **CSV import**: auto-detects headers, case-insensitive. Quantity from `Count`/`Quantity`/`Qty`. Name from `Name`/`Card Name`. Set from `Edition`/`Set`/`Set Code`/`Set Name`. Collector number from `Collector Number`/`Card Number`. Finish from `Foil` (truthy or `foil`/`etched`). A file with a set and a collector number needs no name column. Rows resolve by set+number, then set+name, then name (the card's default printing, §4.1). There's a preview step showing resolved, ambiguous, and unresolved rows before committing.
  - The file: Excel's `sep=` first line (padded with spaces or empty cells or not) sets the delimiter; a cell may have spaces before its opening quote; lines may end in CRLF, LF, or CR, inside quoted cells too.
  - TCGplayer: `Simple Name` is read before `Name` (a Name that isn't the Simple Name with a variant after it is noted). Trailing variant notes in parentheses or brackets ("Lightning Bolt (Borderless) [Foil]") are dropped one at a time, up to 8, then the rest at once, when the name as written matches no card (so a card whose own name ends in parentheses, like "Erase (Not the Urza's Legacy One) [Foil]", keeps them), and a misspelled name ending in parentheses is matched to the closest card whose name does (≥ 0.92, noted), not to the card named before its parentheses.
- **CSV export**: `Count,Name,Edition,Collector Number,Foil` (Moxfield-compatible), as `binder-collection-YYYY-MM-DD.csv` (local date). Text a spreadsheet could read as a formula (starting with `=`, `+`, `-`, or `@`, like "+2 Mace") is quoted.

### 5.4 Decks

**5.4.1 Deck list (`/decks`)**
Tabs for Built, Prospective, and All. Each deck card shows name, format, status, card count, completion % (Σ(n − short) / Σ n), cost to finish (and how many cards to buy have no price), and color identity pips; an empty deck says "No cards yet." instead. Actions: new, duplicate (a copy's name keeps within the 100-character limit), delete (with confirmation).

**5.4.2 Editor (`/decks/:id`)**
- **Left: search.** Scope toggle (All cards / My library), local name autocomplete (FTS), and a results list with "+" buttons that add to the selected board. Search results show owned/free badges.
- **Right: deck.** Grouped by board, then by type (Creature, Planeswalker, Instant, Sorcery, Artifact, Enchantment, Battle, Land) or by category (toggle). Each line has: quantity stepper (up to 999), name (hover shows the image), mana cost, status icon (✅ owned / ⚠️ in another built deck / 🛒 buy), price, and a menu (move board, set category, choose printing, remove). A maybe line short of copies says how many other built decks hold and how many this deck uses on its other boards. While a line is being moved or removed, its buttons wait until the list shows the change.
- A line whose card is no longer in the card data (Scryfall re-keyed it) stays, as "A card no longer in the card data", counting toward the deck's size but not its cost or completion, with a warning to remove it and add the card again. Its quantity and printing can't be changed (it can still be moved to another board, given a category, or removed), and export leaves it out.
- **Header**: name, format, status toggle, card count per board, completion, cost to finish, warnings count (each card's warnings once, whatever boards it's on), **Brainstorm with Claude** (§5.5), and **Scan cards into this deck** (§5.1.3). A deck that scanning has added to shows how much of it scans cover ("Scanned 56 of 60": each line counts its scanned copies up to its quantity, maybe left out), and each line "2 of 4 scanned"; these are the counts scanning uses to fill the list first (§5.1.3), and they can't be reset. A deck deleted in another window gives way to one message on the next edit.
- **Panels**: Deck health (format warnings), Mana curve (bar chart of main-board nonland mana values), Type counts.
- **Buy list tab**: table of short lines (quantity, name, cheapest price, link) and total. "Copy as text" (`4 Lightning Bolt` per line). A toggle to ignore basics (the setting, for every deck). Of printings with the same cheapest price, one with a TCGplayer link wins, then the first by id.
- **Import/export**: paste or export text. Accepted formats:
  - Arena (`4 Lightning Bolt (M11) 149`, section headers `Commander`, `Deck`, `Sideboard`)
  - MTGO (`4 Lightning Bolt`, `SB: 2 Duress`, or a blank line before the sideboard)
  - Moxfield (quantity, name, optional `(SET) number`, `*F*` for foil ignored)
  
  Resolution order: exact name → face name → fuzzy (≥ 0.92) → unresolved list shown to the user. Export produces Arena and MTGO formats.

### 5.5 Brainstorm (`/brainstorm`, `/brainstorm/:threadId`)
- A conversation list plus a chat view. `POST /api/ai/threads/:id/messages` streams Claude's answer as server-sent events: text and note deltas, a line per tool call ("Searching your library for `t:elf id:g`"), and how each call went. Each tool round is stored as it completes (the call with its results, in one transaction), so a failure keeps everything before it.
- Model `claude-opus-5-5` with adaptive thinking at effort `medium` (Opus 5.5's default, which does better than Opus 5 at `high`), up to 64k output tokens, streaming, and server-side refusal fallbacks (`fallbacks: "default"`; the chat notes when another model carried on). After a fallback, Anthropic may keep answering that conversation with the other model for about an hour (a message says so only in its model, with no fallback block), so the chat also notes wherever the answering model changes. Thinking display `updates` returns Claude's short notes between tool calls, shown in the chat; its reasoning stays hidden. A replayed thinking block whose conversation no longer matches (the system prompt or tools changed in a Binder update) is dropped rather than refused (`block_binding.prefix_mismatch_behavior: "drop_block"`). The system prompt never changes between requests, so it stays cached with the tools. It explains the formats, the ownership rules, the tools and search syntax, and asks for card names as `[[Name]]`, brief answers, and a few words before each lookup.
- Binder runs the loop with the SDK's streaming Messages API: each request streams; then Binder validates and runs the tool calls, stores the round, and asks again, up to 16 requests per answer, Binder's own retries included (an answer that reaches the limit ends with an error, and Continue allows 16 more; the SDK's own retries after a failed attempt, §6, aren't counted, and a failed attempt isn't billed). (The SDK's tool runner can't store a round atomically, or drop what a declining model wrote before a fallback, without Binder taking over its history.) Tool inputs stream as Claude writes them; one that isn't JSON at all is asked for again, twice at most.
- **Tools** (Zod schemas, checked before running; a failed call goes back to Claude as an error result):
  - `search_my_library(query, limit?)`: the local compiler over the owner's collection, sorted by name (25 results unless Claude asks for up to 60, with the total). Compact rows: name, mana cost, type, power/toughness or loyalty, price, owned, free, and the decks using it, each with its id ("Elves (deck 3, built, 1)"). A query Binder can't parse comes back as an error to fix.
  - `search_scryfall(query, limit?)`: Scryfall's search, most-played first (EDHREC rank), with the same rows. Scryfall's warnings about ignored terms are passed on.
  - `get_card(name)`: the Oracle text (each face), mana value, color identity, the formats it's legal in, price, and the owner's copies and decks. Names resolve like decklist import (exact, face, fuzzy ≥ 0.92); an unknown name suggests close ones.
  - `get_deck(deck_id | name)`: one deck, by id or by name (ignoring case): format, status, notes, boards, completion, cost to finish, warnings, and every line with its board, category, and status. A name several decks share lists their ids; an unknown one lists the owner's decks.
  - `create_prospective_deck(name, format, notes?, cards[{name, quantity, board?, category?}])`: resolves names like decklist import. Names that match no card are left out and reported, and names matched only approximately (fuzzy) are reported with the card they became; with none matched, no deck is made. Creates a prospective deck with those lines and categories and returns its id, name, format, card count, completion, cost to finish (and how many cards to buy have no price), the deck's own format warnings, and up to 10 of its cards'. The chat shows the deck (and any names left out) with **Open in deckbuilder**; approximate matches reach the owner through Claude's answer.
  - Every tool checks its input with its schema before running. A problem comes back as a short, readable error (at most 5 problems listed), and the chat's activity line never fails, whatever Claude sent.
- **Deck-scoped conversations**: "Brainstorm with Claude" in the deck editor starts a conversation with `deck_id`, or reopens the deck's newest one that nothing has been said in yet and that I haven't named, so clicking it again doesn't pile up empty conversations (the start page does the same for conversations about no deck). The deck's summary (every line with its status) goes into a text block before the first message, not into the system prompt, so the cache holds; `get_deck` reads the deck again later.
- Messages are stored as the content blocks sent and received, and replayed verbatim, with these exceptions: an answer cut off (`max_tokens` or the context window) keeps only its text; before a fallback partway through an answer only text is kept (the API's rule for sending such an answer back); and a declined turn (everything after Claude's last finished answer, up to its refusal: the question, any tool rounds, and any earlier unanswered question) is left out of later requests, though the chat still shows it. A stopped answer keeps the text of the request in progress and where another model took over (that request's notes and any partly written tool call go; earlier tool rounds are already stored with theirs); a tool round already running when Stop comes finishes and is stored. An answer that fails partway, or is stopped before Claude wrote anything, can be continued: Continue asks again from what's stored. The reason an answer failed shows beside Continue in the window that saw it; after a reload the page says only that Claude hasn't finished answering.
- While Claude works with nothing new to show (before its first words, while it writes a tool call, after each tool round, after a notice), the chat shows "Thinking…". A tool call's line appears only once the call is written, which for a whole deck can take a while, so the stream says when Claude starts one.
- A conversation that outgrows Claude's context window says so ("This conversation has grown too long for Claude. Start a new one to go on."), whether an answer was cut off by it or the conversation can't be sent at all. Either way an assistant message (its text, or empty) records it, so the notice stays after a reload and Continue isn't offered: it would only send the whole conversation again. The message box gives way to **Start a new conversation** too, for the same reason (the server refuses a message there). An empty assistant message is never sent back to Claude.
- One answer at a time per conversation; **Stop**, or leaving the page, stops it. A Stop in the first instant, before the server has begun the answer, drops the page's stream instead, which stops it the same way. A window that opens the conversation while Claude answers in another shows "Claude is answering in another window…" until it finishes; a window already open on it isn't told, and a message sent from it is refused as busy. A conversation can't be deleted while it answers. `[[Card]]` links in answers open the card's drawer (`GET /api/cards/named`, which settles names that collide once punctuation is ignored the way the tools do: the whole written name first, then an exact name, then a card from a regular set). Each conversation shows an estimated cost, from each answer's token usage at the prices of the model that wrote it (each attempt of a refusal fallback at its own model's; an attempt declined before it wrote anything isn't billed, so it isn't counted), updated when an answer ends. It is usually a little under what Anthropic bills (Binder prices a model it doesn't know as Opus 5, and a refusal fallback's cache repricing isn't modelled): a stopped request counts little more than its input (or nothing, if stopped before Claude wrote any text), and a request that came through garbled or failed partway isn't counted.
- With no key, the page explains and links to Settings; stored conversations stay readable.

### 5.6 Settings (`/settings`)
- **API key**: masked field, "Test" button, saved to `.env` with mode 600, and the server re-creates the Anthropic client. Only the `.env` key is used; the server never sends it back, only its last four characters. Brainstorm (§5.5) uses it; scanning never does.
- **Card data**: last updated, "Refresh now", progress.
- **Scanner**: auto-commit (manual captures only; auto mode's captures wait in the queue), default finish, accept uncertain printing (never a reading that contradicted the title).
- **Deckbuilder**: ignore basics in buy lists.
- **Backups**: last backup, "Back up now" (today's backup, or when that exists another copy of it, §6), folder path.
- **Library file**: its size (the library and its log, split out once the log holds 1 MB or more) and the unused space inside the file, and **Compact the library** (once at least 10 MB is unused, as replacing card data leaves, and not while card data is being refreshed): a backup first (as Back up now), then `VACUUM`, a rebuild of the name search index, and a log checkpoint. The toast says the sizes before and after, and the backup's name. The size counts the library's write-ahead log, which is kept to 64 MB on disk after each checkpoint.

### 5.7 First use and keyboard shortcuts
- **Getting started**: while the collection is empty, Look up shows three first steps under the finder: scan your cards, import a CSV (it opens the Library with the import panel), and scan or build a deck.
- **Empty states**: the Library, Search, Decks, deck editor, and Scan pages each say what to do next when there's nothing to show.
- **Keyboard shortcuts** (none while a text field or dropdown has focus, with Ctrl, Cmd, or Alt, or while the card details are open): `?` lists them (also the **?** button in the header, and **Keyboard shortcuts** under Getting started); `/` finds a card; `g` then a letter goes to a page (`h` Look up, `s` Search, `l` Library, `c` Scan, `d` Decks, `b` Brainstorm, `t` Settings; within 1.5 s); on the Scan page, Space captures (on a focused dropdown too, instead of opening it) and `a` switches between Auto and Manual.

## 6. Error handling
- **Scryfall client**: every request sends `User-Agent: Binder/0.1 (personal)` and `Accept: application/json`. A single-flight queue enforces ≥ 100 ms between requests. On 429, back off exponentially (1 s, 2 s, 4 s), and after 3 retries give up and pause the queue for 8 s. The bulk download gives up when no data has come for 60 s (30 minutes at most in all). Network errors are marked `offline` for UI messaging.
- **Bulk import**: staging table plus atomic swap (§4.2). On failure the old data stays live and `meta.bulk_error` is set and shown in Settings. Offline with card data already here, the error says so ("… The card data from DATE stays in use"), and the start logs why the data is stale ("Card data is 9 days old") before refreshing in the background.
- **Startup**: a port already in use, or a `PORT` that isn't a port number, prints one line saying so and exits with status 1. Scans a restart interrupted are picked up again only once the server is listening, so a second Binder started while one runs leaves the running one's scans alone.
- **Requests**: only from this computer (the Host header names it), and a request that changes something only from Binder's own page: an `Origin`, when sent, must name the same host and port as the request, and `Sec-Fetch-Site`, when sent, must be `same-origin` or `none`. The dev server's proxy keeps the page's own Host (`changeOrigin: false`), so the rule holds through `pnpm dev` too. Ids in URLs are plain numbers from 1; `0x1`, `1e0`, and `01` are no id (404).
- **API key file**: the key replaces the first `ANTHROPIC_API_KEY` line in place (keeping an `export`), removing any other; the rest of the file stays. A symlinked `.env` is written through to its target, a hard-linked one in place (made private before the key goes in); otherwise a temporary file is renamed over it. Leftovers of an interrupted write are removed, unless the process that left them is still running. Reading, a quoted value ignores what follows the closing quote, a `# comment` after a value is dropped, and a value starting with `#` is no key. A proxy header setting (`ANTHROPIC_CUSTOM_HEADERS`) can't replace the key's header.
- **Anthropic**: typed error handling with the SDK's error classes. A refused key (401) says to check it in Settings. Rate limits, overload (529), timeouts, and server errors are retried by the SDK (twice), then shown in the chat with Continue. A `refusal` stop reason (after the fallbacks) is shown as such. A tool call cut off by `max_tokens` is never run; the answer's text is kept and marked as cut off.
- **OCR helper**: timeout or crash restarts the process, and the item goes to review with the error (§5.1.4).
- **API responses**: errors are JSON `{error: {code, message}}` with the right HTTP status. The SPA shows toasts for mutations and inline errors for queries.
- **Backups**: compact copies made with `VACUUM INTO` (about half the live file's size), written under a temporary name and renamed when complete; a failed copy's temporary file is removed, and each backup first removes the partial copies (`binder-*.db.tmp`) that interrupted ones left. Removing old backups is best effort: one that can't be removed is logged and tried again next time. Each kind is pruned on its own, and never the backup just written. Restore one by stopping Binder and copying it over `data/binder.db` (deleting `binder.db-wal` and `binder.db-shm`).
  - **Daily**: at server start, if `last_backup_at` is more than 24 h old, or dated in the future (the clock was once set ahead), write `data/backups/binder-YYYY-MM-DD.db` (local date) and keep the newest 7. An existing backup for today is never replaced (after a restore it may hold newer data); the start logs that it's already there. A failed backup is logged and doesn't stop the app; the next start tries again.
  - **Back up now** (Settings): writes today's backup when there is none yet, or else an extra copy, `binder-YYYY-MM-DD-N.db`, numbered after the last copy kept that day. Extra copies are kept apart from the daily 7: the newest 3, by date and then copy, so pressing it never pushes out the week of daily backups. It records `last_backup_at`, so the next daily backup waits a day from it. A failure is shown, not logged.
  - **Before upgrading**: when the server start, `pnpm run setup`, or `pnpm ocr:bench` finds a migration pending on a database that already has migrations applied, it first logs "Backing up the database before upgrading it…" and writes `data/backups/binder-YYYY-MM-DD-before-NNN.db`, NNN being the first pending migration (another copy that day is `…-before-NNN-2.db`, and so on, numbered after the last one kept: an earlier copy is never replaced, and a new one is never numbered below one kept, which pruning would take for older). The newest 3 of these are kept, apart from the daily 7 and the extra copies. If the copy fails, the database isn't changed: the server (or script) prints one line saying why and exits with status 1 rather than upgrade a library it couldn't back up. A new, empty database is migrated without a copy.
- **Validation**: all request bodies and query params are validated with Zod at the route boundary.

## 7. Testing
Vitest, test-first for logic modules.
- **Fixtures**: `tests/fixtures/cards.json` holds about 60 real Scryfall card objects fetched once by `scripts/fetch-fixtures.ts`. They cover DFC, split, adventure, flip, X costs, hybrid and Phyrexian mana, colorless, lands, basics, "any number" cards, partner commanders, and multiple printings of the same card.
- **Search**: a parser test table (input → AST or error), plus a compiler test table (query → expected card names over the fixture DB). Scryfall-semantics cases (`c:` vs `id:`) get explicit tests.
- **Ownership**: owned, allocated, free, short, status, and buy list across built, prospective, and maybe combinations.
- **Formats**: every rule in §4.4.
- **Decklists**: parse and serialize round-trips for each format, plus the resolution order.
- **Matcher**: synthetic OCR outputs → decisions (exact set+number, name-only, ambiguous, junk).
- **Routes**: Hono `app.request()` against an in-memory database seeded from fixtures. Covers collection CRUD, deck CRUD, buy list, library search, and scan item lifecycle (with the OCR client stubbed).
- **Brainstorm**: a local fake of the Messages API (`tests/helpers/fake-anthropic.ts`) streams scripted answers in the wire format the SDK parses, so the chat loop, the tools, and the routes are tested without a key or any call to Anthropic.
- **Manual**: the scanner end-to-end with the iPhone, and brainstorm with a real key.

## 8. Build milestones
Each milestone ends with a working app.
1. **Foundation**: scaffold, database and migrations, Scryfall client, bulk import, Settings (card data section), card detail drawer (read-only).
2. **Search**: parser and compiler, library and Scryfall scopes, advanced form, results views, ownership badges.
3. **Collection**: add/remove in the drawer, `/library` stats, CSV import/export.
4. **Decks**: list, editor, format rules, status, buy list, decklist import/export.
5. **Scanner**: capture UI, OCR helper, matcher, benchmark, queue, commit. Plus the API key setting, for brainstorm.
6. **Brainstorm**: threads, streaming chat, tools, save-to-deck.
7. **Deck scanning and polish**: scanning into a deck, the Settings backups section, and the fixes first use asked for.
8. **Polish**: the follow-ups left in `docs/plans/m*-followups.md`, empty states, keyboard shortcuts.

Implementation plans are written per milestone.
