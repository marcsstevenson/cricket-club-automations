import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv, Deps } from './env';
import { ApiError } from './errors';
import { registerGames } from './routes/games';
import { registerPhotos } from './routes/photos';
import { registerReports } from './routes/reports';
import { registerTeams } from './routes/teams';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  registerTeams(app);
  registerGames(app);
  registerReports(app);
  registerPhotos(app);
  // Route registrations are added here by later tasks.

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message, ...err.extra }, err.status as ContentfulStatusCode);
    }
    const requestId = deps.id();
    console.error(JSON.stringify({ msg: 'unhandled_error', requestId, error: String(err) }));
    return c.json({ error: 'internal', message: 'Something went wrong.', requestId }, 500);
  });

  return app;
}
