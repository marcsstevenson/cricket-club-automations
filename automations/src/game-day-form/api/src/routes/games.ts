import type { Hono } from 'hono';
import type { GamePage, RefreshResult } from '../../../shared/src/api';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { startData, unavailableStart } from '../playhq/summary';
import type { V2Summary } from '../playhq/types';
import { getReport } from '../reports/repo';
import { toReportOut } from '../reports/serialize';
import { loadGameContext, type GameContext } from './context';

export function registerGames(app: Hono<AppEnv>) {
  const startFor = (ctx: GameContext, s: V2Summary | null) =>
    s ? startData(s, ctx.team, ctx.labels, ctx.game.date) : unavailableStart(ctx.team, ctx.game.date);

  app.get('/teams/:slug/games/:gameId', async (c) => {
    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    const saved = await getReport(c.env.DB, ctx.squad.season.playhqSeasonId, ctx.team.slug, ctx.game.gameId);
    const start = startFor(ctx, await ctx.summary());
    return c.json<GamePage>({ game: ctx.game, report: saved ? toReportOut(saved, ctx.labels) : null, start });
  });

  app.post('/teams/:slug/games/:gameId/refresh', async (c) => {
    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    const allowed = await c.get('deps').limit(c.env, 'REFRESH_LIMIT', ctx.game.gameId);
    if (!allowed) return c.json<RefreshResult>({ start: startFor(ctx, await ctx.summary()), rateLimited: true });
    let s;
    try {
      s = (await ctx.summary(true))!;
    } catch {
      throw new ApiError(503, 'playhq_unavailable', "Couldn't reach PlayHQ — try again later.");
    }
    return c.json<RefreshResult>({ start: startFor(ctx, s) });
  });
}
