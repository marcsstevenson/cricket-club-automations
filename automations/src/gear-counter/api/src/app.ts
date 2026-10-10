import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import * as v from 'valibot';
import { nzDate } from '../../shared/src/dates';
import type { TeamPage } from '../../shared/src/types';
import { registerAdmin } from './admin';
import type { AppEnv, Deps } from './env';
import { ApiError } from './errors';
import { adjust, listItem, move, recent, setCount, teamLevels, unlistItem } from './levels';
import { getTeam, listTeams, summary } from './teams';
import { parseNote, parseWho } from './who';

const ITEM = /^[A-Z0-9-]{1,20}$/;
const Adjust = v.object({ delta: v.pipe(v.number(), v.integer(), v.minValue(-20), v.maxValue(20), v.check((n) => n !== 0)) });
const Count = v.object({ level: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(999)) });

const Move = v.object({
  from: v.string(),
  to: v.string(),
  item: v.string(),
  qty: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(999)),
});

function item(id: string) {
  if (!ITEM.test(id)) throw new ApiError(404, 'item_not_found', 'Unknown item.');
  return id;
}

const body = async (c: { req: { json: () => Promise<unknown> } }) =>
  ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    if (c.req.method !== 'GET' && !(await deps.limit(c.env, 'WRITE_LIMIT', c.req.header('cf-connecting-ip') ?? 'local'))) {
      throw new ApiError(429, 'rate_limited', 'Too many changes at once — wait a moment and try again.');
    }
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/teams', async (c) => c.json((await listTeams(c.env.DB)).map(summary)));

  app.get('/teams/:slug', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    const page: TeamPage = { team: summary(t), spec: t.spec, levels: await teamLevels(c.env.DB, t), recent: await recent(c.env.DB, t.slug) };
    return c.json(page);
  });

  app.post('/teams/:slug/items/:item/adjust', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    const b = await body(c);
    const parsed = v.safeParse(Adjust, b);
    if (!parsed.success) throw new ApiError(400, 'invalid_delta', 'delta must be a whole number from -20 to 20, not 0.');
    const who = parseWho(b.who);
    return c.json({ level: await adjust(c.env.DB, t, item(c.req.param('item')), parsed.output.delta, who, deps.now()) });
  });

  app.put('/teams/:slug/items/:item', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    parseWho((await body(c)).who);
    return c.json(await listItem(c.env.DB, t, item(c.req.param('item')), deps.now()));
  });

  app.delete('/teams/:slug/items/:item', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    await unlistItem(c.env.DB, t, item(c.req.param('item')));
    return c.body(null, 204);
  });

  app.post('/teams/:slug/items/:item/count', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    const b = await body(c);
    const parsed = v.safeParse(Count, b);
    if (!parsed.success) throw new ApiError(400, 'invalid_level', 'level must be a whole number from 0 to 999.');
    const who = parseWho(b.who);
    const note = parseNote(b.note);
    return c.json({ level: await setCount(c.env.DB, t, item(c.req.param('item')), parsed.output.level, who, note, deps.now()) });
  });

  app.post('/moves', async (c) => {
    const b = await body(c);
    const parsed = v.safeParse(Move, b);
    if (!parsed.success) throw new ApiError(400, 'invalid_move', 'Choose where to move it and a quantity from 1 to 999.');
    const who = parseWho(b.who);
    const note = parseNote(b.note);
    const [from, to] = await Promise.all([getTeam(c.env.DB, parsed.output.from), getTeam(c.env.DB, parsed.output.to)]);
    return c.json(await move(c.env.DB, from, to, item(parsed.output.item), parsed.output.qty, who, note, deps.id(), deps.now()));
  });

  registerAdmin(app);

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.code, message: err.message }, err.status as ContentfulStatusCode);
    const requestId = deps.id();
    console.error(JSON.stringify({ msg: 'unhandled_error', requestId, error: String(err) }));
    return c.json({ error: 'internal', message: 'Something went wrong.', requestId }, 500);
  });

  return app;
}
