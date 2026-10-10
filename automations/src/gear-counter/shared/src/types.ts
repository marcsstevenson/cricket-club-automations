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
  /** Date of the latest stocktake, or null. */
  latest: string | null;
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

export interface StocktakeRef {
  id: string;
  date: string;
  label: string;
}

export interface TeamPage {
  team: TeamSummary;
  /** Kit Spec column new stocktakes start from; null for a pool (every item). */
  spec: string | null;
  today: string;
  /** Newest first. */
  stocktakes: StocktakeRef[];
}

export interface Line {
  itemId: string;
  name: string;
  category: string;
  expected: number;
  count: number;
  added: boolean;
}

export interface Stocktake extends StocktakeRef {
  teamSlug: string;
  lines: Line[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
