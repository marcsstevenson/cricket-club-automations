-- Pools can describe themselves (shown instead of "Spare gear in storage"); docs/spec.md §2.
ALTER TABLE teams ADD COLUMN description TEXT;
