import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, clientIp } from '../errors';
import { DAY_MS } from '../photos/cleanup';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export function registerPhotos(app: Hono<AppEnv>) {
  app.post('/photos', async (c) => {
    const deps = c.get('deps');
    if (!(await deps.limit(c.env, 'WRITE_LIMIT', clientIp(c.req.header('cf-connecting-ip'))))) {
      throw new ApiError(429, 'rate_limited', 'Too many uploads — wait a minute and try again.');
    }
    const notJpeg = new ApiError(415, 'unsupported_type', 'Photos must be JPEG.');
    if (c.req.header('content-type') !== 'image/jpeg') throw notJpeg;
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength > MAX_PHOTO_BYTES) throw new ApiError(413, 'too_large', 'Photos must be under 2 MB.');
    if (buf.byteLength < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw notJpeg;

    const id = deps.id();
    const key = `photos/${id}.jpg`;
    await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: 'image/jpeg' } });
    await c.env.DB.prepare('INSERT INTO photos (id, report_id, r2_key, bytes, created_at) VALUES (?, NULL, ?, ?, ?)')
      .bind(id, key, buf.byteLength, deps.now().toISOString())
      .run();
    return c.json({ id }, 201);
  });

  app.get('/photos/:id', async (c) => {
    const row = await c.env.DB.prepare('SELECT report_id, r2_key, created_at FROM photos WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ report_id: string | null; r2_key: string; created_at: string }>();
    const recent = row && Date.parse(row.created_at) > c.get('deps').now().getTime() - DAY_MS;
    if (!row || (!row.report_id && !recent)) throw new ApiError(404, 'not_found', 'Photo not found.');
    const obj = await c.env.PHOTOS.get(row.r2_key);
    if (!obj) throw new ApiError(404, 'not_found', 'Photo not found.');
    return new Response(obj.body, {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex',
      },
    });
  });
}
