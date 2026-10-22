-- Game-day reminders go once per game, after it's been played (functional spec §8.5), so the log is keyed by game
-- instead of by team and day. The old log held no rows when this was written.
DROP TABLE reminder_log;

-- One row per team per game: claimed as 'sending' before the email goes, then 'sent' or 'failed'.
-- Only a 'failed' row is tried again, so nobody gets the same game's reminder twice. A game between two club teams
-- has a row for each.
CREATE TABLE reminder_log (
  team_slug  TEXT NOT NULL,
  game_id    TEXT NOT NULL,
  game_date  TEXT NOT NULL,
  status     TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 1,
  resend_id  TEXT,
  error      TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_slug, game_id)
);
