import { findItem, kitSpecQty, specLines } from '../../shared/src/data';
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

/**
 * Lists the team's Kit Spec items (every item for a pool) that have no row yet — e.g. after gear-data.json gains
 * items or Kit Spec quantities — so spec §2 "always listed" holds. One statement; a no-op when nothing is missing.
 */
export async function ensureListed(db: D1Database, team: TeamRow, now: Date): Promise<void> {
  const ids = JSON.stringify(specLines(team.spec).map((l) => l.item.id));
  await db
    .prepare('INSERT OR IGNORE INTO levels (team_slug, item_id, level, added, updated_at) SELECT ?1, value, 0, 0, ?2 FROM json_each(?3)')
    .bind(team.slug, now.toISOString(), ids)
    .run();
}

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

/**
 * + / − (spec §4.1). One D1 transaction: the log entry is grouped (or created, or dropped when it nets to 0)
 * and the level changed together, so a retry or two devices tapping at once can't double-count or lose a change.
 * The change actually applied is MAX(-level, delta), so the floor at 0 is reflected in the log.
 */
export async function adjust(db: D1Database, team: TeamRow, itemId: string, delta: number, who: string, now: Date): Promise<number> {
  const name = itemName(itemId);
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - GROUP_MS).toISOString();
  const level = '(SELECT level FROM levels WHERE team_slug = ?1 AND item_id = ?2)';
  const applied = `MAX(-${level}, ?3)`;
  const newest = '(SELECT id FROM log WHERE team_slug = ?1 AND item_id = ?2 ORDER BY id DESC LIMIT 1)';
  const results = await db.batch<{ level: number }>([
    // Add to this person's recent adjust entry for the item…
    db
      .prepare(
        `UPDATE log SET change = change + ${applied}, level_after = ${level} + ${applied}, updated_at = ?4
         WHERE id = ${newest} AND kind = 'adjust' AND who = ?5 COLLATE NOCASE AND updated_at > ?6 AND ${applied} <> 0`,
      )
      .bind(team.slug, itemId, delta, at, who, cutoff),
    // …or start a new one.
    db
      .prepare(
        `INSERT INTO log (at, updated_at, team_slug, item_id, item_name, kind, change, level_after, who)
         SELECT ?4, ?4, ?1, ?2, ?7, 'adjust', ${applied}, ${level} + ${applied}, ?5
         WHERE changes() = 0 AND ${level} IS NOT NULL AND ${applied} <> 0`,
      )
      .bind(team.slug, itemId, delta, at, who, cutoff, name),
    // A group that nets to 0 disappears.
    db.prepare(`DELETE FROM log WHERE id = ${newest} AND kind = 'adjust' AND change = 0`).bind(team.slug, itemId),
    db
      .prepare('UPDATE levels SET level = MAX(0, level + ?3), updated_at = ?4 WHERE team_slug = ?1 AND item_id = ?2 RETURNING level')
      .bind(team.slug, itemId, delta, at),
  ]);
  const row = results[3].results[0];
  if (!row) throw notListed();
  return row.level;
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

/** One D1 transaction (spec §4.2). The CHECK (level >= 0) rolls it back when the source is short or unlisted. */
export async function move(
  db: D1Database, from: TeamRow, to: TeamRow, itemId: string, qty: number, who: string, note: string | null, moveId: string, now: Date,
): Promise<{ fromLevel: number; toLevel: number }> {
  if (from.slug === to.slug) throw new ApiError(400, 'same_team', 'Choose a different team or pool.');
  const name = itemName(itemId);
  const at = now.toISOString();
  const toAdded = to.kind === 'team' && !kitSpecQty(to.spec, itemId) ? 1 : 0;
  try {
    await db.batch([
      // No source row: insert one at -1, which fails the CHECK and rolls everything back.
      db
        .prepare('INSERT INTO levels (team_slug, item_id, level, added, updated_at) SELECT ?1, ?2, -1, 0, ?3 WHERE NOT EXISTS (SELECT 1 FROM levels WHERE team_slug = ?1 AND item_id = ?2)')
        .bind(from.slug, itemId, at),
      db.prepare('UPDATE levels SET level = level - ?3, updated_at = ?4 WHERE team_slug = ?1 AND item_id = ?2').bind(from.slug, itemId, qty, at),
      db
        .prepare(
          `INSERT INTO levels (team_slug, item_id, level, added, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (team_slug, item_id) DO UPDATE SET level = level + excluded.level, updated_at = excluded.updated_at`,
        )
        .bind(to.slug, itemId, qty, toAdded, at),
      db
        .prepare(
          `INSERT INTO log (at, updated_at, team_slug, item_id, item_name, kind, change, level_after, move_id, to_slug, note, who)
           SELECT ?1, ?1, ?2, ?3, ?4, 'move', -?5, level, ?6, ?7, ?8, ?9 FROM levels WHERE team_slug = ?2 AND item_id = ?3`,
        )
        .bind(at, from.slug, itemId, name, qty, moveId, to.slug, note, who),
      db
        .prepare(
          `INSERT INTO log (at, updated_at, team_slug, item_id, item_name, kind, change, level_after, move_id, from_slug, note, who)
           SELECT ?1, ?1, ?2, ?3, ?4, 'move', ?5, level, ?6, ?7, ?8, ?9 FROM levels WHERE team_slug = ?2 AND item_id = ?3`,
        )
        .bind(at, to.slug, itemId, name, qty, moveId, from.slug, note, who),
    ]);
  } catch (e) {
    if (!/CHECK constraint failed/i.test(String(e))) throw e;
    const row = await db.prepare('SELECT level FROM levels WHERE team_slug = ? AND item_id = ?').bind(from.slug, itemId).first<{ level: number }>();
    throw new ApiError(409, 'not_enough', `Only ${row?.level ?? 0} available.`);
  }
  const [a, b] = await db.batch<{ level: number }>([
    db.prepare('SELECT level FROM levels WHERE team_slug = ? AND item_id = ?').bind(from.slug, itemId),
    db.prepare('SELECT level FROM levels WHERE team_slug = ? AND item_id = ?').bind(to.slug, itemId),
  ]);
  return { fromLevel: a.results[0].level, toLevel: b.results[0].level };
}
