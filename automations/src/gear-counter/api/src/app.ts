import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import * as v from 'valibot';
import { nzDate } from '../../shared/src/dates';
import type { TeamPage } from '../../shared/src/types';
import { registerAdmin } from './admin';
import type { AppEnv, Deps } from './env';
import { ApiError } from './errors';
import { addLine, adjustCount, getStocktake, listStocktakes, openStocktake, removeLine } from './repo';
import { getTeam, listTeams, summary } from './teams';

const ID = /^[a-f0-9]{32}$/;
const ITEM = /^[A-Z0-9-]{1,20}$/;
const Adjust = v.object({ delta: v.pipe(v.number(), v.integer(), v.minValue(-20), v.maxValue(20), v.check((n) => n !== 0)) });

function lineParams(stocktakeId: string, itemId: string) {
  if (!ID.test(stocktakeId)) throw new ApiError(404, 'stocktake_not_found', 'Stocktake not found.');
  if (!ITEM.test(itemId)) throw new ApiError(404, 'item_not_found', 'Unknown item.');
  return { stocktakeId, itemId };
}

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
    const body: TeamPage = { team: summary(t), spec: t.spec, today: nzDate(deps.now()), stocktakes: await listStocktakes(c.env.DB, t.slug) };
    return c.json(body);
  });

  app.post('/teams/:slug/stocktakes', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    const now = deps.now();
    return c.json(await openStocktake(c.env.DB, t, nzDate(now), deps.id(), now));
  });

  app.get('/stocktakes/:id', async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) throw new ApiError(404, 'stocktake_not_found', 'Stocktake not found.');
    return c.json(await getStocktake(c.env.DB, id));
  });

  app.post('/stocktakes/:id/lines/:item/adjust', async (c) => {
    const { stocktakeId, itemId } = lineParams(c.req.param('id'), c.req.param('item'));
    const parsed = v.safeParse(Adjust, await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, 'invalid_delta', 'delta must be a whole number from -20 to 20, not 0.');
    return c.json({ count: await adjustCount(c.env.DB, stocktakeId, itemId, parsed.output.delta, deps.now()) });
  });

  app.put('/stocktakes/:id/lines/:item', async (c) => {
    const { stocktakeId, itemId } = lineParams(c.req.param('id'), c.req.param('item'));
    return c.json(await addLine(c.env.DB, stocktakeId, itemId, deps.now()));
  });

  app.delete('/stocktakes/:id/lines/:item', async (c) => {
    const { stocktakeId, itemId } = lineParams(c.req.param('id'), c.req.param('item'));
    await removeLine(c.env.DB, stocktakeId, itemId);
    return c.body(null, 204);
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
