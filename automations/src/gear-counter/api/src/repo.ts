import { findItem, specLines } from '../../shared/src/data';
import { dateLabel } from '../../shared/src/dates';
import type { Line, Stocktake, StocktakeRef } from '../../shared/src/types';
import { ApiError } from './errors';

type Team = { slug: string; spec: string | null };

interface LineRow {
  item_id: string;
  name: string;
  category: string;
  expected: number;
  count: number;
  added: number;
}

const toLine = (r: LineRow): Line => ({
  itemId: r.item_id,
  name: r.name,
  category: r.category,
  expected: r.expected,
  count: r.count,
  added: r.added === 1,
});

const ref = (r: { id: string; date: string }): StocktakeRef => ({ id: r.id, date: r.date, label: dateLabel(r.date) });

export async function listStocktakes(db: D1Database, teamSlug: string): Promise<StocktakeRef[]> {
  const { results } = await db
    .prepare('SELECT id, date FROM stocktakes WHERE team_slug = ? ORDER BY date DESC')
    .bind(teamSlug)
    .all<{ id: string; date: string }>();
  return results.map(ref);
}

export async function getStocktake(db: D1Database, id: string): Promise<Stocktake> {
  const head = await db.prepare('SELECT id, team_slug, date FROM stocktakes WHERE id = ?').bind(id).first<{ id: string; team_slug: string; date: string }>();
  if (!head) throw new ApiError(404, 'stocktake_not_found', 'Stocktake not found.');
  const { results } = await db
    .prepare('SELECT item_id, name, category, expected, count, added FROM lines WHERE stocktake_id = ? ORDER BY sort, name')
    .bind(id)
    .all<LineRow>();
  return { ...ref(head), teamSlug: head.team_slug, lines: results.map(toLine) };
}

/** Creates the team's stocktake for `date` with its spec lines, or returns the existing one. */
export async function openStocktake(db: D1Database, team: Team, date: string, id: string, now: Date): Promise<Stocktake> {
  const at = now.toISOString();
  // One transaction: when another request created today's first, the INSERT is ignored and the
  // EXISTS guard stops lines being written against the unused id.
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO stocktakes (id, team_slug, date, created_at) VALUES (?, ?, ?, ?)').bind(id, team.slug, date, at),
    ...specLines(team.spec).map((l) =>
      db
        .prepare(
          `INSERT INTO lines (stocktake_id, item_id, name, category, sort, expected, count, added, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7 WHERE EXISTS (SELECT 1 FROM stocktakes WHERE id = ?1)`,
        )
        .bind(id, l.item.id, l.item.name, l.item.category, l.sort, l.expected, at),
    ),
  ]);
  const row = await db.prepare('SELECT id FROM stocktakes WHERE team_slug = ? AND date = ?').bind(team.slug, date).first<{ id: string }>();
  return getStocktake(db, row!.id);
}

export async function adjustCount(db: D1Database, stocktakeId: string, itemId: string, delta: number, now: Date): Promise<number> {
  const row = await db
    .prepare('UPDATE lines SET count = MAX(0, count + ?1), updated_at = ?2 WHERE stocktake_id = ?3 AND item_id = ?4 RETURNING count')
    .bind(delta, now.toISOString(), stocktakeId, itemId)
    .first<{ count: number }>();
  if (!row) throw new ApiError(404, 'line_not_found', 'That line is no longer in this stocktake.');
  return row.count;
}

export async function addLine(db: D1Database, stocktakeId: string, itemId: string, now: Date): Promise<Line> {
  const found = findItem(itemId);
  if (!found) throw new ApiError(404, 'item_not_found', 'Unknown item.');
  await getStocktake(db, stocktakeId); // 404s if missing
  const { item, sort } = found;
  await db
    .prepare(
      `INSERT OR IGNORE INTO lines (stocktake_id, item_id, name, category, sort, expected, count, added, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?)`,
    )
    .bind(stocktakeId, item.id, item.name, item.category, sort, now.toISOString())
    .run();
  const row = await db
    .prepare('SELECT item_id, name, category, expected, count, added FROM lines WHERE stocktake_id = ? AND item_id = ?')
    .bind(stocktakeId, itemId)
    .first<LineRow>();
  return toLine(row!);
}

export async function removeLine(db: D1Database, stocktakeId: string, itemId: string): Promise<void> {
  const r = await db
    .prepare('DELETE FROM lines WHERE stocktake_id = ? AND item_id = ? AND added = 1 AND count = 0')
    .bind(stocktakeId, itemId)
    .run();
  if (r.meta.changes) return;
  const line = await db
    .prepare('SELECT added, count FROM lines WHERE stocktake_id = ? AND item_id = ?')
    .bind(stocktakeId, itemId)
    .first<{ added: number; count: number }>();
  if (!line) throw new ApiError(404, 'line_not_found', 'That line is no longer in this stocktake.');
  throw new ApiError(409, 'cannot_remove', line.added ? 'Set the count to 0 before removing this line.' : 'Only lines you added can be removed.');
}
