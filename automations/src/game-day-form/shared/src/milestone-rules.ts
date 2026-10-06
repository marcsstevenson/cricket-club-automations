import { samePlayer } from './players';
import type { CheckContext, MilestoneRow, MilestoneRule, PlayerFigures } from './types';

export const OPEN: MilestoneRule = { kind: 'open' };
const pairs = (batBalls: number): MilestoneRule => ({ kind: 'pairs', batBalls, bowlOvers: 2 });
const DIV3 = /\bdiv(ision)?\s*3\b/;

/** Seasons run September to March, so a game dated January to August is after Christmas. */
export function afterChristmas(gameDate: string | null): boolean {
  if (!gameDate) return false;
  const month = Number(gameDate.slice(5, 7));
  return month >= 1 && month <= 8;
}

/** Functional spec §6.3.1. `overLimit` is this game's PlayHQ over limit per innings. */
export function ruleFor(i: { overLimit: number | null; gradeName: string | null; gameDate: string | null }): MilestoneRule {
  const name = (i.gradeName ?? '').toLowerCase();
  const div3 = DIV3.test(name);
  if (i.overLimit !== null && i.overLimit > 0) {
    if (i.overLimit <= 18) return pairs(12);
    if (i.overLimit >= 27) return OPEN;
    if (name.includes('hardball') && div3) return OPEN;
    const year6 = name.includes('year 6') && !name.includes('super 8');
    if (afterChristmas(i.gameDate) && (year6 || div3)) return OPEN;
    return pairs(15);
  }
  if (['kiwi', 'year 3', 'year 4', 'mini mags'].some((w) => name.includes(w))) return pairs(12);
  return OPEN;
}

/** The flag a row should carry (without the tick), or null. Functional spec §6.3.3. */
export function expectedCheck(rule: MilestoneRule, figures: PlayerFigures[], row: MilestoneRow): { actual: number; share: number } | null {
  if (rule.kind !== 'pairs' || row.type === 'hattrick' || !row.player) return null;
  const f = figures.find((x) => samePlayer(row.player, x.player));
  if (!f) return null;
  if (row.type === 'bat') {
    return f.ballsFaced !== null && f.ballsFaced > rule.batBalls ? { actual: f.ballsFaced, share: rule.batBalls } : null;
  }
  return f.overs !== null && f.overs > rule.bowlOvers ? { actual: f.overs, share: rule.bowlOvers } : null;
}

/**
 * Re-derives every row's check flag. The tick survives only while the PlayHQ figure is unchanged.
 * Without PlayHQ data the rows are returned untouched, so saved flags are never wiped. Idempotent.
 */
export function withChecks(rows: MilestoneRow[], ctx: CheckContext): MilestoneRow[] {
  if (!ctx.available) return rows;
  return rows.map((row) => {
    const exp = expectedCheck(ctx.rule, ctx.figures, row);
    const prev = row.check ?? null;
    return { ...row, check: exp ? { ...exp, checked: prev?.checked === true && prev.actual === exp.actual } : null };
  });
}

export const needsCheck = (rows: MilestoneRow[]) => rows.filter((r) => r.check && !r.check.checked).length;
