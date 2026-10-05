import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createApp } from '../src/app';
import { findTeam, parseSquad, resetSquadCache } from '../src/squad/load';
import squadFixture from './fixtures/squad.json';
import { call, seedSquad, testDeps } from './helpers';

describe('parseSquad', () => {
  it('accepts the fixture', () => {
    expect(parseSquad(squadFixture).teams).toHaveLength(2);
  });

  it('rejects duplicate player keys', () => {
    const bad = structuredClone(squadFixture);
    bad.teams[1].players.push({ key: 'p001', firstName: 'X', lastName: 'Y' } as never);
    expect(() => parseSquad(bad)).toThrow(/squad/i);
  });

  it('rejects slugs that are not lowercase', () => {
    const bad = structuredClone(squadFixture);
    bad.teams[0].slug = 'Pumas';
    expect(() => parseSquad(bad)).toThrow();
  });

  it('rejects blank surnames', () => {
    const bad = structuredClone(squadFixture);
    bad.teams[0].players[0].lastName = ' ';
    expect(() => parseSquad(bad)).toThrow();
  });
});

describe('findTeam', () => {
  it('matches the slug case-insensitively', () => {
    expect(findTeam(parseSquad(squadFixture), 'Pumas').slug).toBe('pumas');
  });
  it('throws a 404 for unknown teams', () => {
    let err: unknown;
    try {
      findTeam(parseSquad(squadFixture), 'pumaz');
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 404, code: 'team_not_found' });
  });
});

describe('GET /api/teams', () => {
  beforeEach(() => resetSquadCache());

  it('lists teams with their mascot, never players', async () => {
    await seedSquad();
    const res = await call(createApp(testDeps()), '/api/teams');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { slug: 'pumas', name: 'Parklands Pumas', mascot: 'pumas' },
      { slug: 'tigers', name: 'Parklands Tigers', mascot: 'tigers' },
    ]);
  });

  it('fails clearly when the squad is missing', async () => {
    await env.CONFIG.delete('squad');
    const res = await call(createApp(testDeps()), '/api/teams');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'squad_missing' });
  });

  it('fails clearly when the squad is invalid', async () => {
    await seedSquad({ season: {}, teams: 'nope' });
    const res = await call(createApp(testDeps()), '/api/teams');
    expect(await res.json()).toMatchObject({ error: 'squad_invalid' });
  });
});
