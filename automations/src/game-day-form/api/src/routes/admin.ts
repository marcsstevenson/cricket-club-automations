import type { Context, Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, clientIp } from '../errors';
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

function noStore(res: Response) {
  res.headers.set('cache-control', 'no-store');
  return res;
}

export function registerAdmin(app: Hono<AppEnv>) {
  app.get('/admin/check', async (c) => {
    await requireAdmin(c);
    return c.json({ ok: true });
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
