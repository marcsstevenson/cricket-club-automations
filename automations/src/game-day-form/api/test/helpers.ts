import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import type { createApp } from '../src/app';
import type { Deps } from '../src/env';

export const NOW = new Date('2026-02-01T00:00:00Z'); // 1 Feb 2026, 1 pm in NZ

export function testDeps(over: Partial<Deps> = {}): Deps {
  let n = 0;
  return {
    fetch: async () => {
      throw new Error('unexpected fetch');
    },
    now: () => NOW,
    id: () => `id${String(++n).padStart(4, '0')}`,
    limit: async () => true,
    ...over,
  };
}

export async function call(app: ReturnType<typeof createApp>, path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const res = await app.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
