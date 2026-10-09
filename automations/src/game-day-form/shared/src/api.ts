import type { FormState, NotPlayedReason, PlayhqStartData, Scoring } from './types';

export interface TeamSummary {
  slug: string;
  name: string;
  mascot: string;
}

export type ReportStatus = 'reported' | 'not_played' | 'not_reported' | 'upcoming';

export interface GameOption {
  gameId: string;
  date: string | null;
  dateLabel: string;
  round: string;
  opposition: string;
  venue: string;
  reportStatus: ReportStatus;
  selectable: boolean;
}

export interface TeamPage {
  team: TeamSummary & { grade: string | null };
  season: string;
  today: string;
  squad: { key: string; label: string }[];
  fixture: { available: boolean; games: GameOption[] };
  defaultGameId: string | null;
  /** This season's award wins per squad key: the game IDs each player won Player / Mascot of the day in. */
  awards: AwardGames;
}

export interface AwardGames {
  potd: Record<string, string[]>;
  mascot: Record<string, string[]>;
}

export type ReportOut = FormState & { version: number; updatedAt: string };

export interface GamePage {
  game: GameOption;
  report: ReportOut | null;
  start: PlayhqStartData;
}

export interface RefreshResult {
  start: PlayhqStartData;
  rateLimited?: boolean;
}

export type ListStatus = 'reported' | 'not_played' | 'missing' | 'upcoming';

export interface GameRow {
  gameId: string;
  teamSlug: string;
  teamName: string;
  date: string | null;
  dateLabel: string;
  round: string;
  opposition: string;
  venue: string;
  status: ListStatus;
  scoring: Scoring | null;
  issues: string;
  notPlayedReason: NotPlayedReason | null;
  notPlayedOther: string;
  score: string | null;
  potd: string | null;
  mascot: string | null;
  milestoneCount: number;
  uncheckedCount: number;
}

export interface GamesList {
  today: string;
  rows: GameRow[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  latest?: ReportOut | null;
  requestId?: string;
}
