import type { Env } from '../env';

export const DAY_MS = 24 * 3600 * 1000;

export async function cleanupOrphanPhotos(env: Env, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const { results } = await env.DB.prepare('SELECT id, r2_key FROM photos WHERE report_id IS NULL AND created_at < ? LIMIT 500')
    .bind(cutoff)
    .all<{ id: string; r2_key: string }>();
  if (!results.length) return 0;
  await env.PHOTOS.delete(results.map((r) => r.r2_key));
  await env.DB.batch(results.map((r) => env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(r.id)));
  return results.length;
}
