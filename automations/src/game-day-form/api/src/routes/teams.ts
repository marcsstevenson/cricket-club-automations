import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { loadSquad, teamSummary } from '../squad/load';

export function registerTeams(app: Hono<AppEnv>) {
  app.get('/teams', async (c) => {
    const squad = await loadSquad(c.env, c.get('deps').now());
    return c.json(squad.teams.map(teamSummary));
  });
}
