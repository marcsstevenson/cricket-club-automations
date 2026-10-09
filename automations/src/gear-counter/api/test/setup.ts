import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// vitest-pool-workers 0.22 doesn't isolate storage per test, so start each test from an empty D1.
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM lines'), env.DB.prepare('DELETE FROM stocktakes')]);
});
