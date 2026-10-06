import type { Hono } from 'hono';
import type { GameRow, GamesList } from '../../../shared/src/api';
import { nzDate } from '../../../shared/src/dates';
import { squadLabels } from '../../../shared/src/labels';
import { MILESTONE_TEXT, REASON_TEXT, SCORING_TEXT, STATUS_TEXT } from '../../../shared/src/text';
import { toCsv, type Cell } from '../csv';
import type { AppEnv } from '../env';
import { applyFilters, buildRows, person, type Row } from '../list/rows';
import { teamFixture, type FixtureGame } from '../playhq/fixture';
import type { V1Game } from '../playhq/types';
import { loadReports } from '../reports/repo';
import { loadSquad } from '../squad/load';
import { phq, type Ctx } from './context';

export async function allRows(c: Ctx): Promise<Row[]> {
  const deps = c.get('deps');
  const squad = await loadSquad(c.env, deps.now());
  const service = phq(c);
  const byGrade = new Map<string, Promise<V1Game[] | null>>();
  const fixtures = new Map<string, FixtureGame[] | null>();
  for (const team of squad.teams) {
    const grade = team.playhqGradeId;
    if (!grade) {
      fixtures.set(team.slug, null);
      continue;
    }
    if (!byGrade.has(grade)) byGrade.set(grade, service.fixture(grade).then((r) => r.data).catch(() => null));
    const games = await byGrade.get(grade)!;
    fixtures.set(team.slug, games ? teamFixture(games, team.playhqTeamId) : null);
  }
  const rows = buildRows({
    squad,
    fixtures,
    reports: await loadReports(c.env.DB, squad.season.playhqSeasonId),
    today: nzDate(deps.now()),
    labels: new Map(squad.teams.map((t) => [t.slug, squadLabels(t.players)])),
  });
  return applyFilters(rows, new URL(c.req.url).searchParams);
}

const yn = (b: boolean) => (b ? 'Y' : 'N');

export function gamesCsv(rows: Row[], origin: string, admin: boolean): string {
  const header = [
    'Date', 'Team', 'Round', 'Opposition', 'Venue', 'Status', 'PlayHQ scoring', 'Issues', 'Not played reason',
    'Team runs', 'Team wickets', 'Opposition runs', 'Opposition wickets', 'Score source',
    'Player of the day', 'Player of the day ID', 'Player of the day is Other', ...(admin ? ['Player of the day full name'] : []),
    'Mascot of the day', 'Mascot ID', 'Mascot is Other', ...(admin ? ['Mascot full name'] : []),
    'Highlights', 'Photo links', 'Last updated', 'Last updated by',
  ];
  const body = rows.map((row): Cell[] => {
    const r = row.report;
    const labels = new Map<string, string>();
    const potd = r ? person(r.potdKey, r.potdNamedId, r, row.team, labels) : null;
    const mascot = r ? person(r.mascotKey, r.mascotNamedId, r, row.team, labels) : null;
    const reason = r?.notPlayedReason ? (r.notPlayedReason === 'other' ? `Other: ${r.notPlayedOther ?? ''}` : REASON_TEXT[r.notPlayedReason]) : '';
    return [
      row.date, row.teamName, row.round, row.opposition, row.venue, STATUS_TEXT[row.status],
      r ? SCORING_TEXT[r.scoring] : '', r?.issues ?? '', reason,
      r?.teamRuns, r?.teamWkts, r?.oppRuns, r?.oppWkts, r?.scoreSource === 'playhq' ? 'PlayHQ' : r?.scoreSource ? 'Entered' : '',
      row.potd, potd?.id, potd ? yn(potd.isOther) : '', ...(admin ? [potd?.fullName] : []),
      row.mascot, mascot?.id, mascot ? yn(mascot.isOther) : '', ...(admin ? [mascot?.fullName] : []),
      r?.highlights ?? '', (r?.photoIds ?? []).map((id) => `${origin}/api/photos/${id}`).join(' '), r?.updatedAt, r?.updatedBy,
    ];
  });
  return toCsv(header, body);
}

export function milestonesCsv(rows: Row[], admin: boolean): string {
  const header = ['Date', 'Team', 'Opposition', 'Player', 'Player ID', 'Player is Other', 'Type', 'Runs or wickets', 'Source', 'Check', ...(admin ? ['Full name'] : [])];
  const body: Cell[][] = [];
  for (const row of rows) {
    if (!row.report) continue;
    const labels = squadLabels(row.team.players);
    for (const m of row.report.milestones) {
      const p = person(m.playerKey, m.namedId, row.report, row.team, labels);
      body.push([
        row.date, row.teamName, row.opposition, p.label, p.id, yn(p.isOther), MILESTONE_TEXT[m.type], m.value,
        m.source === 'playhq' ? 'PlayHQ' : 'Entered', m.check ? (m.check.checked ? 'Checked' : 'Needs check') : '', ...(admin ? [p.fullName] : []),
      ]);
    }
  }
  return toCsv(header, body);
}

export const csvResponse = (text: string, filename: string) =>
  new Response(text, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'x-robots-tag': 'noindex',
    },
  });

export function registerList(app: Hono<AppEnv>) {
  app.get('/games', async (c) => {
    const rows = await allRows(c);
    const body: GamesList = { today: nzDate(c.get('deps').now()), rows: rows.map((row): GameRow => ({
        gameId: row.gameId, teamSlug: row.teamSlug, teamName: row.teamName, date: row.date, dateLabel: row.dateLabel,
        round: row.round, opposition: row.opposition, venue: row.venue, status: row.status, scoring: row.scoring,
        issues: row.issues, notPlayedReason: row.notPlayedReason, notPlayedOther: row.notPlayedOther, score: row.score,
        potd: row.potd, mascot: row.mascot, milestoneCount: row.milestoneCount, uncheckedCount: row.uncheckedCount,
      })),
    };
    return c.json(body);
  });
  app.get('/export/games.csv', async (c) => csvResponse(gamesCsv(await allRows(c), new URL(c.req.url).origin, false), 'games.csv'));
  app.get('/export/milestones.csv', async (c) => csvResponse(milestonesCsv(await allRows(c), false), 'milestones.csv'));
}
