import { findItem, kitSpecQty } from '../../shared/src/data';
import type { LevelLine, LogEntry, LogKind } from '../../shared/src/types';
import { ApiError } from './errors';
import type { TeamRow } from './teams';

export const GROUP_MS = 2 * 60 * 1000;

export function itemName(itemId: string): string {
  const found = findItem(itemId);
  if (!found) throw new ApiError(404, 'item_not_found', 'Unknown item.');
  return found.item.name;
}

const notListed = () => new ApiError(404, 'item_not_listed', 'That item is not listed here.');

export async function teamLevels(db: D1Database, team: TeamRow): Promise<LevelLine[]> {
  const { results } = await db
    .prepare('SELECT item_id, level, added FROM levels WHERE team_slug = ?')
    .bind(team.slug)
    .all<{ item_id: string; level: number; added: number }>();
  return results
    .map((r) => {
      const found = findItem(r.item_id);
      return {
        sort: found?.sort ?? Infinity,
        line: {
          itemId: r.item_id,
          name: found?.item.name ?? r.item_id,
          category: found?.item.category ?? 'Other',
          level: r.level,
          kitSpec: kitSpecQty(team.spec, r.item_id),
          added: r.added === 1,
        },
      };
    })
    .sort((a, b) => a.sort - b.sort)
    .map((x) => x.line);
}

/** + / − : atomic on the level; the log entry is grouped (spec §4.1). */
export async function adjust(db: D1Database, team: TeamRow, itemId: string, delta: number, who: string, now: Date): Promise<number> {
  const name = itemName(itemId);
  const [before, after] = await db.batch<{ level: number }>([
    db.prepare('SELECT level FROM levels WHERE team_slug = ?1 AND item_id = ?2').bind(team.slug, itemId),
    db
      .prepare('UPDATE levels SET level = MAX(0, level + ?3), updated_at = ?4 WHERE team_slug = ?1 AND item_id = ?2 RETURNING level')
      .bind(team.slug, itemId, delta, now.toISOString()),
  ]);
  const old = before.results[0]?.level;
  const level = after.results[0]?.level;
  if (old === undefined || level === undefined) throw notListed();
  if (level !== old) await logAdjust(db, team.slug, itemId, name, level - old, level, who, now);
  return level;
}

async function logAdjust(db: D1Database, slug: string, itemId: string, name: string, change: number, levelAfter: number, who: string, now: Date) {
  const at = now.toISOString();
  const last = await db
    .prepare('SELECT id, kind, who, change, updated_at FROM log WHERE team_slug = ? AND item_id = ? ORDER BY id DESC LIMIT 1')
    .bind(slug, itemId)
    .first<{ id: number; kind: LogKind; who: string; change: number; updated_at: string }>();
  const fresh = last && Date.parse(last.updated_at) > now.getTime() - GROUP_MS;
  if (last && fresh && last.kind === 'adjust' && last.who.toLowerCase() === who.toLowerCase()) {
    const total = last.change + change;
    if (total === 0) await db.prepare('DELETE FROM log WHERE id = ?').bind(last.id).run();
    else await db.prepare('UPDATE log SET change = ?, level_after = ?, updated_at = ? WHERE id = ?').bind(total, levelAfter, at, last.id).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO log (at, updated_at, team_slug, item_id, item_name, kind, change, level_after, who)
       VALUES (?1, ?1, ?2, ?3, ?4, 'adjust', ?5, ?6, ?7)`,
    )
    .bind(at, slug, itemId, name, change, levelAfter, who)
    .run();
}

export async function listItem(db: D1Database, team: TeamRow, itemId: string, now: Date): Promise<LevelLine> {
  itemName(itemId); // 404s unknown items
  const added = team.kind === 'team' && !kitSpecQty(team.spec, itemId) ? 1 : 0;
  await db
    .prepare('INSERT OR IGNORE INTO levels (team_slug, item_id, level, added, updated_at) VALUES (?, ?, 0, ?, ?)')
    .bind(team.slug, itemId, added, now.toISOString())
    .run();
  return (await teamLevels(db, team)).find((l) => l.itemId === itemId)!;
}

export async function unlistItem(db: D1Database, team: TeamRow, itemId: string): Promise<void> {
  if (team.kind === 'pool') throw new ApiError(409, 'cannot_unlist', 'Every item stays listed in a pool.');
  if (kitSpecQty(team.spec, itemId)) throw new ApiError(409, 'cannot_unlist', 'Kit Spec items stay listed.');
  const r = await db.prepare('DELETE FROM levels WHERE team_slug = ? AND item_id = ? AND level = 0').bind(team.slug, itemId).run();
  if (r.meta.changes) return;
  const row = await db.prepare('SELECT level FROM levels WHERE team_slug = ? AND item_id = ?').bind(team.slug, itemId).first();
  if (!row) throw notListed();
  throw new ApiError(409, 'cannot_unlist', 'Set the level to 0 before removing this item.');
}

/** Sets the level outright (last write wins) and logs old → new; nothing when unchanged. */
export async function setCount(
  db: D1Database, team: TeamRow, itemId: string, level: number, who: string, note: string | null, now: Date,
): Promise<number> {
  const name = itemName(itemId);
  const at = now.toISOString();
  const [, , after] = await db.batch<{ level: number }>([
    db
      .prepare(
        `INSERT INTO log (at, updated_at, team_slug, item_id, item_name, kind, change, level_after, note, who)
         SELECT ?1, ?1, team_slug, item_id, ?3, 'count', ?4 - level, ?4, ?5, ?6 FROM levels
         WHERE team_slug = ?2 AND item_id = ?7 AND level <> ?4`,
      )
      .bind(at, team.slug, name, level, note, who, itemId),
    db.prepare('UPDATE levels SET level = ?1, updated_at = ?2 WHERE team_slug = ?3 AND item_id = ?4').bind(level, at, team.slug, itemId),
    db.prepare('SELECT level FROM levels WHERE team_slug = ? AND item_id = ?').bind(team.slug, itemId),
  ]);
  if (!after.results[0]) throw notListed();
  return after.results[0].level;
}

interface LogRow {
  id: number; at: string; who: string; item_id: string; item_name: string; kind: LogKind; change: number; level_after: number;
  from_slug: string | null; from_name: string | null; to_slug: string | null; to_name: string | null; note: string | null;
}

export const LOG_SELECT = `
  SELECT l.*, f.name AS from_name, t.name AS to_name
  FROM log l LEFT JOIN teams f ON f.slug = l.from_slug LEFT JOIN teams t ON t.slug = l.to_slug`;

export const toEntry = (r: LogRow): LogEntry => ({
  id: r.id,
  at: r.at,
  who: r.who,
  itemId: r.item_id,
  itemName: r.item_name,
  kind: r.kind,
  change: r.change,
  levelAfter: r.level_after,
  from: r.from_slug ? { slug: r.from_slug, name: r.from_name ?? r.from_slug } : null,
  to: r.to_slug ? { slug: r.to_slug, name: r.to_name ?? r.to_slug } : null,
  note: r.note,
});

export async function recent(db: D1Database, slug: string, limit = 50): Promise<LogEntry[]> {
  const { results } = await db.prepare(`${LOG_SELECT} WHERE l.team_slug = ? ORDER BY l.id DESC LIMIT ?`).bind(slug, limit).all<LogRow>();
  return results.map(toEntry);
}
