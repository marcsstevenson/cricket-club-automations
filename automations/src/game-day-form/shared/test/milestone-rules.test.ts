import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { afterChristmas, expectedCheck, needsCheck, OPEN, ruleFor, withChecks } from '../src/milestone-rules';
import { checkText, milestoneRuleText } from '../src/text';
import { MilestoneRowSchema, type CheckContext, type MilestoneRow, type PlayerFigures } from '../src/types';

const PAIRS12 = { kind: 'pairs', batBalls: 12, bowlOvers: 2 } as const;
const PAIRS15 = { kind: 'pairs', batBalls: 15, bowlOvers: 2 } as const;

const fred = { kind: 'squad' as const, key: 'p010', label: 'Frederick R.' };
const kaiser = { kind: 'squad' as const, key: 'p011', label: 'Kaiser M.' };
const fill = { kind: 'playhq' as const, playhqId: 'ph-fill', label: 'Kim W. (not in squad)' };

const figures: PlayerFigures[] = [
  { player: fred, ballsFaced: 16, overs: 3 },
  { player: kaiser, ballsFaced: 16, overs: 2 },
  { player: fill, ballsFaced: 12, overs: 2.3 },
];

const row = (over: Partial<MilestoneRow>): MilestoneRow => ({
  rowId: 'r', type: 'bowl', player: fred, value: 3, source: 'playhq', playhqValue: 3, touched: false, ...over,
});

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({ available: true, rule: PAIRS12, figures, ...over });

describe('ruleFor', () => {
  const r = (overLimit: number | null, gradeName: string | null, gameDate: string | null = '2025-11-15') => ruleFor({ overLimit, gradeName, gameDate });

  it('uses the over limit for last season grades', () => {
    expect(r(12, 'Kiwi North - Section 1')).toEqual(PAIRS12);
    expect(r(16, 'Year 4 North - Section 2')).toEqual(PAIRS12);
    expect(r(16, 'Year 4 - City Wide Fab 4')).toEqual(PAIRS12);
    expect(r(16, 'Mini Mags Fab 4')).toEqual(PAIRS12);
    expect(r(18, 'Year 3 North - Section 2')).toEqual(PAIRS12);
    expect(r(20, 'Year 5 Hardball Section 1')).toEqual(PAIRS15);
    expect(r(20, 'Junior Girls Incrediball - Div 4 - Section 2')).toEqual(PAIRS15);
    expect(r(20, 'Year 6 Section 3 (Morning)')).toEqual(PAIRS15);
    expect(r(27, 'Year 7 Morning')).toEqual(OPEN);
    expect(r(30, 'Year 7/8 Premier')).toEqual(OPEN);
  });

  it('never limits girls Division 3 Hardball', () => {
    expect(r(20, 'Intermediate Girls Hardball Division 3 - Section 2')).toEqual(OPEN);
    expect(r(20, 'Girls Hardball Div 3')).toEqual(OPEN);
  });

  it('switches Year 6 and Division 3 Incrediball to open from 1 January', () => {
    expect(r(20, 'Year 6 Section 3 (Morning)', '2026-01-10')).toEqual(OPEN);
    expect(r(20, 'Intermediate Girls Incrediball Division 3', '2025-12-13')).toEqual(PAIRS15);
    expect(r(20, 'Intermediate Girls Incrediball Division 3', '2026-02-07')).toEqual(OPEN);
  });

  it('keeps Super 8, Year 5 and Div 4 as pairs all season', () => {
    expect(r(20, 'Year 5/6 Super 8', '2026-02-07')).toEqual(PAIRS15);
    expect(r(20, 'Year 6 Super 8 Incrediball', '2026-02-07')).toEqual(PAIRS15);
    expect(r(20, 'Year 5 Hardball Section 2', '2026-03-21')).toEqual(PAIRS15);
    expect(r(20, 'Junior Girls Incrediball - Div 4', '2026-03-21')).toEqual(PAIRS15);
  });

  it('treats odd 20-ish figures as 20 and a shortened Year 6 game as pairs 12', () => {
    expect(r(22, 'Year 5 Hardball')).toEqual(PAIRS15);
    expect(r(16, 'Year 6 Section 3 (Morning)', '2026-02-07')).toEqual(PAIRS12);
  });

  it('falls back to name keywords when there is no overs figure', () => {
    expect(r(null, 'Kiwi Cricket — Year 1')).toEqual(PAIRS12);
    expect(r(0, 'Year 3')).toEqual(PAIRS12);
    expect(r(null, 'Mini Mags')).toEqual(PAIRS12);
    expect(r(null, 'Year 5')).toEqual(OPEN);
    expect(r(null, null)).toEqual(OPEN);
  });

  it('knows which dates are after Christmas', () => {
    expect(afterChristmas('2026-01-01')).toBe(true);
    expect(afterChristmas('2026-03-21')).toBe(true);
    expect(afterChristmas('2025-12-31')).toBe(false);
    expect(afterChristmas('2025-10-18')).toBe(false);
    expect(afterChristmas(null)).toBe(false);
  });
});

describe('expectedCheck', () => {
  it('flags a bowler over 2 overs and a batter over the ball share', () => {
    expect(expectedCheck(PAIRS12, figures, row({}))).toEqual({ actual: 3, share: 2 });
    expect(expectedCheck(PAIRS12, figures, row({ type: 'bat', player: kaiser, value: 26 }))).toEqual({ actual: 16, share: 12 });
  });

  it('does not flag exactly the share, and flags part overs', () => {
    expect(expectedCheck(PAIRS12, figures, row({ player: kaiser }))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ type: 'bat', player: fill }))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ player: fill }))).toEqual({ actual: 2.3, share: 2 });
  });

  it('uses the 15-ball share', () => {
    expect(expectedCheck(PAIRS15, figures, row({ type: 'bat', player: kaiser }))).toEqual({ actual: 16, share: 15 });
    expect(expectedCheck(PAIRS15, [{ player: kaiser, ballsFaced: 15, overs: null }], row({ type: 'bat', player: kaiser }))).toBeNull();
  });

  it('matches a saved not-in-squad player by PlayHQ id, never an Other name', () => {
    const named = { kind: 'named' as const, id: 'n1', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' };
    expect(expectedCheck(PAIRS12, figures, row({ player: named }))).toEqual({ actual: 2.3, share: 2 });
    expect(expectedCheck(PAIRS12, figures, row({ player: { kind: 'other', fullName: 'Frederick R' } }))).toBeNull();
  });

  it('never flags open grades, hat-tricks, empty players or players without figures', () => {
    expect(expectedCheck(OPEN, figures, row({}))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ type: 'hattrick', value: null }))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ player: null }))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ player: { kind: 'squad', key: 'p999', label: 'Zed Z.' } }))).toBeNull();
    expect(expectedCheck(PAIRS12, [{ player: fred, ballsFaced: null, overs: null }], row({}))).toBeNull();
  });
});

describe('withChecks', () => {
  it('adds an unticked flag, and null on rows that are fine', () => {
    const out = withChecks([row({ rowId: 'a' }), row({ rowId: 'b', player: kaiser })], ctx());
    expect(out.map((r) => r.check)).toEqual([{ actual: 3, share: 2, checked: false }, null]);
  });

  it('keeps the tick while the figure is unchanged, whatever the value', () => {
    const ticked = row({ value: 4, touched: true, check: { actual: 3, share: 2, checked: true } });
    expect(withChecks([ticked], ctx())[0].check).toEqual({ actual: 3, share: 2, checked: true });
  });

  it('resets the tick when the figure changes', () => {
    const ticked = row({ check: { actual: 2.4, share: 2, checked: true } });
    expect(withChecks([ticked], ctx())[0].check).toEqual({ actual: 3, share: 2, checked: false });
  });

  it('removes a flag when the rule becomes open', () => {
    const flagged = row({ check: { actual: 3, share: 2, checked: false } });
    expect(withChecks([flagged], ctx({ rule: OPEN }))[0].check).toBeNull();
  });

  it('leaves rows untouched when PlayHQ data is unavailable', () => {
    const flagged = row({ check: { actual: 3, share: 2, checked: true } });
    expect(withChecks([flagged], ctx({ available: false, figures: [] }))).toEqual([flagged]);
  });

  it('is idempotent', () => {
    const once = withChecks([row({ rowId: 'a' }), row({ rowId: 'b', type: 'hattrick', value: null })], ctx());
    expect(withChecks(once, ctx())).toEqual(once);
  });

  it('counts unticked flags', () => {
    expect(needsCheck([row({ check: { actual: 3, share: 2, checked: false } }), row({ check: { actual: 3, share: 2, checked: true } }), row({ check: null }), row({})])).toBe(1);
  });
});

describe('row schema', () => {
  it('accepts rows with and without a check', () => {
    const base = { rowId: 'r', type: 'bowl', player: null, value: 3, source: 'entered', playhqValue: null, touched: true };
    expect(v.safeParse(MilestoneRowSchema, base).success).toBe(true);
    expect(v.safeParse(MilestoneRowSchema, { ...base, check: null }).success).toBe(true);
    expect(v.safeParse(MilestoneRowSchema, { ...base, check: { actual: 3, share: 2, checked: true } }).success).toBe(true);
    expect(v.safeParse(MilestoneRowSchema, { ...base, check: { actual: 3 } }).success).toBe(false);
  });
});

describe('copy', () => {
  it('words the per-question rules for pairs and open grades', () => {
    expect(milestoneRuleText(PAIRS12)).toEqual({
      bat: "25 or more runs from the batter's first 12 balls.",
      bowl: "3 or more wickets in the bowler's first 2 overs.",
      hattrick: "3 wickets from 3 balls in a row by the same bowler. They can span two of the bowler's overs, but all three must come in their first 2 overs.",
    });
    expect(milestoneRuleText(OPEN)).toEqual({
      bat: '25 or more runs in the innings.',
      bowl: '3 or more wickets in the innings.',
      hattrick: "3 wickets from 3 balls in a row by the same bowler. They can span two of the bowler's overs.",
    });
  });

  it('words flag warnings and confirmations', () => {
    expect(checkText('bowl', { actual: 3, share: 2 })).toEqual({
      warning: '⚠ Bowled 3 overs. Only wickets in the first 2 count. Check the scorebook.',
      confirm: 'Checked: 3 wickets by the end of the 2nd over',
    });
    expect(checkText('bat', { actual: 16, share: 12 })).toEqual({
      warning: '⚠ Faced 16 balls. Only runs from the first 12 count. Check the scorebook.',
      confirm: 'Checked: 25 runs by the 12th ball',
    });
    expect(checkText('bat', { actual: 18, share: 15 }).confirm).toBe('Checked: 25 runs by the 15th ball');
  });
});
