import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// vitest-pool-workers 0.22 doesn't isolate storage per test, so start each test from an empty D1.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM log'),
    // Back to the seeded teams: drop ones a test added (and their levels), unhide the rest.
    env.DB.prepare("DELETE FROM teams WHERE created_at > '2026-10-09T00:00:00.000Z'"),
    env.DB.prepare('DELETE FROM levels WHERE team_slug NOT IN (SELECT slug FROM teams) OR added = 1'),
    env.DB.prepare('UPDATE levels SET level = 0'),
    env.DB.prepare('UPDATE teams SET hidden = 0'),
  ]);
});
