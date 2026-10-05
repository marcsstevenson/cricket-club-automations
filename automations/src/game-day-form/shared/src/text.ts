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
