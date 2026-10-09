import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Line, Stocktake, TeamPage, TeamSummary } from '../../shared/src/types';
import { client, testDeps, type Client } from './helpers';

const open = async (api: Client, slug = 'pumas') => (await (await api(`/teams/${slug}/stocktakes`, { method: 'POST' })).json()) as Stocktake;
const adjust = (api: Client, id: string, item: string, delta: unknown) => api(`/stocktakes/${id}/lines/${item}/adjust`, { method: 'POST', json: { delta } });

describe('teams', () => {
  it('lists the game-day teams with the pool last', async () => {
    const teams = (await (await client()('/teams')).json()) as TeamSummary[];
    expect(teams).toHaveLength(28);
    expect(teams.at(-1)).toEqual({ slug: 'pool', name: 'Club pool', mascot: '', grade: null, dot: null });
    expect(teams.find((t) => t.slug === 'pumas')).toMatchObject({ grade: 'Year 7', dot: 'green' });
  });

  it('404s an unknown team', async () => {
    const res = await client()('/teams/pumaz');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'team_not_found' });
  });

  it('shows today in NZ and stocktakes newest first', async () => {
    let now = new Date('2026-09-12T01:00:00Z');
    const api = client(testDeps({ now: () => now }));
    await open(api);
    now = new Date('2026-10-08T12:30:00Z'); // already 9 Oct in NZ
    await open(api);
    const page = (await (await api('/teams/pumas')).json()) as TeamPage;
    expect(page.today).toBe('2026-10-09');
    expect(page.stocktakes.map((s) => s.label)).toEqual(['9 Oct 2026', '12 Sep 2026']);
  });
});

describe('stocktakes', () => {
  it('starts with the grade spec at 0, in catalogue order', async () => {
    const st = await open(client(), 'penguins');
    expect(st).toMatchObject({ teamSlug: 'penguins', date: '2026-10-09', label: '9 Oct 2026' });
    expect(st.lines).toHaveLength(14);
    expect(st.lines[0]).toEqual({
      itemId: 'STU-01',
      name: 'Individual yellow stumps (stickered)',
      category: 'Stumps & Wickets',
      expected: 12,
      count: 0,
      added: false,
    });
    expect(st.lines.at(-1)?.itemId).toBe('FLD-CS');
  });

  it('gives the pool every catalogue item at 0', async () => {
    const st = await open(client(), 'pool');
    expect(st.lines).toHaveLength(62);
    expect(st.lines.every((l) => l.expected === 0)).toBe(true);
  });

  it('reopens the same day instead of creating another', async () => {
    const api = client();
    const a = await open(api);
    await adjust(api, a.id, 'STU-04', 2);
    const b = await open(api);
    expect(b.id).toBe(a.id);
    expect(b.lines.find((l) => l.itemId === 'STU-04')?.count).toBe(2);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM lines').first<{ n: number }>();
    expect(row?.n).toBe(a.lines.length);
  });

  it('keeps the expected quantities a stocktake started with', async () => {
    const api = client();
    const st = await open(api);
    await env.DB.prepare('UPDATE lines SET expected = 99 WHERE stocktake_id = ? AND item_id = ?').bind(st.id, 'STU-04').run();
    const again = (await (await api(`/stocktakes/${st.id}`)).json()) as Stocktake;
    expect(again.lines.find((l) => l.itemId === 'STU-04')?.expected).toBe(99);
  });

  it('404s an unknown stocktake', async () => {
    expect((await client()(`/stocktakes/${'f'.repeat(32)}`)).status).toBe(404);
    expect((await client()('/stocktakes/nope')).status).toBe(404);
  });
});

describe('adjust', () => {
  it('applies concurrent changes without losing any', async () => {
    const api = client();
    const st = await open(api);
    await Promise.all(Array.from({ length: 10 }, () => adjust(api, st.id, 'FLD-SCC', 1)));
    const res = await adjust(api, st.id, 'FLD-SCC', -3);
    expect(await res.json()).toEqual({ count: 7 });
  });

  it('never goes below 0', async () => {
    const api = client();
    const st = await open(api);
    await adjust(api, st.id, 'STU-04', 1);
    expect(await (await adjust(api, st.id, 'STU-04', -5)).json()).toEqual({ count: 0 });
  });

  it.each([0, 21, -21, 1.5, '1', null])('rejects delta %s', async (delta) => {
    const api = client();
    const st = await open(api);
    expect((await adjust(api, st.id, 'STU-04', delta)).status).toBe(400);
  });

  it('404s a line that is not in the stocktake', async () => {
    const api = client();
    const st = await open(api);
    expect((await adjust(api, st.id, 'BAT-P1', 1)).status).toBe(404);
  });

  it('rate limits writes', async () => {
    const api = client(testDeps({ limit: async () => false }));
    expect((await api('/teams/pumas/stocktakes', { method: 'POST' })).status).toBe(429);
    expect((await api('/teams/pumas')).status).toBe(200);
  });
});

describe('added lines', () => {
  it('adds a catalogue item at 0, idempotently, in catalogue order', async () => {
    const api = client();
    const st = await open(api, 'penguins');
    const res = await api(`/stocktakes/${st.id}/lines/BAT-W2`, { method: 'PUT' });
    expect(await res.json()).toEqual({
      itemId: 'BAT-W2',
      name: 'Wooden bat S2 (softball)',
      category: 'Bats',
      expected: 0,
      count: 0,
      added: true,
    } satisfies Line);
    await api(`/stocktakes/${st.id}/lines/BAT-W2`, { method: 'PUT' });
    const ids = ((await (await api(`/stocktakes/${st.id}`)).json()) as Stocktake).lines.map((l) => l.itemId);
    expect(ids.filter((id) => id === 'BAT-W2')).toHaveLength(1);
    expect(ids.indexOf('BAT-W2')).toBe(ids.indexOf('BAT-P4') + 1);
  });

  it('rejects unknown and excluded items', async () => {
    const api = client();
    const st = await open(api);
    expect((await api(`/stocktakes/${st.id}/lines/MSC-BAG`, { method: 'PUT' })).status).toBe(404);
    expect((await api(`/stocktakes/${st.id}/lines/NOPE`, { method: 'PUT' })).status).toBe(404);
  });

  it('removes an added line only while its count is 0', async () => {
    const api = client();
    const st = await open(api, 'penguins');
    await api(`/stocktakes/${st.id}/lines/BAT-W2`, { method: 'PUT' });
    await adjust(api, st.id, 'BAT-W2', 1);
    expect((await api(`/stocktakes/${st.id}/lines/BAT-W2`, { method: 'DELETE' })).status).toBe(409);
    await adjust(api, st.id, 'BAT-W2', -1);
    expect((await api(`/stocktakes/${st.id}/lines/BAT-W2`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(`/stocktakes/${st.id}/lines/BAT-W2`, { method: 'DELETE' })).status).toBe(404);
  });

  it('never removes Kit Spec lines', async () => {
    const api = client();
    const st = await open(api, 'penguins');
    expect((await api(`/stocktakes/${st.id}/lines/STU-01`, { method: 'DELETE' })).status).toBe(409);
  });
});
