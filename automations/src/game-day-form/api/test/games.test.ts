import { beforeEach, describe, expect, it } from 'vitest';
import type { GamePage, RefreshResult } from '../../shared/src/api';
import { createApp } from '../src/app';
import { startData } from '../src/playhq/summary';
import { findTeam, parseSquad } from '../src/squad/load';
import { squadLabels } from '../../shared/src/labels';
import squadFixture from './fixtures/squad.json';
import { fail, fakeFetch, GRADE, summary, v1Game, v1Page } from './fixtures/playhq';
import { call, seedSquad, testDeps } from './helpers';

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
    expect(startData(full, team, labels).result).toEqual({ team: { runs: 145, wkts: 4 }, opp: { runs: 128, wkts: 4 } });
  });

  it('finds milestones for this team only, within the limits', () => {
    expect(startData(full, team, labels).candidates).toEqual([
      { type: 'bat', player: { kind: 'squad', key: 'p001', label: 'Alex T.' }, value: 31 },
      { type: 'bat', player: { kind: 'playhq', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' }, value: 27 },
      { type: 'bowl', player: { kind: 'squad', key: 'p004', label: 'Jordan L.' }, value: 3 },
    ]);
  });

  it('has no result while the game is not final', () => {
    expect(startData({ ...full, status: 'PENDING' }, team, labels).result).toBeNull();
  });

  it('has no result when only one innings has a total (abandoned or in progress)', () => {
    expect(startData(summary({ id: 'g', team: { runs: 50, wkts: 2 }, opp: null }), team, labels).result).toBeNull();
  });

  it('labels an unnamed hidden PlayHQ player without leaking anything', () => {
    const s = summary({ id: 'g', batting: [{ id: 'ph-hidden', runs: 40 }], appearances: [{ id: 'ph-hidden', firstName: null, lastName: null }] });
    expect(startData(s, team, labels).candidates[0].player.label).toBe('Unnamed player (not in squad)');
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
    expect(body.start?.result?.team).toEqual({ runs: 145, wkts: 4 });
    expect(JSON.stringify(body)).not.toMatch(/Turner|Walker/);
  });

  it('still opens the form when PlayHQ is down', async () => {
    const res = await call(createApp(testDeps({ fetch: fakeFetch(routes({ '/v2/games/g2/summary': fail })).fetch })), '/api/teams/pumas/games/g2');
    expect((await res.json<GamePage>()).start).toEqual({ available: false, result: null, candidates: [] });
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
