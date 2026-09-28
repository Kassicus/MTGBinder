-- Why a scan in review needs a look (spec §5.1.2): 'printing' when the card is certain but its printing isn't,
-- 'unsure' when the card itself isn't. NULL for scans that don't need one.
ALTER TABLE scan_items ADD COLUMN reason TEXT CHECK (reason IN ('printing', 'unsure'));
-- 1 for captures taken by auto mode, which may be of the bare scanning area after a card was lifted.
ALTER TABLE scan_items ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
