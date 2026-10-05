export interface Stat {
  type: string;
  value: number | null;
}

export interface V1Game {
  id: string;
  status: string; // 'FINAL' | 'PENDING' | …
  round: { name: string; abbreviatedName: string } | null;
  schedule: { date: string; time?: string; timezone?: string } | null; // date is already NZ local
  venue: { name: string } | null;
  competitors: { id: string; name: string }[];
}

export interface V2Appearance {
  id: string;
  firstName: string | null;
  lastName: string | null;
  teamId: string;
}

export interface V2PeriodTeam {
  id: string;
  discipline: 'BATTING' | 'BOWLING';
  statistics: Stat[];
  appearances: { id: string; statistics: Stat[] }[];
}

export interface V2Summary {
  id: string;
  status: string;
  teams: { id: string; name: string }[];
  appearances: V2Appearance[];
  periods: { name: string; sequenceNo: number; teams: V2PeriodTeam[] }[];
}
