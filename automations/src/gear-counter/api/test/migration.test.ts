import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const db = env.MIGRATE_DB;
const [init, teams, levels] = env.TEST_MIGRATIONS;

describe('0003_levels', () => {
  it('turns each latest stocktake into levels and opening log entries', async () => {
    expect(levels?.name).toBe('0003_levels.sql');
    await applyD1Migrations(db, [init, teams]);
    await db.batch([
      db.prepare(
        "INSERT INTO teams (slug, name, kind, mascot, grade, spec, dot, sort, hidden, created_at) VALUES ('shed', 'Shed', 'pool', '', NULL, NULL, NULL, 20, 0, '2026-10-10T18:30:00.000Z')",
      ),
      db.prepare(
        "INSERT INTO stocktakes VALUES ('a', 'penguins', '2026-10-09', '2026-10-09T01:00:00.000Z'), ('b', 'penguins', '2026-10-10', '2026-10-10T02:00:00.000Z'), ('c', 'shed', '2026-10-10', '2026-10-10T19:00:00.000Z')",
      ),
      db.prepare(`INSERT INTO lines (stocktake_id, item_id, name, category, sort, expected, count, added, updated_at) VALUES
        ('a', 'STU-03', 'Black rubber bases', 'Stumps & Wickets', 2, 1, 9, 0, 'x'),
        ('b', 'STU-03', 'Black rubber bases', 'Stumps & Wickets', 2, 1, 2, 0, 'x'),
        ('b', 'BAT-W2', 'Wooden bat S2 (softball)', 'Bats', 9, 0, 0, 1, 'x'),
        ('c', 'FLD-TC', 'Tall cones', 'Fielding', 60, 0, 5, 0, 'x')`),
    ]);
    await applyD1Migrations(db, [levels]);

    const level = (slug: string, item: string) =>
      db.prepare('SELECT level, added FROM levels WHERE team_slug = ? AND item_id = ?').bind(slug, item).first<{ level: number; added: number }>();
    expect(await level('penguins', 'STU-03')).toEqual({ level: 2, added: 0 }); // latest, not the older 9
    expect(await level('penguins', 'BAT-W2')).toEqual({ level: 0, added: 1 });
    const penguins = await db.prepare("SELECT COUNT(*) AS n FROM levels WHERE team_slug = 'penguins'").first<{ n: number }>();
    expect(penguins?.n).toBe(14 + 1); // Kiwi Y1 Kit Spec + the added bat
    const pumas = await db.prepare("SELECT COUNT(*) AS n, SUM(level) AS total FROM levels WHERE team_slug = 'pumas'").first<{ n: number; total: number }>();
    expect(pumas).toEqual({ n: 27, total: 0 }); // Year 7 Kit Spec; no stocktake
    const shed = await db.prepare("SELECT COUNT(*) AS n FROM levels WHERE team_slug = 'shed'").first<{ n: number }>();
    expect(shed?.n).toBe(62);
    expect(await level('shed', 'FLD-TC')).toEqual({ level: 5, added: 0 });

    const { results } = await db.prepare('SELECT team_slug, item_id, kind, change, level_after, who, at FROM log ORDER BY id').all();
    expect(results).toEqual([
      { team_slug: 'penguins', item_id: 'STU-03', kind: 'opening', change: 2, level_after: 2, who: 'Migration', at: '2026-10-10T02:00:00.000Z' },
      { team_slug: 'shed', item_id: 'FLD-TC', kind: 'opening', change: 5, level_after: 5, who: 'Migration', at: '2026-10-10T19:00:00.000Z' },
    ]);
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('stocktakes', 'lines', 'mig_kit_spec', 'mig_catalogue')")
      .all();
    expect(tables.results).toEqual([]);
  });
});
