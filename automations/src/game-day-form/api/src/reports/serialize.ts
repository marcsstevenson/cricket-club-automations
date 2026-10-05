import type { ReportOut } from '../../../shared/src/api';
import { otherLabel } from '../../../shared/src/labels';
import type { PlayerChoice } from '../../../shared/src/types';
import type { NamedPlayer, StoredReport } from './repo';

export function refOut(
  key: string | null,
  namedId: string | null,
  named: Map<string, NamedPlayer>,
  labels: Map<string, string>,
): PlayerChoice | null {
  if (key) return { kind: 'squad', key, label: labels.get(key) ?? 'Unknown player' };
  if (!namedId) return null;
  const n = named.get(namedId);
  if (!n) return { kind: 'named', id: namedId, label: 'Unknown player' };
  if (n.playhqId) return { kind: 'named', id: namedId, playhqId: n.playhqId, label: `${otherLabel(n.fullName)} (not in squad)` };
  return { kind: 'named', id: namedId, label: otherLabel(n.fullName) };
}

export function toReportOut(r: StoredReport, labels: Map<string, string>): ReportOut {
  return {
    scoring: r.scoring,
    issues: r.issues ?? '',
    notPlayedReason: r.notPlayedReason,
    notPlayedOther: r.notPlayedOther ?? '',
    team: { runs: r.teamRuns, wkts: r.teamWkts },
    opp: { runs: r.oppRuns, wkts: r.oppWkts },
    scoreSource: r.scoreSource ?? 'entered',
    potd: refOut(r.potdKey, r.potdNamedId, r.named, labels),
    mascot: refOut(r.mascotKey, r.mascotNamedId, r.named, labels),
    highlights: r.highlights ?? '',
    photoIds: r.photoIds,
    milestones: r.milestones.map((m) => ({
      rowId: m.id,
      type: m.type,
      player: refOut(m.playerKey, m.namedId, r.named, labels),
      value: m.value,
      source: m.source,
      playhqValue: m.playhqValue,
      touched: m.touched,
    })),
    updatedBy: r.updatedBy ?? '',
    version: r.version,
    updatedAt: r.updatedAt,
  };
}
