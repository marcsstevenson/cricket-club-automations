import type { Context, Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, clientIp } from '../errors';
import type { AdminTeamDetail, AdminTeamSummary, ReminderLists } from '../../../shared/src/api';
import { nzDate } from '../../../shared/src/dates';
import { squadLabels } from '../../../shared/src/labels';
import { teamFixture, type FixtureGame } from '../playhq/fixture';
import { loadContacts, saveContacts, validateContacts } from '../reminders/contacts';
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
  const sample: FixtureGame = { gameId: 'sample', date: today, time: null, round: 'R1', opposition: 'Example Opposition', venue: 'Parklands Reserve', status: '' };
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
  app.get('/admin/teams', async (c) => {
    await requireAdmin(c);
    const squad = await loadSquad(c.env, c.get('deps').now());
    const contacts = await loadContacts(c.env.DB);
    const teams: AdminTeamSummary[] = squad.teams.map((t) => ({
      slug: t.slug,
      name: t.name,
      gradeName: t.gradeName ?? '',
      playerCount: t.players.length,
      toCount: contacts.get(t.slug)?.to.length ?? 0,
      ccCount: contacts.get(t.slug)?.cc.length ?? 0,
    }));
    return c.json({ teams });
  });
  app.get('/admin/teams/:team', async (c) => {
    await requireAdmin(c);
    const team = findTeam(await loadSquad(c.env, c.get('deps').now()), c.req.param('team'));
    const labels = squadLabels(team.players);
    const body: AdminTeamDetail = {
      slug: team.slug,
      name: team.name,
      gradeName: team.gradeName ?? '',
      playhqGradeId: team.playhqGradeId ?? '',
      playhqTeamId: team.playhqTeamId,
      players: team.players.map((p) => ({ key: p.key, firstName: p.firstName, lastName: p.lastName, playhqId: p.playhqId ?? '', label: labels.get(p.key) ?? '' })),
      reminders: (await loadContacts(c.env.DB)).get(team.slug) ?? { to: [], cc: [] },
    };
    return c.json(body);
  });
  app.put('/admin/teams/:team/reminders', async (c) => {
    await requireAdmin(c);
    const deps = c.get('deps');
    const team = findTeam(await loadSquad(c.env, deps.now()), c.req.param('team'));
    const body = await c.req.json<{ to?: unknown; cc?: unknown }>().catch(() => ({}));
    const checked = validateContacts(body);
    if (!checked.ok) throw new ApiError(400, 'invalid', checked.error);
    const lists: ReminderLists = { to: checked.to, cc: checked.cc };
    await saveContacts(c.env.DB, new Map([[team.slug, lists]]), deps.now());
    return c.json(lists);
  });
  app.post('/admin/teams/:team/test', async (c) => {
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
