import type { Hono } from 'hono';
import type { TeamPage } from '../../../shared/src/api';
import { nzDate } from '../../../shared/src/dates';
import { squadLabels } from '../../../shared/src/labels';
import type { AppEnv } from '../env';
import { awardGames } from '../reports/repo';
import { findTeam, loadSquad, teamSummary } from '../squad/load';
import { fixtureFor } from './context';

export function registerTeams(app: Hono<AppEnv>) {
  app.get('/teams', async (c) => {
    const squad = await loadSquad(c.env, c.get('deps').now());
    return c.json(squad.teams.map(teamSummary));
  });

  app.get('/teams/:slug', async (c) => {
    const deps = c.get('deps');
    const squad = await loadSquad(c.env, deps.now());
    const team = findTeam(squad, c.req.param('slug'));
    const labels = squadLabels(team.players);
    const today = nzDate(deps.now());
    const fixture = await fixtureFor(c, squad, team, today);
    const players = [...team.players].sort(
      (a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName),
    );
    const body: TeamPage = {
      team: { ...teamSummary(team), grade: team.gradeName ?? null },
      season: squad.season.name,
      today,
      squad: players.map((p) => ({ key: p.key, label: labels.get(p.key)! })),
      fixture,
      defaultGameId: fixture.games.filter((g) => g.selectable).at(-1)?.gameId ?? null,
      awards: await awardGames(c.env.DB, squad.season.playhqSeasonId, team.slug),
    };
    return c.json(body);
  });
}
