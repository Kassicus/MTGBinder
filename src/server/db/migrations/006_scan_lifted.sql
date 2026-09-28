-- 1 for an auto-mode capture taken after auto mode saw the empty scanning area (the card before it was lifted), so a
-- copy of the same card isn't marked as the card caught twice (spec §5.1.3). Auto mode no longer photographs the mat.
ALTER TABLE scan_items ADD COLUMN lifted INTEGER NOT NULL DEFAULT 0;
