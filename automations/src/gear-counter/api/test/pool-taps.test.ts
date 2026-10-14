import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { AdjustResult, TeamPage } from '../../shared/src/types';
import { client, testDeps, type Client } from './helpers';

const page = async (api: Client, slug: string) => (await (await api(`/teams/${slug}`)).json()) as TeamPage;
const level = async (api: Client, slug: string, item: string) => (await page(api, slug)).levels.find((l) => l.itemId === item)?.level;
const tap = (api: Client, slug: string, item: string, delta: number, who = 'Sam') =>
  api(`/teams/${slug}/items/${item}/adjust`, { method: 'POST', json: { delta, who, pool: true } });
const tapJson = async (api: Client, slug: string, item: string, delta: number, who = 'Sam') =>
  (await (await tap(api, slug, item, delta, who)).json()) as AdjustResult;
const setLevel = (api: Client, slug: string, item: string, n: number) =>
  api(`/teams/${slug}/items/${item}/count`, { method: 'POST', json: { level: n, who: 'Setup' } });
const at = (t: string) => {
  let now = new Date(t);
  return { api: client(testDeps({ now: () => now })), set: (s: string) => (now = new Date(s)) };
};

describe('Club pool taps', () => {
  it('takes from the Club pool and gives back, logging a paired move', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 5);
    expect(await tapJson(api, 'pumas', 'STU-04', 3)).toEqual({ level: 3, applied: 3, poolLevel: 2 });
    expect(await level(api, 'pool', 'STU-04')).toBe(2);
    const [inn] = (await page(api, 'pumas')).recent;
    expect(inn).toMatchObject({ kind: 'move', who: 'Sam', change: 3, levelAfter: 3, from: { slug: 'pool', name: 'Club pool' }, to: null });
    const [out] = (await page(api, 'pool')).recent;
    expect(out).toMatchObject({ kind: 'move', change: -3, levelAfter: 2, to: { slug: 'pumas', name: 'Parklands Pumas' }, from: null });
    const ids = await env.DB.prepare("SELECT DISTINCT move_id FROM log WHERE kind = 'move'").all<{ move_id: string }>();
    expect(ids.results).toHaveLength(1);
    expect(ids.results[0].move_id).toMatch(/^tap-/);
  });

  it('gives only what the Club pool has, and nothing (unlogged) when it is empty', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 2);
    expect(await tapJson(api, 'pumas', 'STU-04', 5)).toEqual({ level: 2, applied: 2, poolLevel: 0 });
    expect(await tapJson(api, 'pumas', 'STU-04', 1)).toEqual({ level: 2, applied: 0, poolLevel: 0 });
    expect((await page(api, 'pumas')).recent).toHaveLength(1);
  });

  it('returns only what the team holds', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 1);
    await tapJson(api, 'pumas', 'STU-04', 1);
    expect(await tapJson(api, 'pumas', 'STU-04', -4)).toEqual({ level: 0, applied: -1, poolLevel: 1 });
  });

  it('never takes the Club pool below 0 when phones tap at once', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 3);
    const results = await Promise.all(Array.from({ length: 6 }, () => tapJson(api, 'pumas', 'STU-04', 1)));
    expect(results.reduce((n, r) => n + r.applied, 0)).toBe(3);
    expect(await level(api, 'pool', 'STU-04')).toBe(0);
    expect(await level(api, 'pumas', 'STU-04')).toBe(3);
  });

  it('refuses + on an item the Club pool has no row for, and creates the row on −', async () => {
    const api = client();
    await env.DB.prepare("DELETE FROM levels WHERE team_slug = 'pool' AND item_id = 'BAT-W2'").run();
    await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    expect(await tapJson(api, 'penguins', 'BAT-W2', 1)).toMatchObject({ applied: 0, poolLevel: 0 });
    await setLevel(api, 'penguins', 'BAT-W2', 2);
    expect(await tapJson(api, 'penguins', 'BAT-W2', -1)).toEqual({ level: 1, applied: -1, poolLevel: 1 });
  });

  it('groups one person’s taps into one pair, swapping from/to when the sign flips', async () => {
    const { api, set } = at('2026-10-11T01:00:00Z');
    await setLevel(api, 'pool', 'STU-04', 5);
    await setLevel(api, 'pumas', 'STU-04', 4);
    await tapJson(api, 'pumas', 'STU-04', 2);
    set('2026-10-11T01:01:00Z');
    await tapJson(api, 'pumas', 'STU-04', -3, 'sam');
    const [team] = (await page(api, 'pumas')).recent;
    expect(team).toMatchObject({ kind: 'move', change: -1, levelAfter: 3, to: { slug: 'pool' }, from: null, at: '2026-10-11T01:00:00.000Z' });
    const [pool] = (await page(api, 'pool')).recent;
    expect(pool).toMatchObject({ kind: 'move', change: 1, levelAfter: 6, from: { slug: 'pumas' }, to: null }); // 5 − 2 + 3
  });

  it('starts a new pair after 2 minutes, for another person, or after a manual move', async () => {
    const { api, set } = at('2026-10-11T01:00:00Z');
    await setLevel(api, 'pool', 'STU-04', 9);
    await tapJson(api, 'pumas', 'STU-04', 1);
    set('2026-10-11T01:02:01Z');
    await tapJson(api, 'pumas', 'STU-04', 1);
    await tapJson(api, 'pumas', 'STU-04', 1, 'Jo');
    await api('/moves', { method: 'POST', json: { from: 'pumas', to: 'wolves', item: 'STU-04', qty: 1, who: 'Jo' } });
    await tapJson(api, 'pumas', 'STU-04', 1, 'Jo');
    const { recent } = await page(api, 'pumas');
    expect(recent.map((e) => [e.who, e.change])).toEqual([['Jo', 1], ['Jo', -1], ['Jo', 1], ['Sam', 1], ['Sam', 1]]);
  });

  it('deletes a pair that nets to 0', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 2);
    await tapJson(api, 'pumas', 'STU-04', 2);
    await tapJson(api, 'pumas', 'STU-04', -2);
    expect((await page(api, 'pumas')).recent).toEqual([]);
    expect((await page(api, 'pool')).recent.filter((e) => e.kind === 'move')).toEqual([]);
  });

  it('refuses pool taps on the Club pool itself, while it is hidden, and on unlisted items', async () => {
    const api = client();
    expect(await (await tap(api, 'pool', 'STU-04', 1)).json()).toMatchObject({ error: 'pool_self' });
    expect((await tap(api, 'penguins', 'BAT-W2', -1)).status).toBe(404); // not listed for Penguins
    await env.DB.prepare("UPDATE teams SET hidden = 1 WHERE slug = 'pool'").run();
    const res = await tap(api, 'pumas', 'STU-04', 1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'pool_unavailable' });
  });

  it('rejects a pool flag that is not true or false', async () => {
    const res = await client()('/teams/pumas/items/STU-04/adjust', { method: 'POST', json: { delta: 1, who: 'Sam', pool: 'yes' } });
    expect(res.status).toBe(400);
  });
});
