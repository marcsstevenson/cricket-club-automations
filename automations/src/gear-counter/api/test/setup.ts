import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Snapshot the seeded catalogue and levels so each test can edit them freely.
const CATALOGUE = ['categories', 'items', 'kit_specs', 'kit_spec_items', 'levels'];
await env.DB.batch(CATALOGUE.map((t) => env.DB.prepare(`CREATE TABLE IF NOT EXISTS seed_${t} AS SELECT * FROM ${t}`)));

// vitest-pool-workers 0.22 doesn't isolate storage per test, so start each test from an empty D1.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM log'),
    // Back to the seeded teams: drop ones a test added (and their levels), unhide the rest.
    env.DB.prepare("DELETE FROM teams WHERE created_at > '2026-10-09T00:00:00.000Z'"),
    env.DB.prepare('UPDATE teams SET hidden = 0'),
    ...[...CATALOGUE].reverse().map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    ...CATALOGUE.map((t) => env.DB.prepare(`INSERT INTO ${t} SELECT * FROM seed_${t}`)),
  ]);
});
