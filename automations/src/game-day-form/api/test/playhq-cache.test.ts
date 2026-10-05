import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { swr } from '../src/playhq/cache';
import { createPlayhqClient } from '../src/playhq/client';
import { FIFTEEN_MIN, playhqService, SIX_HOURS } from '../src/playhq/service';
import { fail, fakeFetch, summary, v1Game, v1Page } from './fixtures/playhq';
import { NOW, testDeps } from './helpers';

function collector() {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), settle: () => Promise.all(pending) };
}

describe('createPlayhqClient', () => {
  it('sends the key and tenant headers', async () => {
    const f = fakeFetch({ '/v2/games/g1/summary': { data: summary({ id: 'g1' }) } });
    await createPlayhqClient(env, f.fetch).summary('g1');
    expect(f.headers[0].get('x-api-key')).toBe('test-key');
    expect(f.headers[0].get('x-phq-tenant')).toBe('nzc');
  });

  it('follows fixture pagination', async () => {
    const f = fakeFetch({
      '/v1/grades/gr/games': (u: URL) =>
        u.searchParams.get('cursor') ? v1Page([v1Game({ id: 'b', date: '2026-01-02' })]) : v1Page([v1Game({ id: 'a', date: '2026-01-01' })], 'c2'),
    });
    const games = await createPlayhqClient(env, f.fetch).fixture('gr');
    expect(games.map((g) => g.id)).toEqual(['a', 'b']);
    expect(f.calls).toEqual(['/v1/grades/gr/games', '/v1/grades/gr/games?cursor=c2']);
  });

  it('throws on HTTP errors', async () => {
    const f = fakeFetch({ '/v2/games/g1/summary': fail });
    await expect(createPlayhqClient(env, f.fetch).summary('g1')).rejects.toThrow(/PlayHQ 500/);
  });
});

describe('swr', () => {
  const base = { kv: env.CONFIG, key: 'k', freshFor: () => 1000 };

  it('fetches and stores on a miss', async () => {
    const c = collector();
    const r = await swr({ ...base, now: 0, load: async () => 'v1', waitUntil: c.waitUntil });
    expect(r).toEqual({ data: 'v1', stale: false });
    expect(await env.CONFIG.get('k', 'json')).toEqual({ fetchedAt: 0, data: 'v1' });
  });

  it('serves fresh entries without loading', async () => {
    await env.CONFIG.put('k', JSON.stringify({ fetchedAt: 0, data: 'old' }));
    const r = await swr({ ...base, now: 999, load: async () => { throw new Error('should not load'); }, waitUntil: collector().waitUntil });
    expect(r).toEqual({ data: 'old', stale: false });
  });

  it('serves stale entries and refreshes in the background', async () => {
    await env.CONFIG.put('k', JSON.stringify({ fetchedAt: 0, data: 'old' }));
    const c = collector();
    const r = await swr({ ...base, now: 5000, load: async () => 'new', waitUntil: c.waitUntil });
    expect(r).toEqual({ data: 'old', stale: true });
    await c.settle();
    expect(await env.CONFIG.get('k', 'json')).toEqual({ fetchedAt: 5000, data: 'new' });
  });

  it('keeps the stale entry when the background refresh fails', async () => {
    await env.CONFIG.put('k', JSON.stringify({ fetchedAt: 0, data: 'old' }));
    const c = collector();
    await swr({ ...base, now: 5000, load: async () => { throw new Error('down'); }, waitUntil: c.waitUntil });
    await c.settle();
    expect(await env.CONFIG.get('k', 'json')).toEqual({ fetchedAt: 0, data: 'old' });
  });

  it('throws on a miss when loading fails', async () => {
    await expect(swr({ ...base, now: 0, load: async () => { throw new Error('down'); }, waitUntil: collector().waitUntil })).rejects.toThrow('down');
  });

  it('bypasses the cache when forced', async () => {
    await env.CONFIG.put('k', JSON.stringify({ fetchedAt: 0, data: 'old' }));
    const r = await swr({ ...base, now: 1, force: true, load: async () => 'new', waitUntil: collector().waitUntil });
    expect(r).toEqual({ data: 'new', stale: false });
  });
});

describe('playhqService', () => {
  it('treats a non-final summary as fresh for 15 minutes only', async () => {
    const f = fakeFetch({ '/v2/games/g1/summary': { data: summary({ id: 'g1', status: 'PENDING' }) } });
    const svc = (offset: number) => playhqService(env, testDeps({ fetch: f.fetch, now: () => new Date(NOW.getTime() + offset) }), collector().waitUntil);
    await svc(0).summary('g1');
    expect((await svc(FIFTEEN_MIN - 1).summary('g1')).stale).toBe(false);
    expect((await svc(FIFTEEN_MIN + 1).summary('g1')).stale).toBe(true);
  });

  it('treats a final summary and the fixture as fresh for 6 hours', async () => {
    const f = fakeFetch({
      '/v2/games/g1/summary': { data: summary({ id: 'g1' }) },
      '/v1/grades/gr/games': v1Page([]),
    });
    const svc = (offset: number) => playhqService(env, testDeps({ fetch: f.fetch, now: () => new Date(NOW.getTime() + offset) }), collector().waitUntil);
    await svc(0).summary('g1');
    await svc(0).fixture('gr');
    expect((await svc(SIX_HOURS - 1).summary('g1')).stale).toBe(false);
    expect((await svc(SIX_HOURS - 1).fixture('gr')).stale).toBe(false);
    expect((await svc(SIX_HOURS + 1).fixture('gr')).stale).toBe(true);
  });
});
