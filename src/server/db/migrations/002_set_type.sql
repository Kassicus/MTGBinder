-- Scryfall's set type (expansion, core, masters, commander, promo, box, memorabilia, funny, masterpiece, ...).
-- It decides each card's default printing. Rows imported before this migration hold '' until the next import.
ALTER TABLE cards ADD COLUMN set_type TEXT NOT NULL DEFAULT '';
