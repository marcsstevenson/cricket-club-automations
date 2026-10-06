-- Pairs-cricket check flags (functional spec §6.3.3). NULL check_actual = no flag.
ALTER TABLE milestones ADD COLUMN check_actual REAL;
ALTER TABLE milestones ADD COLUMN check_share INTEGER;
ALTER TABLE milestones ADD COLUMN checked INTEGER NOT NULL DEFAULT 0;
