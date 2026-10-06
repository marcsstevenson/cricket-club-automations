import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GamesList } from '../../shared/src/api';
import { createApp } from '../src/app';
import { form, pumasRoutes, put } from './builders';
import { call, seedSquad, testDeps } from './helpers';
import { summary } from './fixtures/playhq';

async function seeded() {
  await seedSquad();
  const app = createApp(testDeps({ fetch: pumasRoutes().fetch }));
  await put(app, 'g1', form({
    scoring: 'yes_issues',
    issues: 'Tablet died',
    mascot: { kind: 'other', fullName: 'Chris Pratt' },
    highlights: '=cmd()',
    milestones: [{ rowId: 'x', type: 'hattrick', player: { kind: 'squad', key: 'p004' }, value: null, source: 'entered', playhqValue: null, touched: true }],
  }));
  return app;
}

describe('GET /api/games', () => {
  beforeEach(() => seedSquad());

  it('lists every game with status, newest first', async () => {
    const app = await seeded();
    const body = await (await call(app, '/api/games')).json<GamesList>();
    expect(body.rows.map((r) => [r.gameId, r.status])).toEqual([
      ['g3', 'upcoming'],
      ['g2', 'missing'],
      ['g1', 'reported'],
    ]);
    expect(body.rows[2]).toMatchObject({ potd: 'Alex T.', mascot: 'Chris P.', score: '100/5 v 90/7', milestoneCount: 1, issues: 'Tablet died' });
    expect(JSON.stringify(body)).not.toMatch(/Turner|Pratt/);
  });

  it('filters by team, status and follow-up', async () => {
    const app = await seeded();
    const q = async (qs: string) => (await (await call(app, `/api/games?${qs}`)).json<GamesList>()).rows.map((r) => r.gameId);
    expect(await q('status=missing,upcoming')).toEqual(['g3', 'g2']);
    expect(await q('followUp=1')).toEqual(['g1']);
    expect(await q('team=tigers')).toEqual([]);
  });
});

describe('exports', () => {
  it('public CSVs never contain full names', async () => {
    const app = await seeded();
    const games = await (await call(app, '/api/export/games.csv')).text();
    const milestones = await (await call(app, '/api/export/milestones.csv')).text();
    expect(games).toContain('Chris P.');
    expect(games).toContain("'=cmd()");
    expect(games + milestones).not.toMatch(/Turner|Pratt|Lee\b/);
    expect(milestones).toContain('Jordan L.,p004,N,Hat-trick');
  });

  it('admin CSVs add full names with the right passcode', async () => {
    const app = await seeded();
    const res = await call(app, '/api/admin/export/games.csv', { headers: { 'x-admin-passcode': 'letmein' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toContain('games-full-names.csv');
    const text = await res.text();
    expect(text).toContain('Alex Turner');
    expect(text).toContain('Chris Pratt');
  });

  it('admin rejects a wrong passcode and rate-limits', async () => {
    const app = await seeded();
    expect((await call(app, '/api/admin/check', { headers: { 'x-admin-passcode': 'nope' } })).status).toBe(401);
    expect((await call(app, '/api/admin/check', { headers: { 'x-admin-passcode': 'letmein' } })).status).toBe(200);
    const limited = createApp(testDeps({ limit: async (_e, name) => name !== 'ADMIN_LIMIT' }));
    expect((await call(limited, '/api/admin/check', { headers: { 'x-admin-passcode': 'letmein' } })).status).toBe(429);
  });

  it('fails closed when the passcode secret is not configured', async () => {
    const ctx = createExecutionContext();
    const res = await createApp(testDeps()).request('/api/admin/check', {}, { ...env, ADMIN_PASSCODE: '' }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'admin_disabled' });
  });

  it('sends no-store on the admin check', async () => {
    const res = await call(createApp(testDeps()), '/api/admin/check', { headers: { 'x-admin-passcode': 'letmein' } });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('unchecked milestone flags', () => {
  beforeEach(() => seedSquad());

  async function flagged() {
    const routes = pumasRoutes({
      '/v2/games/g2/summary': {
        data: summary({ id: 'g2', team: { runs: 120, wkts: 0 }, opp: { runs: 89, wkts: 0 }, overLimit: 16, bowling: [{ id: 'ph-jordan', wkts: 3, overs: 3 }] }),
      },
    });
    const app = createApp(testDeps({ fetch: routes.fetch }));
    await put(app, 'g2', form({
      scoring: 'yes',
      milestones: [{ rowId: 'x', type: 'bowl', player: { kind: 'squad', key: 'p004' }, value: 3, source: 'playhq', playhqValue: 3, touched: false }],
    }));
    return app;
  }

  it('counts unchecked flags and includes them in follow-up', async () => {
    const app = await flagged();
    const body = await (await call(app, '/api/games')).json<GamesList>();
    expect(body.rows.find((r) => r.gameId === 'g2')).toMatchObject({ milestoneCount: 1, uncheckedCount: 1 });
    const followUp = await (await call(app, '/api/games?followUp=1')).json<GamesList>();
    expect(followUp.rows.map((r) => r.gameId)).toEqual(['g2']);
  });

  it('adds a Check column to milestones.csv', async () => {
    const app = await flagged();
    const csv = await (await call(app, '/api/export/milestones.csv')).text();
    expect(csv).toContain('Type,Runs or wickets,Source,Check');
    expect(csv).toContain('Jordan L.,p004,N,Bowling,3,PlayHQ,Needs check');
  });
});
