import { describe, expect, it } from 'vitest';
import { emptyForm, type FormState, type MilestoneRow } from '../src/types';
import { validateReport } from '../src/validation';

const squad = (key: string) => ({ kind: 'squad' as const, key });

function valid(over: Partial<FormState> = {}): FormState {
  return {
    ...emptyForm(),
    scoring: 'yes',
    team: { runs: 145, wkts: 4 },
    opp: { runs: 128, wkts: 4 },
    potd: squad('p001'),
    mascot: squad('p002'),
    ...over,
  };
}

const row = (over: Partial<MilestoneRow>): MilestoneRow => ({
  rowId: 'r1', type: 'bat', player: squad('p001'), value: 30, source: 'entered', playhqValue: null, touched: true, ...over,
});

describe('validateReport', () => {
  it('accepts a complete report', () => {
    expect(validateReport(valid())).toEqual({});
  });

  it('requires the PlayHQ question', () => {
    expect(validateReport(valid({ scoring: null }))).toEqual({ scoring: 'Choose an answer.' });
  });

  it('requires issues text when there were issues', () => {
    expect(validateReport(valid({ scoring: 'yes_issues', issues: '  ' }))).toHaveProperty('issues');
    expect(validateReport(valid({ scoring: 'yes_issues', issues: 'App crashed' }))).toEqual({});
  });

  it('only needs a reason when the game was not played', () => {
    const base = { ...emptyForm(), scoring: 'not_played' as const };
    expect(validateReport(base)).toEqual({ notPlayedReason: 'Choose a reason.' });
    expect(validateReport({ ...base, notPlayedReason: 'other' })).toHaveProperty('notPlayedOther');
    expect(validateReport({ ...base, notPlayedReason: 'rain' })).toEqual({});
  });

  it('checks score ranges', () => {
    const e = validateReport(valid({ team: { runs: 1000, wkts: 31 }, opp: { runs: null, wkts: 2.5 } }));
    expect(Object.keys(e).sort()).toEqual(['opp.runs', 'opp.wkts', 'team.runs', 'team.wkts']);
    expect(validateReport(valid({ team: { runs: 0, wkts: 30 }, opp: { runs: 999, wkts: 0 } }))).toEqual({});
  });

  it('requires player and mascot of the day, and a name for Other', () => {
    const e = validateReport(valid({ potd: null, mascot: { kind: 'other', fullName: ' ' } }));
    expect(e).toEqual({ potd: 'Choose a player.', mascot: "Enter the player's full name." });
  });

  it('limits photos to 5', () => {
    expect(validateReport(valid({ photoIds: ['1', '2', '3', '4', '5', '6'] }))).toHaveProperty('photoIds');
  });

  it('checks milestone ranges by type', () => {
    const e = validateReport(valid({
      milestones: [
        row({ rowId: 'a', type: 'bat', value: 24 }),
        row({ rowId: 'b', type: 'bowl', value: 20, player: squad('p002') }),
        row({ rowId: 'c', type: 'hattrick', value: 3, player: squad('p003') }),
      ],
    }));
    expect(Object.keys(e).sort()).toEqual(['milestones.0.value', 'milestones.1.value', 'milestones.2.value']);
  });

  it('accepts milestone boundary values', () => {
    expect(validateReport(valid({
      milestones: [
        row({ rowId: 'a', type: 'bat', value: 25 }),
        row({ rowId: 'b', type: 'bowl', value: 3 }),
        row({ rowId: 'c', type: 'bowl', value: 19, player: squad('p002') }),
        row({ rowId: 'd', type: 'hattrick', value: null }),
      ],
    }))).toEqual({});
  });

  it('allows one milestone per player per type', () => {
    const e = validateReport(valid({
      milestones: [row({ rowId: 'a' }), row({ rowId: 'b', value: 40 })],
    }));
    expect(e).toEqual({ 'milestones.1.player': 'This player already has this milestone.' });
  });

  it('treats Other names case-insensitively for duplicates', () => {
    const other = (n: string) => ({ kind: 'other' as const, fullName: n });
    const e = validateReport(valid({
      milestones: [row({ rowId: 'a', player: other('Chris Pratt') }), row({ rowId: 'b', player: other(' chris pratt') })],
    }));
    expect(e).toHaveProperty('milestones.1.player');
  });

  it('requires a player on every milestone row', () => {
    expect(validateReport(valid({ milestones: [row({ player: null })] }))).toEqual({ 'milestones.0.player': 'Choose a player.' });
  });
});
