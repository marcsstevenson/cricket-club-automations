export type TeamKind = 'team' | 'pool';

export interface TeamSummary {
  slug: string;
  name: string;
  kind: TeamKind;
  /** Image name in /mascots; '' shows the ball. */
  mascot: string;
  /** Display grade, e.g. "Kiwi Year 1/2"; null for a pool. */
  grade: string | null;
  /** Dot sticker colour name, e.g. "light blue"; null when the team has none. */
  dot: string | null;
}

/** As the admin page sees it. */
export interface AdminTeam extends TeamSummary {
  /** Kit Spec column; null for a pool. */
  spec: string | null;
  hidden: boolean;
  /** ISO time of the latest log entry, or null. */
  lastChange: string | null;
}

export interface NewTeam {
  kind: TeamKind;
  name: string;
  slug: string;
  spec?: string | null;
  grade?: string | null;
  dot?: string | null;
  mascot?: string;
}

export interface TeamPage {
  team: TeamSummary;
  /** Kit Spec column; null for a pool. */
  spec: string | null;
  /** Listed items in catalogue order. */
  levels: LevelLine[];
  /** Newest first, at most 50. */
  recent: LogEntry[];
}

export interface LevelLine {
  itemId: string;
  name: string;
  category: string;
  level: number;
  /** Kit Spec quantity for this team (0 for added items and pools). */
  kitSpec: number;
  /** Listed with + Add item (not in the team's Kit Spec). */
  added: boolean;
}

export type LogKind = 'opening' | 'adjust' | 'move' | 'count';

export interface TeamRef {
  slug: string;
  name: string;
}

export interface LogEntry {
  id: number;
  /** ISO time the entry was created (server time). */
  at: string;
  who: string;
  itemId: string;
  itemName: string;
  kind: LogKind;
  /** Signed change to this team's level. */
  change: number;
  levelAfter: number;
  from: TeamRef | null;
  to: TeamRef | null;
  note: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
