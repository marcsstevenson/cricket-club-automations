import type { MilestoneRule, MilestoneType } from './types';

export const SCORING_TEXT = {
  yes: 'Yes',
  no: 'No',
  yes_issues: 'Yes but there were issues',
  not_played: 'Game not played',
} as const;

export const REASON_TEXT = { rain: 'Rained out', cancelled: 'Cancelled', forfeit: 'Forfeit', other: 'Other' } as const;

export const STATUS_TEXT = {
  reported: 'Reported',
  not_played: 'Not played',
  not_reported: 'Not yet reported',
  missing: 'Missing',
  upcoming: 'Upcoming',
} as const;

export const MILESTONE_TEXT = { bat: 'Batting', bowl: 'Bowling', hattrick: 'Hat-trick' } as const;

const HAT_TRICK = "3 wickets from 3 balls in a row by the same bowler. They can span two of the bowler's overs";

/** One-line rule shown under each milestone question (functional spec §6.3.2). */
export function milestoneRuleText(rule: MilestoneRule): Record<MilestoneType, string> {
  if (rule.kind === 'open') {
    return { bat: '25 or more runs in the innings.', bowl: '3 or more wickets in the innings.', hattrick: `${HAT_TRICK}.` };
  }
  return {
    bat: `25 or more runs from the batter's first ${rule.batBalls} balls.`,
    bowl: `3 or more wickets in the bowler's first ${rule.bowlOvers} overs.`,
    hattrick: `${HAT_TRICK}, but all three must come in their first ${rule.bowlOvers} overs.`,
  };
}

const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** Warning and tick label on a flagged row (functional spec §6.3.3). */
export function checkText(type: MilestoneType, c: { actual: number; share: number }) {
  return type === 'bat'
    ? {
        warning: `⚠ Faced ${c.actual} balls. Only runs from the first ${c.share} count. Check the scorebook.`,
        confirm: `Checked: 25 runs by the ${ordinal(c.share)} ball`,
      }
    : {
        warning: `⚠ Bowled ${c.actual} overs. Only wickets in the first ${c.share} count. Check the scorebook.`,
        confirm: `Checked: 3 wickets by the end of the ${ordinal(c.share)} over`,
      };
}
