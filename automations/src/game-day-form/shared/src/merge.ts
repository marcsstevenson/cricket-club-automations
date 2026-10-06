import type { ReportOut } from './api';
import {
  emptyForm,
  type FormState,
  type MilestoneCandidate,
  type MilestoneRow,
  type PlayhqStartData,
  type Score,
} from './types';
import { samePlayer } from './players';

export { samePlayer };

const defaultRowId = () => crypto.randomUUID();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function candidateRow(c: MilestoneCandidate, rowId: string): MilestoneRow {
  return { rowId, type: c.type, player: clone(c.player), value: c.value, source: 'playhq', playhqValue: c.value, touched: false };
}

export function startForm(start: PlayhqStartData, newRowId: () => string = defaultRowId): FormState {
  const f = emptyForm();
  if (start.result) {
    f.scoring = 'yes';
    f.team = { ...start.result.team };
    f.opp = { ...start.result.opp };
    f.scoreSource = 'playhq';
  }
  f.milestones = start.candidates.map((c) => candidateRow(c, newRowId()));
  return f;
}

export function reportToForm(r: ReportOut): FormState {
  const { version: _v, updatedAt: _u, ...form } = clone(r);
  return form;
}

const fmt = (s: Score) => (s.runs === null || s.wkts === null ? '–' : `${s.runs}/${s.wkts}`);
const same = (a: Score, b: Score) => a.runs === b.runs && a.wkts === b.wkts;

export function merge(cur: FormState, fresh: PlayhqStartData, newRowId: () => string = defaultRowId) {
  const next: FormState = clone(cur);
  const changes: string[] = [];

  if (fresh.result) {
    const r = fresh.result;
    if (!same(cur.team, r.team)) changes.push(`Team score ${fmt(cur.team)} → ${fmt(r.team)}`);
    if (!same(cur.opp, r.opp)) changes.push(`Opposition score ${fmt(cur.opp)} → ${fmt(r.opp)}`);
    next.team = { ...r.team };
    next.opp = { ...r.opp };
    next.scoreSource = 'playhq';
    if (cur.scoring === 'no') {
      next.scoring = 'yes';
      changes.push('PlayHQ answer changed from No to Yes');
    } else if (cur.scoring === null) {
      next.scoring = 'yes';
    }
  }

  const counts = { bat: { added: 0, updated: 0, removed: 0 }, bowl: { added: 0, updated: 0, removed: 0 } };
  const kept: MilestoneRow[] = [];
  for (const row of next.milestones) {
    if (row.type === 'hattrick' || row.source !== 'playhq' || row.touched) {
      kept.push(row);
      continue;
    }
    const c = fresh.candidates.find((c) => c.type === row.type && samePlayer(row.player, c.player));
    if (!c) {
      counts[row.type].removed++;
      continue;
    }
    if (row.value !== c.value) counts[row.type].updated++;
    kept.push({ ...row, value: c.value, playhqValue: c.value });
  }
  for (const c of fresh.candidates) {
    if (kept.some((r) => r.type === c.type && samePlayer(r.player, c.player))) continue;
    kept.push(candidateRow(c, newRowId()));
    counts[c.type].added++;
  }
  next.milestones = kept;

  for (const type of ['bat', 'bowl'] as const) {
    const noun = type === 'bat' ? 'batting' : 'bowling';
    for (const action of ['added', 'updated', 'removed'] as const) {
      const n = counts[type][action];
      if (n) changes.push(`${n} ${noun} milestone${n > 1 ? 's' : ''} ${action}`);
    }
  }

  return { next, changes: changes.length ? changes : ['No changes from PlayHQ'] };
}
