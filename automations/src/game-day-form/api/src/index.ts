import { createApp } from './app';
import { defaultDeps, type Env } from './env';

const app = createApp(defaultDeps);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
