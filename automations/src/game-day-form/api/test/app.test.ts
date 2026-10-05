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

  it('applies the D1 schema', async () => {
    const { env } = await import('cloudflare:test');
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'reports'").first();
    expect(row).toEqual({ name: 'reports' });
  });
});
