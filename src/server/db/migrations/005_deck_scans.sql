-- Scanning into a deck (spec §4.1, §5.1.3): a scan can go to a deck's board as well as the collection. A deleted deck
-- leaves its scans for the collection only.
ALTER TABLE scan_items ADD COLUMN deck_id INTEGER REFERENCES decks (id) ON DELETE SET NULL;
ALTER TABLE scan_items ADD COLUMN board TEXT CHECK (board IN ('commander', 'main', 'side'));
-- 1 for a scan the worker added to the collection by itself (auto-commit), so the Scan page can say so.
ALTER TABLE scan_items ADD COLUMN auto_committed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX scan_items_deck ON scan_items (deck_id, board) WHERE deck_id IS NOT NULL;
