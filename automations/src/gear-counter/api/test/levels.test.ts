import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Catalogue, LevelLine, TeamPage, TeamSummary } from '../../shared/src/types';
import { client, testDeps, type Client } from './helpers';

const page = async (api: Client, slug: string) => (await (await api(`/teams/${slug}`)).json()) as TeamPage;
const adjust = (api: Client, slug: string, item: string, delta: unknown, who: unknown = 'Sam') =>
  api(`/teams/${slug}/items/${item}/adjust`, { method: 'POST', json: { delta, who } });
const count = (api: Client, slug: string, item: string, level: unknown, who = 'Sam', note?: string) =>
  api(`/teams/${slug}/items/${item}/count`, { method: 'POST', json: { level, who, note } });

describe('teams', () => {
  it('lists the visible teams, then pools', async () => {
    const teams = (await (await client()('/teams')).json()) as TeamSummary[];
    expect(teams).toHaveLength(28);
    expect(teams.at(-1)).toEqual({ slug: 'pool', name: 'Club pool', kind: 'pool', mascot: '', grade: null, dot: null, description: null });
    expect(teams.find((t) => t.slug === 'pumas')).toMatchObject({ kind: 'team', grade: 'Year 7', dot: 'green' });
  });

  it('shows a team its Kit Spec items in catalogue order with no changes yet', async () => {
    const p = await page(client(), 'penguins');
    expect(p.spec).toBe('Kiwi Y1');
    const kit = await env.DB.prepare(
      "SELECT s.item_id FROM kit_spec_items s JOIN kit_specs k ON k.id = s.spec_id JOIN items i ON i.id = s.item_id JOIN categories c ON c.id = i.category_id WHERE k.name = 'Kiwi Y1' ORDER BY c.sort, i.sort",
    ).all<{ item_id: string }>();
    expect(p.levels.map((l) => l.itemId)).toEqual(kit.results.map((r) => r.item_id));
    expect(p.levels.find((l) => l.itemId === 'STU-03')).toEqual({
      itemId: 'STU-03', name: 'Black rubber bases', category: 'Stumps & Wickets', level: 0, kitSpec: 1, added: false, retired: false, pinned: true,
    } satisfies LevelLine);
    expect(p.recent).toEqual([]);
  });

  it('shows a pool every item', async () => {
    expect((await page(client(), 'pool')).levels).toHaveLength(62);
  });

  it('404s an unknown team', async () => {
    expect((await client()('/teams/pumaz')).status).toBe(404);
  });
});

describe('adjust', () => {
  it('applies concurrent changes without losing any', async () => {
    const api = client();
    await Promise.all(Array.from({ length: 10 }, () => adjust(api, 'pumas', 'FLD-SCC', 1)));
    expect(await (await adjust(api, 'pumas', 'FLD-SCC', -3)).json()).toEqual({ level: 7 });
  });

  it('never goes below 0 and logs only what was applied', async () => {
    const api = client();
    await adjust(api, 'pumas', 'STU-04', 1, 'Jo');
    expect(await (await adjust(api, 'pumas', 'STU-04', -5)).json()).toEqual({ level: 0 });
    expect(await (await adjust(api, 'pumas', 'STU-04', -1)).json()).toEqual({ level: 0 });
    const { recent } = await page(api, 'pumas');
    expect(recent.map((e) => [e.who, e.change, e.levelAfter])).toEqual([['Sam', -1, 0], ['Jo', 1, 1]]);
  });

  it.each([0, 21, -21, 1.5, '1', null])('rejects delta %s', async (delta) => {
    expect((await adjust(client(), 'pumas', 'STU-04', delta)).status).toBe(400);
  });

  it.each([null, '', '   ', 'x'.repeat(41), 7])('requires a name (%s)', async (who) => {
    const res = await adjust(client(), 'pumas', 'STU-04', 1, who);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'name_required' });
  });

  it('requires a name when it is left out', async () => {
    const res = await client()('/teams/pumas/items/STU-04/adjust', { method: 'POST', json: { delta: 1 } });
    expect(res.status).toBe(400);
  });

  it('404s an item that is not listed', async () => {
    expect((await adjust(client(), 'penguins', 'BAT-W2', 1)).status).toBe(404);
    expect((await adjust(client(), 'penguins', 'NOPE', 1)).status).toBe(404);
  });

  it('rate limits writes', async () => {
    const api = client(testDeps({ limit: async () => false }));
    expect((await adjust(api, 'pumas', 'STU-04', 1)).status).toBe(429);
    expect((await api('/teams/pumas')).status).toBe(200);
  });
});

describe('grouping', () => {
  const at = (t: string) => {
    let now = new Date(t);
    return { api: client(testDeps({ now: () => now })), set: (s: string) => (now = new Date(s)) };
  };

  it('merges one person’s taps on an item within 2 minutes', async () => {
    const { api, set } = at('2026-10-11T01:00:00Z');
    await adjust(api, 'pumas', 'STU-04', 1);
    set('2026-10-11T01:01:30Z');
    await adjust(api, 'pumas', 'STU-04', 1, 'sam'); // name compared case-insensitively
    set('2026-10-11T01:03:00Z'); // 90 s after the last tap: still grouped
    await adjust(api, 'pumas', 'STU-04', 1);
    const { recent } = await page(api, 'pumas');
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ kind: 'adjust', who: 'Sam', change: 3, levelAfter: 3, at: '2026-10-11T01:00:00.000Z' });
  });

  it('starts a new entry after 2 minutes, for another person, item or kind', async () => {
    const { api, set } = at('2026-10-11T01:00:00Z');
    await adjust(api, 'pumas', 'STU-04', 1);
    set('2026-10-11T01:02:01Z');
    await adjust(api, 'pumas', 'STU-04', 1); // > 2 min since the last tap
    await adjust(api, 'pumas', 'STU-04', 1, 'Jo'); // another person
    await adjust(api, 'pumas', 'FLD-SCC', 1, 'Jo'); // another item
    await count(api, 'pumas', 'STU-04', 5, 'Jo');
    await adjust(api, 'pumas', 'STU-04', 1, 'Jo'); // after a count
    const { recent } = await page(api, 'pumas');
    expect(recent.map((e) => [e.kind, e.who, e.itemId, e.change])).toEqual([
      ['adjust', 'Jo', 'STU-04', 1],
      ['count', 'Jo', 'STU-04', 2],
      ['adjust', 'Jo', 'FLD-SCC', 1],
      ['adjust', 'Jo', 'STU-04', 1],
      ['adjust', 'Sam', 'STU-04', 1],
      ['adjust', 'Sam', 'STU-04', 1],
    ]);
  });

  it('drops a group that nets to 0', async () => {
    const api = client();
    await adjust(api, 'pumas', 'STU-04', 2);
    await adjust(api, 'pumas', 'STU-04', -2);
    expect((await page(api, 'pumas')).recent).toEqual([]);
  });
});

describe('listing', () => {
  it('lists an added item at 0, idempotently, in catalogue order', async () => {
    const api = client();
    const res = await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    expect(await res.json()).toEqual({
      itemId: 'BAT-W2', name: 'Wooden bat S2 (softball)', category: 'Bats', level: 0, kitSpec: 0, added: true, retired: false, pinned: false,
    });
    await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    const ids = (await page(api, 'penguins')).levels.map((l) => l.itemId);
    expect(ids.filter((id) => id === 'BAT-W2')).toHaveLength(1);
    expect(ids.indexOf('BAT-W2')).toBe(ids.indexOf('BAT-P4') + 1);
  });

  it('rejects unknown and excluded items', async () => {
    const api = client();
    expect((await api('/teams/pumas/items/MSC-BAG', { method: 'PUT', json: { who: 'Sam' } })).status).toBe(404);
    expect((await api('/teams/pumas/items/NOPE', { method: 'PUT', json: { who: 'Sam' } })).status).toBe(404);
  });

  it('unlists an added item only at 0, and never Kit Spec or pool items', async () => {
    const api = client();
    await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    await adjust(api, 'penguins', 'BAT-W2', 1);
    expect((await api('/teams/penguins/items/BAT-W2', { method: 'DELETE' })).status).toBe(409);
    await adjust(api, 'penguins', 'BAT-W2', -1);
    expect((await api('/teams/penguins/items/BAT-W2', { method: 'DELETE' })).status).toBe(204);
    expect((await api('/teams/penguins/items/BAT-W2', { method: 'DELETE' })).status).toBe(404);
    expect((await api('/teams/penguins/items/STU-03', { method: 'DELETE' })).status).toBe(409);
    expect((await api('/teams/pool/items/STU-03', { method: 'DELETE' })).status).toBe(409);
  });
});

describe('set count', () => {
  it('sets the level and logs old → new with the note', async () => {
    const api = client();
    await adjust(api, 'pumas', 'STU-04', 4);
    expect(await (await count(api, 'pumas', 'STU-04', 6, 'Jo', '  after the shed check ')).json()).toEqual({ level: 6 });
    const [entry] = (await page(api, 'pumas')).recent;
    expect(entry).toMatchObject({ kind: 'count', who: 'Jo', change: 2, levelAfter: 6, note: 'after the shed check', from: null, to: null });
  });

  it('writes nothing when the level is unchanged', async () => {
    const api = client();
    await count(api, 'pumas', 'STU-04', 0);
    expect((await page(api, 'pumas')).recent).toEqual([]);
  });

  it.each([-1, 1000, 2.5, '3'])('rejects level %s', async (level) => {
    expect((await count(client(), 'pumas', 'STU-04', level)).status).toBe(400);
  });

  it('rejects a note over 200 characters', async () => {
    expect((await count(client(), 'pumas', 'STU-04', 1, 'Sam', 'x'.repeat(201))).status).toBe(400);
  });
});

describe('recent changes', () => {
  it('returns the newest 50', async () => {
    const api = client();
    for (let i = 0; i < 26; i++) {
      await count(api, 'pumas', 'STU-04', i % 2 ? 0 : 1);
      await count(api, 'pumas', 'FLD-SCC', i % 2 ? 0 : 1);
    }
    const { recent } = await page(api, 'pumas');
    expect(recent).toHaveLength(50);
    expect(recent[0].id).toBeGreaterThan(recent[49].id);
  });
});

describe('review fixes', () => {
  it('groups concurrent taps by one person without losing any', async () => {
    const api = client();
    await Promise.all(Array.from({ length: 8 }, () => adjust(api, 'pumas', 'FLD-SCC', 1)));
    const { recent, levels } = await page(api, 'pumas');
    expect(levels.find((l) => l.itemId === 'FLD-SCC')?.level).toBe(8);
    expect(recent.map((e) => [e.who, e.change, e.levelAfter])).toEqual([['Sam', 8, 8]]);
  });

  it('lists Kit Spec items that were missing (e.g. after a Kit Spec update)', async () => {
    const api = client();
    await env.DB.prepare("DELETE FROM levels WHERE team_slug = 'penguins' AND item_id = 'STU-03'").run();
    await env.DB.prepare("DELETE FROM levels WHERE team_slug = 'pool' AND item_id = 'FLD-TC'").run();
    expect((await page(api, 'penguins')).levels.map((l) => l.itemId)).toContain('STU-03');
    expect((await page(api, 'pool')).levels).toHaveLength(62);
  });
});

describe('catalogue in D1', () => {
  const sql = (q: string) => env.DB.prepare(q).run();
  const line = async (api: Client, slug: string, item: string) => (await page(api, slug)).levels.find((l) => l.itemId === item);

  it('serves the catalogue in order', async () => {
    const cat = (await (await client()('/catalogue')).json()) as Catalogue;
    expect(cat.categories).toHaveLength(11);
    expect(cat.categories[0]).toMatchObject({ name: 'Stumps & Wickets' });
    expect(cat.items).toHaveLength(62);
    expect(cat.items[0]).toMatchObject({ id: 'STU-01', category: 'Stumps & Wickets', retired: false });
    expect(cat.specs).toContain('Year 5');
  });

  it('keeps a retired item where it is held, unpinned, until removed at 0', async () => {
    const api = client();
    await adjust(api, 'penguins', 'STU-03', 2);
    await sql("UPDATE items SET retired = 1 WHERE id = 'STU-03'");
    expect(((await (await api('/catalogue')).json()) as Catalogue).items.some((i) => i.id === 'STU-03')).toBe(false);
    expect(await line(api, 'penguins', 'STU-03')).toMatchObject({ level: 2, retired: true, pinned: false });
    expect(await line(api, 'pool', 'STU-03')).toMatchObject({ level: 0, retired: true, pinned: false });
    expect((await api('/teams/penguins/items/STU-03', { method: 'DELETE' })).status).toBe(409);
    await adjust(api, 'penguins', 'STU-03', -2);
    expect((await api('/teams/penguins/items/STU-03', { method: 'DELETE' })).status).toBe(204);
    expect(await line(api, 'penguins', 'STU-03')).toBeUndefined(); // not listed again
    const res = await api('/teams/penguins/items/STU-03', { method: 'PUT', json: { who: 'Sam' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'item_retired' });
  });

  it('keeps an item dropped from the Kit Spec where held, removable at 0', async () => {
    const api = client();
    await adjust(api, 'penguins', 'STU-03', 1);
    await sql("DELETE FROM kit_spec_items WHERE item_id = 'STU-03' AND spec_id = (SELECT id FROM kit_specs WHERE name = 'Kiwi Y1')");
    expect(await line(api, 'penguins', 'STU-03')).toMatchObject({ level: 1, kitSpec: 0, pinned: false, retired: false });
    await adjust(api, 'penguins', 'STU-03', -1);
    expect((await api('/teams/penguins/items/STU-03', { method: 'DELETE' })).status).toBe(204);
  });

  it('lists a new item in pools and in teams whose Kit Spec has it, on their next load', async () => {
    const api = client();
    await sql("INSERT INTO items (id, category_id, name, sort, retired, created_at) VALUES ('X-ABC123', 1, 'Practice stumps', 999, 0, 'x')");
    await sql("INSERT INTO kit_spec_items (spec_id, item_id, qty) SELECT id, 'X-ABC123', 2 FROM kit_specs WHERE name = 'Kiwi Y1'");
    expect(await line(api, 'pool', 'X-ABC123')).toMatchObject({ level: 0, pinned: true, name: 'Practice stumps' });
    expect(await line(api, 'penguins', 'X-ABC123')).toMatchObject({ level: 0, kitSpec: 2, pinned: true });
    expect(await line(api, 'pumas', 'X-ABC123')).toBeUndefined();
  });
});
