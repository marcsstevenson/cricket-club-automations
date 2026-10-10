import { nzDate, nzDateTime } from '../../shared/src/dates';
import type { LogEntry } from '../../shared/src/types';
import { loadCatalogue } from './catalogue';
import { toCsv, type Cell } from './csv';
import { ensureListed, LOG_SELECT, teamLevels, toEntry } from './levels';
import { listTeams, type TeamRow } from './teams';

/** One row per catalogue item, a column per team/pool (hidden ones marked), current levels. */
export async function clubCsv(db: D1Database): Promise<string> {
  const [teams, cat] = await Promise.all([listTeams(db, true), loadCatalogue(db)]);
  // New items / Kit Spec quantities reach every team and pool here too (spec §3.7).
  const now = new Date();
  for (const t of teams) await ensureListed(db, t, cat, now);
  const [levels, last] = await db.batch([
    db.prepare('SELECT team_slug, item_id, level FROM levels'),
    db.prepare('SELECT team_slug, MAX(at) AS at FROM log GROUP BY team_slug'),
  ]);
  const level = new Map((levels.results as { team_slug: string; item_id: string; level: number }[]).map((r) => [`${r.team_slug}|${r.item_id}`, r.level]));
  const lastChange = new Map((last.results as { team_slug: string; at: string }[]).map((r) => [r.team_slug, nzDate(new Date(r.at))]));
  const rows: Cell[][] = [
    ['Category', 'Item', 'Club total', ...teams.map((t) => (t.hidden ? `${t.name} (hidden)` : t.name))],
    ['Last change', '', '', ...teams.map((t) => lastChange.get(t.slug) ?? '')],
  ];
  for (const item of cat.items) {
    const cells = teams.map((t) => level.get(`${t.slug}|${item.id}`));
    const total = cells.reduce<number>((n, c) => n + (c ?? 0), 0);
    // Retired items only while someone still holds them.
    if (item.retired && !total) continue;
    rows.push([item.category, item.retired ? `${item.name} (retired)` : item.name, total, ...cells]);
  }
  return toCsv(rows);
}

export async function levelsCsv(db: D1Database, team: TeamRow): Promise<string> {
  const cat = await loadCatalogue(db);
  await ensureListed(db, team, cat, new Date());
  const lines = await teamLevels(db, team, cat);
  return toCsv([
    ['Category', 'Item', 'Level', 'Kit Spec', 'Listed'],
    ...lines.map((l) => [l.category, l.name, l.level, l.kitSpec || null, l.added ? 'Added' : 'Kit Spec']),
  ]);
}

const KIND = (e: LogEntry) =>
  e.kind === 'opening' ? 'Opening' : e.kind === 'adjust' ? 'Adjust' : e.kind === 'count' ? 'Set count' : e.change < 0 ? 'Move out' : 'Move in';

/** Every log entry (or one team's), newest first. */
export async function logCsv(db: D1Database, slug?: string): Promise<string> {
  const stmt = slug
    ? db.prepare(`SELECT x.*, tm.name AS team_name FROM (${LOG_SELECT} WHERE l.team_slug = ?) x JOIN teams tm ON tm.slug = x.team_slug ORDER BY x.id DESC`).bind(slug)
    : db.prepare(`SELECT x.*, tm.name AS team_name FROM (${LOG_SELECT}) x JOIN teams tm ON tm.slug = x.team_slug ORDER BY x.id DESC`);
  const { results } = await stmt.all<Parameters<typeof toEntry>[0] & { team_name: string }>();
  return toCsv([
    ['When', 'Who', 'Team', 'Item', 'Kind', 'Change', 'Level after', 'From', 'To', 'Note'],
    ...results.map((r) => {
      const e = toEntry(r);
      return [nzDateTime(e.at), e.who, r.team_name, e.itemName, KIND(e), e.change, e.levelAfter, e.from?.name, e.to?.name, e.note];
    }),
  ]);
}
