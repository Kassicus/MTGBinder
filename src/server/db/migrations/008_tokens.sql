-- Scryfall's tokens and emblems (spec §4.1, M12): one row per token identity, from its newest paper printing. They're
-- never in `cards`, so search, the library, and decks never see them.
CREATE TABLE tokens (
  oracle_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  layout TEXT NOT NULL,
  type_line TEXT NOT NULL,
  oracle_text TEXT NOT NULL,
  power TEXT,
  toughness TEXT,
  colors TEXT NOT NULL,
  image_small TEXT,
  image_normal TEXT,
  card_faces TEXT
);

-- Which tokens each card makes (by oracle id), from Scryfall's all_parts.
CREATE TABLE card_tokens (
  oracle_id TEXT NOT NULL,
  token_oracle_id TEXT NOT NULL,
  PRIMARY KEY (oracle_id, token_oracle_id)
) WITHOUT ROWID;
