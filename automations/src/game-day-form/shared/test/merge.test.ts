import { describe, expect, it } from 'vitest';
import { merge, reportToForm, startForm } from '../src/merge';
import { emptyForm, type FormState, type MilestoneRow, type PlayhqStartData } from '../src/types';

const alex = { kind: 'squad' as const, key: 'p001', label: 'Alex T.' };
const jordan = { kind: 'squad' as const, key: 'p004', label: 'Jordan L.' };
const fillIn = { kind: 'playhq' as const, playhqId: 'ph-fill', label: 'Kim W. (not in squad)' };

const ids = () => {
  let n = 0;
  return () => `new${++n}`;
};

const start = (over: Partial<PlayhqStartData> = {}): PlayhqStartData => ({
  available: true,
  result: { team: { runs: 145, wkts: 4 }, opp: { runs: 131, wkts: 4 } },
  candidates: [],
  ...over,
});

const row = (over: Partial<MilestoneRow>): MilestoneRow => ({
  rowId: 'r', type: 'bat', player: alex, value: 31, source: 'playhq', playhqValue: 31, touched: false, ...over,
});

describe('startForm', () => {
  it('prefills PlayHQ scores as read-only and answers Yes', () => {
    const f = startForm(start(), ids());
    expect(f.scoring).toBe('yes');
    expect(f.scoreSource).toBe('playhq');
    expect(f.team).toEqual({ runs: 145, wkts: 4 });
  });

  it('leaves scores blank when PlayHQ has no result', () => {
    const f = startForm(start({ result: null }), ids());
    expect(f).toMatchObject({ scoring: null, scoreSource: 'entered', team: { runs: null, wkts: null } });
  });

  it('adds a PlayHQ row per milestone candidate', () => {
    const f = startForm(start({ candidates: [{ type: 'bat', player: alex, value: 31 }, { type: 'bowl', player: fillIn, value: 3 }] }), ids());
    expect(f.milestones).toEqual([
      { rowId: 'new1', type: 'bat', player: alex, value: 31, source: 'playhq', playhqValue: 31, touched: false },
      { rowId: 'new2', type: 'bowl', player: fillIn, value: 3, source: 'playhq', playhqValue: 3, touched: false },
    ]);
  });
});

describe('merge', () => {
  const base = (over: Partial<FormState> = {}): FormState => ({ ...emptyForm(), scoring: 'yes', ...over });

  it('switches typed scores to PlayHQ and reports the change', () => {
    const cur = base({ team: { runs: 145, wkts: 4 }, opp: { runs: 128, wkts: 4 } });
    const { next, changes } = merge(cur, start(), ids());
    expect(next.scoreSource).toBe('playhq');
    expect(next.opp).toEqual({ runs: 131, wkts: 4 });
    expect(changes).toEqual(['Opposition score 128/4 → 131/4']);
  });

  it('changes No to Yes when PlayHQ has the result', () => {
    const { next, changes } = merge(base({ scoring: 'no' }), start(), ids());
    expect(next.scoring).toBe('yes');
    expect(changes).toContain('PlayHQ answer changed from No to Yes');
  });

  it('leaves Game not played alone', () => {
    expect(merge(base({ scoring: 'not_played' }), start(), ids()).next.scoring).toBe('not_played');
  });

  it('leaves scores alone when PlayHQ has no result', () => {
    const cur = base({ team: { runs: 10, wkts: 1 }, opp: { runs: 9, wkts: 2 } });
    const { next } = merge(cur, start({ result: null }), ids());
    expect(next.team).toEqual({ runs: 10, wkts: 1 });
    expect(next.scoreSource).toBe('entered');
  });

  it('updates untouched PlayHQ rows, removes ones that no longer qualify', () => {
    const cur = base({ milestones: [row({ rowId: 'a' }), row({ rowId: 'b', type: 'bowl', player: jordan, value: 3, playhqValue: 3 })] });
    const { next, changes } = merge(cur, start({ candidates: [{ type: 'bat', player: alex, value: 35 }] }), ids());
    expect(next.milestones).toEqual([row({ rowId: 'a', value: 35, playhqValue: 35 })]);
    expect(changes).toEqual(expect.arrayContaining(['1 batting milestone updated', '1 bowling milestone removed']));
  });

  it('keeps touched rows and rows the coach added', () => {
    const touched = row({ rowId: 'a', value: 40, touched: true });
    const entered = row({ rowId: 'b', type: 'hattrick', value: null, source: 'entered', playhqValue: null, touched: true });
    const { next } = merge(base({ milestones: [touched, entered] }), start({ candidates: [{ type: 'bat', player: alex, value: 35 }] }), ids());
    expect(next.milestones).toEqual([touched, entered]);
  });

  it('adds new candidates without duplicating existing players', () => {
    const cur = base({ milestones: [row({ rowId: 'a', source: 'entered', touched: true })] });
    const { next, changes } = merge(cur, start({ candidates: [{ type: 'bat', player: alex, value: 31 }, { type: 'bowl', player: jordan, value: 4 }] }), ids());
    expect(next.milestones.map((m) => m.rowId)).toEqual(['a', 'new1']);
    expect(changes).toContain('1 bowling milestone added');
  });

  it('matches a saved not-in-squad player by PlayHQ id', () => {
    const saved = row({ rowId: 'a', player: { kind: 'named', id: 'n1', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' }, value: 27, playhqValue: 27 });
    const { next } = merge(base({ milestones: [saved] }), start({ candidates: [{ type: 'bat', player: fillIn, value: 27 }] }), ids());
    expect(next.milestones).toHaveLength(1);
  });

  it('says when nothing changed', () => {
    const cur = startForm(start(), ids());
    expect(merge(cur, start(), ids()).changes).toEqual(['No changes from PlayHQ']);
  });
});

describe('reportToForm', () => {
  it('drops version fields', () => {
    const f = reportToForm({ ...emptyForm(), version: 3, updatedAt: '2026-02-01T00:00:00Z' });
    expect(f).toEqual(emptyForm());
  });
});
