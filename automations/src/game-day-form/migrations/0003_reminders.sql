-- Game-day reminder emails (functional spec §8.5).
-- Each team's To and Cc lists, as JSON arrays of lower-case addresses. A team with no row has no reminders.
CREATE TABLE team_reminders (
  team_slug  TEXT PRIMARY KEY,
  to_emails  TEXT NOT NULL DEFAULT '[]',
  cc_emails  TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

-- One row per team per game day: claimed as 'sending' before the email goes, then 'sent' or 'failed'.
-- Only a 'failed' row is tried again, so nobody gets the same reminder twice.
CREATE TABLE reminder_log (
  team_slug  TEXT NOT NULL,
  game_date  TEXT NOT NULL,
  game_ids   TEXT NOT NULL,
  status     TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 1,
  resend_id  TEXT,
  error      TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_slug, game_date)
);
