import type { Hono } from 'hono';
import type { GamePage, RefreshResult } from '../../../shared/src/api';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { startData, UNAVAILABLE } from '../playhq/summary';
import { getReport } from '../reports/repo';
import { toReportOut } from '../reports/serialize';
import { loadGameContext } from './context';

export function registerGames(app: Hono<AppEnv>) {
  app.get('/teams/:slug/games/:gameId', async (c) => {
    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    const saved = await getReport(c.env.DB, ctx.squad.season.playhqSeasonId, ctx.team.slug, ctx.game.gameId);
    if (saved) return c.json<GamePage>({ game: ctx.game, report: toReportOut(saved, ctx.labels), start: null });
    const s = await ctx.summary();
    return c.json<GamePage>({ game: ctx.game, report: null, start: s ? startData(s, ctx.team, ctx.labels) : UNAVAILABLE });
  });

  app.post('/teams/:slug/games/:gameId/refresh', async (c) => {
    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    const allowed = await c.get('deps').limit(c.env, 'REFRESH_LIMIT', ctx.game.gameId);
    if (!allowed) {
      const s = await ctx.summary();
      return c.json<RefreshResult>({ start: s ? startData(s, ctx.team, ctx.labels) : UNAVAILABLE, rateLimited: true });
    }
    let s;
    try {
      s = (await ctx.summary(true))!;
    } catch {
      throw new ApiError(503, 'playhq_unavailable', "Couldn't reach PlayHQ — try again later.");
    }
    return c.json<RefreshResult>({ start: startData(s, ctx.team, ctx.labels) });
  });
}
