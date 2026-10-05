import type { Context } from 'hono';
import type { GameOption } from '../../../shared/src/api';
import { formatGameDate } from '../../../shared/src/dates';
import type { AppEnv } from '../env';
import { teamFixture, type FixtureGame } from '../playhq/fixture';
import { playhqService } from '../playhq/service';
import { reportStatuses } from '../reports/repo';
import type { Squad, Team } from '../squad/load';

export type Ctx = Context<AppEnv>;

export const phq = (c: Ctx) => playhqService(c.env, c.get('deps'), (p) => c.executionCtx.waitUntil(p));

export function toOption(g: FixtureGame, status: 'reported' | 'not_played' | undefined, today: string): GameOption {
  const selectable = g.date !== null && g.date <= today;
  return {
    gameId: g.gameId,
    date: g.date,
    dateLabel: g.date ? formatGameDate(g.date) : 'Date TBC',
    round: g.round,
    opposition: g.opposition,
    venue: g.venue,
    reportStatus: status ?? (selectable ? 'not_reported' : 'upcoming'),
    selectable,
  };
}

export async function fixtureFor(c: Ctx, squad: Squad, team: Team, today: string) {
  if (!team.playhqGradeId) return { available: false, games: [] as GameOption[] };
  let games: FixtureGame[];
  try {
    games = teamFixture((await phq(c).fixture(team.playhqGradeId)).data, team.playhqTeamId);
  } catch (err) {
    console.warn(JSON.stringify({ msg: 'fixture_unavailable', team: team.slug, error: String(err) }));
    return { available: false, games: [] as GameOption[] };
  }
  const statuses = await reportStatuses(c.env.DB, squad.season.playhqSeasonId, team.slug);
  return { available: true, games: games.map((g) => toOption(g, statuses.get(g.gameId), today)) };
}
