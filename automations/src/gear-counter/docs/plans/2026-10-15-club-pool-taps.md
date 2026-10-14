# Club pool taps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** + and − on every team and pool page except the Club pool's take gear from the Club pool and give it back,
behind a "Take from Club pool" toggle that is on whenever the page opens.

**Architecture:** The existing adjust endpoint gains `pool: true`. A new `poolTap` (api/src/pool-taps.ts) reads both
levels, works out what can be applied, and writes both levels plus a grouped pair of `move` log entries (`move_id`
starting `tap-`) in one D1 batch, retrying when the `CHECK (level >= 0)` rolls a concurrent tap back. The phone's
offline queue keys taps by mode (plain or pool) so the two never net; the team page shows the toggle, "Pool N" per line
and a notice when a synced pool tap was clipped.

**Tech Stack:** Cloudflare Worker + Hono + D1, valibot, SvelteKit 5 (runes) static SPA, Vitest (pool-workers),
Playwright.

**Spec:** `automations/src/gear-counter/docs/spec.md` §2, §3.3, §4.5, §5, §6, §8 (commit 2eb5036).

All paths below are relative to `automations/src/gear-counter/`. Run commands from that directory.

## Global Constraints

- The Club pool is the team row with slug `pool` (`CLUB_POOL`). It has no toggle and refuses pool taps (400).
- Toggle label exactly **Take from Club pool**; on each time the page opens; not stored anywhere.
- Line hint exactly `Pool N`; at 0 the hint reads **None left in the Club pool** and + is disabled.
- Clip notice: `Club pool only had {applied} {name}; the other {short} wasn't added.` (`weren't` when short > 1);
  when nothing applied: `None left in the Club pool: {short} {name} wasn't added.` (`weren't` when short > 1).
- Levels never go below 0 anywhere, the Club pool's included.
- Pool tap log entries are `kind = 'move'` pairs whose `move_id` starts `tap-`; grouping window `GROUP_MS` (2 min),
  same name case-insensitive; a pair that nets to 0 is deleted; `from`/`to` follow the sign.
- Adjust responses are `{ level, applied }` plain and `{ level, applied, poolLevel }` with `pool: true`.
- Team page payload adds `pool: { [itemId]: level } | null` (null on the Club pool's page or when it is hidden).
- Hidden Club pool: pool taps 409 `pool_unavailable`; toggle not shown.
- Never commit secrets, `.dev.vars` or squad JSON. Deploying needs Marc's explicit OK.

## Review Focus

1. **Two phones tapping + on the same item when the pool has fewer than they want** — the pool must end at 0, never
   negative, and each response's `applied` must add up to what the pool had. (Task 2 concurrency test.)
2. **A + and − mix that flips a grouped pair's sign** (+2 then −3 within 2 minutes when the team already held some) —
   the pair must read "Moved 1 … to Club pool" on the team, with `from`/`to` swapped. (Task 2 sign-flip test.)
3. **Taps queued before this deploy** (localStorage `pcc-gear-pending-v2`) — they must still sync as plain taps, not be
   dropped or sent as pool taps. (Task 3 `fromV2` test.)
4. **Existing e2e flows that tap + on team pages** — with the toggle on by default and an empty pool they would find
   + disabled; they must turn it off first. (Task 4 e2e updates.)
5. **An item the Club pool has no row for** (added in admin since the pool page was last opened, or retired) — + must
   be refused cleanly (applied 0), and − must create the pool row. (Task 2 tests.)

---

### Task 1: `applied` on plain taps, the Club pool helper and the `pool` map on the team page

**Files:**
- Modify: `shared/src/types.ts` (TeamPage, new AdjustResult)
- Modify: `api/src/teams.ts` (CLUB_POOL, clubPool)
- Modify: `api/src/levels.ts` (adjust returns `{ level, applied }`)
- Modify: `api/src/app.ts` (team page `pool`, adjust response)
- Test: `api/test/levels.test.ts`

**Interfaces:**
- Produces: `CLUB_POOL = 'pool'`, `clubPool(db): Promise<TeamRow | null>`, `poolLevels(db): Promise<Record<string, number>>`
  (all in `api/src/teams.ts`); `AdjustResult { level: number; applied: number; poolLevel?: number }` and
  `TeamPage.pool: Record<string, number> | null` (in `shared/src/types.ts`); `adjust(...)` now returns
  `Promise<AdjustResult>`.

- [ ] **Step 1: Write the failing tests** — in `api/test/levels.test.ts`:

Change the three exact adjust expectations:

```ts
    expect(await (await adjust(api, 'pumas', 'FLD-SCC', -3)).json()).toEqual({ level: 7, applied: -3 });
```
```ts
    expect(await (await adjust(api, 'pumas', 'STU-04', -5)).json()).toEqual({ level: 0, applied: -1 });
    expect(await (await adjust(api, 'pumas', 'STU-04', -1)).json()).toEqual({ level: 0, applied: 0 });
```

Add to `describe('teams', …)`:

```ts
  it('shows the Club pool’s levels on other pages, but not its own', async () => {
    const api = client();
    await count(api, 'pool', 'STU-04', 3);
    const pumas = await page(api, 'pumas');
    expect(pumas.pool?.['STU-04']).toBe(3);
    expect((await page(api, 'pool')).pool).toBeNull();
  });

  it('has no Club pool levels while the Club pool is hidden', async () => {
    await env.DB.prepare("UPDATE teams SET hidden = 1 WHERE slug = 'pool'").run();
    expect((await page(client(), 'pumas')).pool).toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run api/test/levels.test.ts`
Expected: FAIL — `applied` missing from the adjust responses; `pool` undefined on the page.

- [ ] **Step 3: Implement**

`shared/src/types.ts` — add to `TeamPage` after `recent`:

```ts
  /** The Club pool's levels by item id; null on the Club pool's own page or while it is hidden (spec §4.5). */
  pool: Record<string, number> | null;
```

and after `TeamPage`:

```ts
/** POST /teams/:slug/items/:item/adjust. `applied` is the change actually made; `poolLevel` only for pool taps. */
export interface AdjustResult {
  level: number;
  applied: number;
  poolLevel?: number;
}
```

`api/src/teams.ts` — after `getAnyTeam`:

```ts
/** The Club pool's slug: the club's store that other teams take gear from (spec §2, §4.5). */
export const CLUB_POOL = 'pool';

/** The Club pool if it is visible, else null. */
export async function clubPool(db: D1Database): Promise<TeamRow | null> {
  return db.prepare('SELECT * FROM teams WHERE slug = ? AND hidden = 0').bind(CLUB_POOL).first<TeamRow>();
}

export async function poolLevels(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db.prepare('SELECT item_id, level FROM levels WHERE team_slug = ?').bind(CLUB_POOL).all<{ item_id: string; level: number }>();
  return Object.fromEntries(results.map((r) => [r.item_id, r.level]));
}
```

`api/src/levels.ts` — `adjust` reads the level first inside the same batch and returns both. Change the signature
to `Promise<AdjustResult>` (import `AdjustResult` from `../../shared/src/types`), prepend a read to the batch and
change the tail:

```ts
  const results = await db.batch<{ level: number }>([
    db.prepare('SELECT level FROM levels WHERE team_slug = ?1 AND item_id = ?2').bind(team.slug, itemId),
    // …the four existing statements unchanged…
  ]);
  const before = results[0].results[0];
  const row = results[4].results[0];
  if (!before || !row) throw notListed();
  return { level: row.level, applied: row.level - before.level };
```

`api/src/app.ts` — import `CLUB_POOL, clubPool, poolLevels` from `./teams`; the team page:

```ts
    const pool = t.slug !== CLUB_POOL && (await clubPool(c.env.DB)) ? await poolLevels(c.env.DB) : null;
    const page: TeamPage = { team: summary(t), spec: t.spec, levels: await teamLevels(c.env.DB, t, cat), recent: await recent(c.env.DB, t.slug), pool };
```

and the adjust route returns the result object directly:

```ts
    return c.json(await adjust(c.env.DB, t, await loadCatalogue(c.env.DB), item(c.req.param('item')), parsed.output.delta, who, deps.now()));
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run api/test/levels.test.ts`
Expected: PASS.

- [ ] **Step 5: Whole suite, typecheck, commit**

Run: `npx vitest run` → all pass; `npm run typecheck` → 0 errors (the web side compiles: `TeamPage.pool` is only
read in Task 4, and `api.adjust`'s declared type is widened in Task 3).

```bash
git add shared/src/types.ts api/src/teams.ts api/src/levels.ts api/src/app.ts api/test/levels.test.ts
git commit -m "feat(gear-counter): adjust reports what it applied; team page carries the Club pool's levels"
```

---

### Task 2: Club pool taps on the server

**Files:**
- Create: `api/src/pool-taps.ts`
- Modify: `api/src/app.ts` (adjust route: `pool` flag)
- Test: `api/test/pool-taps.test.ts`

**Interfaces:**
- Consumes: `CLUB_POOL`, `clubPool` (Task 1), `GROUP_MS`, `itemName` (`api/src/levels.ts`), `AdjustResult` (Task 1).
- Produces: `TAP_PREFIX = 'tap-'`; `poolTap(db, team: TeamRow, cat: Cat, itemId: string, delta: number, who: string,
  newId: () => string, now: Date): Promise<AdjustResult>` (always with `poolLevel`).

- [ ] **Step 1: Write the failing tests** — `api/test/pool-taps.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { AdjustResult, TeamPage } from '../../shared/src/types';
import { client, testDeps, type Client } from './helpers';

const page = async (api: Client, slug: string) => (await (await api(`/teams/${slug}`)).json()) as TeamPage;
const level = async (api: Client, slug: string, item: string) => (await page(api, slug)).levels.find((l) => l.itemId === item)?.level;
const tap = (api: Client, slug: string, item: string, delta: number, who = 'Sam') =>
  api(`/teams/${slug}/items/${item}/adjust`, { method: 'POST', json: { delta, who, pool: true } });
const tapJson = async (api: Client, slug: string, item: string, delta: number, who = 'Sam') =>
  (await (await tap(api, slug, item, delta, who)).json()) as AdjustResult;
const setLevel = (api: Client, slug: string, item: string, n: number) =>
  api(`/teams/${slug}/items/${item}/count`, { method: 'POST', json: { level: n, who: 'Setup' } });
const at = (t: string) => {
  let now = new Date(t);
  return { api: client(testDeps({ now: () => now })), set: (s: string) => (now = new Date(s)) };
};

describe('Club pool taps', () => {
  it('takes from the Club pool and gives back, logging a paired move', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 5);
    expect(await tapJson(api, 'pumas', 'STU-04', 3)).toEqual({ level: 3, applied: 3, poolLevel: 2 });
    expect(await level(api, 'pool', 'STU-04')).toBe(2);
    const [inn] = (await page(api, 'pumas')).recent;
    expect(inn).toMatchObject({ kind: 'move', who: 'Sam', change: 3, levelAfter: 3, from: { slug: 'pool', name: 'Club pool' }, to: null });
    const [out] = (await page(api, 'pool')).recent;
    expect(out).toMatchObject({ kind: 'move', change: -3, levelAfter: 2, to: { slug: 'pumas', name: 'Parklands Pumas' }, from: null });
    const ids = await env.DB.prepare("SELECT DISTINCT move_id FROM log WHERE kind = 'move'").all<{ move_id: string }>();
    expect(ids.results).toHaveLength(1);
    expect(ids.results[0].move_id).toMatch(/^tap-/);
  });

  it('gives only what the Club pool has, and nothing (unlogged) when it is empty', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 2);
    expect(await tapJson(api, 'pumas', 'STU-04', 5)).toEqual({ level: 2, applied: 2, poolLevel: 0 });
    expect(await tapJson(api, 'pumas', 'STU-04', 1)).toEqual({ level: 2, applied: 0, poolLevel: 0 });
    expect((await page(api, 'pumas')).recent).toHaveLength(1);
  });

  it('returns only what the team holds', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 1);
    await tapJson(api, 'pumas', 'STU-04', 1);
    expect(await tapJson(api, 'pumas', 'STU-04', -4)).toEqual({ level: 0, applied: -1, poolLevel: 1 });
  });

  it('never takes the Club pool below 0 when phones tap at once', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 3);
    const results = await Promise.all(Array.from({ length: 6 }, () => tapJson(api, 'pumas', 'STU-04', 1)));
    expect(results.reduce((n, r) => n + r.applied, 0)).toBe(3);
    expect(await level(api, 'pool', 'STU-04')).toBe(0);
    expect(await level(api, 'pumas', 'STU-04')).toBe(3);
  });

  it('refuses + on an item the Club pool has no row for, and creates the row on −', async () => {
    const api = client();
    await env.DB.prepare("DELETE FROM levels WHERE team_slug = 'pool' AND item_id = 'BAT-W2'").run();
    await api('/teams/penguins/items/BAT-W2', { method: 'PUT', json: { who: 'Sam' } });
    expect(await tapJson(api, 'penguins', 'BAT-W2', 1)).toMatchObject({ applied: 0, poolLevel: 0 });
    await setLevel(api, 'penguins', 'BAT-W2', 2);
    expect(await tapJson(api, 'penguins', 'BAT-W2', -1)).toEqual({ level: 1, applied: -1, poolLevel: 1 });
  });

  it('groups one person’s taps into one pair, swapping from/to when the sign flips', async () => {
    const { api, set } = at('2026-10-11T01:00:00Z');
    await setLevel(api, 'pool', 'STU-04', 5);
    await setLevel(api, 'pumas', 'STU-04', 4);
    await tapJson(api, 'pumas', 'STU-04', 2);
    set('2026-10-11T01:01:00Z');
    await tapJson(api, 'pumas', 'STU-04', -3, 'sam');
    const [team] = (await page(api, 'pumas')).recent;
    expect(team).toMatchObject({ kind: 'move', change: -1, levelAfter: 3, to: { slug: 'pool' }, from: null, at: '2026-10-11T01:00:00.000Z' });
    const [pool] = (await page(api, 'pool')).recent;
    expect(pool).toMatchObject({ kind: 'move', change: 1, levelAfter: 6, from: { slug: 'pumas' }, to: null }); // 5 − 2 + 3
  });

  it('starts a new pair after 2 minutes, for another person, or after a manual move', async () => {
    const { api, set } = at('2026-10-11T01:00:00Z');
    await setLevel(api, 'pool', 'STU-04', 9);
    await tapJson(api, 'pumas', 'STU-04', 1);
    set('2026-10-11T01:02:01Z');
    await tapJson(api, 'pumas', 'STU-04', 1);
    await tapJson(api, 'pumas', 'STU-04', 1, 'Jo');
    await api('/moves', { method: 'POST', json: { from: 'pumas', to: 'wolves', item: 'STU-04', qty: 1, who: 'Jo' } });
    await tapJson(api, 'pumas', 'STU-04', 1, 'Jo');
    const { recent } = await page(api, 'pumas');
    expect(recent.map((e) => [e.who, e.change])).toEqual([['Jo', 1], ['Jo', -1], ['Jo', 1], ['Sam', 1], ['Sam', 1]]);
  });

  it('deletes a pair that nets to 0', async () => {
    const api = client();
    await setLevel(api, 'pool', 'STU-04', 2);
    await tapJson(api, 'pumas', 'STU-04', 2);
    await tapJson(api, 'pumas', 'STU-04', -2);
    expect((await page(api, 'pumas')).recent).toEqual([]);
    expect((await page(api, 'pool')).recent.filter((e) => e.kind === 'move')).toEqual([]);
  });

  it('refuses pool taps on the Club pool itself, while it is hidden, and on unlisted items', async () => {
    const api = client();
    expect(await (await tap(api, 'pool', 'STU-04', 1)).json()).toMatchObject({ error: 'pool_self' });
    expect((await tap(api, 'penguins', 'BAT-W2', -1)).status).toBe(404); // not listed for Penguins
    await env.DB.prepare("UPDATE teams SET hidden = 1 WHERE slug = 'pool'").run();
    const res = await tap(api, 'pumas', 'STU-04', 1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'pool_unavailable' });
  });

  it('rejects a pool flag that is not true or false', async () => {
    const res = await client()('/teams/pumas/items/STU-04/adjust', { method: 'POST', json: { delta: 1, who: 'Sam', pool: 'yes' } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run api/test/pool-taps.test.ts`
Expected: FAIL — responses lack `poolLevel`, levels unchanged in the pool, no move entries (the route still does a
plain adjust).

- [ ] **Step 3: Implement** — `api/src/pool-taps.ts`:

```ts
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
    // The pool row may be missing (an item added since the pool page was last opened): −?3 below 0 fails the CHECK.
    db
      .prepare(
        `INSERT INTO levels (team_slug, item_id, level, added, updated_at) VALUES (?2, ?6, -?3, 0, ?4)
         ON CONFLICT (team_slug, item_id) DO UPDATE SET level = level - ?3, updated_at = excluded.updated_at`,
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
```

`api/src/app.ts` — import `poolTap` from `./pool-taps`; extend the schema and route:

```ts
const Adjust = v.object({
  delta: v.pipe(v.number(), v.integer(), v.minValue(-20), v.maxValue(20), v.check((n) => n !== 0)),
  pool: v.optional(v.boolean()),
});
```
```ts
    if (!parsed.success) throw new ApiError(400, 'invalid_delta', 'delta must be a whole number from -20 to 20, not 0, and pool true or false.');
    const who = parseWho(b.who);
    const cat = await loadCatalogue(c.env.DB);
    const id = item(c.req.param('item'));
    if (parsed.output.pool) return c.json(await poolTap(c.env.DB, t, cat, id, parsed.output.delta, who, deps.id, deps.now()));
    return c.json(await adjust(c.env.DB, t, cat, id, parsed.output.delta, who, deps.now()));
```

Note: D1 rejects a statement given more bindings than its highest `?N`, so each statement binds
`args.slice(0, highest ?N)`; gaps below the highest (e.g. ?2 and ?5 unused in the first UPDATE) are fine.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run api/test/pool-taps.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Whole suite, typecheck, commit**

Run: `npx vitest run` → all pass; `npm run typecheck` → 0 errors.

```bash
git add api/src/pool-taps.ts api/src/app.ts api/test/pool-taps.test.ts
git commit -m "feat(gear-counter): Club pool taps on the server"
```

---

### Task 3: Phone queue keeps plain and pool taps apart

**Files:**
- Create: `shared/src/queue.ts`
- Test: `shared/test/queue.test.ts`
- Modify: `web/src/lib/api.ts` (adjust takes `pool`)
- Modify: `web/src/lib/sync.svelte.ts` (mode in the key, v2 migration, pool callbacks)

**Interfaces:**
- Consumes: `AdjustResult` (Task 1), the `pool` flag on the adjust route (Task 2).
- Produces (`shared/src/queue.ts`): `type TapMode = 'plain' | 'pool'`; `interface TapKey { team; item; mode; who }`;
  `tapKey(k: TapKey): string`; `parseTapKey(key: string): TapKey`; `fromV2(old: Record<string, number>): Record<string, number>`;
  `shortText(name: string, applied: number, short: number): string`.
- Produces (`web/src/lib/sync.svelte.ts` `queue`): `add(team, item, delta, pool: boolean)`;
  `pendingFor(team, item)` (both modes); `pendingPool(item)` (pool-mode taps for that item, all teams);
  callbacks `onLevel(team, item, level)`, `onPool(item, poolLevel)`, `onShort(team, item, applied, short)`, `onIdle(team)`.
- Produces (`web/src/lib/api.ts`): `adjust(team, id, delta, who, pool = false): Promise<AdjustResult>`.

- [ ] **Step 1: Write the failing tests** — `shared/test/queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fromV2, parseTapKey, shortText, tapKey } from '../src/queue';

describe('tap keys', () => {
  it('round-trips team, item, mode and a name containing |', () => {
    const k = { team: 'pumas', item: 'STU-04', mode: 'pool' as const, who: 'Sam|Jo' };
    expect(tapKey(k)).toBe('pumas|STU-04|p|Sam|Jo');
    expect(parseTapKey(tapKey(k))).toEqual(k);
    expect(parseTapKey(tapKey({ ...k, mode: 'plain' }))).toEqual({ ...k, mode: 'plain' });
  });

  it('turns taps queued before Club pool taps into plain taps', () => {
    expect(fromV2({ 'pumas|STU-04|Sam|Jo': 2, 'pool|FLD-TC|Jo': -1 })).toEqual({ 'pumas|STU-04|a|Sam|Jo': 2, 'pool|FLD-TC|a|Jo': -1 });
  });
});

describe('shortText', () => {
  it('says what the Club pool could not cover', () => {
    expect(shortText('Tall cones', 2, 1)).toBe("Club pool only had 2 Tall cones; the other 1 wasn't added.");
    expect(shortText('Tall cones', 1, 3)).toBe("Club pool only had 1 Tall cones; the other 3 weren't added.");
    expect(shortText('Bails (pair)', 0, 1)).toBe("None left in the Club pool: 1 Bails (pair) wasn't added.");
    expect(shortText('Bails (pair)', 0, 2)).toBe("None left in the Club pool: 2 Bails (pair) weren't added.");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/test/queue.test.ts`
Expected: FAIL — cannot resolve `../src/queue`.

- [ ] **Step 3: Implement** — `shared/src/queue.ts`:

```ts
/** How a queued tap is sent: a plain adjust, or a Club pool tap (spec §4.1, §4.5). */
export type TapMode = 'plain' | 'pool';

export interface TapKey {
  team: string;
  item: string;
  mode: TapMode;
  who: string;
}

/** team|item|a-or-p|who. Slugs and item ids never contain '|'; the name may, so it is everything after the third. */
export const tapKey = (k: TapKey) => `${k.team}|${k.item}|${k.mode === 'pool' ? 'p' : 'a'}|${k.who}`;

export function parseTapKey(key: string): TapKey {
  const [team, item, m] = key.split('|', 3);
  return { team, item, mode: m === 'p' ? 'pool' : 'plain', who: key.slice(team.length + item.length + m.length + 3) };
}

/** Keys queued before Club pool taps were team|item|who and were always plain taps. */
export function fromV2(old: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(old).map(([key, n]) => {
      const [team, item] = key.split('|', 2);
      return [tapKey({ team, item, mode: 'plain', who: key.slice(team.length + item.length + 2) }), n];
    }),
  );
}

const wasnt = (n: number) => (n === 1 ? "wasn't" : "weren't");

/** Notice when a synced Club pool + applied less than was tapped (spec §4.5). */
export function shortText(name: string, applied: number, short: number) {
  return applied > 0
    ? `Club pool only had ${applied} ${name}; the other ${short} ${wasnt(short)} added.`
    : `None left in the Club pool: ${short} ${name} ${wasnt(short)} added.`;
}
```

`web/src/lib/api.ts` — import `AdjustResult`; replace the adjust entry:

```ts
    adjust: (team: string, id: string, delta: number, who: string, pool = false) =>
      req<AdjustResult>(`${item(team, id)}/adjust`, json('POST', pool ? { delta, who, pool } : { delta, who })),
```

`web/src/lib/sync.svelte.ts` — replace the key handling:

```ts
import { fromV2, parseTapKey, tapKey } from '$shared/queue';
import { api, isTransient } from './api';
import { me } from './who.svelte';

const KEY = 'pcc-gear-pending-v3';
const V2_KEY = 'pcc-gear-pending-v2';
const OLD_KEY = 'pcc-gear-pending-v1';
```

`load()` reads `KEY`; if `V2_KEY` holds anything, merge `fromV2(v2)` into the result (adding to any same key),
write it back under `KEY` and remove `V2_KEY`. Keep the v1 handling as it is.

Replace `pendingFor` and add `pendingPool`:

```ts
  pendingFor(team: string, item: string) {
    return Object.entries(this.pending).reduce((n, [k, v]) => {
      const t = parseTapKey(k);
      return t.team === team && t.item === item ? n + v : n;
    }, 0);
  }

  /** This phone's queued Club pool taps for an item, all teams: the Club pool is that much lower than the server says. */
  pendingPool(item: string) {
    return Object.entries(this.pending).reduce((n, [k, v]) => {
      const t = parseTapKey(k);
      return t.mode === 'pool' && t.item === item ? n + v : n;
    }, 0);
  }

  add(team: string, item: string, delta: number, pool: boolean) {
    this.error = '';
    this.#change(tapKey({ team, item, mode: pool ? 'pool' : 'plain', who: me.name }), delta);
    void this.flush();
  }
```

Add callbacks beside `onLevel`/`onIdle`:

```ts
  /** Called with the Club pool's level after a pool tap lands. */
  onPool: ((item: string, level: number) => void) | null = null;
  /** Called when a pool + applied less than was sent (spec §4.5). */
  onShort: ((team: string, item: string, applied: number, short: number) => void) | null = null;
```

In `flush()`, parse with `parseTapKey` and send the mode:

```ts
        const { team, item, mode, who } = parseTapKey(key);
        const total = this.pending[key];
        const delta = Math.max(-MAX_STEP, Math.min(MAX_STEP, total));
        try {
          const r = await api().adjust(team, item, delta, who, mode === 'pool');
          this.#change(key, -delta);
          this.offline = false;
          this.onLevel?.(team, item, r.level);
          if (r.poolLevel !== undefined) this.onPool?.(item, r.poolLevel);
          if (mode === 'pool' && delta > 0 && r.applied < delta) this.onShort?.(team, item, r.applied, delta - r.applied);
        } catch (e) {
```

(the `catch` body is unchanged).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run shared/test/queue.test.ts` → PASS; `npm run typecheck` → 0 errors except the team page's
`queue.add(team.slug, l.itemId, delta)` call, which now needs a fourth argument — pass `false` there for now:

```ts
    queue.add(team.slug, l.itemId, delta, false);
```

Run `npm run typecheck` again → 0 errors.

- [ ] **Step 5: Whole suite, commit**

Run: `npx vitest run` → all pass.

```bash
git add shared/src/queue.ts shared/test/queue.test.ts web/src/lib/api.ts web/src/lib/sync.svelte.ts "web/src/routes/[team]/+page.svelte"
git commit -m "feat(gear-counter): the tap queue keeps plain and Club pool taps apart"
```

---

### Task 4: Toggle, "Pool N" and the clip notice on the team page

**Files:**
- Modify: `web/src/routes/[team]/+page.svelte`
- Modify: `web/src/lib/styles/app.css`
- Test: `web/tests/e2e/gear-counter.spec.ts`

**Interfaces:**
- Consumes: `TeamPage.pool` (Task 1); `queue.add(…, pool)`, `queue.pendingPool`, `queue.onPool`, `queue.onShort`
  (Task 3); `shortText` (Task 3).

- [ ] **Step 1: Write the failing e2e tests** — in `web/tests/e2e/gear-counter.spec.ts`:

Make `named()` turn the toggle off by default (existing tests tap + with an empty Club pool), and add a helper:

```ts
/** Plain + and − (spec §4.1): turn off "Take from Club pool" when the page has it. */
async function plain(page: Page) {
  const toggle = page.getByLabel('Take from Club pool');
  if (await toggle.count()) await toggle.uncheck();
}

async function named(page: Page, path: string, name = 'Sam', { pool = false } = {}) {
  // …existing body…
  await expect(page.getByText(`Counting as ${name}`)).toBeVisible();
  if (!pool) await plain(page);
}
```

In 'admin edits the catalogue and teams follow', after `await page.goto('/tigers');` add `await plain(page);`.

Add after 'set count and move to another team show in both logs':

```ts
test('+ and − take from and give back to the Club pool by default', async ({ page }) => {
  await page.request.post('/api/teams/pool/items/STU-04/count', { data: { level: 2, who: 'Setup' } });
  await named(page, '/pumas', 'Sam', { pool: true });
  await expect(page.getByLabel('Take from Club pool')).toBeChecked();
  const bails = line(page, 'Bails (pair)');
  await expect(bails).toContainText('Pool 2');
  await bails.getByRole('button', { name: 'One more Bails (pair)' }).click();
  await bails.getByRole('button', { name: 'One more Bails (pair)' }).click();
  await expect(bails.locator('.qty')).toHaveText('2');
  await expect(bails).toContainText('None left in the Club pool');
  await expect(bails.getByRole('button', { name: 'One more Bails (pair)' })).toBeDisabled();
  await bails.getByRole('button', { name: 'One less Bails (pair)' }).click();
  await expect(bails).toContainText('Pool 1');
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.locator('.log li').first()).toContainText('Received 1 Bails (pair) from Club pool');

  await page.getByLabel('Take from Club pool').uncheck();
  await expect(bails).not.toContainText('Pool');
  await bails.getByRole('button', { name: 'One more Bails (pair)' }).click();
  await expect(bails.locator('.qty')).toHaveText('2');
  await expect(page.getByText('All changes saved')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Take from Club pool')).toBeChecked(); // on again when the page opens
  await expect(line(page, 'Bails (pair)')).toContainText('Pool 1');

  await page.goto('/pool');
  await expect(page.getByLabel('Take from Club pool')).toHaveCount(0);
  await expect(line(page, 'Bails (pair)').locator('.qty')).toHaveText('1');
  await expect(page.locator('.log li').first()).toContainText('Moved 1 Bails (pair) to Parklands Pumas');
});

test('offline Club pool taps that the pool can no longer cover are clipped at sync', async ({ page, context, request }) => {
  await request.post('/api/teams/pool/items/HEL-J/count', { data: { level: 2, who: 'Setup' } });
  await named(page, '/rhinos', 'Sam', { pool: true }); // Year 5 lists the J helmet
  const helmets = line(page, 'J [53-54, age 7-10]');
  await expect(helmets).toContainText('Pool 2');
  await context.setOffline(true);
  await helmets.getByRole('button', { name: /One more/ }).click();
  await helmets.getByRole('button', { name: /One more/ }).click();
  await expect(page.getByText('Offline — will sync')).toBeVisible();
  await request.post('/api/teams/pool/items/HEL-J/count', { data: { level: 1, who: 'Jo' } }); // someone else took one
  await context.setOffline(false);
  await expect(page.getByText("Club pool only had 1 J [53-54, age 7-10]; the other 1 wasn't added.")).toBeVisible({ timeout: 15_000 });
  await expect(helmets.locator('.qty')).toHaveText('1');
  await expect(helmets).toContainText('None left in the Club pool');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test -g "Club pool"`
Expected: FAIL — no "Take from Club pool" control (the new tests can't find it; `named` with `pool: true` passes but
`toBeChecked` fails).

- [ ] **Step 3: Implement** — `web/src/routes/[team]/+page.svelte`:

Script additions (import `shortText` from `$shared/queue`):

```ts
  // "Take from Club pool" (spec §3.3, §4.5): on each time the page opens, not remembered.
  let fromPool = $state(true);
  let pool = $derived(data.page.pool);
  const usePool = $derived(fromPool && pool !== null);
  const poolLeft = (itemId: string) => Math.max(0, (pool?.[itemId] ?? 0) - queue.pendingPool(itemId));
```

In `refresh()` and in `add()`'s re-read, also set `pool = fresh.pool;`.

In the callbacks `$effect`, add (and clear both in the cleanup):

```ts
    queue.onPool = (item, level) => {
      if (pool) pool = { ...pool, [item]: level };
    };
    queue.onShort = (t, item, applied, short) => {
      if (t === slug) notice = shortText(levels.find((l) => l.itemId === item)?.name ?? 'items', applied, short);
    };
```

`tap()`:

```ts
  function tap(l: LevelLine, delta: 1 | -1) {
    if (!me.name) return; // the name modal is open
    if (delta < 0 && shown(l) === 0) return;
    if (delta > 0 && usePool && poolLeft(l.itemId) === 0) return;
    notice = '';
    queue.add(team.slug, l.itemId, delta, usePool);
  }
```

Markup — first thing inside the toolbar card:

```svelte
  {#if pool}
    <label class="pool-toggle"><input type="checkbox" bind:checked={fromPool} /> Take from Club pool</label>
  {/if}
```

Inside `.line-text`, after the tags:

```svelte
            {#if usePool}
              {@const left = poolLeft(l.itemId)}
              <span class="pool-left" class:empty={left === 0}>{left === 0 ? 'None left in the Club pool' : `Pool ${left}`}</span>
            {/if}
```

The + button gains `disabled={usePool && poolLeft(l.itemId) === 0}`.

`web/src/lib/styles/app.css` — after the `.tag.retired` rule:

```css
.pool-toggle { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 600; }
.pool-toggle input { width: 20px; height: 20px; }
.pool-left { flex-basis: 100%; font-size: 0.8rem; color: var(--pcc-grey-600); }
.pool-left.empty { color: var(--pcc-red-700, #b42318); }
```

(Check `web/src/lib/styles/tokens.css` for the red token's real name and use it.)

- [ ] **Step 4: Run to verify they pass**

Run: `npx playwright test` → all pass (the two new tests and every existing one).

- [ ] **Step 5: Typecheck, whole suite, commit**

Run: `npm run typecheck` → 0 errors; `npx vitest run` → all pass.

```bash
git add "web/src/routes/[team]/+page.svelte" web/src/lib/styles/app.css web/tests/e2e/gear-counter.spec.ts
git commit -m "feat(gear-counter): Take from Club pool toggle, Pool N and the clip notice on team pages"
```

---

### Task 5: Spec touch-ups and memory

**Files:**
- Modify: `docs/spec.md` (§4.5 notice wording when nothing applied; §5 `busy` 503)
- Modify: `C:\Users\marcs\.claude\projects\D--git-marcsstevenson-pcc\memory\gear-counter-site.md`

- [ ] **Step 1:** In §4.5, after the clip notice example add: *When nothing could be applied: "None left in the
  Club pool: 1 Tall cones wasn't added."* In §5, after the adjust row's notes add: *A pool tap that keeps colliding
  with other taps returns 503 `busy` (retried by the phone).*
- [ ] **Step 2:** Add one line to the gear-counter memory: Club pool taps (toggle default on; `tap-` move pairs).
- [ ] **Step 3: Commit**

```bash
git add docs/spec.md
git commit -m "docs(gear-counter): Club pool tap notice and busy response"
```

Deploying (`npm run deploy`) and pushing are separate steps that need Marc's OK.
