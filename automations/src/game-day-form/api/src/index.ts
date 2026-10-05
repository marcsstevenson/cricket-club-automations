import { createApp } from './app';
import { defaultDeps, type Env } from './env';
import { cleanupOrphanPhotos } from './photos/cleanup';

const app = createApp(defaultDeps);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      cleanupOrphanPhotos(env, new Date()).then((deleted) => console.log(JSON.stringify({ msg: 'photo_cleanup', deleted }))),
    );
  },
} satisfies ExportedHandler<Env>;
