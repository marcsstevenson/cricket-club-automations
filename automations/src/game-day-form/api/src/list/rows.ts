import type { GameRow, ListStatus } from '../../../shared/src/api';
import { formatGameDate } from '../../../shared/src/dates';
import { otherLabel } from '../../../shared/src/labels';
import type { FixtureGame } from '../playhq/fixture';
import type { StoredReport } from '../reports/repo';
import type { Squad, Team } from '../squad/load';

export type Row = GameRow & { report: StoredReport | null; team: Team };

export function person(key: string | null, namedId: string | null, r: StoredReport, team: Team, labels: Map<string, string>) {
  if (key) {
    const p = team.players.find((p) => p.key === key);
    return { label: labels.get(key) ?? 'Unknown player', id: key, isOther: false, fullName: p ? `${p.firstName} ${p.lastName}` : '' };
  }
  if (namedId) {
    const n = r.named.get(namedId);
    return { label: n ? otherLabel(n.fullName) : 'Unknown player', id: namedId, isOther: true, fullName: n?.fullName ?? '' };
  }
  return { label: '', id: '', isOther: false, fullName: '' };
}

function makeRow(team: Team, g: FixtureGame, r: StoredReport | null, today: string, labels: Map<string, string>): Row {
  const status: ListStatus = r
    ? r.scoring === 'not_played'
      ? 'not_played'
      : 'reported'
    : g.date && g.date < today
      ? 'missing'
      : 'upcoming';
  return {
    gameId: g.gameId,
    teamSlug: team.slug,
    teamName: team.name,
    date: g.date,
    dateLabel: g.date ? formatGameDate(g.date) : 'Date TBC',
    round: g.round,
    opposition: g.opposition,
    venue: g.venue,
    status,
    scoring: r?.scoring ?? null,
    issues: r?.issues ?? '',
    notPlayedReason: r?.notPlayedReason ?? null,
    notPlayedOther: r?.notPlayedOther ?? '',
    score: r && r.teamRuns !== null ? `${r.teamRuns}/${r.teamWkts} v ${r.oppRuns}/${r.oppWkts}` : null,
    potd: r ? person(r.potdKey, r.potdNamedId, r, team, labels).label || null : null,
    mascot: r ? person(r.mascotKey, r.mascotNamedId, r, team, labels).label || null : null,
    milestoneCount: r?.milestones.length ?? 0,
    report: r,
    team,
  };
}

export function buildRows(i: {
  squad: Squad;
  fixtures: Map<string, FixtureGame[] | null>;
  reports: StoredReport[];
  today: string;
  labels: Map<string, Map<string, string>>;
}): Row[] {
  const rows: Row[] = [];
  const byKey = new Map(i.reports.map((r) => [`${r.teamSlug}|${r.gameId}`, r]));
  const used = new Set<string>();
  for (const team of i.squad.teams) {
    for (const g of i.fixtures.get(team.slug) ?? []) {
      const k = `${team.slug}|${g.gameId}`;
      const r = byKey.get(k) ?? null;
      if (r) used.add(k);
      rows.push(makeRow(team, g, r, i.today, i.labels.get(team.slug)!));
    }
  }
  // Reports whose game isn't in a fixture we could load (e.g. PlayHQ down).
  for (const r of i.reports) {
    if (used.has(`${r.teamSlug}|${r.gameId}`)) continue;
    const team = i.squad.teams.find((t) => t.slug === r.teamSlug);
    if (!team) continue;
    const g: FixtureGame = { gameId: r.gameId, date: r.gameDate, round: '', opposition: '—', venue: '—', status: '' };
    rows.push(makeRow(team, g, r, i.today, i.labels.get(team.slug)!));
  }
  return rows.sort((a, b) => (b.date ?? '0000').localeCompare(a.date ?? '0000'));
}

export function applyFilters(rows: Row[], q: URLSearchParams): Row[] {
  const team = q.get('team');
  const statuses = (q.get('status') ?? '').split(',').filter(Boolean);
  const followUp = q.get('followUp') === '1';
  return rows.filter(
    (r) =>
      (!team || r.teamSlug === team) &&
      (!statuses.length || statuses.includes(r.status)) &&
      (!followUp || r.scoring === 'no' || r.scoring === 'yes_issues'),
  );
}
