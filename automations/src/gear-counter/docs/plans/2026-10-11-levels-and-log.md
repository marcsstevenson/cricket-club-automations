# Levels and Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dated stocktakes with a current level per team/pool and item plus a log of every change (adjust, move, set count), attributed to a name kept in the browser.

**Architecture:** D1 gets `levels` (one row per listed team × item) and `log` (one row per movement; taps by the same name on the same item within 2 minutes are merged into one row). Migration `0003_levels.sql` turns each team's latest stocktake into levels plus `opening` log rows, then drops `stocktakes`/`lines`. The SPA team page shows levels with +/− (queued offline as before), a ⋯ dialog for Move and Set count, and Recent changes; a name modal blocks changes until a name is stored. Admin CSVs switch to levels and gain a log export.

**Tech Stack:** Cloudflare Workers + Hono + D1, valibot, SvelteKit 2 static SPA (Svelte 5 runes), Vitest with `@cloudflare/vitest-pool-workers` 0.22, Playwright 1.63.

**Spec:** `docs/spec.md` (rewritten for this change — read it first; it is the authority).

## Global Constraints

- Working directory for every command: `automations/src/gear-counter`.
- `who` is required on every change: 1–40 characters after trimming; 400 `name_required` otherwise.
- Notes: optional, up to 200 characters after trimming; empty → null.
- Adjust delta: integer −20…20, not 0. Set count level: integer 0–999. Move qty: integer 1–999.
- Grouping window: **2 minutes** (`GROUP_MS = 120_000`), same `who` compared case-insensitively, newest log row for that team + item must be `kind = 'adjust'`.
- Log times are server time, ISO UTC strings; display/CSV convert to Pacific/Auckland.
- Levels never go below 0 (`CHECK (level >= 0)`).
- A `levels` row exists exactly when the item is listed for that team/pool. Pools list every catalogue item; teams always list their Kit Spec items.
- Recent changes: newest 50 rows for the team/pool.
- Error bodies stay `{ error, message }`; admin routes keep `x-admin-passcode`, `ADMIN_LIMIT` (30/min), `cache-control: no-store`.
- Never commit `.dev.vars`, `.env`, or squad JSON. Commit/push/deploy only with the user's go-ahead (the plan's last task is gated).
- Name storage key `pcc-gear-name` (localStorage). Queue key becomes `pcc-gear-pending-v2`; the old `pcc-gear-pending-v1` is read once, dropped, and reported as an error if it held changes.

## Review Focus

1. **Offline taps then name change** — taps queued under one name must be sent under that name even if the name is changed before they sync. (Queue key includes `who`; Task 6 test.)
2. **Move from an unlisted or empty item** — a move whose source has no `levels` row, or less than `qty`, must change nothing (no destination increase, no log). (CHECK-constraint batch; Task 4 tests.)
3. **Grouping across people and kinds** — Sam's taps must never merge into Jo's row, nor into a `count`/`move` row, nor after 2 minutes; a group that nets to 0 disappears. (Task 3 tests.)
4. **Migration on real data** — teams with no stocktake, pools added after the seed (Social Smash, Smash Play), added lines, and zero counts. (Task 2 test on a second D1.)
5. **Set count racing taps** — Set count is last-write-wins; the dialog must not open while that item has queued taps, so the level it shows is current. (Task 7: ⋯ disabled while pending.)

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/levels_migration.py` (new) | Writes `migrations/0003_levels.sql` from `gear-data.json` (helper tables + conversion SQL) |
| `migrations/0003_levels.sql` (generated, committed) | Creates `levels`, `log`; converts latest stocktakes; drops `stocktakes`, `lines` |
| `shared/src/types.ts` | `LevelLine`, `LogEntry`, `TeamRef`, new `TeamPage`; `AdminTeam.lastChange`; stocktake types removed |
| `shared/src/data.ts` | add `kitSpecQty(spec, itemId)` |
| `shared/src/dates.ts` | add `nzDateTime(iso)`, `whenLabel(iso)` |
| `shared/src/levels.ts` (replaces `lines.ts`) | `levelsText(total, kind)` |
| `api/src/who.ts` (new) | `parseWho`, `parseNote` |
| `api/src/levels.ts` (replaces `repo.ts`) | `teamLevels`, `adjust` (+ grouping), `listItem`, `unlistItem`, `setCount`, `move`, `recent` |
| `api/src/app.ts` | new public routes; stocktake routes removed |
| `api/src/teams.ts` | `getAnyTeam`; `addTeam` lists items; `adminTeams` → `lastChange` |
| `api/src/exports.ts` | `clubCsv`, `levelsCsv`, `logCsv` |
| `api/src/admin.ts` | export routes for levels and log |
| `api/test/*` | `setup.ts` reset; `levels.test.ts`, `moves.test.ts`, `migration.test.ts` (new); `admin.test.ts`, `app.test.ts` updated |
| `wrangler.test.jsonc`, `vitest.config.ts` | second D1 binding `MIGRATE_DB` for the migration test |
| `web/src/lib/who.svelte.ts` (new), `NameModal.svelte` (new) | stored name + blocking modal |
| `web/src/lib/sync.svelte.ts` | queue keyed `team|item|who`, `onLevel`, `onIdle`, v1 drop |
| `web/src/lib/api.ts` | new client calls |
| `web/src/lib/ItemDialog.svelte` (new), `RecentChanges.svelte` (new) | Move / Set count dialog; log list |
| `web/src/lib/AddItem.svelte` | unchanged API (`have`, `onadd`) |
| `web/src/routes/[team]/+page.ts`, `+page.svelte` | levels page |
| `web/src/lib/draft.ts` | deleted |
| `web/src/routes/+page.svelte` | hero copy only |
| `web/src/routes/admin/+page.svelte` | lastChange, Levels/Log CSV buttons, Full log |
| `web/src/lib/styles/app.css` | log list, item menu button, dialog form styles |
| `web/tests/e2e/gear-counter.spec.ts` | rewritten |
| `README.md` | data model paragraph |

---

### Task 1: Shared types, dates, data helpers, spec example

**Files:**
- Modify: `shared/src/types.ts`, `shared/src/data.ts`, `shared/src/dates.ts`, `docs/spec.md`
- Create: `shared/src/levels.ts`; Delete: `shared/src/lines.ts`
- Test: `shared/test/lines.test.ts` → rename to `shared/test/levels.test.ts`

**Interfaces:**
- Produces: `LevelLine { itemId, name, category, level, kitSpec, added }`, `LogKind`, `TeamRef { slug, name }`, `LogEntry { id, at, who, itemId, itemName, kind, change, levelAfter, from, to, note }`, `TeamPage { team, spec, levels, recent }`, `AdminTeam.lastChange: string | null`; `kitSpecQty(spec: string | null, itemId: string): number`; `nzDateTime(iso): 'YYYY-MM-DD HH:MM'`; `whenLabel(iso): '11 Oct, 2:14 pm'`; `levelsText(total: number, kind: TeamKind): string`.

- [ ] **Step 1: Write the failing tests** — replace `shared/test/lines.test.ts` with `shared/test/levels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { kitSpecQty } from '../src/data';
import { dateLabel, nzDate, nzDateTime, whenLabel } from '../src/dates';
import { levelsText } from '../src/levels';

describe('levelsText', () => {
  it('totals a bag or a pool', () => {
    expect(levelsText(1, 'team')).toBe('1 item in this bag');
    expect(levelsText(68, 'team')).toBe('68 items in this bag');
    expect(levelsText(0, 'pool')).toBe('0 items in this pool');
  });
});

describe('kitSpecQty', () => {
  it('reads the Kit Spec column, 0 for pools and unknown items', () => {
    expect(kitSpecQty('Kiwi Y1', 'STU-03')).toBe(1);
    expect(kitSpecQty('Kiwi Y1', 'BAT-W2')).toBe(0);
    expect(kitSpecQty(null, 'STU-03')).toBe(0);
    expect(kitSpecQty('Nope', 'STU-03')).toBe(0);
  });
});

describe('dates', () => {
  it('uses the New Zealand calendar day and clock', () => {
    expect(nzDate(new Date('2026-10-08T12:30:00Z'))).toBe('2026-10-09');
    expect(dateLabel('2026-10-09')).toBe('9 Oct 2026');
    expect(nzDateTime('2026-10-11T01:14:00.000Z')).toBe('2026-10-11 14:14');
    expect(whenLabel('2026-10-11T01:14:00.000Z')).toBe('11 Oct, 2:14 pm');
    expect(whenLabel('2026-10-10T20:05:00.000Z')).toBe('11 Oct, 9:05 am');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run shared/test/levels.test.ts` → FAIL (`levelsText`, `kitSpecQty`, `nzDateTime`, `whenLabel` not exported).

- [ ] **Step 3: Implement.**

`shared/src/levels.ts`:
```ts
import type { TeamKind } from './types';

export function levelsText(total: number, kind: TeamKind) {
  return `${total} ${total === 1 ? 'item' : 'items'} in this ${kind === 'pool' ? 'pool' : 'bag'}`;
}
```
Delete `shared/src/lines.ts`.

Append to `shared/src/dates.ts`:
```ts
const nzClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const parts = (iso: string) => Object.fromEntries(nzClock.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));

/** ISO time → "2026-10-11 14:14" in New Zealand. */
export function nzDateTime(iso: string) {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** ISO time → "11 Oct, 2:14 pm" in New Zealand. */
export function whenLabel(iso: string) {
  const p = parts(iso);
  const h = Number(p.hour);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]}, ${h % 12 || 12}:${p.minute} ${h < 12 ? 'am' : 'pm'}`;
}
```

Append to `shared/src/data.ts`:
```ts
/** Kit Spec quantity for an item (0 when not in the column, or for a pool). */
export function kitSpecQty(spec: string | null, itemId: string): number {
  return spec === null ? 0 : (data.specs[spec]?.[itemId] ?? 0);
}
```

In `shared/src/types.ts`: delete `StocktakeRef`, `Line`, `Stocktake`; replace `TeamPage`; rename `AdminTeam.latest` → `lastChange` (doc: "ISO time of the latest log entry, or null"); add:
```ts
export interface LevelLine {
  itemId: string;
  name: string;
  category: string;
  level: number;
  /** Kit Spec quantity for this team (0 for added items and pools). */
  kitSpec: number;
  /** Listed with + Add item (not in the team's Kit Spec). */
  added: boolean;
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

export interface TeamPage {
  team: TeamSummary;
  /** Kit Spec column; null for a pool. */
  spec: string | null;
  /** Listed items in catalogue order. */
  levels: LevelLine[];
  /** Newest first, at most 50. */
  recent: LogEntry[];
}
```

In `docs/spec.md` §3.3 change the example `Migration · 10 Oct · Opening level Bails (pair) 4` to `Migration · 10 Oct, 9:31 am · Opening level Bails (pair) 4`.

- [ ] **Step 4: Run** `npx vitest run shared/test` → PASS. (`npm run typecheck` fails until later tasks — expected.)

- [ ] **Step 5: Commit** — `git add -A shared docs/spec.md && git commit -m "refactor(gear-counter): shared types and helpers for levels and log"`

---

### Task 2: Migration 0003 and its test

**Files:**
- Create: `scripts/levels_migration.py`, `migrations/0003_levels.sql` (generated), `api/test/migration.test.ts`
- Modify: `wrangler.test.jsonc`, `vitest.config.ts`, `api/test/env.d.ts`, `api/test/setup.ts`

**Interfaces:**
- Produces tables `levels(team_slug, item_id, level CHECK >= 0, added, updated_at, PK)` and `log(id INTEGER PRIMARY KEY AUTOINCREMENT, at, updated_at, team_slug, item_id, item_name, kind CHECK in (…), change, level_after, move_id, from_slug, to_slug, note, who)` with indexes `log_team (team_slug, id DESC)`, `log_team_item (team_slug, item_id, id DESC)`.

- [ ] **Step 1: Generator script** `scripts/levels_migration.py`:

```python
"""Write migrations/0003_levels.sql: stocktakes -> levels + log (see docs/spec.md §6).

The Kit Spec and catalogue come from shared/src/gear-data.json and are loaded into helper tables that the
migration drops again. Rerun only if gear-data.json changes before this migration is applied.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "shared/src/gear-data.json").read_text(encoding="utf-8"))
q = lambda v: "'" + str(v).replace("'", "''") + "'"

catalogue = ",\n".join(f"  ({q(i['id'])}, {q(i['name'])}, {n})" for n, i in enumerate(data["items"]))
kit = ",\n".join(f"  ({q(col)}, {q(item)}, {qty})" for col, items in data["specs"].items() for item, qty in items.items())

LATEST = """
  stocktakes s
  JOIN (SELECT team_slug, MAX(date) AS date FROM stocktakes GROUP BY team_slug) m ON m.team_slug = s.team_slug AND m.date = s.date
  JOIN lines l ON l.stocktake_id = s.id
  JOIN teams t ON t.slug = s.team_slug"""

sql = f"""-- Stocktakes become current levels plus a log of changes (docs/spec.md §6). Generated by scripts/levels_migration.py.
CREATE TABLE levels (
  team_slug TEXT NOT NULL,
  item_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
  added INTEGER NOT NULL DEFAULT 0 CHECK (added IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_slug, item_id)
);

CREATE TABLE log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  team_slug TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'adjust', 'move', 'count')),
  change INTEGER NOT NULL,
  level_after INTEGER NOT NULL,
  move_id TEXT,
  from_slug TEXT,
  to_slug TEXT,
  note TEXT,
  who TEXT NOT NULL
);
CREATE INDEX log_team ON log (team_slug, id DESC);
CREATE INDEX log_team_item ON log (team_slug, item_id, id DESC);

CREATE TABLE mig_catalogue (item_id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL);
INSERT INTO mig_catalogue (item_id, name, sort) VALUES
{catalogue};

CREATE TABLE mig_kit_spec (spec TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL);
INSERT INTO mig_kit_spec (spec, item_id, qty) VALUES
{kit};

-- 1. Each team's latest stocktake becomes its levels.
INSERT INTO levels (team_slug, item_id, level, added, updated_at)
SELECT s.team_slug, l.item_id, l.count, l.added, s.created_at FROM {LATEST};

-- 2. Kit Spec items (teams) and every item (pools) are always listed.
INSERT OR IGNORE INTO levels (team_slug, item_id, level, added, updated_at)
SELECT t.slug, k.item_id, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM teams t JOIN mig_kit_spec k ON k.spec = t.spec WHERE t.kind = 'team';
INSERT OR IGNORE INTO levels (team_slug, item_id, level, added, updated_at)
SELECT t.slug, c.item_id, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM teams t CROSS JOIN mig_catalogue c WHERE t.kind = 'pool';

-- 3. Opening log entries for every level above 0.
INSERT INTO log (at, updated_at, team_slug, item_id, item_name, kind, change, level_after, who)
SELECT s.created_at, s.created_at, s.team_slug, l.item_id, l.name, 'opening', l.count, l.count, 'Migration'
FROM {LATEST}
WHERE l.count > 0
ORDER BY s.created_at, s.team_slug, l.sort;

-- 4. Done with stocktakes.
DROP TABLE lines;
DROP TABLE stocktakes;
DROP TABLE mig_kit_spec;
DROP TABLE mig_catalogue;
"""
(ROOT / "migrations/0003_levels.sql").write_text(sql, encoding="utf-8", newline="\n")
print("wrote migrations/0003_levels.sql")
```

Run: `python scripts/levels_migration.py` → `wrote migrations/0003_levels.sql`.

- [ ] **Step 2: Second D1 for the migration test.** `wrangler.test.jsonc` `d1_databases` becomes:
```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "test", "database_id": "test" },
  { "binding": "MIGRATE_DB", "database_name": "migrate", "database_id": "migrate" }
]
```
`api/test/env.d.ts` adds `MIGRATE_DB: D1Database;` to the `Cloudflare.Env` interface.

- [ ] **Step 3: Reset between tests** — `api/test/setup.ts` `beforeEach` becomes:
```ts
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM log'),
    // Back to the seeded teams: drop ones a test added (and their levels), unhide the rest.
    env.DB.prepare("DELETE FROM teams WHERE created_at > '2026-10-09T00:00:00.000Z'"),
    env.DB.prepare('DELETE FROM levels WHERE team_slug NOT IN (SELECT slug FROM teams) OR added = 1'),
    env.DB.prepare('UPDATE levels SET level = 0'),
    env.DB.prepare('UPDATE teams SET hidden = 0'),
  ]);
});
```

- [ ] **Step 4: Write the failing migration test** `api/test/migration.test.ts`:
```ts
import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { items, specLines } from '../../shared/src/data';

const db = env.MIGRATE_DB;
const [init, teams, levels] = env.TEST_MIGRATIONS;

describe('0003_levels', () => {
  it('turns each latest stocktake into levels and opening log entries', async () => {
    await applyD1Migrations(db, [init, teams]);
    await db.batch([
      db.prepare("INSERT INTO teams (slug, name, kind, mascot, grade, spec, dot, sort, hidden, created_at) VALUES ('shed', 'Shed', 'pool', '', NULL, NULL, NULL, 20, 0, '2026-10-10T18:30:00.000Z')"),
      db.prepare("INSERT INTO stocktakes VALUES ('a', 'penguins', '2026-10-09', '2026-10-09T01:00:00.000Z'), ('b', 'penguins', '2026-10-10', '2026-10-10T02:00:00.000Z'), ('c', 'shed', '2026-10-10', '2026-10-10T19:00:00.000Z')"),
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
    expect(penguins?.n).toBe(specLines('Kiwi Y1').length + 1);
    const pumas = await db.prepare("SELECT COUNT(*) AS n, SUM(level) AS total FROM levels WHERE team_slug = 'pumas'").first<{ n: number; total: number }>();
    expect(pumas).toEqual({ n: specLines('Year 7').length, total: 0 }); // no stocktake
    const shed = await db.prepare("SELECT COUNT(*) AS n FROM levels WHERE team_slug = 'shed'").first<{ n: number }>();
    expect(shed?.n).toBe(items.length);
    expect(await level('shed', 'FLD-TC')).toEqual({ level: 5, added: 0 });

    const { results } = await db.prepare('SELECT team_slug, item_id, kind, change, level_after, who, at FROM log ORDER BY id').all();
    expect(results).toEqual([
      { team_slug: 'penguins', item_id: 'STU-03', kind: 'opening', change: 2, level_after: 2, who: 'Migration', at: '2026-10-10T02:00:00.000Z' },
      { team_slug: 'shed', item_id: 'FLD-TC', kind: 'opening', change: 5, level_after: 5, who: 'Migration', at: '2026-10-10T19:00:00.000Z' },
    ]);
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('stocktakes', 'lines', 'mig_kit_spec', 'mig_catalogue')").all();
    expect(tables.results).toEqual([]);
  });
});
```
(`FLD-TC` is Tall cones; `STU-03` Black rubber bases; `BAT-W2` Wooden bat S2 (softball) — all checked against `gear-data.json`.)

- [ ] **Step 5: Run** `npx vitest run api/test/migration.test.ts` → PASS once the migration is generated; `api/test/app.test.ts` and `admin.test.ts` now FAIL (stocktake tables gone) — fixed in Tasks 3–5.

- [ ] **Step 6: Commit** — `git add scripts/levels_migration.py migrations/0003_levels.sql api/test wrangler.test.jsonc && git commit -m "feat(gear-counter): migrate stocktakes to levels and log"`

---

### Task 3: Levels API — page, adjust with grouping, list/unlist, set count

**Files:**
- Create: `api/src/who.ts`, `api/src/levels.ts`, `api/test/levels.test.ts`
- Delete: `api/src/repo.ts`, `api/test/app.test.ts` (its team-list tests move into `levels.test.ts`)
- Modify: `api/src/app.ts`, `api/src/teams.ts` (export `TeamRow` already; add `getAnyTeam`)

**Interfaces:**
- Consumes: Task 1 types, `kitSpecQty`, `findItem`; `TeamRow` from `teams.ts`.
- Produces: `teamLevels(db, team): Promise<LevelLine[]>`, `adjust(db, team, itemId, delta, who, now): Promise<number>`, `listItem(db, team, itemId, now): Promise<LevelLine>`, `unlistItem(db, team, itemId): Promise<void>`, `setCount(db, team, itemId, level, who, note, now): Promise<number>`, `recent(db, slug, limit = 50): Promise<LogEntry[]>`, `itemName(itemId): string` (404 for unknown), `GROUP_MS`.

- [ ] **Step 1: Write the failing tests** `api/test/levels.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { specLines } from '../../shared/src/data';
import type { LevelLine, TeamPage, TeamSummary } from '../../shared/src/types';
import { client, testDeps, type Client } from './helpers';

const page = async (api: Client, slug: string) => (await (await api(`/teams/${slug}`)).json()) as TeamPage;
const adjust = (api: Client, slug: string, item: string, delta: unknown, who: unknown = 'Sam') =>
  api(`/teams/${slug}/items/${item}/adjust`, { method: 'POST', json: { delta, who } });
const count = (api: Client, slug: string, item: string, level: unknown, who = 'Sam', note?: string) =>
  api(`/teams/${slug}/items/${item}/count`, { method: 'POST', json: { level, who, note } });

describe('teams', () => {
  it('lists the visible teams, then pools', async () => {
    const teams = (await (await client()('/teams')).json()) as TeamSummary[];
    expect(teams).toHaveLength(28);
    expect(teams.at(-1)).toEqual({ slug: 'pool', name: 'Club pool', kind: 'pool', mascot: '', grade: null, dot: null });
    expect(teams.find((t) => t.slug === 'pumas')).toMatchObject({ kind: 'team', grade: 'Year 7', dot: 'green' });
  });

  it('shows a team its Kit Spec items in catalogue order with no changes yet', async () => {
    const p = await page(client(), 'penguins');
    expect(p.spec).toBe('Kiwi Y1');
    expect(p.levels.map((l) => l.itemId)).toEqual(specLines('Kiwi Y1').map((l) => l.item.id));
    expect(p.levels.find((l) => l.itemId === 'STU-03')).toEqual({
      itemId: 'STU-03', name: 'Black rubber bases', category: 'Stumps & Wickets', level: 0, kitSpec: 1, added: false,
    } satisfies LevelLine);
    expect(p.recent).toEqual([]);
  });

  it('shows a pool every item', async () => {
    expect((await page(client(), 'pool')).levels).toHaveLength(62);
  });

  it('404s an unknown team', async () => {
    expect((await client()('/teams/pumaz')).status).toBe(404);
  });
});

describe('adjust', () => {
  it('applies concurrent changes without losing any', async () => {
    const api = client();
    await Promise.all(Array.from({ length: 10 }, () => adjust(api, 'pumas', 'FLD-SCC', 1)));
    expect(await (await adjust(api, 'pumas', 'FLD-SCC', -3)).json()).toEqual({ level: 7 });
  });

  it('never goes below 0 and logs only what was applied', async () => {
    const api = client();
    await adjust(api, 'pumas', 'STU-04', 1, 'Jo');
    expect(await (await adjust(api, 'pumas', 'STU-04', -5)).json()).toEqual({ level: 0 });
    expect(await (await adjust(api, 'pumas', 'STU-04', -1)).json()).toEqual({ level: 0 });
    const { recent } = await page(api, 'pumas');
    expect(recent.map((e) => [e.who, e.change, e.levelAfter])).toEqual([['Sam', -1, 0], ['Jo', 1, 1]]);
  });

  it.each([0, 21, -21, 1.5, '1', null])('rejects delta %s', async (delta) => {
    expect((await adjust(client(), 'pumas', 'STU-04', delta)).status).toBe(400);
  });

  it.each([undefined, '', '   ', 'x'.repeat(41), 7])('requires a name (%s)', async (who) => {
    const res = await adjust(client(), 'pumas', 'STU-04', 1, who);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'name_required' });
  });

  it('404s an item that is not listed', async () => {
    expect((await adjust(client(), 'penguins', 'BAT-W2', 1)).status).toBe(404);
    expect((await adjust(client(), 'penguins', 'NOPE', 1)).status).toBe(404);
  });

  it('rate limits writes', async () => {
    const api = client(testDeps({ limit: async () => false }));
    expect((await adjust(api, 'pumas', 'STU-04', 1)).status).toBe(429);
    expect((await api('/teams/pumas')).status).toBe(200);
  });
});

describe('grouping', () => {
  const at = (t: string) => {
    let now = new Date(t);
    return { api: client(testDeps({ now: () => now })), set: (s: string) => (now = new Date(s)) };
  };

  it('merges one person’s taps on an item within 2 minutes', async () => {
    const { api, set } = at('2026-10-11T01:00:00Z');
    await adjust(api, 'pumas', 'STU-04', 1);
    set('2026-10-11T01:01:30Z');
    await adjust(api, 'pumas', 'STU-04', 1, 'sam'); // name compared case-insensitively
    set('2026-10-11T01:03:00Z'); // 90 s after the last tap: still grouped
    await adjust(api, 'pumas', 'STU-04', 1);
    const { recent } = await page(api, 'pumas');
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ kind: 'adjust', who: 'Sam', change: 3, levelAfter: 3, at: '2026-10-11T01:00:00.000Z' });
  });

  it('starts a new entry after 2 minutes, for another person, item or kind', async () => {
    const { api, set } = at('2026-10-11T01:00:00Z');
    await adjust(api, 'pumas', 'STU-04', 1);
    set('2026-10-11T01:02:01Z');
    await adjust(api, 'pumas', 'STU-04', 1); // > 2 min since the last tap
    await adjust(api, 'pumas', 'STU-04', 1, 'Jo'); // another person
    await adjust(api, 'pumas', 'FLD-SCC', 1, 'Jo'); // another item
    await count(api, 'pumas', 'STU-04', 5, 'Jo');
    await adjust(api, 'pumas', 'STU-04', 1, 'Jo'); // after a count
    const { recent } = await page(api, 'pumas');
    expect(recent.map((e) => [e.kind, e.who, e.itemId, e.change])).toEqual([
      ['adjust', 'Jo', 'STU-04', 1],
      ['count', 'Jo', 'STU-04', 2],
      ['adjust', 'Jo', 'FLD-SCC', 1],
      ['adjust', 'Jo', 'STU-04', 1],
      ['adjust', 'Sam', 'STU-04', 1],
      ['adjust', 'Sam', 'STU-04', 1],
    ]);
  });

  it('drops a group that nets to 0', async () => {
    const api = client();
    await adjust(api, 'pumas', 'STU-04', 2);
    await adjust(api, 'pumas', 'STU-04', -2);
    expect((await page(api, 'pumas')).recent).toEqual([]);
  });
});

describe('listing', () => {
  it('lists an added item at 0, idempotently, in catalogue order', async () => {
    const api = client();
    const res = await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    expect(await res.json()).toEqual({ itemId: 'BAT-W2', name: 'Wooden bat S2 (softball)', category: 'Bats', level: 0, kitSpec: 0, added: true });
    await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    const ids = (await page(api, 'penguins')).levels.map((l) => l.itemId);
    expect(ids.filter((id) => id === 'BAT-W2')).toHaveLength(1);
    expect(ids.indexOf('BAT-W2')).toBe(ids.indexOf('BAT-P4') + 1);
  });

  it('rejects unknown and excluded items', async () => {
    const api = client();
    expect((await api('/teams/pumas/items/MSC-BAG', { method: 'PUT', json: { who: 'Sam' } })).status).toBe(404);
    expect((await api('/teams/pumas/items/NOPE', { method: 'PUT', json: { who: 'Sam' } })).status).toBe(404);
  });

  it('unlists an added item only at 0, and never Kit Spec or pool items', async () => {
    const api = client();
    await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    await adjust(api, 'penguins', 'BAT-W2', 1);
    expect((await api('/teams/penguins/items/BAT-W2', { method: 'DELETE' })).status).toBe(409);
    await adjust(api, 'penguins', 'BAT-W2', -1);
    expect((await api('/teams/penguins/items/BAT-W2', { method: 'DELETE' })).status).toBe(204);
    expect((await api('/teams/penguins/items/BAT-W2', { method: 'DELETE' })).status).toBe(404);
    expect((await api('/teams/penguins/items/STU-03', { method: 'DELETE' })).status).toBe(409);
    expect((await api('/teams/pool/items/STU-03', { method: 'DELETE' })).status).toBe(409);
  });
});

describe('set count', () => {
  it('sets the level and logs old → new with the note', async () => {
    const api = client();
    await adjust(api, 'pumas', 'STU-04', 4);
    expect(await (await count(api, 'pumas', 'STU-04', 6, 'Jo', '  after the shed check ')).json()).toEqual({ level: 6 });
    const [entry] = (await page(api, 'pumas')).recent;
    expect(entry).toMatchObject({ kind: 'count', who: 'Jo', change: 2, levelAfter: 6, note: 'after the shed check', from: null, to: null });
  });

  it('writes nothing when the level is unchanged', async () => {
    const api = client();
    await count(api, 'pumas', 'STU-04', 0);
    expect((await page(api, 'pumas')).recent).toEqual([]);
  });

  it.each([-1, 1000, 2.5, '3'])('rejects level %s', async (level) => {
    expect((await count(client(), 'pumas', 'STU-04', level)).status).toBe(400);
  });

  it('rejects a note over 200 characters', async () => {
    expect((await count(client(), 'pumas', 'STU-04', 1, 'Sam', 'x'.repeat(201))).status).toBe(400);
  });
});

describe('recent changes', () => {
  it('returns the newest 50', async () => {
    const api = client();
    for (let i = 0; i < 26; i++) {
      await count(api, 'pumas', 'STU-04', i % 2 ? 0 : 1);
      await count(api, 'pumas', 'FLD-SCC', i % 2 ? 0 : 1);
    }
    const { recent } = await page(api, 'pumas');
    expect(recent).toHaveLength(50);
    expect(recent[0].id).toBeGreaterThan(recent[49].id);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run api/test/levels.test.ts` → FAIL (routes 404).

- [ ] **Step 3: `api/src/who.ts`:**
```ts
import { ApiError } from './errors';

export function parseWho(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 40) throw new ApiError(400, 'name_required', 'Tell us your name (up to 40 characters) before making changes.');
  return s;
}

export function parseNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.trim().length > 200) throw new ApiError(400, 'invalid_note', 'Notes can be up to 200 characters.');
  return v.trim() || null;
}
```

- [ ] **Step 4: `api/src/levels.ts`:**
```ts
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
```

- [ ] **Step 5: Routes in `api/src/app.ts`.** Remove the `repo` import, `ID`, `lineParams`, and the four stocktake routes and `POST /teams/:slug/stocktakes`. Add:
```ts
import { adjust, listItem, recent, setCount, teamLevels, unlistItem } from './levels';
import { parseNote, parseWho } from './who';

const ITEM = /^[A-Z0-9-]{1,20}$/;
const Adjust = v.object({ delta: v.pipe(v.number(), v.integer(), v.minValue(-20), v.maxValue(20), v.check((n) => n !== 0)) });
const Count = v.object({ level: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(999)) });

function item(id: string) {
  if (!ITEM.test(id)) throw new ApiError(404, 'item_not_found', 'Unknown item.');
  return id;
}
const body = async (c: { req: { json: () => Promise<unknown> } }) => ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
```
Routes (inside `createApp`, replacing the old ones):
```ts
  app.get('/teams/:slug', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    const page: TeamPage = { team: summary(t), spec: t.spec, levels: await teamLevels(c.env.DB, t), recent: await recent(c.env.DB, t.slug) };
    return c.json(page);
  });

  app.post('/teams/:slug/items/:item/adjust', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    const b = await body(c);
    const parsed = v.safeParse(Adjust, b);
    if (!parsed.success) throw new ApiError(400, 'invalid_delta', 'delta must be a whole number from -20 to 20, not 0.');
    const who = parseWho(b.who);
    return c.json({ level: await adjust(c.env.DB, t, item(c.req.param('item')), parsed.output.delta, who, deps.now()) });
  });

  app.put('/teams/:slug/items/:item', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    parseWho((await body(c)).who);
    return c.json(await listItem(c.env.DB, t, item(c.req.param('item')), deps.now()));
  });

  app.delete('/teams/:slug/items/:item', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    await unlistItem(c.env.DB, t, item(c.req.param('item')));
    return c.body(null, 204);
  });

  app.post('/teams/:slug/items/:item/count', async (c) => {
    const t = await getTeam(c.env.DB, c.req.param('slug'));
    const b = await body(c);
    const parsed = v.safeParse(Count, b);
    if (!parsed.success) throw new ApiError(400, 'invalid_level', 'level must be a whole number from 0 to 999.');
    const who = parseWho(b.who);
    const note = parseNote(b.note);
    return c.json({ level: await setCount(c.env.DB, t, item(c.req.param('item')), parsed.output.level, who, note, deps.now()) });
  });
```
Delete `api/src/repo.ts` and `api/test/app.test.ts`.

- [ ] **Step 6: Run** `npx vitest run api/test/levels.test.ts api/test/migration.test.ts shared` → PASS.

- [ ] **Step 7: Commit** — `git commit -am "feat(gear-counter): levels API with grouped adjust log, listing and set count"` (plus `git add` for new files).

---

### Task 4: Moves

**Files:**
- Modify: `api/src/levels.ts` (add `move`), `api/src/app.ts` (route), `api/src/teams.ts` (none)
- Create: `api/test/moves.test.ts`

**Interfaces:**
- Produces: `move(db, from: TeamRow, to: TeamRow, itemId, qty, who, note, moveId, now): Promise<{ fromLevel: number; toLevel: number }>`; route `POST /moves`.

- [ ] **Step 1: Failing tests** `api/test/moves.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { TeamPage } from '../../shared/src/types';
import { client, type Client } from './helpers';

const page = async (api: Client, slug: string) => (await (await api(`/teams/${slug}`)).json()) as TeamPage;
const level = async (api: Client, slug: string, item: string) => (await page(api, slug)).levels.find((l) => l.itemId === item);
const move = (api: Client, b: Record<string, unknown>) => api('/moves', { method: 'POST', json: { who: 'Jo', ...b } });
const setLevel = (api: Client, slug: string, item: string, n: number) => api(`/teams/${slug}/items/${item}/count`, { method: 'POST', json: { level: n, who: 'Sam' } });

describe('moves', () => {
  it('moves gear between a pool and a team, listing it there, with paired log entries', async () => {
    const api = client();
    await setLevel(api, 'pool', 'BAT-W2', 5);
    const res = await move(api, { from: 'pool', to: 'penguins', item: 'BAT-W2', qty: 3, note: ' for Saturday ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fromLevel: 2, toLevel: 3 });
    expect(await level(api, 'penguins', 'BAT-W2')).toMatchObject({ level: 3, added: true });

    const [out] = (await page(api, 'pool')).recent;
    expect(out).toMatchObject({ kind: 'move', who: 'Jo', change: -3, levelAfter: 2, to: { slug: 'penguins', name: 'Parklands Penguins' }, from: null, note: 'for Saturday' });
    const [inn] = (await page(api, 'penguins')).recent;
    expect(inn).toMatchObject({ kind: 'move', change: 3, levelAfter: 3, from: { slug: 'pool', name: 'Club pool' }, to: null, note: 'for Saturday' });
  });

  it('adds to an existing level', async () => {
    const api = client();
    await setLevel(api, 'pumas', 'STU-04', 2);
    await setLevel(api, 'tigers', 'STU-04', 1);
    expect(await (await move(api, { from: 'pumas', to: 'tigers', item: 'STU-04', qty: 2 })).json()).toEqual({ fromLevel: 0, toLevel: 3 });
  });

  it('refuses when the source is short, changing nothing', async () => {
    const api = client();
    await setLevel(api, 'pool', 'BAT-W2', 2);
    const res = await move(api, { from: 'pool', to: 'penguins', item: 'BAT-W2', qty: 3 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_enough', message: 'Only 2 available.' });
    expect(await level(api, 'pool', 'BAT-W2')).toMatchObject({ level: 2 });
    expect(await level(api, 'penguins', 'BAT-W2')).toBeUndefined();
    expect((await page(api, 'penguins')).recent).toEqual([]);
  });

  it('refuses when the source does not list the item', async () => {
    const api = client();
    const res = await move(api, { from: 'penguins', to: 'pool', item: 'BAT-W2', qty: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ message: 'Only 0 available.' });
    expect(await level(api, 'pool', 'BAT-W2')).toMatchObject({ level: 0 });
  });

  it('refuses the same team, hidden teams and bad input', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 5);
    expect((await move(api, { from: 'pool', to: 'pool', item: 'STU-04', qty: 1 })).status).toBe(400);
    await api('/admin/teams/pumas', { method: 'PATCH', headers: { 'x-admin-passcode': 'test-passcode', 'content-type': 'application/json' }, body: '{"hidden":true}' });
    expect((await move(api, { from: 'pool', to: 'pumas', item: 'STU-04', qty: 1 })).status).toBe(404);
    for (const qty of [0, 1000, 1.5, '2']) expect((await move(api, { from: 'pool', to: 'tigers', item: 'STU-04', qty })).status).toBe(400);
    expect((await move(api, { from: 'pool', to: 'tigers', item: 'NOPE', qty: 1 })).status).toBe(404);
    expect((await move(api, { from: 'pool', to: 'tigers', item: 'STU-04', qty: 1, who: '' })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run api/test/moves.test.ts` → FAIL.

- [ ] **Step 3: Implement** — append to `api/src/levels.ts`:
```ts
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
```

Route in `api/src/app.ts`:
```ts
const Move = v.object({
  from: v.string(), to: v.string(), item: v.string(),
  qty: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(999)),
});

  app.post('/moves', async (c) => {
    const b = await body(c);
    const parsed = v.safeParse(Move, b);
    if (!parsed.success) throw new ApiError(400, 'invalid_move', 'Choose where to move it and a quantity from 1 to 999.');
    const who = parseWho(b.who);
    const note = parseNote(b.note);
    const [from, to] = await Promise.all([getTeam(c.env.DB, parsed.output.from), getTeam(c.env.DB, parsed.output.to)]);
    return c.json(await move(c.env.DB, from, to, item(parsed.output.item), parsed.output.qty, who, note, deps.id(), deps.now()));
  });
```

- [ ] **Step 4: Run** `npx vitest run api/test/moves.test.ts api/test/levels.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A api && git commit -m "feat(gear-counter): atomic moves between teams and pools"`

---

### Task 5: Admin teams and CSV exports

**Files:**
- Modify: `api/src/teams.ts`, `api/src/exports.ts`, `api/src/admin.ts`, `api/test/admin.test.ts`

**Interfaces:**
- Consumes: `teamLevels`, `LOG_SELECT`, `toEntry` (Task 3); `nzDate`, `nzDateTime` (Task 1).
- Produces: `getAnyTeam(db, slug): Promise<TeamRow>` (hidden included); `adminTeams` returns `lastChange`; `clubCsv(db)`, `levelsCsv(db, team)`, `logCsv(db, slug?)`; routes `/admin/export/teams/:slug.csv`, `/admin/export/log.csv?team=`.

- [ ] **Step 1: Update tests** in `api/test/admin.test.ts`:
  - Replace helpers `open`/`adjust` with:
    ```ts
    const adjust = (api: Client, slug: string, item: string, delta: number, who = 'Sam') =>
      api(`/teams/${slug}/items/${item}/adjust`, { method: 'POST', json: { delta, who } });
    ```
  - "lists every team…" → after `await adjust(api, 'lions', 'STU-03', 1)` expect `lions` `{ grade: 'Kiwi Year 1/2', spec: 'Kiwi Y1', hidden: false }` and `lastChange` matching `/^2026-10-09T03:00:00/`; `pumas.lastChange` null.
  - "adds a pool…" → replace `open(api,'shed')` with `expect(((await (await api('/teams/shed')).json()) as TeamPage).levels).toHaveLength(62)`.
  - "adds a team…" → `expect(((await (await api('/teams/seals')).json()) as TeamPage).levels.length).toBeGreaterThan(0)`.
  - "hides a team…" → drop the stocktake lines; after hiding expect `/teams/lions` 404 and `adjust(api,'lions','STU-03',1)` 404; after unhide 200.
  - Replace the whole `describe('CSV exports')` with:
    ```ts
    describe('CSV exports', () => {
      it('builds the club inventory from current levels', async () => {
        const api = client();
        await adjust(api, 'lions', 'STU-03', 2);
        await adjust(api, 'pool', 'STU-03', 5);
        await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
        await addPool(api, '=Shed, "north"', 'shed');
        await admin(api, '/teams/pumas', { method: 'PATCH', json: { hidden: true } });
        const res = await admin(api, '/export/club.csv');
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="club-inventory-2026-10-09.csv"');
        const rows = await csvRows(res);
        const header = rows[0].split(',');
        expect(header.slice(0, 3)).toEqual(['Category', 'Item', 'Club total']);
        expect(header).toContain('Parklands Pumas (hidden)');
        expect(rows[0].endsWith(`Club pool,"'=Shed, ""north"""`)).toBe(true);
        expect(rows[1].split(',')[0]).toBe('Last change');
        expect(rows[1].split(',')[header.indexOf('Parklands Lions')]).toBe('2026-10-09');
        expect(rows[1].split(',')[header.indexOf('Parklands Bears')]).toBe('');
        expect(rows).toHaveLength(2 + 62);
        const bases = rows.find((r) => r.startsWith('Stumps & Wickets,Black rubber bases,'))!.split(',');
        expect(bases[2]).toBe('7');
        expect(bases[header.indexOf('Parklands Lions')]).toBe('2');
        expect(bases[header.indexOf('Parklands Pumas (hidden)')]).toBe(''); // not in the Year 7 Kit Spec
        const bat = rows.find((r) => r.startsWith('Bats,Wooden bat S2 (softball),'))!.split(',');
        expect(bat[header.indexOf('Parklands Penguins')]).toBe('0');
        expect(bat[header.indexOf('Parklands Lions')]).toBe('');
      });

      it('downloads one team’s levels', async () => {
        const api = client();
        await adjust(api, 'penguins', 'STU-03', 3);
        await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
        const res = await admin(api, '/export/teams/penguins.csv');
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="penguins-levels-2026-10-09.csv"');
        const rows = await csvRows(res);
        expect(rows[0]).toBe('Category,Item,Level,Kit Spec,Listed');
        expect(rows).toContain('Stumps & Wickets,Black rubber bases,3,1,Kit Spec');
        expect(rows).toContain('Bats,Wooden bat S2 (softball),0,,Added');
        expect(rows).toHaveLength(1 + 15);
      });

      it('downloads the log, all teams or one, newest first, in NZ time', async () => {
        let now = new Date('2026-10-11T01:14:00Z');
        const api = client(testDeps({ now: () => now }));
        await adjust(api, 'pool', 'STU-03', 5, 'Jo');
        now = new Date('2026-10-11T01:20:00Z');
        await api('/moves', { method: 'POST', json: { from: 'pool', to: 'lions', item: 'STU-03', qty: 2, who: 'Jo', note: 'for Sat' } });
        await adjust(api, 'pumas', 'STU-04', 1, '=Sam');

        const all = await admin(api, '/export/log.csv');
        expect(all.headers.get('content-disposition')).toBe('attachment; filename="gear-log-2026-10-11.csv"');
        const rows = await csvRows(all);
        expect(rows[0]).toBe('When,Who,Team,Item,Kind,Change,Level after,From,To,Note');
        expect(rows.slice(1)).toEqual([
          "2026-10-11 14:20,'=Sam,Parklands Pumas,Bails (pair),Adjust,1,1,,,",
          '2026-10-11 14:20,Jo,Parklands Lions,Black rubber bases,Move in,2,2,Club pool,,for Sat',
          '2026-10-11 14:20,Jo,Club pool,Black rubber bases,Move out,-2,3,,Parklands Lions,for Sat',
          '2026-10-11 14:14,Jo,Club pool,Black rubber bases,Adjust,5,5,,,',
        ]);
        const one = await admin(api, '/export/log.csv?team=lions');
        expect(one.headers.get('content-disposition')).toBe('attachment; filename="lions-log-2026-10-11.csv"');
        expect(await csvRows(one)).toHaveLength(2);
        expect((await admin(api, '/export/log.csv?team=nobody')).status).toBe(404);
      });

      it('404s a bad levels file name', async () => {
        expect((await admin(client(), '/export/teams/bears.txt')).status).toBe(404);
        expect((await admin(client(), '/export/teams/nobody.csv')).status).toBe(404);
      });
    });
    ```
  Note the move rows: "Move in" (id higher) is listed before "Move out" because both share a time and the log is ordered by `id DESC`.

- [ ] **Step 2: Run** `npx vitest run api/test/admin.test.ts` → FAIL.

- [ ] **Step 3: `api/src/teams.ts`.**
  - Add:
    ```ts
    /** Any team or pool, hidden included, else 404. */
    export async function getAnyTeam(db: D1Database, slug: string): Promise<TeamRow> {
      const row = await db.prepare('SELECT * FROM teams WHERE slug = ?').bind(slug.toLowerCase()).first<TeamRow>();
      if (!row) throw new ApiError(404, 'team_not_found', 'Team not found.');
      return row;
    }
    ```
  - In `adminTeams`, replace the `latest` subquery with `(SELECT MAX(at) FROM log g WHERE g.team_slug = t.slug) AS last_change`, and map `lastChange: r.last_change` (rename the row type field accordingly; drop `latest`).
  - In `addTeam`, after the `INSERT INTO teams`, list its items:
    ```ts
    const at = now.toISOString();
    await db.batch(
      specLines(t.spec).map(({ item }) =>
        db.prepare('INSERT OR IGNORE INTO levels (team_slug, item_id, level, added, updated_at) VALUES (?, ?, 0, 0, ?)').bind(t.slug, item.id, at),
      ),
    );
    ```
    (import `specLines` from shared data).

- [ ] **Step 4: `api/src/exports.ts`** (replace the file):
```ts
import { items } from '../../shared/src/data';
import { nzDate, nzDateTime } from '../../shared/src/dates';
import type { LogEntry } from '../../shared/src/types';
import { toCsv, type Cell } from './csv';
import { LOG_SELECT, teamLevels, toEntry } from './levels';
import { listTeams, type TeamRow } from './teams';

/** One row per catalogue item, a column per team/pool (hidden ones marked), current levels. */
export async function clubCsv(db: D1Database): Promise<string> {
  const teams = await listTeams(db, true);
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
  for (const item of items) {
    const cells = teams.map((t) => level.get(`${t.slug}|${item.id}`));
    rows.push([item.category, item.name, cells.reduce<number>((n, c) => n + (c ?? 0), 0), ...cells]);
  }
  return toCsv(rows);
}

export async function levelsCsv(db: D1Database, team: TeamRow): Promise<string> {
  const lines = await teamLevels(db, team);
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
```
Note `levelsCsv` writes the Kit Spec quantity blank when 0 (pools and added items), so the expected row `Bats,Wooden bat S2 (softball),0,,Added` holds.

- [ ] **Step 5: `api/src/admin.ts`** — replace the two export routes:
```ts
  app.get('/admin/export/club.csv', async (c) => {
    await requireAdmin(c);
    return csvResponse(await clubCsv(c.env.DB), `club-inventory-${nzDate(c.get('deps').now())}.csv`);
  });

  app.get('/admin/export/log.csv', async (c) => {
    await requireAdmin(c);
    const slug = c.req.query('team');
    if (slug) await getAnyTeam(c.env.DB, slug);
    const day = nzDate(c.get('deps').now());
    return csvResponse(await logCsv(c.env.DB, slug), slug ? `${slug}-log-${day}.csv` : `gear-log-${day}.csv`);
  });

  app.get('/admin/export/teams/:file', async (c) => {
    await requireAdmin(c);
    const slug = /^([a-z][a-z0-9-]{1,29})\.csv$/.exec(c.req.param('file'))?.[1];
    if (!slug) throw new ApiError(404, 'not_found', 'Not found.');
    const team = await getAnyTeam(c.env.DB, slug);
    return csvResponse(await levelsCsv(c.env.DB, team), `${slug}-levels-${nzDate(c.get('deps').now())}.csv`);
  });
```
Register `/admin/export/log.csv` before `/admin/export/teams/:file` (order does not clash, but keep it readable). Update imports.

- [ ] **Step 6: Run** `npm test` → all PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit** — `git add -A api && git commit -m "feat(gear-counter): admin exports for levels and the change log"`

---

### Task 6: Web — name, sync queue v2, API client

**Files:**
- Create: `web/src/lib/who.svelte.ts`, `web/src/lib/NameModal.svelte`
- Modify: `web/src/lib/sync.svelte.ts`, `web/src/lib/api.ts`
- Delete: `web/src/lib/draft.ts`

**Interfaces:**
- Produces: `me` (`$state({ name })`), `setName(name)`; `<NameModal bind:open />`; `queue.add(team, item, delta)`, `queue.pendingFor(team, item)`, `queue.hasPending(team)`, `queue.onLevel(team, item, level)`, `queue.onIdle(team)`; `api().team(slug)`, `adjust(team, item, delta, who)`, `list(team, item, who)`, `unlist(team, item)`, `count(team, item, level, who, note)`, `move({ from, to, item, qty, who, note })`.

- [ ] **Step 1: `web/src/lib/who.svelte.ts`:**
```ts
const KEY = 'pcc-gear-name';

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** The name recorded against this browser's changes (spec §3.1). Empty until asked. */
export const me = $state({ name: read() });

export function setName(name: string) {
  me.name = name.trim().slice(0, 40);
  try {
    localStorage.setItem(KEY, me.name);
  } catch {
    // Storage blocked: the name lasts for this page only.
  }
}
```

- [ ] **Step 2: `web/src/lib/NameModal.svelte`:**
```svelte
<script lang="ts">
  import { me, setName } from './who.svelte';

  /** Set true to change the name; the modal also opens by itself while no name is stored. */
  let { open = $bindable(false) }: { open?: boolean } = $props();
  let dialog = $state<HTMLDialogElement>();
  let value = $state('');

  $effect(() => {
    if ((open || !me.name) && dialog && !dialog.open) {
      value = me.name;
      dialog.showModal();
    }
  });

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setName(value);
    open = false;
    dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  class="modal"
  aria-labelledby="name-title"
  oncancel={(e) => {
    if (!me.name) e.preventDefault(); // can't be skipped
    else open = false;
  }}
>
  <form class="modal-body" onsubmit={save}>
    <h2 id="name-title">What's your name?</h2>
    <p class="note">It's saved on this device and shown next to the changes you make.</p>
    <label class="field" for="who">Your name</label>
    <input id="who" type="text" maxlength="40" autocomplete="name" required bind:value />
    <p><button class="btn">Save</button></p>
  </form>
</dialog>
```

- [ ] **Step 3: `web/src/lib/sync.svelte.ts`** (replace the file):
```ts
import { api, isTransient } from './api';
import { me } from './who.svelte';

const KEY = 'pcc-gear-pending-v2';
const OLD_KEY = 'pcc-gear-pending-v1';
const RETRY_MS = 4000;
const MAX_STEP = 20; // the API's largest single change

// team|item|who — the name is part of the key so taps keep the name they were made under.
const keyOf = (team: string, item: string, who: string) => `${team}|${item}|${who}`;

function load(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Taps not yet confirmed by the server, as a net change per team, item and name. Kept in localStorage so a
 * reload or lost signal loses nothing; sent one at a time and retried until they land.
 */
class SyncQueue {
  pending = $state<Record<string, number>>({});
  offline = $state(false);
  error = $state('');
  /** Called with the server's level after each change lands. */
  onLevel: ((team: string, item: string, level: number) => void) | null = null;
  /** Called when a team has nothing left to send. */
  onIdle: ((team: string) => void) | null = null;
  #running = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    if (typeof window === 'undefined') return;
    this.pending = load();
    try {
      // Taps queued by the old stocktake version can't be sent any more (spec §7).
      const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? '{}');
      if (old && Object.keys(old).length) this.error = 'Some changes made before the last update could not be saved — please check those levels.';
      localStorage.removeItem(OLD_KEY);
    } catch {
      // ignore
    }
    addEventListener('online', () => void this.flush());
    queueMicrotask(() => void this.flush());
  }

  pendingFor(team: string, item: string) {
    const prefix = `${team}|${item}|`;
    return Object.entries(this.pending).reduce((n, [k, v]) => (k.startsWith(prefix) ? n + v : n), 0);
  }

  hasPending(team: string) {
    return Object.keys(this.pending).some((k) => k.startsWith(`${team}|`));
  }

  add(team: string, item: string, delta: number) {
    this.error = '';
    this.#change(keyOf(team, item, me.name), delta);
    void this.flush();
  }

  #change(key: string, delta: number) {
    const next = (this.pending[key] ?? 0) + delta;
    if (next) this.pending[key] = next;
    else delete this.pending[key];
    try {
      localStorage.setItem(KEY, JSON.stringify(this.pending));
    } catch {
      // Private mode or storage full: the queue still works for this page.
    }
  }

  async flush() {
    if (this.#running) return;
    this.#running = true;
    clearTimeout(this.#timer);
    try {
      for (let key = Object.keys(this.pending)[0]; key; key = Object.keys(this.pending)[0]) {
        const [team, item, who] = key.split('|');
        const total = this.pending[key];
        const delta = Math.max(-MAX_STEP, Math.min(MAX_STEP, total));
        try {
          const { level } = await api().adjust(team, item, delta, who);
          this.#change(key, -delta);
          this.offline = false;
          this.onLevel?.(team, item, level);
        } catch (e) {
          if (isTransient(e)) {
            this.offline = true;
            this.#timer = setTimeout(() => void this.flush(), RETRY_MS);
            return;
          }
          // The item or team is gone, or the name was refused: these taps can never land.
          this.#change(key, -total);
          this.error = e instanceof Error ? e.message : 'A change could not be saved.';
        }
        if (!this.hasPending(team)) this.onIdle?.(team);
      }
    } finally {
      this.#running = false;
    }
  }
}

export const queue = new SyncQueue();
```

- [ ] **Step 4: `web/src/lib/api.ts`** — replace the returned object:
```ts
  const item = (team: string, id: string) => `/teams/${encodeURIComponent(team)}/items/${encodeURIComponent(id)}`;
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return {
    teams: () => req<TeamSummary[]>('/teams'),
    team: (slug: string) => req<TeamPage>(`/teams/${encodeURIComponent(slug)}`),
    adjust: (team: string, id: string, delta: number, who: string) => req<{ level: number }>(`${item(team, id)}/adjust`, json('POST', { delta, who })),
    list: (team: string, id: string, who: string) => req<LevelLine>(item(team, id), json('PUT', { who })),
    unlist: (team: string, id: string) => req<null>(item(team, id), { method: 'DELETE' }),
    count: (team: string, id: string, level: number, who: string, note: string) =>
      req<{ level: number }>(`${item(team, id)}/count`, json('POST', { level, who, note })),
    move: (b: { from: string; to: string; item: string; qty: number; who: string; note: string }) =>
      req<{ fromLevel: number; toLevel: number }>('/moves', json('POST', b)),
  };
```
Update the type import to `ApiErrorBody, LevelLine, TeamPage, TeamSummary`. Delete `web/src/lib/draft.ts`.

- [ ] **Step 5: Check** `npm --prefix web run check` — errors remain only in `routes/[team]` (Task 7). Commit — `git add -A web/src/lib && git commit -m "feat(gear-counter): name store, queue v2 and API client for levels"`

---

### Task 7: Web — team/pool page, item dialog, recent changes

**Files:**
- Create: `web/src/lib/ItemDialog.svelte`, `web/src/lib/RecentChanges.svelte`
- Modify: `web/src/routes/[team]/+page.ts`, `web/src/routes/[team]/+page.svelte`, `web/src/routes/+page.svelte`, `web/src/lib/styles/app.css`

**Interfaces:**
- Consumes: Task 6 `queue`, `api`, `me`, `NameModal`; `whenLabel`, `levelsText`.

- [ ] **Step 1: `web/src/routes/[team]/+page.ts`:**
```ts
import { error } from '@sveltejs/kit';
import { api, ApiFailure } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const a = api(fetch);
  try {
    const [page, teams] = await Promise.all([a.team(params.team), a.teams()]);
    return { page, teams };
  } catch (e) {
    if (e instanceof ApiFailure) error(e.status === 404 ? 404 : e.status || 503, e.message);
    throw e;
  }
};
```

- [ ] **Step 2: `web/src/lib/RecentChanges.svelte`:**
```svelte
<script lang="ts">
  import { whenLabel } from '$shared/dates';
  import type { LogEntry } from '$shared/types';

  let { entries }: { entries: LogEntry[] } = $props();

  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  function what(e: LogEntry) {
    switch (e.kind) {
      case 'opening':
        return `Opening level ${e.itemName} ${e.levelAfter}`;
      case 'adjust':
        return `${e.itemName} ${signed(e.change)}`;
      case 'count':
        return `Set ${e.itemName} ${e.levelAfter - e.change} → ${e.levelAfter}`;
      case 'move':
        return e.change < 0 ? `Moved ${-e.change} ${e.itemName} to ${e.to?.name ?? '?'}` : `Received ${e.change} ${e.itemName} from ${e.from?.name ?? '?'}`;
    }
  }
</script>

<section class="recent" aria-labelledby="recent-title">
  <h2 id="recent-title">Recent changes</h2>
  {#if entries.length}
    <ul class="log">
      {#each entries as e (e.id)}
        <li>
          <strong>{e.who}</strong> · <time datetime={e.at}>{whenLabel(e.at)}</time> · {what(e)}{#if e.note}<span class="log-note"> · “{e.note}”</span>{/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="note">No changes yet.</p>
  {/if}
</section>
```

- [ ] **Step 3: `web/src/lib/ItemDialog.svelte`:**
```svelte
<script lang="ts">
  import type { LevelLine, TeamSummary } from '$shared/types';
  import { api } from './api';
  import { me } from './who.svelte';

  let {
    team,
    teams,
    line,
    onclose,
    ondone,
  }: { team: TeamSummary; teams: TeamSummary[]; line: LevelLine; onclose: () => void; ondone: (message: string) => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let mode = $state<'menu' | 'move' | 'count'>('menu');
  let to = $state('');
  let qty = $state(1);
  let level = $state(0);
  let note = $state('');
  let error = $state('');
  let busy = $state(false);
  const others = $derived(teams.filter((t) => t.slug !== team.slug));

  $effect(() => {
    level = line.level;
    dialog?.showModal();
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      if (mode === 'move') {
        const dest = others.find((t) => t.slug === to);
        await api().move({ from: team.slug, to, item: line.itemId, qty, who: me.name, note });
        ondone(`Moved ${qty} ${line.name} to ${dest?.name ?? to}.`);
      } else {
        await api().count(team.slug, line.itemId, level, me.name, note);
        ondone(`${line.name} set to ${level}.`);
      }
      dialog?.close();
    } catch (err) {
      error = err instanceof Error ? err.message : 'That did not save.';
    } finally {
      busy = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="modal" aria-labelledby="item-title" onclose={onclose} onclick={(e) => e.target === dialog && dialog?.close()}>
  <form class="modal-body" onsubmit={submit}>
    <div class="modal-head">
      <h2 id="item-title">{line.name}</h2>
      <button type="button" class="icon-btn" aria-label="Close" onclick={() => dialog?.close()}>✕</button>
    </div>
    <p class="note">{line.level} in {team.name}</p>
    {#if mode === 'menu'}
      <p><button type="button" class="btn wide" disabled={line.level === 0} onclick={() => (mode = 'move')}>Move…</button></p>
      <p><button type="button" class="btn wide" onclick={() => (mode = 'count')}>Set count…</button></p>
    {:else}
      {#if mode === 'move'}
        <label class="field" for="move-to">Move to</label>
        <select id="move-to" required bind:value={to}>
          <option value="" disabled>Choose…</option>
          {#each others as t (t.slug)}<option value={t.slug}>{t.name}</option>{/each}
        </select>
        <label class="field" for="move-qty">How many</label>
        <input id="move-qty" type="number" inputmode="numeric" min="1" max={line.level} required bind:value={qty} />
      {:else}
        <label class="field" for="count-level">Count</label>
        <input id="count-level" type="number" inputmode="numeric" min="0" max="999" required bind:value={level} />
      {/if}
      <label class="field" for="item-note">Note (optional)</label>
      <input id="item-note" type="text" maxlength="200" bind:value={note} />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <p><button class="btn" disabled={busy}>{mode === 'move' ? 'Move' : 'Save'}</button></p>
    {/if}
  </form>
</dialog>
```
Add to `app.css` `input[type='number']` to the shared input selector list, plus:
```css
.btn.wide { width: 100%; }
.step.more { border-color: var(--pcc-grey-300); font-size: 1.1rem; }
.recent { margin: 28px 0 16px; }
.log { list-style: none; margin: 0; padding: 0; background: var(--pcc-surface); border: 1px solid var(--pcc-grey-300); border-radius: var(--radius); }
.log li { padding: 8px 12px; border-top: 1px solid var(--pcc-grey-300); font-size: 0.9rem; }
.log li:first-child { border-top: 0; }
.log-note { color: var(--pcc-grey-600); }
.who-line { margin: 4px 0 0; color: #fff; font-size: 0.9rem; }
.who-line button { background: none; border: 0; padding: 0; color: var(--pcc-teal-400); font: inherit; text-decoration: underline; cursor: pointer; }
```

- [ ] **Step 4: `web/src/routes/[team]/+page.svelte`** (replace the file):
```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { items } from '$shared/data';
  import { levelsText } from '$shared/levels';
  import type { LevelLine } from '$shared/types';
  import AddItem from '$lib/AddItem.svelte';
  import { api } from '$lib/api';
  import Dot from '$lib/Dot.svelte';
  import ItemDialog from '$lib/ItemDialog.svelte';
  import Mascot from '$lib/Mascot.svelte';
  import NameModal from '$lib/NameModal.svelte';
  import RecentChanges from '$lib/RecentChanges.svelte';
  import { queue } from '$lib/sync.svelte';
  import { me } from '$lib/who.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const ORDER = new Map(items.map((i, n) => [i.id, n]));
  const team = $derived(data.page.team);
  let levels = $derived<LevelLine[]>(data.page.levels);
  let message = $state('');
  let notice = $state('');
  let renaming = $state(false);
  let active = $state<LevelLine | null>(null);

  const shown = (l: LevelLine) => Math.max(0, l.level + queue.pendingFor(team.slug, l.itemId));
  const lines = $derived(levels.map((l) => ({ ...l, level: shown(l) })));
  const groups = $derived(
    lines.reduce<{ category: string; lines: LevelLine[] }[]>((gs, l) => {
      const last = gs.at(-1);
      if (last?.category === l.category) last.lines.push(l);
      else gs.push({ category: l.category, lines: [l] });
      return gs;
    }, []),
  );
  const total = $derived(lines.reduce((n, l) => n + l.level, 0));
  const have = $derived(new Set(levels.map((l) => l.itemId)));
  const saving = $derived(queue.hasPending(team.slug));

  const refresh = () => invalidateAll();

  $effect(() => {
    const slug = team.slug;
    queue.onLevel = (t, item, level) => {
      if (t === slug) levels = levels.map((l) => (l.itemId === item ? { ...l, level } : l));
    };
    queue.onIdle = (t) => {
      if (t === slug) void refresh(); // pick up the grouped log entry
    };
    return () => {
      queue.onLevel = null;
      queue.onIdle = null;
    };
  });

  // Pick up other people's changes when the page comes back into view.
  $effect(() => {
    const slug = team.slug;
    const onShow = () => {
      if (document.visibilityState === 'visible' && !queue.hasPending(slug)) void refresh().catch(() => {});
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  });

  function tap(l: LevelLine, delta: 1 | -1) {
    if (!me.name) return; // the name modal is open
    if (delta < 0 && shown(l) === 0) return;
    notice = '';
    queue.add(team.slug, l.itemId, delta);
  }

  async function add(itemId: string) {
    message = '';
    try {
      const line = await api().list(team.slug, itemId, me.name);
      levels = [...levels.filter((l) => l.itemId !== itemId), line].sort((a, b) => (ORDER.get(a.itemId) ?? Infinity) - (ORDER.get(b.itemId) ?? Infinity));
      return true;
    } catch (e) {
      message = e instanceof Error ? e.message : 'Could not add that item.';
      return false;
    }
  }

  async function unlist(l: LevelLine) {
    message = '';
    try {
      await api().unlist(team.slug, l.itemId);
      levels = levels.filter((x) => x.itemId !== l.itemId);
    } catch (e) {
      message = e instanceof Error ? e.message : 'Could not remove that item.';
    }
  }

  async function done(text: string) {
    notice = text;
    await refresh();
  }
</script>

<svelte:head><title>{team.name} · Gear counter</title></svelte:head>

<NameModal bind:open={renaming} />

<section class="team-band">
  <Mascot name={team.mascot} />
  <div>
    <h1>{team.name}</h1>
    <p class="team-meta">{#if team.grade}<Dot colour={team.dot} size="lg" />{team.grade}{:else}Spare gear in storage{/if}</p>
    {#if me.name}<p class="who-line">Counting as {me.name} · <button type="button" onclick={() => (renaming = true)}>change</button></p>{/if}
  </div>
</section>

<div class="card toolbar">
  <p class="progress" aria-live="polite">{levelsText(total, team.kind)}</p>
  <p class="sync" class:offline={queue.offline && saving} role="status">
    {queue.offline && saving ? 'Offline — will sync' : saving ? 'Saving…' : 'All changes saved'}
  </p>
  {#if notice}<p class="notice">{notice}</p>{/if}
  {#if queue.error}<p class="error" role="alert">{queue.error}</p>{/if}
  {#if message}<p class="error" role="alert">{message}</p>{/if}
</div>

{#each groups as g (g.category)}
  <section class="category">
    <h2>{g.category}</h2>
    <ul class="lines">
      {#each g.lines as l (l.itemId)}
        {@const pending = queue.pendingFor(team.slug, l.itemId) !== 0}
        <li class="line" data-item={l.itemId}>
          <div class="line-text">
            <span class="line-name">{l.name}</span>
            {#if l.added}<span class="tag">Added</span>{/if}
          </div>
          <div class="stepper">
            {#if l.added && l.level === 0 && !pending}
              <button type="button" class="step remove" aria-label="Remove {l.name}" onclick={() => unlist(l)}>✕</button>
            {:else}
              <button type="button" class="step" aria-label="One less {l.name}" disabled={l.level === 0} onclick={() => tap(l, -1)}>−</button>
            {/if}
            <span class="qty"><strong>{l.level}</strong></span>
            <button type="button" class="step" aria-label="One more {l.name}" onclick={() => tap(l, 1)}>+</button>
            <button type="button" class="step more" aria-label="More for {l.name}" disabled={pending} onclick={() => (active = l)}>⋯</button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/each}

<div class="add-row"><AddItem {have} onadd={add} /></div>

<RecentChanges entries={data.page.recent} />

{#if active}
  <ItemDialog {team} teams={data.teams} line={active} onclose={() => (active = null)} ondone={done} />
{/if}

<p><a href="/">← All teams</a></p>
```
(Pools: `AddItem` shows "Every item is already on the list." because pools list everything — acceptable.)

`web/src/routes/+page.svelte` hero text: `<p>Choose a team or pool to see and update its gear.</p>`.

- [ ] **Step 5: Check** `npm run typecheck` → clean.

- [ ] **Step 6: Commit** — `git add -A web && git commit -m "feat(gear-counter): levels page with move, set count and recent changes"`

---

### Task 8: Web — admin page

**Files:** Modify `web/src/routes/admin/+page.svelte`

- [ ] **Step 1:** In the Downloads card add a second button after the club one:
```svelte
    <button type="button" class="btn" onclick={() => download('/export/log.csv')}>Full log (CSV)</button>
```
- [ ] **Step 2:** In each team row replace the meta's latest text and the CSV button:
```svelte
{kindText(t)} · /{t.slug} · {t.lastChange ? `Last change ${dateLabel(nzDate(new Date(t.lastChange)))}` : 'No changes'}
…
<button type="button" class="small" aria-label="Download {t.name} levels CSV" onclick={() => download(`/export/teams/${t.slug}.csv`)}>Levels</button>
<button type="button" class="small" aria-label="Download {t.name} log CSV" disabled={!t.lastChange} onclick={() => download(`/export/log.csv?team=${t.slug}`)}>Log</button>
```
Import `nzDate` alongside `dateLabel`. Change the Downloads note to "Current levels, and every logged change."

- [ ] **Step 3:** `npm run typecheck` → clean. Commit — `git commit -am "feat(gear-counter): admin downloads for levels and the log"`

---

### Task 9: End-to-end tests

**Files:** Replace `web/tests/e2e/gear-counter.spec.ts`

- [ ] **Step 1: Write the suite:**
```ts
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const line = (page: Page, name: string) => page.locator('li.line', { has: page.getByText(name, { exact: true }) });

async function named(page: Page, path: string, name = 'Sam') {
  await page.goto(path);
  const dialog = page.getByRole('dialog', { name: "What's your name?" });
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Your name').fill(name);
    await dialog.getByRole('button', { name: 'Save' }).click();
  }
  await expect(page.getByText(`Counting as ${name}`)).toBeVisible();
}

test('home lists the teams and the club pool', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Parklands Penguins/ })).toContainText('Kiwi Year 1');
  await expect(page.getByRole('link', { name: /Club pool/ })).toBeVisible();
});

test('asks for a name before any change, and remembers it', async ({ page }) => {
  await page.goto('/penguins');
  const dialog = page.getByRole('dialog', { name: "What's your name?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible(); // can't be skipped
  await dialog.getByLabel('Your name').fill('Sam');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.reload();
  await expect(page.getByText('Counting as Sam')).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('+ and − change the level, grouped into one log entry', async ({ page }) => {
  await named(page, '/penguins');
  await expect(page.locator('.progress')).toHaveText('0 items in this bag');
  const tees = line(page, 'Yellow batting tee');
  await expect(tees.getByRole('button', { name: 'One less Yellow batting tee' })).toBeDisabled();
  for (let i = 0; i < 3; i++) await tees.getByRole('button', { name: 'One more Yellow batting tee' }).click();
  await tees.getByRole('button', { name: 'One less Yellow batting tee' }).click();
  await expect(tees.locator('.qty')).toHaveText('2');
  await expect(page.getByText('All changes saved')).toBeVisible();
  const log = page.locator('.log li');
  await expect(log).toHaveCount(1);
  await expect(log.first()).toContainText('Sam');
  await expect(log.first()).toContainText('Yellow batting tee +2');
  await page.reload();
  await expect(line(page, 'Yellow batting tee').locator('.qty')).toHaveText('2');
  await expect(page.locator('.progress')).toHaveText('2 items in this bag');
});

test('set count and move to another team show in both logs', async ({ page }) => {
  await named(page, '/pool');
  const cones = line(page, 'Tall cones');
  await cones.getByRole('button', { name: 'More for Tall cones' }).click();
  let dialog = page.getByRole('dialog', { name: 'Tall cones' });
  await dialog.getByRole('button', { name: 'Set count…' }).click();
  await dialog.getByLabel('Count').fill('10');
  await dialog.getByLabel('Note (optional)').fill('shed check');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Tall cones set to 10.')).toBeVisible();
  await expect(cones.locator('.qty')).toHaveText('10');
  await expect(page.locator('.log li').first()).toContainText('Set Tall cones 0 → 10 · “shed check”');

  await cones.getByRole('button', { name: 'More for Tall cones' }).click();
  dialog = page.getByRole('dialog', { name: 'Tall cones' });
  await dialog.getByRole('button', { name: 'Move…' }).click();
  await dialog.getByLabel('Move to').selectOption({ label: 'Parklands Pumas' });
  await dialog.getByLabel('How many').fill('4');
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText('Moved 4 Tall cones to Parklands Pumas.')).toBeVisible();
  await expect(cones.locator('.qty')).toHaveText('6');
  await expect(page.locator('.log li').first()).toContainText('Moved 4 Tall cones to Parklands Pumas');

  await page.goto('/pumas');
  await expect(line(page, 'Tall cones').locator('.qty')).toHaveText('4');
  await expect(page.locator('.log li').first()).toContainText('Received 4 Tall cones from Club pool');
});

test('a move larger than the level is refused', async ({ page }) => {
  await named(page, '/pumas');
  await line(page, 'Tall cones').getByRole('button', { name: 'More for Tall cones' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tall cones' });
  await dialog.getByRole('button', { name: 'Move…' }).click();
  await dialog.getByLabel('Move to').selectOption({ label: 'Club pool' });
  await dialog.getByLabel('How many').evaluate((el: HTMLInputElement) => el.removeAttribute('max'));
  await dialog.getByLabel('How many').fill('9');
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Only 4 available.');
});

test('items can be added and removed while at 0', async ({ page }) => {
  await named(page, '/penguins');
  await page.getByRole('button', { name: '+ Add item' }).click();
  const add = page.getByRole('dialog', { name: 'Add an item' });
  await add.getByLabel('Search').fill('S2 (soft');
  await add.getByRole('button', { name: 'Wooden bat S2 (softball)' }).click();
  const bat = line(page, 'Wooden bat S2 (softball)');
  await expect(bat).toContainText('Added');
  await bat.getByRole('button', { name: 'Remove Wooden bat S2 (softball)' }).click();
  await expect(bat).toHaveCount(0);
});

test('taps made offline sync when the signal returns', async ({ page, context }) => {
  await named(page, '/wolves'); // Year 5 lists the J helmet (Year 3 does not)
  const helmets = line(page, 'J [53-54, age 7-10]');
  await expect(helmets.locator('.qty')).toHaveText('0');
  await context.setOffline(true);
  await helmets.getByRole('button', { name: /One more/ }).click();
  await helmets.getByRole('button', { name: /One more/ }).click();
  await expect(page.getByText('Offline — will sync')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(line(page, 'J [53-54, age 7-10]').locator('.qty')).toHaveText('2');
});

test('admin adds a pool, downloads CSVs and hides it', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Admin passcode').fill('e2e-passcode');
  await page.getByRole('button', { name: 'Continue' }).click();
  const form = page.getByRole('form', { name: 'Add a pool' });
  await form.getByLabel('Name').fill('Garage Shed');
  await form.getByRole('button', { name: 'Add pool' }).click();
  await expect(page.locator('[data-team="garage-shed"]')).toContainText('No changes');

  const club = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Club inventory (CSV)' }).click();
  expect(readFileSync(await (await club).path(), 'utf8').split('\r\n')[0]).toContain('Garage Shed');
  const log = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Full log (CSV)' }).click();
  const logCsv = readFileSync(await (await log).path(), 'utf8');
  expect(logCsv).toContain('Move in');
  expect(logCsv).toContain('shed check');
  const levels = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Parklands Pumas levels CSV' }).click();
  expect((await levels).suggestedFilename()).toMatch(/^pumas-levels-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.locator('[data-team="garage-shed"]').getByRole('button', { name: 'Hide' }).click();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Garage Shed/ })).toHaveCount(0);
});

test('an unknown team shows Team not found', async ({ page }) => {
  await page.goto('/pumaz');
  await expect(page.getByRole('heading', { name: 'Team not found' })).toBeVisible();
});
```
- [ ] **Step 2: Run** `npm run e2e` → 10 passed. Fix forward, not by loosening assertions.
- [ ] **Step 3: README** — replace the "Teams, pools and admin" first sentence with: "Teams and pools are in D1 (`teams`); each listed item's current level is in `levels` and every change is in `log` (see `docs/spec.md` §6)." Commit — `git add -A && git commit -m "test(gear-counter): end-to-end coverage for levels, moves and the log"`

---

### Task 10: Release (gated — needs the user's go-ahead)

- [ ] **Step 1:** Fresh backup: `npx wrangler d1 export pcc-gear-counter --remote --output "C:/Users/marcs/Downloads/pcc-gear-counter-d1-backup-$(date +%Y%m%d-%H%M).sql"`; confirm the file has `INSERT INTO "lines"` rows.
- [ ] **Step 2:** Dry-run the migration locally on the backup: `rm -rf .wrangler/state && npx wrangler d1 execute pcc-gear-counter --local --file <backup>` then `npx wrangler d1 migrations apply pcc-gear-counter --local`; check `SELECT team_slug, SUM(level) FROM levels GROUP BY team_slug` matches the latest-stocktake totals from the backup (e.g. Pumas 81, Club pool 365, Wolves 73).
- [ ] **Step 3:** `npm run deploy` (applies `0003_levels.sql`, deploys). Verify: `/api/teams/pumas` returns `levels` totalling the pre-migration figure and `recent` with `opening` entries; admin club CSV downloads.
- [ ] **Step 4:** Push `main` with the marcsstevenson token header (as in previous pushes).
