import { nzDate } from '../../../shared/src/dates';
import type { Deps, Env } from '../env';
import { teamFixture } from '../playhq/fixture';
import { playhqService } from '../playhq/service';
import { reportStatuses } from '../reports/repo';
import { loadSquad } from '../squad/load';
import { loadContacts } from './contacts';
import { reminderEmail, sendEmail } from './email';

/** Reminders go from this hour (New Zealand time) on a game day. */
export const SEND_HOUR = 18;

/** The hour of the day in New Zealand, 0–23. */
export function nzHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: 'numeric', hourCycle: 'h23' }).format(d));
}

/**
 * Emails each team that has a game today with no report yet. Runs from the cron at 05:00 and 06:00 UTC, so one run
 * lands on 6 pm in NZ whatever the season; a team gets at most one reminder a day, and a failed send is tried again
 * on a later run that day.
 */
export async function runReminders(env: Env, deps: Deps, waitUntil: (p: Promise<unknown>) => void) {
  const result = { sent: 0, failed: 0 };
  const now = deps.now();
  if (!env.RESEND_API_KEY || nzHour(now) < SEND_HOUR) return result;

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
    if (!games.length) continue;
    const reported = await reportStatuses(env.DB, squad.season.playhqSeasonId, team.slug);
    const missing = games.filter((g) => !reported.has(g.gameId));
    if (!missing.length) continue;

    // Claim the day's reminder: a new row, or a retry of a failed one. Anything else means it's already handled.
    const claimed = await env.DB.prepare(
      `INSERT INTO reminder_log (team_slug, game_date, game_ids, status, attempts, updated_at) VALUES (?, ?, ?, 'sending', 1, ?)
       ON CONFLICT (team_slug, game_date) DO UPDATE SET status = 'sending', attempts = attempts + 1, game_ids = excluded.game_ids,
         updated_at = excluded.updated_at
       WHERE reminder_log.status = 'failed'
       RETURNING attempts`,
    )
      .bind(team.slug, today, missing.map((g) => g.gameId).join(','), now.toISOString())
      .first<{ attempts: number }>();
    if (!claimed) continue;

    const email = reminderEmail({ team, games: missing, siteUrl: env.SITE_URL });
    const sent = await sendEmail(env, deps.fetch, to, email, `reminder-${team.slug}-${today}`);
    await env.DB.prepare('UPDATE reminder_log SET status = ?, resend_id = ?, error = ?, updated_at = ? WHERE team_slug = ? AND game_date = ?')
      .bind(sent.ok ? 'sent' : 'failed', sent.ok ? sent.id : null, sent.ok ? null : sent.error, deps.now().toISOString(), team.slug, today)
      .run();
    console.log(JSON.stringify({ msg: sent.ok ? 'reminder_sent' : 'reminder_failed', team: team.slug, date: today, attempt: claimed.attempts, ...(sent.ok ? {} : { error: sent.error }) }));
    if (sent.ok) result.sent++;
    else result.failed++;
  }
  return result;
}
