import { beforeEach, describe, expect, it } from 'vitest';
import type { GamePage, RefreshResult } from '../../shared/src/api';
import { createApp } from '../src/app';
import { startData, unavailableStart } from '../src/playhq/summary';
import { findTeam, parseSquad } from '../src/squad/load';
import { squadLabels } from '../../shared/src/labels';
import squadFixture from './fixtures/squad.json';
import { fail, fakeFetch, GRADE, summary, v1Game, v1Page } from './fixtures/playhq';
import { call, seedSquad, testDeps } from './helpers';
import { form, put } from './builders';

const team = findTeam(parseSquad(squadFixture), 'pumas');
const labels = squadLabels(team.players);

const full = summary({
  id: 'g2',
  team: { runs: 145, wkts: 4 },
  opp: { runs: 128, wkts: 4 },
  batting: [{ id: 'ph-alex', runs: 31 }, { id: 'ph-sam', runs: 24 }, { id: 'ph-fill', runs: 27 }],
  bowling: [{ id: 'ph-jordan', wkts: 3 }, { id: 'ph-sam', wkts: 2 }, { id: 'ph-alex', wkts: 20 }],
  appearances: [
    { id: 'ph-alex', firstName: 'Alex', lastName: 'Turner' },
    { id: 'ph-fill', firstName: 'Kim', lastName: 'Walker' },
  ],
});

describe('startData', () => {
  it('reads both final scores', () => {
    expect(startData(full, team, labels, '2026-01-31').result).toEqual({ team: { runs: 145, wkts: 4 }, opp: { runs: 128, wkts: 4 } });
  });

  it('finds milestones for this team only, within the limits', () => {
    expect(startData(full, team, labels, '2026-01-31').candidates).toEqual([
      { type: 'bat', player: { kind: 'squad', key: 'p001', label: 'Alex T.' }, value: 31 },
      { type: 'bat', player: { kind: 'playhq', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' }, value: 27 },
      { type: 'bowl', player: { kind: 'squad', key: 'p004', label: 'Jordan L.' }, value: 3 },
    ]);
  });

  it('has no result while the game is not final', () => {
    expect(startData({ ...full, status: 'PENDING' }, team, labels, '2026-01-31').result).toBeNull();
  });

  it('has no result when only one innings has a total (abandoned or in progress)', () => {
    expect(startData(summary({ id: 'g', team: { runs: 50, wkts: 2 }, opp: null }), team, labels, '2026-01-31').result).toBeNull();
  });

  it('labels an unnamed hidden PlayHQ player without leaking anything', () => {
    const s = summary({ id: 'g', batting: [{ id: 'ph-hidden', runs: 40 }], appearances: [{ id: 'ph-hidden', firstName: null, lastName: null }] });
    expect(startData(s, team, labels, '2026-01-31').candidates[0].player.label).toBe('Unnamed player (not in squad)');
  });
});

describe('startData — milestone rule and figures', () => {
  const pairs = summary({
    id: 'g4',
    team: { runs: 120, wkts: 0 },
    opp: { runs: 89, wkts: 0 },
    overLimit: 16,
    grade: 'Year 4 North - Section 2',
    batting: [{ id: 'ph-alex', runs: 26, balls: 16 }, { id: 'ph-fill', runs: 10, balls: 12 }],
    bowling: [{ id: 'ph-jordan', wkts: 3, overs: 3 }, { id: 'ph-sam', wkts: 0, overs: 2 }],
    appearances: [{ id: 'ph-fill', firstName: 'Kim', lastName: 'Walker' }],
  });

  it('picks the rule from the over limit and grade name', () => {
    expect(startData(pairs, team, labels, '2026-03-21').rule).toEqual({ kind: 'pairs', batBalls: 12, bowlOvers: 2 });
    expect(startData({ ...pairs, grade: null }, team, labels, '2026-03-21').rule).toEqual({ kind: 'pairs', batBalls: 12, bowlOvers: 2 });
    const twenty = summary({ id: 'g5', team: { runs: 1, wkts: 0 }, opp: { runs: 1, wkts: 0 }, overLimit: 20 });
    // No grade on the summary → squad gradeName "Year 6 Section 3 (Morning)"; after Christmas → open.
    expect(startData(twenty, team, labels, '2026-01-31').rule).toEqual({ kind: 'open' });
    expect(startData(twenty, team, labels, '2025-11-01').rule).toEqual({ kind: 'pairs', batBalls: 15, bowlOvers: 2 });
  });

  it('lists balls faced and overs bowled for this team, with labels only', () => {
    const s = startData(pairs, team, labels, '2026-03-21');
    expect(s.figures).toEqual(
      expect.arrayContaining([
        { player: { kind: 'squad', key: 'p001', label: 'Alex T.' }, ballsFaced: 16, overs: null },
        { player: { kind: 'playhq', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' }, ballsFaced: 12, overs: null },
        { player: { kind: 'squad', key: 'p004', label: 'Jordan L.' }, ballsFaced: null, overs: 3 },
        { player: { kind: 'squad', key: 'p002', label: 'Sam Th.' }, ballsFaced: null, overs: 2 },
      ]),
    );
    expect(s.figures).toHaveLength(4);
    expect(JSON.stringify(s)).not.toMatch(/Walker|Turner/);
  });

  it('uses the squad grade name when PlayHQ is unavailable', () => {
    const tigers = findTeam(parseSquad({ ...squadFixture, teams: [{ ...squadFixture.teams[1], gradeName: 'Year 3' }] }), 'tigers');
    expect(unavailableStart(tigers, '2026-01-31')).toEqual({
      available: false, result: null, candidates: [], figures: [], rule: { kind: 'pairs', batBalls: 12, bowlOvers: 2 },
    });
  });
});

const routes = (over: Record<string, unknown> = {}) => ({
  [`/v1/grades/${GRADE}/games`]: v1Page([v1Game({ id: 'g2', date: '2026-01-31' }), v1Game({ id: 'g3', date: '2026-02-07', status: 'PENDING' })]),
  '/v2/games/g2/summary': { data: full },
  ...over,
});

describe('GET /api/teams/:slug/games/:gameId', () => {
  beforeEach(() => seedSquad());

  it('returns PlayHQ start data when there is no report', async () => {
    const res = await call(createApp(testDeps({ fetch: fakeFetch(routes()).fetch })), '/api/teams/pumas/games/g2');
    const body = await res.json<GamePage>();
    expect(res.status).toBe(200);
    expect(body.report).toBeNull();
    expect(body.game.gameId).toBe('g2');
    expect(body.start.result?.team).toEqual({ runs: 145, wkts: 4 });
    expect(JSON.stringify(body)).not.toMatch(/Turner|Walker/);
  });

  it('returns start data alongside a saved report', async () => {
    const app = createApp(testDeps({ fetch: fakeFetch(routes()).fetch }));
    await put(app, 'g2', form({ scoring: 'yes' }));
    const body = await (await call(app, '/api/teams/pumas/games/g2')).json<GamePage>();
    expect(body.report?.version).toBe(1);
    expect(body.start.available).toBe(true);
    expect(body.start.rule).toEqual({ kind: 'open' });
  });

  it('still opens the form when PlayHQ is down', async () => {
    const res = await call(createApp(testDeps({ fetch: fakeFetch(routes({ '/v2/games/g2/summary': fail })).fetch })), '/api/teams/pumas/games/g2');
    expect((await res.json<GamePage>()).start).toEqual({ available: false, result: null, candidates: [], figures: [], rule: { kind: 'open' } });
  });

  it('503s when the fixture is unavailable and nothing is cached', async () => {
    const res = await call(createApp(testDeps({ fetch: fakeFetch(routes({ [`/v1/grades/${GRADE}/games`]: fail })).fetch })), '/api/teams/pumas/games/g2');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'fixture_unavailable' });
  });

  it('404s for a game that is not in the fixture', async () => {
    const res = await call(createApp(testDeps({ fetch: fakeFetch(routes()).fetch })), '/api/teams/pumas/games/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'game_not_found' });
  });
});

describe('POST /api/teams/:slug/games/:gameId/refresh', () => {
  beforeEach(() => seedSquad());

  it('bypasses the cache', async () => {
    const f = fakeFetch(routes());
    const app = createApp(testDeps({ fetch: f.fetch }));
    await call(app, '/api/teams/pumas/games/g2');
    await call(app, '/api/teams/pumas/games/g2/refresh', { method: 'POST' });
    expect(f.calls.filter((p) => p === '/v2/games/g2/summary')).toHaveLength(2);
  });

  it('returns the cached copy with rateLimited when pressed again too soon', async () => {
    const f = fakeFetch(routes());
    const app = createApp(testDeps({ fetch: f.fetch, limit: async (_e, name) => name !== 'REFRESH_LIMIT' }));
    const res = await call(app, '/api/teams/pumas/games/g2/refresh', { method: 'POST' });
    const body = await res.json<RefreshResult>();
    expect(body.rateLimited).toBe(true);
    expect(body.start.result).not.toBeNull();
  });

  it("says PlayHQ couldn't be reached", async () => {
    const app = createApp(testDeps({ fetch: fakeFetch(routes({ '/v2/games/g2/summary': fail })).fetch }));
    const res = await call(app, '/api/teams/pumas/games/g2/refresh', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'playhq_unavailable', message: "Couldn't reach PlayHQ — try again later." });
  });
});
