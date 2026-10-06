import { otherLabel } from '../../../shared/src/labels';
import { ruleFor } from '../../../shared/src/milestone-rules';
import type { MilestoneCandidate, PlayerFigures, PlayerRefOut, PlayhqStartData } from '../../../shared/src/types';
import type { Team } from '../squad/load';
import type { Stat, V2Summary } from './types';

/** Start data when PlayHQ can't be reached: no figures, and the rule falls back to the squad grade name. */
export function unavailableStart(team: Team, gameDate: string | null): PlayhqStartData {
  return {
    available: false,
    result: null,
    candidates: [],
    figures: [],
    rule: ruleFor({ overLimit: null, gradeName: team.gradeName ?? null, gameDate }),
  };
}

const stat = (stats: Stat[], type: string) => stats.find((s) => s.type === type)?.value ?? null;
const keepMax = (map: Map<string, number>, id: string, value: number | null) => {
  if (value !== null) map.set(id, Math.max(map.get(id) ?? 0, value));
};

export function startData(s: V2Summary, team: Team, labels: Map<string, string>, gameDate: string | null): PlayhqStartData {
  const teamId = team.playhqTeamId;
  const oppId = s.teams.find((t) => t.id !== teamId)?.id;
  const totals = new Map<string, { runs: number; wkts: number }>();
  const bat = new Map<string, number>();
  const bowl = new Map<string, number>();
  const balls = new Map<string, number>();
  const overs = new Map<string, number>();
  let overLimit: number | null = null;

  for (const period of s.periods) {
    for (const t of period.teams) {
      if (t.discipline === 'BATTING') {
        const runs = stat(t.statistics, 'TOTAL_SCORE');
        const wkts = stat(t.statistics, 'TOTAL_OUTS');
        if (runs !== null && wkts !== null) totals.set(t.id, { runs, wkts });
        const limit = stat(t.statistics, 'OVER_LIMIT');
        if (limit !== null && limit > 0) overLimit = Math.max(overLimit ?? 0, limit);
      }
      if (t.id !== teamId) continue;
      for (const a of t.appearances) {
        if (t.discipline === 'BATTING') {
          keepMax(bat, a.id, stat(a.statistics, 'TOTAL_RUNS'));
          keepMax(balls, a.id, stat(a.statistics, 'BALLS_FACED'));
        } else {
          keepMax(bowl, a.id, stat(a.statistics, 'WICKETS'));
          keepMax(overs, a.id, stat(a.statistics, 'OVERS'));
        }
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
  const figures: PlayerFigures[] = [...new Set([...balls.keys(), ...overs.keys()])].map((id) => ({
    player: ref(id),
    ballsFaced: balls.get(id) ?? null,
    overs: overs.get(id) ?? null,
  }));
  const rule = ruleFor({ overLimit, gradeName: s.grade?.name ?? team.gradeName ?? null, gameDate });
  return { available: true, result, candidates, rule, figures };
}
