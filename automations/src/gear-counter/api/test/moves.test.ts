import { describe, expect, it } from 'vitest';
import type { TeamPage } from '../../shared/src/types';
import { client, type Client } from './helpers';

const page = async (api: Client, slug: string) => (await (await api(`/teams/${slug}`)).json()) as TeamPage;
const level = async (api: Client, slug: string, item: string) => (await page(api, slug)).levels.find((l) => l.itemId === item);
const move = (api: Client, b: Record<string, unknown>) => api('/moves', { method: 'POST', json: { who: 'Jo', ...b } });
const setLevel = (api: Client, slug: string, item: string, n: number) => api(`/teams/${slug}/items/${item}/count`, { method: 'POST', json: { level: n, who: 'Sam' } });

describe('moves', () => {
  it('moves gear between a pool and a team, listing it there, with paired log entries', async () => {
    const api = client();
    await setLevel(api, 'pool', 'BAT-W2', 5);
    const res = await move(api, { from: 'pool', to: 'penguins', item: 'BAT-W2', qty: 3, note: ' for Saturday ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fromLevel: 2, toLevel: 3 });
    expect(await level(api, 'penguins', 'BAT-W2')).toMatchObject({ level: 3, added: true });

    const [out] = (await page(api, 'pool')).recent;
    expect(out).toMatchObject({ kind: 'move', who: 'Jo', change: -3, levelAfter: 2, to: { slug: 'penguins', name: 'Parklands Penguins' }, from: null, note: 'for Saturday' });
    const [inn] = (await page(api, 'penguins')).recent;
    expect(inn).toMatchObject({ kind: 'move', change: 3, levelAfter: 3, from: { slug: 'pool', name: 'Club pool' }, to: null, note: 'for Saturday' });
  });

  it('adds to an existing level', async () => {
    const api = client();
    await setLevel(api, 'pumas', 'STU-04', 2);
    expect((await setLevel(api, 'wolves', 'STU-04', 1)).status).toBe(200); // Year 5 lists bails
    expect(await (await move(api, { from: 'pumas', to: 'wolves', item: 'STU-04', qty: 2 })).json()).toEqual({ fromLevel: 0, toLevel: 3 });
  });

  it('refuses when the source is short, changing nothing', async () => {
    const api = client();
    await setLevel(api, 'pool', 'BAT-W2', 2);
    const res = await move(api, { from: 'pool', to: 'penguins', item: 'BAT-W2', qty: 3 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_enough', message: 'Only 2 available.' });
    expect(await level(api, 'pool', 'BAT-W2')).toMatchObject({ level: 2 });
    expect(await level(api, 'penguins', 'BAT-W2')).toBeUndefined();
    expect((await page(api, 'penguins')).recent).toEqual([]);
  });

  it('refuses when the source does not list the item', async () => {
    const api = client();
    const res = await move(api, { from: 'penguins', to: 'pool', item: 'BAT-W2', qty: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ message: 'Only 0 available.' });
    expect(await level(api, 'pool', 'BAT-W2')).toMatchObject({ level: 0 });
  });

  it('refuses the same team, hidden teams and bad input', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 5);
    expect((await move(api, { from: 'pool', to: 'pool', item: 'STU-04', qty: 1 })).status).toBe(400);
    await api('/admin/teams/pumas', { method: 'PATCH', headers: { 'x-admin-passcode': 'test-passcode', 'content-type': 'application/json' }, body: '{"hidden":true}' });
    expect((await move(api, { from: 'pool', to: 'pumas', item: 'STU-04', qty: 1 })).status).toBe(404);
    for (const qty of [0, 1000, 1.5, '2']) expect((await move(api, { from: 'pool', to: 'tigers', item: 'STU-04', qty })).status).toBe(400);
    expect((await move(api, { from: 'pool', to: 'tigers', item: 'NOPE', qty: 1 })).status).toBe(404);
    expect((await move(api, { from: 'pool', to: 'tigers', item: 'STU-04', qty: 1, who: '' })).status).toBe(400);
  });
});
