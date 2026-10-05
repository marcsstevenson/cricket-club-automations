import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { call, testDeps } from './helpers';

describe('app', () => {
  it('answers health checks', async () => {
    const res = await call(createApp(testDeps()), '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns a JSON 404 for unknown API paths', async () => {
    const res = await call(createApp(testDeps()), '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  it('turns unexpected errors into a 500 with a request id', async () => {
    const app = createApp(testDeps());
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    const res = await call(app, '/api/boom');
    expect(res.status).toBe(500);
    const body = await res.json<{ error: string; requestId: string }>();
    expect(body.error).toBe('internal');
    expect(body.requestId).toBeTruthy();
  });

  it('uses FAKE_NOW as the clock when set (demo environment)', async () => {
    const { env, createExecutionContext, waitOnExecutionContext } = await import('cloudflare:test');
    const { seedSquad } = await import('./helpers');
    await seedSquad();
    const at = async (fakeNow?: string) => {
      const ctx = createExecutionContext();
      const res = await createApp(testDeps()).request('/api/games', {}, { ...env, FAKE_NOW: fakeNow }, ctx);
      await waitOnExecutionContext(ctx);
      return (await res.json<{ today: string }>()).today;
    };
    expect(await at('2026-03-21T08:00:00Z')).toBe('2026-03-21');
    expect(await at()).toBe('2026-02-01'); // testDeps clock
    expect(await at('not a date')).toBe('2026-02-01'); // ignored when invalid
  });

  it('applies the D1 schema', async () => {
    const { env } = await import('cloudflare:test');
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'reports'").first();
    expect(row).toEqual({ name: 'reports' });
  });
});
