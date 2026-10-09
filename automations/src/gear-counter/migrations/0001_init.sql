-- One stocktake per team (or the pool) per NZ calendar day.
CREATE TABLE stocktakes (
  id TEXT PRIMARY KEY,
  team_slug TEXT NOT NULL,
  date TEXT NOT NULL,        -- YYYY-MM-DD, New Zealand
  created_at TEXT NOT NULL,
  UNIQUE (team_slug, date)
);

-- Name, category and sort are copied from the catalogue so old stocktakes survive catalogue changes.
CREATE TABLE lines (
  stocktake_id TEXT NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  sort INTEGER NOT NULL,
  expected INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  added INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (stocktake_id, item_id)
);
