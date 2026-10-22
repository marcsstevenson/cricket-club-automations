import { createApp } from './app';
import { defaultDeps, type Env } from './env';
import { cleanupOrphanPhotos } from './photos/cleanup';
import { runReminders } from './reminders/run';

const app = createApp(defaultDeps);

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    if (controller.cron === '0 14 * * *') {
      ctx.waitUntil(
        cleanupOrphanPhotos(env, new Date()).then((deleted) => console.log(JSON.stringify({ msg: 'photo_cleanup', deleted }))),
      );
      return;
    }
    // Hourly 05:00–10:00 UTC: game-day reminders (runReminders keeps to 6–10 pm in NZ and waits for each game to finish).
    ctx.waitUntil(
      runReminders(env, defaultDeps, (p) => ctx.waitUntil(p))
        .then((r) => console.log(JSON.stringify({ msg: 'reminders', ...r })))
        .catch((err) => console.error(JSON.stringify({ msg: 'reminders_error', error: String(err) }))),
    );
  },
} satisfies ExportedHandler<Env>;
