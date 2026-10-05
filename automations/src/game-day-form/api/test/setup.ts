import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// vitest-pool-workers 0.22 no longer isolates storage per test; reset it so tests start from empty KV/R2/D1.
beforeEach(async () => {
  for (const { name } of (await env.CONFIG.list()).keys) await env.CONFIG.delete(name);
  const objects = await env.PHOTOS.list();
  if (objects.objects.length) await env.PHOTOS.delete(objects.objects.map((o) => o.key));
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
  ).all<{ name: string }>();
  if (results.length) {
    await env.DB.batch([env.DB.prepare('PRAGMA defer_foreign_keys = true'), ...results.map((t) => env.DB.prepare(`DELETE FROM "${t.name}"`))]);
  }
});
