# Binder

Personal MTG collection manager for this Mac: open Binder.app, or run `pnpm start` in a terminal. Either way it's at
http://localhost:4321.

## First run

```bash
pnpm install
pnpm run setup      # builds the OCR helper, creates data/binder.db, imports Scryfall card data (~1 min)
pnpm start          # builds the UI and serves everything at http://localhost:4321
```

With an empty collection, **Look up** shows three ways to start: scan your cards, import a CSV, or scan or build a
deck. Press `?` (anywhere but a text box or dropdown) for the keyboard shortcuts.

## Binder.app

Binder also comes as a Mac app, with its own window and a menu-bar icon. Build it and put it in Applications with:

```bash
pnpm app            # draws the icons, builds the UI and the OCR helper, packages Binder.app, installs it
```

The first time, move your library into it, with Binder quit:

```bash
pnpm move-library   # copies data/ to ~/Library/Application Support/Binder; data/ is left as it was
```

Then open Binder from Spotlight, Launchpad, or Applications, and enter your Anthropic API key again in Settings (it
isn't copied). Closing the window keeps Binder running in the menu bar, so scans finish and card data refreshes;
click the menu-bar icon, then **Open Binder** (or click the Dock icon) to open it again; **Quit Binder** in the
menu-bar icon's menu, or Cmd+Q, stops it. Opening Binder again while it runs brings its window forward, and links to
Scryfall and other sites open in your browser.
The first time you open Scan, macOS asks whether Binder may use the camera; your iPhone appears through Continuity
Camera as it does in a browser. If it's refused (by mistake, or after an update), turn Binder on in System Settings →
Privacy & Security → Camera, then quit and reopen Binder; if its switch is already on and the camera still won't
start, clear the old permission with `tccutil reset Camera local.binder.app` in Terminal, then reopen Binder.
Binder.app is signed on this Mac, not by a developer account, so macOS may ask again after an update.

Binder.app keeps everything in `~/Library/Application Support/Binder`: the library, its backups and card data, the
key, its window's own files (`Electron/`), and the server's log (`Logs/binder.log`, the run before in
`binder.previous.log`). To update it, quit Binder and run `pnpm app` again. `pnpm start` still runs Binder from the
terminal on the project's `data/`, and says so when Binder.app keeps its own library.

## Searching

Open **Search**. Choose **All cards** (Scryfall, full Scryfall syntax) or **My library** (your collection).
Queries use Scryfall syntax: `t:creature c:g mv<=3 o:"draw a card"`, `id<=bg is:commander`, `-t:land r>=rare`.
My library also understands `in:deck`, `in:built`, `in:"Deck Name"`, `free>0`, `qty>=2`, `is:foil`, `is:wanted`, and
`is:unpriced` (copies with no price, which the Library's value leaves out: its "without a price" note links there).
**Advanced ▾** opens a form that writes the query for you. If Scryfall is unreachable, Search offers to search the
local card data instead. Scryfall's totals beyond one page read "About N": it counts digital-only cards that Binder
leaves out.

## Your library

Open any card (from Look up, Search, Library, Sets, or the `/` finder) to see **Your copies**. Step them up or down,
or pick a printing and finish under **Add a copy**. **Library** lists what you own, with totals (cards, unique cards, and
value at each copy's finish price), and searches only your collection. Sort it by **Quantity** (with the ↑/↓ button
for either way round) to see what you have the most, or the fewest, copies of.

**Import CSV** reads exports from Moxfield, Deckbox, ManaBox, Archidekt, TCGplayer, and Dragon Shield, or any CSV with
Count and Name columns (add Edition and Collector Number to pin the printing; with those two, the name is optional). It shows how each row matched before
anything is added, and it adds to your library rather than replacing it. **Export CSV** writes
`Count,Name,Edition,Collector Number,Foil`, which Moxfield and most other apps can import.

## Sets

**Sets** lists every set you own a card from, with how much of it you have: "85 / 276 30%". A set counts as
complete when you own one copy of each card in it, in any printing from that set (a showcase or borderless copy counts
for its card) and any finish; a copy of the same card from another set counts for that set instead. Percentages round
down, so only a complete set shows 100%, with a gold bar. Sort by completion, release date, name, or cards owned, and
filter by name or code. Open a set to see every card in collector-number order, the ones you're missing dimmed;
**Missing only** lists just those. Click a card to add a copy.

## Decks

**Decks** lists your decks: built ones (you've put them together from cards you own) and prospective ones (ideas).
Each shows what the whole deck costs, how complete it is, and what the missing cards cost. In a deck:
- search on the left and press **+** to add cards, or paste a list under **Import / Export** (Arena, MTGO, or
  Moxfield text);
- each card shows ✅ **Owned**, ⚠️ **N held by other built decks**, or 🛒 **Buy N** (hover the icon for the words).
  On the maybe board of a built deck, ⚠️ says **N already used by this deck** when the deck's own other boards hold
  the copies. **Buy list** totals the missing cards with TCGplayer links;
- **Deck health** flags format problems (size, copies, legality, commander color identity) without blocking anything;
- a deck you've scanned into shows **Scanned N of M** in its header, and each card how many of its copies were scanned.

Basic lands are left out of completion, cost to finish, and the buy list by default (Settings → Deckbuilder).

Any card's details also offer **Add to deck**.

## Brainstorm

Open **Brainstorm** to ask Claude what to build next, or how to improve a deck. Claude searches your library and
Scryfall, reads your decks, and can save an idea as a prospective deck (**Open in deckbuilder**). In a deck, **Brainstorm
with Claude** starts a conversation about that deck. Card names in answers open the card, and Claude's notes show what
it's checking as it works.

Brainstorming needs your Anthropic API key (Settings → Anthropic API key) and uses Claude Opus 5.5. Each conversation
shows an estimate of what it has cost so far (usually a little under what Anthropic bills). Every message sends the
whole conversation again; Anthropic caches it for 5 minutes, and the first message after a pause pays to cache it again.
So a long conversation costs more per message: start a new one for a new idea. A conversation answers one message at a
time. **Stop** ends an answer early and keeps what it said; so does leaving the page, opening another conversation, or
following a deck link while Claude answers. When an answer fails partway, **Continue** asks again.

## Scanning

Open **Scan** and pick your iPhone as the camera. It appears through Continuity Camera when both devices share an
Apple ID with Wi-Fi and Bluetooth on; lock the iPhone and mount it in landscape over the scanning area. Put a card in
the guide and press **Capture** (or Space), or switch to **Auto**, which captures each card once it holds still.
Auto starts by learning the empty mat, so start with the guide clear; the line under the camera says what it's doing.

Binder reads each card with the Mac's own text recognition:
- most cards printed since 2015 come back **Ready**, with their exact printing;
- older cards, which print no set code, often come back as **Check the printing**, with the likeliest one picked;
- anything it can't read is **Not sure**: pick the card from its suggestions or search for it.

Correct the printing, finish, or count on any row, then press **Add N cards to collection**, which adds the ready
rows it counted. A card whose collector line has the foil star (★, which the Mac reads as `*`) starts as **Foil**
when its printing comes in foil.
Auto mode captures a card again when it's nudged or moved; the second row then says "Same card as the scan before it.
Discard it if the camera caught one card twice." Lifting the card, and leaving the mat empty for about a second,
between two copies of it keeps them apart.

To scan a deck you own, choose it (or **New deck…**) under **Scanning into**, or press **Scan cards into this deck** in
the deck. Its cards go to your collection and the deck at once: they first fill the copies the deck already lists, so a
deck you planned first isn't doubled, and only extra copies are added. Each row says which deck and board it goes to,
with **Change** for a scan taken while the wrong deck was chosen. The deck stays chosen for the rest of the session;
check **Scanning into** before you start. If you forgot, **Send every scan here to…** above the queue moves every scan
waiting there to the right deck (and new captures follow). A row you accept with **Looks right** reads **Ready ·
confirmed**. Auto mode doesn't photograph the empty mat; if it ever does, the capture is skipped and the queue says how
many.

Scanning happens entirely on this Mac. Settings → Scanner can **Add manual captures to the collection as soon as
they're identified confidently** (auto mode's captures always wait in the queue), choose what **Scans start as**, or
**Accept a card whose printing is uncertain, with its likeliest printing** (old cards; never one whose set, number, or
year contradicted its name). (Settings → Anthropic API key is for Claude's deckbuilding help, saved in `.env` and
readable only by you.)

Scanning needs Xcode's command line tools (`xcode-select --install`) to build the OCR helper, `bin/ocr`, from
`native/ocr.swift`; the server rebuilds it when the source changes. `pnpm ocr:bench` measures recognition on about 70
Scryfall card images, downloaded once into `data/bench`.

## Keyboard shortcuts

`?` lists them. `/` finds a card. `g` then a letter goes to a page: `g h` Look up, `g s` Search, `g l` Library,
`g e` Sets, `g c` Scan, `g d` Decks, `g b` Brainstorm, `g t` Settings. On the Scan page, Space captures and `a` switches between
Auto and Manual. None of them fire while a text field or dropdown has focus. (Space still captures on a focused
dropdown, instead of opening it.)

## Development

```bash
pnpm dev            # API on :4321 (auto-restarts) + Vite on http://localhost:5173
pnpm app:dev        # Binder.app's window, run from the project on data/ (no packaging): its key is data/.env
                    # (not the project's .env), and it writes data/Electron/ and data/Logs/
pnpm app --no-install   # packages Binder.app into release/ without installing it
pnpm test           # unit and integration tests
pnpm typecheck
```

Card data refreshes automatically at startup when it's older than 7 days (or when a Binder update needs
something new from it), or from Settings → Card data.
Everything lives in `data/` (database, downloads, and backups in `data/backups`: a backup is written when Binder
starts and the last one is over 24 hours old, and the newest 7 are kept).
Settings → Backups shows the last backup and the folder, and **Back up now** saves one on demand (once today's backup
exists it saves an extra copy; the newest 3 extra copies are kept, apart from the daily 7).
Before a Binder update changes the database's structure, it also saves `binder-YYYY-MM-DD-before-NNN.db` there (the
newest 3 are kept); if it can't, it doesn't start, and the database is left as it was.
To restore a backup, stop Binder and copy it over `data/binder.db` (Binder.app's is
`~/Library/Application Support/Binder/binder.db`), deleting `binder.db-wal` and `binder.db-shm`. Set
`BINDER_DATA_DIR` to use a different folder.
Replacing card data leaves unused space inside `data/binder.db`; Settings → Library file shows how much (its size
also counts the log beside the file), and **Compact the library** gives it back (after a backup).
If port 4321 is taken (Binder may already be running, from a terminal or as Binder.app in the menu bar), start with
`PORT=4322 pnpm start`.
