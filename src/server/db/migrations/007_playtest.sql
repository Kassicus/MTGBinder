-- The playtest's game in progress (spec §4.1, §5.9): at most one, as its setup (JSON: the model version, the seed, the
-- seats' deck snapshots, starting life, the starting seat, and whether it draws on turn 1) and its actions in order.
CREATE TABLE playtest_game (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  setup TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE playtest_actions (
  game_id INTEGER NOT NULL REFERENCES playtest_game (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, seq)
);
