import { items } from '../../shared/src/data';
import { toCsv, type Cell } from './csv';
import { ApiError } from './errors';
import { listTeams } from './teams';

interface LatestLine {
  team_slug: string;
  date: string;
  item_id: string;
  name: string;
  category: string;
  sort: number;
  expected: number;
  count: number;
  added: number;
}

// Every line of each team's most recent stocktake.
const LATEST = `
  SELECT s.team_slug, s.date, l.item_id, l.name, l.category, l.sort, l.expected, l.count, l.added
  FROM stocktakes s
  JOIN (SELECT team_slug, MAX(date) AS date FROM stocktakes GROUP BY team_slug) m ON m.team_slug = s.team_slug AND m.date = s.date
  JOIN lines l ON l.stocktake_id = s.id`;

/** One row per catalogue item, a column per team/pool (hidden ones marked), counts from each latest stocktake. */
export async function clubCsv(db: D1Database): Promise<string> {
  const teams = await listTeams(db, true);
  const { results } = await db.prepare(LATEST).all<LatestLine>();
  const dates = new Map<string, string>();
  const counts = new Map<string, number>(); // `${slug}|${item}`
  const extra = new Map<string, { name: string; category: string }>(); // lines for items no longer in the catalogue
  const known = new Set(items.map((i) => i.id));
  for (const l of results) {
    dates.set(l.team_slug, l.date);
    counts.set(`${l.team_slug}|${l.item_id}`, l.count);
    if (!known.has(l.item_id)) extra.set(l.item_id, { name: l.name, category: l.category });
  }
  const rows: Cell[][] = [
    ['Category', 'Item', 'Club total', ...teams.map((t) => (t.hidden ? `${t.name} (hidden)` : t.name))],
    ['Stocktake date', '', '', ...teams.map((t) => dates.get(t.slug) ?? '')],
  ];
  const all = [...items.map((i) => ({ id: i.id, name: i.name, category: i.category })), ...[...extra].map(([id, x]) => ({ id, ...x }))];
  for (const item of all) {
    const cells = teams.map((t) => counts.get(`${t.slug}|${item.id}`));
    const total = cells.reduce<number>((n, c) => n + (c ?? 0), 0);
    rows.push([item.category, item.name, total, ...cells]);
  }
  return toCsv(rows);
}

/** The team's latest stocktake, one row per line. */
export async function teamCsv(db: D1Database, slug: string): Promise<{ csv: string; date: string }> {
  const { results } = await db.prepare(`${LATEST} WHERE s.team_slug = ? ORDER BY l.sort, l.name`).bind(slug).all<LatestLine>();
  if (!results.length) throw new ApiError(404, 'no_stocktake', 'This team has no stocktake yet.');
  const rows: Cell[][] = [
    ['Category', 'Item', 'Count', 'Kit Spec', 'Added'],
    ...results.map((l) => [l.category, l.name, l.count, l.expected, l.added ? 'Yes' : '']),
  ];
  return { csv: toCsv(rows), date: results[0].date };
}
