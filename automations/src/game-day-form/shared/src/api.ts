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
  /** The highlights text, cut to a short preview ('' when none). */
  highlights: string;
  photoCount: number;
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

/** Admin only: one row of the admin teams list. */
export interface AdminTeamSummary {
  slug: string;
  name: string;
  gradeName: string;
  playerCount: number;
  toCount: number;
  ccCount: number;
}

export interface ReminderLists {
  to: string[];
  cc: string[];
}

/** Admin only: a team's details (read-only, from the squad) and its editable reminder lists. Holds full names. */
export interface AdminTeamDetail {
  slug: string;
  name: string;
  gradeName: string;
  playhqGradeId: string;
  playhqTeamId: string;
  players: { key: string; firstName: string; lastName: string; playhqId: string; label: string }[];
  reminders: ReminderLists;
}
