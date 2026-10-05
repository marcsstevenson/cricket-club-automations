import type { Context } from 'hono';
import type { GameOption } from '../../../shared/src/api';
import { formatGameDate, nzDate } from '../../../shared/src/dates';
import { squadLabels } from '../../../shared/src/labels';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { teamFixture, type FixtureGame } from '../playhq/fixture';
import { playhqService } from '../playhq/service';
import type { V2Summary } from '../playhq/types';
import { reportStatuses } from '../reports/repo';
import { findTeam, loadSquad, type Squad, type Team } from '../squad/load';

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

export async function loadGameContext(c: Ctx, slug: string, gameId: string) {
  const deps = c.get('deps');
  const squad = await loadSquad(c.env, deps.now());
  const team = findTeam(squad, slug);
  const labels = squadLabels(team.players);
  const today = nzDate(deps.now());
  const fixture = await fixtureFor(c, squad, team, today);
  if (!fixture.available) {
    throw new ApiError(503, 'fixture_unavailable', 'Fixture not available from PlayHQ yet — try again later.');
  }
  const game = fixture.games.find((g) => g.gameId === gameId);
  if (!game) throw new ApiError(404, 'game_not_found', "This game isn't in the team's fixture.");
  const service = phq(c);
  return {
    squad,
    team,
    labels,
    today,
    game,
    /** Cached summary; null if PlayHQ is unreachable. With force=true, errors are thrown instead. */
    async summary(force = false): Promise<V2Summary | null> {
      try {
        return (await service.summary(gameId, force)).data;
      } catch (err) {
        if (force) throw err;
        console.warn(JSON.stringify({ msg: 'summary_unavailable', gameId, error: String(err) }));
        return null;
      }
    },
  };
}

export type GameContext = Awaited<ReturnType<typeof loadGameContext>>;
