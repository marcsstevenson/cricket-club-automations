import type { Context, Hono } from 'hono';
import { nzDate } from '../../shared/src/dates';
import { loadCatalogue } from './catalogue';
import { csvResponse } from './csv';
import type { AppEnv } from './env';
import { ApiError } from './errors';
import { clubCsv, levelsCsv, logCsv } from './exports';
import { addTeam, adminTeams, getAnyTeam, parseNewTeam, setHidden } from './teams';

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function requireAdmin(c: Context<AppEnv>) {
  c.header('cache-control', 'no-store');
  if (!c.env.ADMIN_PASSCODE) throw new ApiError(503, 'admin_disabled', 'The admin page is not set up.');
  if (!(await c.get('deps').limit(c.env, 'ADMIN_LIMIT', c.req.header('cf-connecting-ip') ?? 'local'))) {
    throw new ApiError(429, 'rate_limited', 'Too many requests — wait a minute and try again.');
  }
  if (!(await safeEqual(c.req.header('x-admin-passcode') ?? '', c.env.ADMIN_PASSCODE))) {
    throw new ApiError(401, 'unauthorised', 'Wrong passcode.');
  }
}

export function registerAdmin(app: Hono<AppEnv>) {
  app.get('/admin/check', async (c) => {
    await requireAdmin(c);
    return c.json({ ok: true });
  });

  app.get('/admin/teams', async (c) => {
    await requireAdmin(c);
    return c.json(await adminTeams(c.env.DB));
  });

  app.post('/admin/teams', async (c) => {
    await requireAdmin(c);
    const cat = await loadCatalogue(c.env.DB);
    const team = parseNewTeam(await c.req.json().catch(() => null), cat.specNames);
    return c.json(await addTeam(c.env.DB, team, cat, c.get('deps').now()), 201);
  });

  app.patch('/admin/teams/:slug', async (c) => {
    await requireAdmin(c);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.hidden !== 'boolean') throw new ApiError(400, 'invalid_body', 'Send { "hidden": true } or { "hidden": false }.');
    return c.json(await setHidden(c.env.DB, c.req.param('slug'), body.hidden));
  });

  app.get('/admin/export/club.csv', async (c) => {
    await requireAdmin(c);
    return csvResponse(await clubCsv(c.env.DB), `club-inventory-${nzDate(c.get('deps').now())}.csv`);
  });

  app.get('/admin/export/log.csv', async (c) => {
    await requireAdmin(c);
    const slug = c.req.query('team');
    if (slug) await getAnyTeam(c.env.DB, slug);
    const day = nzDate(c.get('deps').now());
    return csvResponse(await logCsv(c.env.DB, slug), slug ? `${slug}-log-${day}.csv` : `gear-log-${day}.csv`);
  });

  app.get('/admin/export/teams/:file', async (c) => {
    await requireAdmin(c);
    const slug = /^([a-z][a-z0-9-]{1,29})\.csv$/.exec(c.req.param('file'))?.[1];
    if (!slug) throw new ApiError(404, 'not_found', 'Not found.');
    const team = await getAnyTeam(c.env.DB, slug);
    return csvResponse(await levelsCsv(c.env.DB, team), `${slug}-levels-${nzDate(c.get('deps').now())}.csv`);
  });
}
