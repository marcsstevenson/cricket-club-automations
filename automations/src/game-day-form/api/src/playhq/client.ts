import type { Env } from '../env';
import type { V1Game, V2Summary } from './types';

export class PlayhqError extends Error {}

export function createPlayhqClient(env: Env, fetchFn: typeof fetch) {
  async function get<T>(path: string): Promise<T> {
    const res = await fetchFn(`${env.PLAYHQ_BASE_URL}${path}`, {
      headers: { 'x-api-key': env.PLAYHQ_API_KEY, 'x-phq-tenant': env.PLAYHQ_TENANT },
    });
    if (!res.ok) throw new PlayhqError(`PlayHQ ${res.status} for ${path}`);
    return res.json<T>();
  }

  return {
    async fixture(gradeId: string): Promise<V1Game[]> {
      const out: V1Game[] = [];
      let cursor: string | undefined;
      do {
        const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const page = await get<{ data: V1Game[]; metadata?: { hasMore: boolean; nextCursor: string | null } }>(
          `/v1/grades/${gradeId}/games${q}`,
        );
        out.push(...page.data);
        cursor = page.metadata?.hasMore && page.metadata.nextCursor ? page.metadata.nextCursor : undefined;
      } while (cursor);
      return out;
    },
    async summary(gameId: string): Promise<V2Summary> {
      return (await get<{ data: V2Summary }>(`/v2/games/${gameId}/summary`)).data;
    },
  };
}
