import { otherLabel } from '../../../shared/src/labels';
import type { MilestoneCandidate, PlayerRefOut, PlayhqStartData } from '../../../shared/src/types';
import type { Team } from '../squad/load';
import type { Stat, V2Summary } from './types';

export const UNAVAILABLE: PlayhqStartData = { available: false, result: null, candidates: [] };

const stat = (stats: Stat[], type: string) => stats.find((s) => s.type === type)?.value ?? null;

export function startData(s: V2Summary, team: Team, labels: Map<string, string>): PlayhqStartData {
  const teamId = team.playhqTeamId;
  const oppId = s.teams.find((t) => t.id !== teamId)?.id;
  const totals = new Map<string, { runs: number; wkts: number }>();
  const bat = new Map<string, number>();
  const bowl = new Map<string, number>();

  for (const period of s.periods) {
    for (const t of period.teams) {
      if (t.discipline === 'BATTING') {
        const runs = stat(t.statistics, 'TOTAL_SCORE');
        const wkts = stat(t.statistics, 'TOTAL_OUTS');
        if (runs !== null && wkts !== null) totals.set(t.id, { runs, wkts });
      }
      if (t.id !== teamId) continue;
      for (const a of t.appearances) {
        const value = stat(a.statistics, t.discipline === 'BATTING' ? 'TOTAL_RUNS' : 'WICKETS');
        if (value === null) continue;
        const map = t.discipline === 'BATTING' ? bat : bowl;
        map.set(a.id, Math.max(map.get(a.id) ?? 0, value));
      }
    }
  }

  const mine = totals.get(teamId);
  const theirs = oppId ? totals.get(oppId) : undefined;
  const result = s.status === 'FINAL' && mine && theirs ? { team: mine, opp: theirs } : null;

  const byPlayhqId = new Map(team.players.filter((p) => p.playhqId).map((p) => [p.playhqId!, p]));
  const names = new Map(s.appearances.map((a) => [a.id, `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim()]));
  const ref = (id: string): PlayerRefOut => {
    const p = byPlayhqId.get(id);
    if (p) return { kind: 'squad', key: p.key, label: labels.get(p.key)! };
    const name = names.get(id);
    return { kind: 'playhq', playhqId: id, label: name ? `${otherLabel(name)} (not in squad)` : 'Unnamed player (not in squad)' };
  };

  const candidates: MilestoneCandidate[] = [
    ...[...bat].filter(([, r]) => r >= 25 && r <= 999).map(([id, r]) => ({ type: 'bat' as const, player: ref(id), value: r })),
    ...[...bowl].filter(([, w]) => w >= 3 && w <= 19).map(([id, w]) => ({ type: 'bowl' as const, player: ref(id), value: w })),
  ];
  return { available: true, result, candidates };
}
