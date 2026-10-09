export interface TeamSummary {
  slug: string;
  name: string;
  mascot: string;
  /** Display grade, e.g. "Kiwi Year 1/2"; null for the club pool. */
  grade: string | null;
  /** Dot sticker colour name, e.g. "light blue"; null when the team has none. */
  dot: string | null;
}

export interface StocktakeRef {
  id: string;
  date: string;
  label: string;
}

export interface TeamPage {
  team: TeamSummary;
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
