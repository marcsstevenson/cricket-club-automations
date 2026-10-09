import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { createApp } from '../src/app';
import type { Deps } from '../src/env';

export const NOW = new Date('2026-10-09T03:00:00Z'); // 9 Oct 2026, 4 pm in NZ

export function testDeps(over: Partial<Deps> = {}): Deps {
  let n = 0;
  return {
    now: () => NOW,
    id: () => (++n).toString(16).padStart(32, '0'),
    limit: async () => true,
    ...over,
  };
}

export type Client = ReturnType<typeof client>;

export function client(deps: Deps = testDeps()) {
  const app = createApp(deps);
  return async (path: string, init?: RequestInit & { json?: unknown }) => {
    const { json, ...rest } = init ?? {};
    const req: RequestInit = json === undefined ? rest : { ...rest, headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) };
    const ctx = createExecutionContext();
    const res = await app.request(`/api${path}`, req, env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}
