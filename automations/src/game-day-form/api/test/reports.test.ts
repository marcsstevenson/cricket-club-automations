import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GamePage, ReportOut } from '../../shared/src/api';
import { createApp } from '../src/app';
import { form, pumasRoutes, put } from './builders';
import { fail, summary } from './fixtures/playhq';
import { call, seedSquad, testDeps } from './helpers';

const app = () => createApp(testDeps({ fetch: pumasRoutes().fetch }));

describe('PUT report', () => {
  beforeEach(() => seedSquad());

  it('creates a report and returns labels only', async () => {
    const res = await put(app(), 'g1', form({ mascot: { kind: 'other', fullName: 'Chris Pratt' }, updatedBy: 'Sarah' }));
    expect(res.status).toBe(200);
    const body = await res.json<ReportOut>();
    expect(body.version).toBe(1);
    expect(body.potd).toEqual({ kind: 'squad', key: 'p001', label: 'Alex T.' });
    expect(body.mascot).toMatchObject({ kind: 'named', label: 'Chris P.' });
    expect(body.scoreSource).toBe('entered');
    expect(JSON.stringify(body)).not.toMatch(/Turner|Pratt/);
  });

  it('shows the saved report on the game endpoint', async () => {
    const a = app();
    await put(a, 'g1', form());
    const page = await (await call(a, '/api/teams/pumas/games/g1')).json<GamePage>();
    expect(page.report?.version).toBe(1);
    expect(page.start.available).toBe(true);
  });

  it('uses PlayHQ scores when PlayHQ has the result, whatever the client sent', async () => {
    const body = await (await put(app(), 'g2', form({ scoring: 'yes', team: { runs: 1, wkts: 1 } }))).json<ReportOut>();
    expect(body.team).toEqual({ runs: 145, wkts: 4 });
    expect(body.scoreSource).toBe('playhq');
  });

  it('stores scoring yes when PlayHQ has the result and the client sent no', async () => {
    const body = await (await put(app(), 'g2', form({ scoring: 'no' }))).json<ReportOut>();
    expect(body.scoreSource).toBe('playhq');
    expect(body.scoring).toBe('yes');
    const page = await (await call(app(), '/api/teams/pumas/games/g2')).json<GamePage>();
    expect(page.report?.scoring).toBe('yes');
  });

  it('stores an unmatched PlayHQ player by id and labels them', async () => {
    const body = await (
      await put(app(), 'g2', form({
        scoring: 'yes',
        milestones: [{ rowId: 'x', type: 'bat', player: { kind: 'playhq', playhqId: 'ph-fill' }, value: 27, source: 'playhq', playhqValue: 27, touched: false }],
      }))
    ).json<ReportOut>();
    expect(body.milestones[0].player).toMatchObject({ kind: 'named', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' });
    const named = await env.DB.prepare('SELECT full_name FROM named_players WHERE playhq_id = ?').bind('ph-fill').first();
    expect(named).toEqual({ full_name: 'Kim Walker' });
  });

  it('clears everything but the reason when the game was not played', async () => {
    const body = await (await put(app(), 'g1', form({ scoring: 'not_played', notPlayedReason: 'rain' }))).json<ReportOut>();
    expect(body).toMatchObject({ scoring: 'not_played', notPlayedReason: 'rain', potd: null, mascot: null, team: { runs: null, wkts: null }, milestones: [] });
  });

  it('increments the version on edit and keeps history', async () => {
    const a = app();
    await put(a, 'g1', form());
    const res = await put(a, 'g1', form({ baseVersion: 1, highlights: 'Edited' }));
    expect((await res.json<ReportOut>()).version).toBe(2);
    const { results } = await env.DB.prepare('SELECT version FROM report_versions ORDER BY version').all();
    expect(results).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it('keeps a saved Other person when sent back as named', async () => {
    const a = app();
    const first = await (await put(a, 'g1', form({ mascot: { kind: 'other', fullName: 'Chris Pratt' } }))).json<ReportOut>();
    const second = await (await put(a, 'g1', form({ baseVersion: 1, mascot: first.mascot }))).json<ReportOut>();
    expect(second.mascot).toEqual(first.mascot);
  });

  it('409s with the latest report on a version conflict', async () => {
    const a = app();
    await put(a, 'g1', form());
    const res = await put(a, 'g1', form({ baseVersion: 0 }));
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string; latest: ReportOut }>();
    expect(body.error).toBe('version_conflict');
    expect(body.latest.version).toBe(1);
  });

  it('422s with field errors', async () => {
    const res = await put(app(), 'g1', form({ potd: null }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'validation_failed', fields: { potd: 'Choose a player.' } });
  });

  it('rejects squad keys from another team, named ids from other reports and unknown PlayHQ ids', async () => {
    const res = await put(app(), 'g1', form({
      potd: { kind: 'squad', key: 'nope' },
      mascot: { kind: 'named', id: 'someone-elses' },
      milestones: [{ rowId: 'x', type: 'bat', player: { kind: 'playhq', playhqId: 'ph-ghost' }, value: 30, source: 'playhq', playhqValue: 30, touched: false }],
    }));
    expect(res.status).toBe(422);
    const { fields } = await res.json<{ fields: Record<string, string> }>();
    expect(Object.keys(fields).sort()).toEqual(['mascot', 'milestones.0.player', 'potd']);
  });

  it('refuses future games', async () => {
    const res = await put(app(), 'g3', form());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'game_not_selectable' });
  });

  it('rejects malformed bodies', async () => {
    const res = await put(app(), 'g1', { scoring: 'maybe' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects unknown photo ids', async () => {
    const res = await put(app(), 'g1', form({ photoIds: ['nope'] }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ fields: { photoIds: expect.any(String) } });
  });

  it('429s when over the save limit', async () => {
    const a = createApp(testDeps({ fetch: pumasRoutes().fetch, limit: async () => false }));
    expect((await put(a, 'g1', form())).status).toBe(429);
  });
});

describe('milestone check flags', () => {
  beforeEach(() => seedSquad());

  const pairsG2 = (over: Record<string, unknown> = {}) =>
    pumasRoutes({
      '/v2/games/g2/summary': {
        data: summary({
          id: 'g2',
          team: { runs: 120, wkts: 0 },
          opp: { runs: 89, wkts: 0 },
          overLimit: 16,
          bowling: [{ id: 'ph-jordan', wkts: 3, overs: 3 }, { id: 'ph-sam', wkts: 3, overs: 2 }],
        }),
      },
      ...over,
    });
  const bowlRow = (key: string, check?: unknown) => ({
    rowId: key, type: 'bowl', player: { kind: 'squad', key }, value: 3, source: 'playhq', playhqValue: 3, touched: false, ...(check === undefined ? {} : { check }),
  });
  const save = async (routes: ReturnType<typeof pumasRoutes>, milestones: unknown[]) =>
    (await put(createApp(testDeps({ fetch: routes.fetch })), 'g2', form({ scoring: 'yes', milestones: milestones as never }))).json<ReportOut>();

  it('flags an over-share bowler from PlayHQ even when the client sent no flag', async () => {
    const body = await save(pairsG2(), [bowlRow('p004'), bowlRow('p002')]);
    expect(body.milestones.map((m) => m.check)).toEqual([{ actual: 3, share: 2, checked: false }, null]);
  });

  it('keeps the tick when it matches the PlayHQ figure', async () => {
    const ok = await save(pairsG2(), [bowlRow('p004', { actual: 3, share: 2, checked: true })]);
    expect(ok.milestones[0].check).toEqual({ actual: 3, share: 2, checked: true });
  });

  it('drops a tick made against a different figure', async () => {
    const stale = await save(pairsG2(), [bowlRow('p004', { actual: 2.4, share: 2, checked: true })]);
    expect(stale.milestones[0].check).toEqual({ actual: 3, share: 2, checked: false });
  });

  it("clears a flag PlayHQ doesn't support", async () => {
    const body = await save(pairsG2(), [bowlRow('p002', { actual: 9, share: 2, checked: false })]);
    expect(body.milestones[0].check).toBeNull();
  });

  it("stores the client's flag as sent when PlayHQ can't be reached", async () => {
    const body = await save(pairsG2({ '/v2/games/g2/summary': fail }), [bowlRow('p004', { actual: 3, share: 2, checked: true })]);
    expect(body.milestones[0].check).toEqual({ actual: 3, share: 2, checked: true });
  });

  it("matches a saved named player on the stored PlayHQ id, not the client's", async () => {
    const fill = pairsG2({
      '/v2/games/g2/summary': {
        data: summary({
          id: 'g2',
          team: { runs: 120, wkts: 0 },
          opp: { runs: 89, wkts: 0 },
          overLimit: 16,
          bowling: [{ id: 'ph-fill', wkts: 3, overs: 3 }],
          appearances: [{ id: 'ph-fill', firstName: 'Kim', lastName: 'Walker' }],
        }),
      },
    });
    const a = createApp(testDeps({ fetch: fill.fetch }));
    const first = await (
      await put(a, 'g2', form({ scoring: 'yes', milestones: [{ ...bowlRow('x'), player: { kind: 'other', fullName: 'Chris Pratt' } }] as never }))
    ).json<ReportOut>();
    const ref = first.milestones[0].player as { kind: 'named'; id: string };
    const spoofed = { ...ref, playhqId: 'ph-fill' };
    const second = await (
      await put(a, 'g2', form({ baseVersion: 1, scoring: 'yes', milestones: [{ ...bowlRow('x'), player: spoofed }] as never }))
    ).json<ReportOut>();
    expect(second.milestones[0].check).toBeNull();
  });

  it('round-trips the flag through D1', async () => {
    await save(pairsG2(), [bowlRow('p004')]);
    const row = await env.DB.prepare('SELECT check_actual, check_share, checked FROM milestones').first();
    expect(row).toEqual({ check_actual: 3, check_share: 2, checked: 0 });
  });
});
