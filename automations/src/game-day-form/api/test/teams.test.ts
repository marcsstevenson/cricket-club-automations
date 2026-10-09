import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TeamPage } from '../../shared/src/api';
import { createApp } from '../src/app';
import { fail, fakeFetch, GRADE, v1Game, v1Page } from './fixtures/playhq';
import { call, seedSquad, testDeps } from './helpers';

const fixture = v1Page([
  v1Game({ id: 'g3', date: '2026-02-07', status: 'PENDING', round: 5 }),
  v1Game({ id: 'g1', date: '2026-01-24', round: 3, opp: 'Hornby Hawks' }),
  v1Game({ id: 'g2', date: '2026-01-31', round: 4 }),
  v1Game({ id: 'gTbc', date: null, status: 'PENDING', round: 6 }),
  v1Game({ id: 'other', date: '2026-01-31', teamId: 'someone-else' }),
]);

const get = async (path: string, routes: Record<string, unknown> = { [`/v1/grades/${GRADE}/games`]: fixture }) => {
  const res = await call(createApp(testDeps({ fetch: fakeFetch(routes).fetch })), path);
  return { res, body: (await res.json()) as TeamPage & { error?: string } };
};

describe('GET /api/teams/:slug', () => {
  beforeEach(() => seedSquad());

  it('returns team details and squad labels sorted by first name, without surnames', async () => {
    const { res, body } = await get('/api/teams/pumas');
    expect(res.status).toBe(200);
    expect(body.team).toEqual({ slug: 'pumas', name: 'Parklands Pumas', mascot: 'pumas', grade: 'Year 6 Section 3 (Morning)' });
    expect(body.season).toBe('Summer 2025/26');
    expect(body.squad).toEqual([
      { key: 'p001', label: 'Alex T.' },
      { key: 'p004', label: 'Jordan L.' },
      { key: 'p003', label: 'Sam Ta.' },
      { key: 'p002', label: 'Sam Th.' },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/Turner|Thompson|Taylor/);
  });

  it("lists only this team's games in date order with status and selectability", async () => {
    const { body } = await get('/api/teams/pumas');
    expect(body.today).toBe('2026-02-01');
    expect(body.fixture.available).toBe(true);
    expect(body.fixture.games.map((g) => [g.gameId, g.reportStatus, g.selectable])).toEqual([
      ['g1', 'not_reported', true],
      ['g2', 'not_reported', true],
      ['g3', 'upcoming', false],
      ['gTbc', 'upcoming', false],
    ]);
    expect(body.fixture.games[0]).toMatchObject({ dateLabel: 'Sat 24 Jan', round: 'R3', opposition: 'Hornby Hawks', venue: 'Parklands Reserve' });
    expect(body.fixture.games[3].dateLabel).toBe('Date TBC');
    expect(body.defaultGameId).toBe('g2');
  });

  it('marks reported and not-played games', async () => {
    const insert = (id: string, game: string, scoring: string) =>
      env.DB.prepare(
        `INSERT INTO reports (id, season_id, team_slug, game_id, game_date, scoring, version, updated_at)
         VALUES (?, 'season-test', 'pumas', ?, '2026-01-24', ?, 1, '2026-01-25T00:00:00Z')`,
      ).bind(id, game, scoring).run();
    await insert('r1', 'g1', 'yes');
    await insert('r2', 'g2', 'not_played');
    const { body } = await get('/api/teams/pumas');
    expect(body.fixture.games.slice(0, 2).map((g) => g.reportStatus)).toEqual(['reported', 'not_played']);
  });

  it("lists the games each player has won each award in, for this team's season only", async () => {
    const insert = (id: string, season: string, team: string, game: string, potd: string | null, mascot: string | null) =>
      env.DB.prepare(
        `INSERT INTO reports (id, season_id, team_slug, game_id, game_date, scoring, potd_key, mascot_key, version, updated_at)
         VALUES (?, ?, ?, ?, '2026-01-24', 'yes', ?, ?, 1, '2026-01-25T00:00:00Z')`,
      ).bind(id, season, team, game, potd, mascot).run();
    await insert('r1', 'season-test', 'pumas', 'g1', 'p001', 'p002');
    await insert('r2', 'season-test', 'pumas', 'g2', 'p001', null);
    await insert('r3', 'season-old', 'pumas', 'x1', 'p004', 'p004');
    await insert('r4', 'season-test', 'tigers', 'y1', 'p003', 'p003');
    const { body } = await get('/api/teams/pumas');
    expect(body.awards).toEqual({ potd: { p001: ['g1', 'g2'] }, mascot: { p002: ['g1'] } });
  });

  it('has empty awards before any reports', async () => {
    expect((await get('/api/teams/pumas')).body.awards).toEqual({ potd: {}, mascot: {} });
  });

  it('opens with capital letters in the link', async () => {
    expect((await get('/api/teams/Pumas')).res.status).toBe(200);
  });

  it('404s for unknown teams', async () => {
    const { res, body } = await get('/api/teams/pumaz');
    expect(res.status).toBe(404);
    expect(body.error).toBe('team_not_found');
  });

  it('reports the fixture as unavailable when the team has no grade yet', async () => {
    const { body } = await get('/api/teams/tigers');
    expect(body.fixture).toEqual({ available: false, games: [] });
    expect(body.defaultGameId).toBeNull();
  });

  it('still loads when PlayHQ is down and nothing is cached', async () => {
    const { res, body } = await get('/api/teams/pumas', { [`/v1/grades/${GRADE}/games`]: fail });
    expect(res.status).toBe(200);
    expect(body.fixture.available).toBe(false);
  });
});
