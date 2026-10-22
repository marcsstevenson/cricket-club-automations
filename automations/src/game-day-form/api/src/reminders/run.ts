import { nzDate } from '../../../shared/src/dates';
import type { Deps, Env } from '../env';
import { teamFixture, type FixtureGame } from '../playhq/fixture';
import { playhqService } from '../playhq/service';
import { reportStatuses } from '../reports/repo';
import { loadSquad } from '../squad/load';
import { loadContacts } from './contacts';
import { reminderEmail, sendEmail } from './email';

/** Reminders go between these hours (New Zealand time) on a game day. */
export const SEND_HOUR = 18;
export const LAST_HOUR = 22;
/** A game counts as played this long after its start time. */
export const GAME_HOURS = 3;

function nzParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { hour: get('hour'), minute: get('minute') };
}

/** The hour of the day in New Zealand, 0–23. */
export function nzHour(d: Date): number {
  return nzParts(d).hour;
}

/** Whether a game today has been played by `minutes` past midnight. A game with no start time counts as played by 6 pm. */
function played(g: FixtureGame, minutes: number): boolean {
  const m = g.time?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return true;
  return Number(m[1]) * 60 + Number(m[2]) + GAME_HOURS * 60 <= minutes;
}

/**
 * Emails each team about each of today's games that has been played with no report yet. Runs from the cron every
 * hour from 05:00 to 10:00 UTC and sends only between 6 pm and 10 pm in NZ, whatever the season. Each game gets at
 * most one reminder, sent at the first run after it's played, and a failed send is tried again on a later run.
 */
export async function runReminders(env: Env, deps: Deps, waitUntil: (p: Promise<unknown>) => void) {
  const result = { sent: 0, failed: 0 };
  const now = deps.now();
  const nz = nzParts(now);
  if (!env.RESEND_API_KEY || nz.hour < SEND_HOUR || nz.hour > LAST_HOUR) return result;

  const contacts = await loadContacts(env.DB);
  if (![...contacts.values()].some((c) => c.to.length)) return result;
  const squad = await loadSquad(env, now);
  const today = nzDate(now);
  const service = playhqService(env, deps, waitUntil);

  for (const team of squad.teams) {
    const to = contacts.get(team.slug);
    if (!to?.to.length || !team.playhqGradeId) continue;
    let games;
    try {
      games = teamFixture((await service.fixture(team.playhqGradeId)).data, team.playhqTeamId).filter((g) => g.date === today);
    } catch (err) {
      console.warn(JSON.stringify({ msg: 'reminder_fixture_unavailable', team: team.slug, error: String(err) }));
      continue;
    }
    const due = games.filter((g) => played(g, nz.hour * 60 + nz.minute));
    if (!due.length) continue;
    const reported = await reportStatuses(env.DB, squad.season.playhqSeasonId, team.slug);

    for (const game of due.filter((g) => !reported.has(g.gameId))) {
      // Claim the game's reminder: a new row, or a retry of a failed one. Anything else means it's already handled.
      const claimed = await env.DB.prepare(
        `INSERT INTO reminder_log (team_slug, game_id, game_date, status, attempts, updated_at) VALUES (?, ?, ?, 'sending', 1, ?)
         ON CONFLICT (team_slug, game_id) DO UPDATE SET status = 'sending', attempts = attempts + 1, game_date = excluded.game_date,
           updated_at = excluded.updated_at
         WHERE reminder_log.status = 'failed'
         RETURNING attempts`,
      )
        .bind(team.slug, game.gameId, today, now.toISOString())
        .first<{ attempts: number }>();
      if (!claimed) continue;

      const email = reminderEmail({ team, games: [game], siteUrl: env.SITE_URL });
      const sent = await sendEmail(env, deps.fetch, to, email, `reminder-${team.slug}-${game.gameId}`);
      await env.DB.prepare('UPDATE reminder_log SET status = ?, resend_id = ?, error = ?, updated_at = ? WHERE team_slug = ? AND game_id = ?')
        .bind(sent.ok ? 'sent' : 'failed', sent.ok ? sent.id : null, sent.ok ? null : sent.error, deps.now().toISOString(), team.slug, game.gameId)
        .run();
      console.log(
        JSON.stringify({ msg: sent.ok ? 'reminder_sent' : 'reminder_failed', team: team.slug, game: game.gameId, date: today, attempt: claimed.attempts, ...(sent.ok ? {} : { error: sent.error }) }),
      );
      if (sent.ok) result.sent++;
      else result.failed++;
    }
  }
  return result;
}
