import type { Deps, Env } from '../env';
import { swr } from './cache';
import { createPlayhqClient } from './client';
import type { V2Summary } from './types';

export const SIX_HOURS = 6 * 3600 * 1000;
export const FIFTEEN_MIN = 15 * 60 * 1000;

export function playhqService(env: Env, deps: Deps, waitUntil: (p: Promise<unknown>) => void) {
  const client = createPlayhqClient(env, deps.fetch);
  const now = () => deps.now().getTime();
  return {
    fixture: (gradeId: string, force = false) =>
      swr({ kv: env.CONFIG, key: `phq:fixture:${gradeId}`, now: now(), freshFor: () => SIX_HOURS, load: () => client.fixture(gradeId), force, waitUntil }),
    summary: (gameId: string, force = false) =>
      swr<V2Summary>({
        kv: env.CONFIG,
        key: `phq:summary:${gameId}`,
        now: now(),
        freshFor: (s) => (s.status === 'FINAL' ? SIX_HOURS : FIFTEEN_MIN),
        load: () => client.summary(gameId),
        force,
        waitUntil,
      }),
  };
}

export type PlayhqService = ReturnType<typeof playhqService>;
