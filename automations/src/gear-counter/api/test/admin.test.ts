import { describe, expect, it } from 'vitest';
import type { AdminTeam, ApiErrorBody, TeamPage, TeamSummary } from '../../shared/src/types';
import { client, testDeps, type Client } from './helpers';

const PASS = { 'x-admin-passcode': 'test-passcode' };
const admin = (api: Client, path: string, { json, ...init }: RequestInit & { json?: unknown } = {}) =>
  api(`/admin${path}`, {
    ...init,
    headers: { ...PASS, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
    body: json === undefined ? init.body : JSON.stringify(json),
  });
const adjust = (api: Client, slug: string, item: string, delta: number, who = 'Sam') =>
  api(`/teams/${slug}/items/${item}/adjust`, { method: 'POST', json: { delta, who } });
const levelsOf = async (api: Client, slug: string) => ((await (await api(`/teams/${slug}`)).json()) as TeamPage).levels;
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
  it('lists every team with its Kit Spec column and last change', async () => {
    const api = client();
    await adjust(api, 'lions', 'STU-03', 1);
    const teams = (await (await admin(api, '/teams')).json()) as AdminTeam[];
    expect(teams).toHaveLength(28);
    expect(teams.find((t) => t.slug === 'lions')).toMatchObject({ grade: 'Kiwi Year 1/2', spec: 'Kiwi Y1', hidden: false });
    expect(teams.find((t) => t.slug === 'lions')?.lastChange).toMatch(/^2026-10-09T03:00:00/);
    expect(teams.find((t) => t.slug === 'pumas')).toMatchObject({ spec: 'Year 7', lastChange: null });
    expect(teams.at(-1)).toMatchObject({ slug: 'pool', kind: 'pool', spec: null });
  });

  it('adds a pool after the Club pool, counted like any team', async () => {
    const api = client();
    const res = await addPool(api);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ slug: 'shed', name: 'Shed', kind: 'pool', grade: null, spec: null, mascot: '', hidden: false });
    const teams = (await (await api('/teams')).json()) as TeamSummary[];
    expect(teams.slice(-2).map((t) => t.slug)).toEqual(['pool', 'shed']);
    expect(await levelsOf(api, 'shed')).toHaveLength(62);
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
    expect(page.levels.length).toBeGreaterThan(0);
    expect(page.levels.every((l) => l.level === 0 && !l.added)).toBe(true);
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
    await adjust(api, 'lions', 'STU-03', 2);
    const hidden = await admin(api, '/teams/lions', { method: 'PATCH', json: { hidden: true } });
    expect(await hidden.json()).toMatchObject({ slug: 'lions', hidden: true });
    expect(((await (await api('/teams')).json()) as TeamSummary[]).some((t) => t.slug === 'lions')).toBe(false);
    expect((await api('/teams/lions')).status).toBe(404);
    expect((await adjust(api, 'lions', 'STU-03', 1)).status).toBe(404);
    expect((await admin(api, '/teams/lions', { method: 'PATCH', json: { hidden: false } })).status).toBe(200);
    expect((await levelsOf(api, 'lions')).find((l) => l.itemId === 'STU-03')?.level).toBe(2);
  });

  it('validates hide requests', async () => {
    const api = client();
    expect((await admin(api, '/teams/lions', { method: 'PATCH', json: { hidden: 'yes' } })).status).toBe(400);
    expect((await admin(api, '/teams/nobody', { method: 'PATCH', json: { hidden: true } })).status).toBe(404);
  });
});

describe('CSV exports', () => {
  it('builds the club inventory from current levels', async () => {
    const api = client();
    await adjust(api, 'lions', 'STU-03', 2);
    await adjust(api, 'pool', 'STU-03', 5);
    await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    await addPool(api, '=Shed, "north"', 'shed');
    await admin(api, '/teams/pumas', { method: 'PATCH', json: { hidden: true } });
    const res = await admin(api, '/export/club.csv');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="club-inventory-2026-10-09.csv"');
    const rows = await csvRows(res);
    const header = rows[0].split(',');
    expect(header.slice(0, 3)).toEqual(['Category', 'Item', 'Club total']);
    expect(header).toContain('Parklands Pumas (hidden)');
    expect(rows[0].endsWith(`Club pool,"'=Shed, ""north"""`)).toBe(true);
    expect(rows[1].split(',')[0]).toBe('Last change');
    expect(rows[1].split(',')[header.indexOf('Parklands Lions')]).toBe('2026-10-09');
    expect(rows[1].split(',')[header.indexOf('Parklands Bears')]).toBe('');
    expect(rows).toHaveLength(2 + 62);
    const bases = rows.find((r) => r.startsWith('Stumps & Wickets,Black rubber bases,'))!.split(',');
    expect(bases[2]).toBe('7');
    expect(bases[header.indexOf('Parklands Lions')]).toBe('2');
    expect(bases[header.indexOf('Parklands Pumas (hidden)')]).toBe(''); // not in the Year 7 Kit Spec
    const bat = rows.find((r) => r.startsWith('Bats,Wooden bat S2 (softball),'))!.split(',');
    expect(bat[header.indexOf('Parklands Penguins')]).toBe('0');
    expect(bat[header.indexOf('Parklands Lions')]).toBe('');
  });

  it('downloads one team’s levels', async () => {
    const api = client();
    await adjust(api, 'penguins', 'STU-03', 3);
    await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    const res = await admin(api, '/export/teams/penguins.csv');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="penguins-levels-2026-10-09.csv"');
    const rows = await csvRows(res);
    expect(rows[0]).toBe('Category,Item,Level,Kit Spec,Listed');
    expect(rows).toContain('Stumps & Wickets,Black rubber bases,3,1,Kit Spec');
    expect(rows).toContain('Bats,Wooden bat S2 (softball),0,,Added');
    expect(rows).toHaveLength(1 + 15);
  });

  it('downloads the log, all teams or one, newest first, in NZ time', async () => {
    let now = new Date('2026-10-11T01:14:00Z');
    const api = client(testDeps({ now: () => now }));
    await adjust(api, 'pool', 'STU-03', 5, 'Jo');
    now = new Date('2026-10-11T01:20:00Z');
    await api('/moves', { method: 'POST', json: { from: 'pool', to: 'lions', item: 'STU-03', qty: 2, who: 'Jo', note: 'for Sat' } });
    await adjust(api, 'pumas', 'STU-04', 1, '=Sam');

    const all = await admin(api, '/export/log.csv');
    expect(all.headers.get('content-disposition')).toBe('attachment; filename="gear-log-2026-10-11.csv"');
    const rows = await csvRows(all);
    expect(rows[0]).toBe('When,Who,Team,Item,Kind,Change,Level after,From,To,Note');
    expect(rows.slice(1)).toEqual([
      "2026-10-11 14:20,'=Sam,Parklands Pumas,Bails (pair),Adjust,1,1,,,",
      '2026-10-11 14:20,Jo,Parklands Lions,Black rubber bases,Move in,2,2,Club pool,,for Sat',
      '2026-10-11 14:20,Jo,Club pool,Black rubber bases,Move out,-2,3,,Parklands Lions,for Sat',
      '2026-10-11 14:14,Jo,Club pool,Black rubber bases,Adjust,5,5,,,',
    ]);
    const one = await admin(api, '/export/log.csv?team=lions');
    expect(one.headers.get('content-disposition')).toBe('attachment; filename="lions-log-2026-10-11.csv"');
    expect(await csvRows(one)).toHaveLength(2);
    expect((await admin(api, '/export/log.csv?team=nobody')).status).toBe(404);
  });

  it('404s a bad levels file name', async () => {
    expect((await admin(client(), '/export/teams/bears.txt')).status).toBe(404);
    expect((await admin(client(), '/export/teams/nobody.csv')).status).toBe(404);
  });
});

describe('pool descriptions', () => {
  const desc = (api: Client, slug: string, description: unknown) => admin(api, `/teams/${slug}`, { method: 'PATCH', json: { description } });

  it('sets, shows and clears a pool description', async () => {
    const api = client();
    const res = await desc(api, 'pool', '  Shed at the club rooms ');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: 'pool', description: 'Shed at the club rooms', hidden: false });
    expect(((await (await api('/teams')).json()) as TeamSummary[]).at(-1)?.description).toBe('Shed at the club rooms');
    expect(((await (await api('/teams/pool')).json()) as TeamPage).team.description).toBe('Shed at the club rooms');
    await desc(api, 'pool', '');
    expect(((await (await api('/teams/pool')).json()) as TeamPage).team.description).toBeNull();
    await desc(api, 'pool', 'Back shed');
    await desc(api, 'pool', null);
    expect(((await (await api('/teams/pool')).json()) as TeamPage).team.description).toBeNull();
  });

  it('adds a pool with a description', async () => {
    const res = await admin(client(), '/teams', { method: 'POST', json: { kind: 'pool', name: 'Shed', slug: 'shed', description: 'Garage at the nets' } });
    expect(await res.json()).toMatchObject({ slug: 'shed', description: 'Garage at the nets' });
  });

  it('refuses a description on a team, too long, or not text', async () => {
    const api = client();
    expect((await desc(api, 'lions', 'Kit bag')).status).toBe(400);
    expect((await desc(api, 'pool', 'x'.repeat(81))).status).toBe(400);
    expect((await desc(api, 'pool', 5)).status).toBe(400);
    expect((await admin(api, '/teams/pool', { method: 'PATCH', json: {} })).status).toBe(400);
    expect((await admin(api, '/teams', { method: 'POST', json: { kind: 'team', name: 'Seals', slug: 'seals', spec: 'Year 3', description: 'x' } })).status).toBe(400);
  });
});
