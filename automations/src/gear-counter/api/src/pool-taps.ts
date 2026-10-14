import type { AdjustResult } from '../../shared/src/types';
import type { Cat } from './catalogue';
import { ApiError } from './errors';
import { GROUP_MS, itemName } from './levels';
import { CLUB_POOL, clubPool, type TeamRow } from './teams';

/** move_id prefix that marks a Club pool tap pair (spec §4.5, §6); manual moves use a plain UUID. */
export const TAP_PREFIX = 'tap-';
const TRIES = 5;

/**
 * + / − with "Take from Club pool" on (spec §4.5). Reads both levels, applies what is possible (+ limited by the
 * Club pool, − by the team) and writes both levels and the grouped log pair in one D1 batch. A concurrent tap that
 * changed a level in between makes the CHECK (level >= 0) roll the batch back; it is then re-read and retried.
 */
export async function poolTap(
  db: D1Database, team: TeamRow, cat: Cat, itemId: string, delta: number, who: string, newId: () => string, now: Date,
): Promise<AdjustResult> {
  if (team.slug === CLUB_POOL) throw new ApiError(400, 'pool_self', "The Club pool can't take from itself.");
  if (!(await clubPool(db))) throw new ApiError(409, 'pool_unavailable', "The Club pool is hidden, so gear can't be taken from it.");
  const name = itemName(cat, itemId);
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - GROUP_MS).toISOString();
  for (let attempt = 1; ; attempt++) {
    const [t, p, last] = await db.batch<Record<string, unknown>>([
      db.prepare('SELECT level FROM levels WHERE team_slug = ? AND item_id = ?').bind(team.slug, itemId),
      db.prepare('SELECT level FROM levels WHERE team_slug = ? AND item_id = ?').bind(CLUB_POOL, itemId),
      db.prepare('SELECT kind, move_id, who, updated_at FROM log WHERE team_slug = ? AND item_id = ? ORDER BY id DESC LIMIT 1').bind(team.slug, itemId),
    ]);
    const teamLevel = t.results[0]?.level as number | undefined;
    if (teamLevel === undefined) throw new ApiError(404, 'item_not_listed', 'That item is not listed here.');
    const poolLevel = (p.results[0]?.level as number | undefined) ?? 0;
    const applied = delta > 0 ? Math.min(delta, poolLevel) : Math.max(delta, -teamLevel);
    if (applied === 0) return { level: teamLevel, applied: 0, poolLevel };

    const g = last.results[0] as { kind: string; move_id: string | null; who: string; updated_at: string } | undefined;
    const grouped = g && g.kind === 'move' && g.move_id?.startsWith(TAP_PREFIX) && g.who.toLowerCase() === who.toLowerCase() && g.updated_at > cutoff;
    const moveId = grouped ? g.move_id! : TAP_PREFIX + newId();
    try {
      await db.batch(writes(db, team.slug, itemId, name, applied, moveId, who, at));
    } catch (e) {
      if (!/CHECK constraint failed/i.test(String(e))) throw e;
      if (attempt < TRIES) continue;
      throw new ApiError(503, 'busy', 'Lots of changes at once — try again.');
    }
    const rows = await db
      .prepare('SELECT team_slug, level FROM levels WHERE item_id = ? AND team_slug IN (?, ?)')
      .bind(itemId, team.slug, CLUB_POOL)
      .all<{ team_slug: string; level: number }>();
    const of = (slug: string) => rows.results.find((r) => r.team_slug === slug)?.level ?? 0;
    return { level: of(team.slug), applied, poolLevel: of(CLUB_POOL) };
  }
}

/**
 * Parameters (each statement binds up to its highest): ?1 team, ?2 Club pool, ?3 applied (team side; the pool gets the opposite), ?4 now, ?5 move_id, ?6 item, ?7 name, ?8 who.
 * Signed change per row: `side` = ?3 on the team row, −?3 on the pool row; the other end is the pool / the team.
 */
function writes(db: D1Database, team: string, item: string, name: string, applied: number, moveId: string, who: string, at: string) {
  const side = 'CASE WHEN team_slug = ?1 THEN ?3 ELSE -?3 END';
  const other = 'CASE WHEN team_slug = ?1 THEN ?2 ELSE ?1 END';
  const args = [team, CLUB_POOL, applied, at, moveId, item, name, who];
  return [
    db.prepare('UPDATE levels SET level = level + ?3, updated_at = ?4 WHERE team_slug = ?1 AND item_id = ?6').bind(...args.slice(0, 6)),
    db.prepare('UPDATE levels SET level = level - ?3, updated_at = ?4 WHERE team_slug = ?2 AND item_id = ?6').bind(...args.slice(0, 6)),
    // The pool row may be missing (an item added since the pool page was last opened): create it on a return, and
    // fail the CHECK on a take. (An upsert can't do this: SQLite checks the proposed row's CHECK before the conflict.)
    db
      .prepare(
        `INSERT INTO levels (team_slug, item_id, level, added, updated_at)
         SELECT ?2, ?6, -?3, 0, ?4 WHERE NOT EXISTS (SELECT 1 FROM levels WHERE team_slug = ?2 AND item_id = ?6)`,
      )
      .bind(...args.slice(0, 6)),
    // Grow the grouped pair (no-op for a new move_id); from/to follow the new sign.
    db
      .prepare(
        `UPDATE log SET
           change = change + ${side},
           level_after = (SELECT v.level FROM levels v WHERE v.team_slug = log.team_slug AND v.item_id = log.item_id),
           from_slug = CASE WHEN change + ${side} > 0 THEN ${other} END,
           to_slug = CASE WHEN change + ${side} < 0 THEN ${other} END,
           updated_at = ?4
         WHERE move_id = ?5`,
      )
      .bind(...args.slice(0, 5)),
    // Or start the pair (also covers a group deleted by another request in between).
    db
      .prepare(
        `INSERT INTO log (at, updated_at, team_slug, item_id, item_name, kind, change, level_after, move_id, from_slug, to_slug, who)
         SELECT * FROM (
           SELECT ?4, ?4, ?1, ?6, ?7, 'move', ?3, (SELECT level FROM levels WHERE team_slug = ?1 AND item_id = ?6), ?5,
                  CASE WHEN ?3 > 0 THEN ?2 END, CASE WHEN ?3 < 0 THEN ?2 END, ?8
           UNION ALL
           SELECT ?4, ?4, ?2, ?6, ?7, 'move', -?3, (SELECT level FROM levels WHERE team_slug = ?2 AND item_id = ?6), ?5,
                  CASE WHEN ?3 < 0 THEN ?1 END, CASE WHEN ?3 > 0 THEN ?1 END, ?8
         ) WHERE NOT EXISTS (SELECT 1 FROM log WHERE move_id = ?5)`,
      )
      .bind(...args),
    db.prepare('DELETE FROM log WHERE move_id = ?5 AND change = 0').bind(...args.slice(0, 5)),
  ];
}
