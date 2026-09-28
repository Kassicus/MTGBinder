-- Scryfall mirror: one row per paper printing.
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  oracle_id TEXT NOT NULL,
  name TEXT NOT NULL,
  face_names TEXT NOT NULL,
  search_name TEXT NOT NULL,
  lang TEXT NOT NULL,
  layout TEXT NOT NULL,
  released_at TEXT NOT NULL,
  set_code TEXT NOT NULL,
  set_name TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  rarity TEXT NOT NULL,
  mana_cost TEXT NOT NULL,
  cmc REAL NOT NULL,
  type_line TEXT NOT NULL,
  oracle_text TEXT NOT NULL,
  flavor_text TEXT,
  power TEXT,
  toughness TEXT,
  loyalty TEXT,
  power_num REAL,
  toughness_num REAL,
  loyalty_num REAL,
  colors TEXT NOT NULL,
  color_identity TEXT NOT NULL,
  keywords TEXT NOT NULL,
  legalities TEXT NOT NULL,
  games TEXT NOT NULL,
  finishes TEXT NOT NULL,
  artist TEXT,
  prices TEXT NOT NULL,
  image_normal TEXT,
  image_small TEXT,
  image_art_crop TEXT,
  card_faces TEXT,
  purchase_uris TEXT,
  scryfall_uri TEXT NOT NULL,
  is_promo INTEGER NOT NULL DEFAULT 0,
  is_digital INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cards_oracle ON cards (oracle_id);
CREATE INDEX cards_set_number ON cards (set_code, collector_number);
CREATE INDEX cards_name ON cards (name COLLATE NOCASE);

-- One row per card identity (oracle_id) for autocomplete and OCR matching.
CREATE TABLE card_names (
  oracle_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  face_names TEXT NOT NULL,
  search_name TEXT NOT NULL,
  default_card_id TEXT NOT NULL
);
CREATE INDEX card_names_search ON card_names (search_name);
CREATE VIRTUAL TABLE card_names_fts USING fts5 (
  search_name,
  content = 'card_names',
  content_rowid = 'rowid',
  tokenize = 'trigram'
);

CREATE TABLE collection (
  id INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards (id),
  finish TEXT NOT NULL CHECK (finish IN ('nonfoil', 'foil', 'etched')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (card_id, finish)
);

CREATE TABLE decks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prospective', 'built')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE deck_cards (
  id INTEGER PRIMARY KEY,
  deck_id INTEGER NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  oracle_id TEXT NOT NULL,
  preferred_card_id TEXT REFERENCES cards (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  board TEXT NOT NULL CHECK (board IN ('commander', 'main', 'side', 'maybe')),
  category TEXT,
  UNIQUE (deck_id, oracle_id, board)
);
CREATE INDEX deck_cards_oracle ON deck_cards (oracle_id);

CREATE TABLE scan_items (
  id INTEGER PRIMARY KEY,
  image_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'identifying', 'confident', 'review', 'committed', 'discarded')),
  method TEXT CHECK (method IN ('ocr', 'claude', 'manual')),
  ocr_json TEXT,
  candidates TEXT NOT NULL DEFAULT '[]',
  card_id TEXT REFERENCES cards (id),
  finish TEXT NOT NULL DEFAULT 'nonfoil' CHECK (finish IN ('nonfoil', 'foil', 'etched')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  confidence REAL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX scan_items_status ON scan_items (status);

CREATE TABLE ai_threads (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  deck_id INTEGER REFERENCES decks (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES ai_threads (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
