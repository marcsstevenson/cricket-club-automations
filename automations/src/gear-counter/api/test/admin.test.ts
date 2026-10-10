import { describe, expect, it } from 'vitest';
import type { AdminTeam, ApiErrorBody, Stocktake, TeamPage, TeamSummary } from '../../shared/src/types';
import { client, testDeps, type Client } from './helpers';

const PASS = { 'x-admin-passcode': 'test-passcode' };
const admin = (api: Client, path: string, { json, ...init }: RequestInit & { json?: unknown } = {}) =>
  api(`/admin${path}`, {
    ...init,
    headers: { ...PASS, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
    body: json === undefined ? init.body : JSON.stringify(json),
  });
const open = async (api: Client, slug: string) => (await (await api(`/teams/${slug}/stocktakes`, { method: 'POST' })).json()) as Stocktake;
const adjust = (api: Client, id: string, item: string, delta: number) => api(`/stocktakes/${id}/lines/${item}/adjust`, { method: 'POST', json: { delta } });
const addPool = (api: Client, name = 'Shed', slug = 'shed') => admin(api, '/teams', { method: 'POST', json: { kind: 'pool', name, slug } });
const csvRows = async (res: Response) => (await res.text()).replace(/^﻿/, '').trimEnd().split('\r\n');

describe('admin access', () => {
  it('rejects a missing or wrong passcode', async () => {
    const api = client();
    expect((await api('/admin/check')).status).toBe(401);
    const res = await api('/admin/teams', { headers: { 'x-admin-passcode': 'nope' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await api('/admin/export/club.csv')).status).toBe(401);
    expect((await api('/admin/teams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  });

  it('accepts the passcode', async () => {
    const res = await admin(client(), '/check');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rate limits admin requests before checking the passcode', async () => {
    const seen: string[] = [];
    const api = client(testDeps({ limit: async (_env, name) => (seen.push(name), name !== 'ADMIN_LIMIT') }));
    expect((await admin(api, '/check')).status).toBe(429);
    expect(seen).toContain('ADMIN_LIMIT');
  });
});

describe('admin teams', () => {
  it('lists every team with its Kit Spec column and latest stocktake', async () => {
    const api = client();
    await open(api, 'lions');
    const teams = (await (await admin(api, '/teams')).json()) as AdminTeam[];
    expect(teams).toHaveLength(28);
    expect(teams.find((t) => t.slug === 'lions')).toMatchObject({ grade: 'Kiwi Year 1/2', spec: 'Kiwi Y1', hidden: false, latest: '2026-10-09' });
    expect(teams.find((t) => t.slug === 'pumas')).toMatchObject({ spec: 'Year 7', latest: null });
    expect(teams.at(-1)).toMatchObject({ slug: 'pool', kind: 'pool', spec: null });
  });

  it('adds a pool after the Club pool, counted like any team', async () => {
    const api = client();
    const res = await addPool(api);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ slug: 'shed', name: 'Shed', kind: 'pool', grade: null, spec: null, mascot: '', hidden: false });
    const teams = (await (await api('/teams')).json()) as TeamSummary[];
    expect(teams.slice(-2).map((t) => t.slug)).toEqual(['pool', 'shed']);
    const st = await open(api, 'shed');
    expect(st.lines).toHaveLength(62);
  });

  it('adds a team after the existing teams with its Kit Spec lines', async () => {
    const api = client();
    const res = await admin(api, '/teams', {
      method: 'POST',
      json: { kind: 'team', name: 'Parklands Seals', slug: 'seals', spec: 'Div 5', grade: 'Division 5', dot: 'Red', mascot: 'seals' },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ slug: 'seals', kind: 'team', spec: 'Div 5', grade: 'Division 5', dot: 'red', mascot: 'seals' });
    const teams = (await (await api('/teams')).json()) as TeamSummary[];
    expect(teams.filter((t) => t.kind === 'team').at(-1)?.slug).toBe('seals');
    const page = (await (await api('/teams/seals')).json()) as TeamPage;
    expect(page.spec).toBe('Div 5');
    expect((await open(api, 'seals')).lines.length).toBeGreaterThan(0);
  });

  it('defaults the grade to the Kit Spec column', async () => {
    const res = await admin(client(), '/teams', { method: 'POST', json: { kind: 'team', name: 'Seals', slug: 'seals', spec: 'Year 3' } });
    expect(await res.json()).toMatchObject({ grade: 'Year 3', dot: null, mascot: '' });
  });

  it.each([
    [{ kind: 'pool', name: '', slug: 'shed' }, 'name'],
    [{ kind: 'pool', name: 'x'.repeat(61), slug: 'shed' }, 'name'],
    [{ kind: 'pool', name: 'Shed', slug: 'Shed 1' }, 'web address'],
    [{ kind: 'pool', name: 'Shed', slug: '1shed' }, 'web address'],
    [{ kind: 'pool', name: 'Shed', slug: 'admin' }, 'web address'],
    [{ kind: 'pool', name: 'Shed', slug: 'api' }, 'web address'],
    [{ kind: 'bag', name: 'Shed', slug: 'shed' }, 'team or a pool'],
    [{ kind: 'team', name: 'Seals', slug: 'seals' }, 'Kit Spec'],
    [{ kind: 'team', name: 'Seals', slug: 'seals', spec: 'Senior' }, 'Kit Spec'],
    [{ kind: 'team', name: 'Seals', slug: 'seals', spec: 'Year 3', dot: 'purple' }, 'dot'],
    [{ kind: 'team', name: 'Seals', slug: 'seals', spec: 'Year 3', mascot: 'kiwis' }, 'mascot'],
  ])('rejects %j', async (body, words) => {
    const res = await admin(client(), '/teams', { method: 'POST', json: body });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).message).toContain(words);
  });

  it('rejects a taken web address or name, hidden teams included', async () => {
    const api = client();
    expect((await addPool(api, 'Anything', 'pumas')).status).toBe(409);
    expect((await addPool(api, 'club POOL', 'store')).status).toBe(409);
    await admin(api, '/teams/lions', { method: 'PATCH', json: { hidden: true } });
    expect((await addPool(api, 'Anything', 'lions')).status).toBe(409);
    const res = await addPool(api, 'parklands lions', 'lions-2');
    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiErrorBody).message).toBe('Parklands Lions already exists.');
  });

  it('hides a team from the public site and brings it back', async () => {
    const api = client();
    const st = await open(api, 'lions');
    const hidden = await admin(api, '/teams/lions', { method: 'PATCH', json: { hidden: true } });
    expect(await hidden.json()).toMatchObject({ slug: 'lions', hidden: true, latest: '2026-10-09' });
    expect(((await (await api('/teams')).json()) as TeamSummary[]).some((t) => t.slug === 'lions')).toBe(false);
    expect((await api('/teams/lions')).status).toBe(404);
    expect((await api('/teams/lions/stocktakes', { method: 'POST' })).status).toBe(404);
    expect((await admin(api, '/teams/lions', { method: 'PATCH', json: { hidden: false } })).status).toBe(200);
    expect((await api(`/stocktakes/${st.id}`)).status).toBe(200);
    expect((await api('/teams/lions')).status).toBe(200);
  });

  it('validates hide requests', async () => {
    const api = client();
    expect((await admin(api, '/teams/lions', { method: 'PATCH', json: { hidden: 'yes' } })).status).toBe(400);
    expect((await admin(api, '/teams/nobody', { method: 'PATCH', json: { hidden: true } })).status).toBe(404);
  });
});

describe('CSV exports', () => {
  it('builds the club inventory from each latest stocktake', async () => {
    let now = new Date('2026-10-08T03:00:00Z');
    const api = client(testDeps({ now: () => now }));
    const old = await open(api, 'lions');
    await adjust(api, old.id, 'STU-03', 9);
    now = new Date('2026-10-09T03:00:00Z');
    const lions = await open(api, 'lions');
    await adjust(api, lions.id, 'STU-03', 2);
    const pool = await open(api, 'pool');
    await adjust(api, pool.id, 'STU-03', 5);
    await addPool(api, '=Shed, "north"', 'shed');
    await admin(api, '/teams/pumas', { method: 'PATCH', json: { hidden: true } });

    const res = await admin(api, '/export/club.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="club-inventory-2026-10-09.csv"');
    const rows = await csvRows(res);
    const header = rows[0].split(',');
    expect(header.slice(0, 3)).toEqual(['Category', 'Item', 'Club total']);
    expect(header).toContain('Parklands Pumas (hidden)');
    expect(rows[0].endsWith(`Club pool,"'=Shed, ""north"""`)).toBe(true);
    const lionsCol = header.indexOf('Parklands Lions');
    const poolCol = header.indexOf('Club pool');
    expect(rows[1].split(',')[0]).toBe('Stocktake date');
    expect(rows[1].split(',')[lionsCol]).toBe('2026-10-09');
    expect(rows[1].split(',')[header.indexOf('Parklands Bears')]).toBe('');
    expect(rows).toHaveLength(2 + 62);
    const bases = rows.find((r) => r.startsWith('Stumps & Wickets,Black rubber bases,'))!.split(',');
    expect(bases[2]).toBe('7'); // 2 (latest Lions) + 5 (pool), not the older 9
    expect(bases[lionsCol]).toBe('2');
    expect(bases[poolCol]).toBe('5');
    expect(bases[header.indexOf('Parklands Bears')]).toBe(''); // no stocktake
  });

  it('downloads one team’s latest stocktake', async () => {
    const api = client();
    const st = await open(api, 'penguins');
    await adjust(api, st.id, 'STU-03', 3);
    await api(`/stocktakes/${st.id}/lines/BAT-W2`, { method: 'PUT' });
    const res = await admin(api, '/export/teams/penguins.csv');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="penguins-2026-10-09.csv"');
    const rows = await csvRows(res);
    expect(rows[0]).toBe('Category,Item,Count,Kit Spec,Added');
    expect(rows).toHaveLength(1 + 15);
    expect(rows).toContain('Stumps & Wickets,Black rubber bases,3,1,');
    expect(rows).toContain('Bats,Wooden bat S2 (softball),0,0,Yes');
  });

  it('404s a team with no stocktake or a bad file name', async () => {
    const api = client();
    expect((await admin(api, '/export/teams/bears.csv')).status).toBe(404);
    expect((await admin(api, '/export/teams/bears.txt')).status).toBe(404);
  });
});
