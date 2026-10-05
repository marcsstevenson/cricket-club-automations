import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReportOut } from '../../shared/src/api';
import { createApp } from '../src/app';
import { cleanupOrphanPhotos } from '../src/photos/cleanup';
import { form, pumasRoutes, put } from './builders';
import { call, NOW, seedSquad, testDeps } from './helpers';

const jpeg = (size = 10) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff]);
  return b;
};
const upload = (app: ReturnType<typeof createApp>, body: BodyInit, type = 'image/jpeg') =>
  call(app, '/api/photos', { method: 'POST', headers: { 'content-type': type }, body });

describe('photos', () => {
  beforeEach(() => seedSquad());

  it('uploads, serves and attaches a photo', async () => {
    const app = createApp(testDeps({ fetch: pumasRoutes().fetch }));
    const res = await upload(app, jpeg());
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    const img = await call(app, `/api/photos/${id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');

    const saved = await (await put(app, 'g1', form({ photoIds: [id] }))).json<ReportOut>();
    expect(saved.photoIds).toEqual([id]);
  });

  it('rejects non-JPEG and oversized uploads', async () => {
    const app = createApp(testDeps());
    expect((await upload(app, jpeg(), 'image/png')).status).toBe(415);
    expect((await upload(app, new Uint8Array([1, 2, 3, 4]))).status).toBe(415);
    expect((await upload(app, jpeg(2 * 1024 * 1024 + 1))).status).toBe(413);
  });

  it('stops serving unattached photos after 24 hours', async () => {
    const id = (await (await upload(createApp(testDeps()), jpeg())).json<{ id: string }>()).id;
    const later = createApp(testDeps({ now: () => new Date(NOW.getTime() + 25 * 3600 * 1000) }));
    expect((await call(later, `/api/photos/${id}`)).status).toBe(404);
  });

  it('cleans up orphans older than a day, keeping attached photos', async () => {
    const app = createApp(testDeps({ fetch: pumasRoutes().fetch }));
    const orphan = (await (await upload(app, jpeg())).json<{ id: string }>()).id;
    const kept = (await (await upload(app, jpeg())).json<{ id: string }>()).id;
    await put(app, 'g1', form({ photoIds: [kept] }));

    expect(await cleanupOrphanPhotos(env, new Date(NOW.getTime() + 3600 * 1000))).toBe(0);
    expect(await cleanupOrphanPhotos(env, new Date(NOW.getTime() + 25 * 3600 * 1000))).toBe(1);
    expect(await env.PHOTOS.head(`photos/${orphan}.jpg`)).toBeNull();
    expect(await env.PHOTOS.head(`photos/${kept}.jpg`)).not.toBeNull();
  });
});
