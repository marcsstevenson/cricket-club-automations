CREATE TABLE named_players (
  id          TEXT PRIMARY KEY,
  full_name   TEXT NOT NULL,
  playhq_id   TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE reports (
  id                TEXT PRIMARY KEY,
  season_id         TEXT NOT NULL,
  team_slug         TEXT NOT NULL,
  game_id           TEXT NOT NULL,
  game_date         TEXT NOT NULL,
  scoring           TEXT NOT NULL CHECK (scoring IN ('yes','no','yes_issues','not_played')),
  issues            TEXT,
  not_played_reason TEXT CHECK (not_played_reason IN ('rain','cancelled','forfeit','other')),
  not_played_other  TEXT,
  team_runs INTEGER, team_wkts INTEGER, opp_runs INTEGER, opp_wkts INTEGER,
  score_source      TEXT CHECK (score_source IN ('playhq','entered')),
  potd_key TEXT,   potd_named_id TEXT REFERENCES named_players(id),
  mascot_key TEXT, mascot_named_id TEXT REFERENCES named_players(id),
  highlights        TEXT,
  version           INTEGER NOT NULL,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT,
  UNIQUE (season_id, team_slug, game_id)
);

CREATE TABLE milestones (
  id           TEXT PRIMARY KEY,
  report_id    TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('bat','bowl','hattrick')),
  player_key   TEXT,
  named_id     TEXT REFERENCES named_players(id),
  value        INTEGER,
  source       TEXT NOT NULL CHECK (source IN ('playhq','entered')),
  playhq_value INTEGER,
  touched      INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  report_id   TEXT REFERENCES reports(id) ON DELETE SET NULL,
  r2_key      TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE report_versions (
  report_id   TEXT NOT NULL REFERENCES reports(id),
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,
  saved_at    TEXT NOT NULL,
  saved_by    TEXT,
  PRIMARY KEY (report_id, version)
);

CREATE INDEX reports_list ON reports (season_id, game_date);
CREATE INDEX milestones_report ON milestones (report_id);
CREATE INDEX photos_orphans ON photos (report_id, created_at);
