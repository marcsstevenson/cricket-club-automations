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
  /** Pools only: shown instead of "Spare gear in storage"; null for the default. */
  description: string | null;
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
  description?: string | null;
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
  /** The item has been retired from the catalogue. */
  retired: boolean;
  /** Always listed here (Kit Spec item, or any item in a pool, not retired); otherwise removable at 0. */
  pinned: boolean;
}

export interface Category {
  id: number;
  name: string;
}

export interface CatalogueItem {
  id: string;
  name: string;
  categoryId: number;
  category: string;
  retired: boolean;
}

/** GET /api/catalogue: categories and the items that can be added, in catalogue order; Kit Spec column names. */
export interface Catalogue {
  categories: Category[];
  items: CatalogueItem[];
  specs: string[];
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

/** GET /api/admin/catalogue. */
export interface AdminCatalogue {
  categories: (Category & { items: number })[];
  /** Catalogue order, retired included; holders = teams/pools holding some, total = club total. */
  items: (CatalogueItem & { holders: number; total: number })[];
  /** Kit Spec columns in order; qty maps item id to quantity; teams = how many teams use the column. */
  specs: { id: number; name: string; teams: number; qty: Record<string, number> }[];
}
