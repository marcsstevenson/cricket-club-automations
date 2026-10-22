import type { Context, Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, clientIp } from '../errors';
import { nzDate } from '../../../shared/src/dates';
import { teamFixture, type FixtureGame } from '../playhq/fixture';
import { loadContacts, reminderTeams, saveContacts, validateContacts, type Contacts } from '../reminders/contacts';
import { reminderEmail, sendEmail } from '../reminders/email';
import { findTeam, loadSquad, type Team } from '../squad/load';
import { phq, type Ctx } from './context';
import { allRows, csvResponse, gamesCsv, milestonesCsv } from './list';

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function requireAdmin(c: Context<AppEnv>) {
  c.header('cache-control', 'no-store');
  if (!c.env.ADMIN_PASSCODE) throw new ApiError(503, 'admin_disabled', 'Admin exports are not configured.');
  if (!(await c.get('deps').limit(c.env, 'ADMIN_LIMIT', clientIp(c.req.header('cf-connecting-ip'))))) {
    throw new ApiError(429, 'rate_limited', 'Too many attempts — wait a minute and try again.');
  }
  if (!(await safeEqual(c.req.header('x-admin-passcode') ?? '', c.env.ADMIN_PASSCODE))) {
    throw new ApiError(401, 'unauthorised', 'Wrong passcode.');
  }
}

/** A game to show in a test email: today's, else the latest played, else the next one, else a made-up one. */
async function sampleGame(c: Ctx, team: Team, today: string): Promise<FixtureGame> {
  const sample: FixtureGame = { gameId: 'sample', date: today, round: 'R1', opposition: 'Example Opposition', venue: 'Parklands Reserve', status: '' };
  if (!team.playhqGradeId) return sample;
  try {
    const games = teamFixture((await phq(c).fixture(team.playhqGradeId)).data, team.playhqTeamId).filter((g) => g.date);
    return games.find((g) => g.date === today) ?? games.filter((g) => g.date! < today).at(-1) ?? games[0] ?? sample;
  } catch {
    return sample;
  }
}

function noStore(res: Response) {
  res.headers.set('cache-control', 'no-store');
  return res;
}

export function registerAdmin(app: Hono<AppEnv>) {
  app.get('/admin/check', async (c) => {
    await requireAdmin(c);
    return c.json({ ok: true });
  });
  app.get('/admin/reminders', async (c) => {
    await requireAdmin(c);
    const squad = await loadSquad(c.env, c.get('deps').now());
    return c.json({ teams: reminderTeams(squad, await loadContacts(c.env.DB)) });
  });
  app.put('/admin/reminders', async (c) => {
    await requireAdmin(c);
    const deps = c.get('deps');
    const squad = await loadSquad(c.env, deps.now());
    const body = await c.req.json<{ teams?: Record<string, { to?: unknown; cc?: unknown }> }>().catch(() => ({}) as { teams?: undefined });
    const input = body.teams && typeof body.teams === 'object' ? Object.entries(body.teams) : [];
    const lists = new Map<string, Contacts>();
    const fields: Record<string, string> = {};
    for (const [slug, value] of input) {
      if (!squad.teams.some((t) => t.slug === slug)) throw new ApiError(400, 'unknown_team', `There's no team called "${slug}".`);
      const checked = validateContacts(value ?? {});
      if (checked.ok) lists.set(slug, { to: checked.to, cc: checked.cc });
      else fields[slug] = checked.error;
    }
    if (Object.keys(fields).length) throw new ApiError(400, 'invalid', 'Check the highlighted teams.', { fields });
    await saveContacts(c.env.DB, lists, deps.now());
    return c.json({ teams: reminderTeams(squad, await loadContacts(c.env.DB)) });
  });
  app.post('/admin/reminders/:team/test', async (c) => {
    await requireAdmin(c);
    if (!c.env.RESEND_API_KEY) throw new ApiError(503, 'email_disabled', "Email isn't set up on this site.");
    const deps = c.get('deps');
    const squad = await loadSquad(c.env, deps.now());
    const team = findTeam(squad, c.req.param('team'));
    const to = (await loadContacts(c.env.DB)).get(team.slug);
    if (!to?.to.length) throw new ApiError(400, 'no_recipients', 'Save at least one To address first.');
    const game = await sampleGame(c, team, nzDate(deps.now()));
    const sent = await sendEmail(c.env, deps.fetch, to, reminderEmail({ team, games: [game], siteUrl: c.env.SITE_URL, test: true }));
    if (!sent.ok) {
      console.warn(JSON.stringify({ msg: 'reminder_test_failed', team: team.slug, error: sent.error }));
      throw new ApiError(502, 'send_failed', `The email couldn't be sent. ${sent.error}`);
    }
    return c.json({ ok: true, sentTo: [...to.to, ...to.cc] });
  });
  app.get('/admin/export/games.csv', async (c) => {
    await requireAdmin(c);
    return noStore(csvResponse(gamesCsv(await allRows(c), new URL(c.req.url).origin, true), 'games-full-names.csv'));
  });
  app.get('/admin/export/milestones.csv', async (c) => {
    await requireAdmin(c);
    return noStore(csvResponse(milestonesCsv(await allRows(c), true), 'milestones-full-names.csv'));
  });
}
