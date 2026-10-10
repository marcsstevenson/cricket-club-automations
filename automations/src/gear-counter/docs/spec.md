# PCC Gear Counter — spec

A phone-first website for tracking Parklands Cricket Club gear: the current stock level of every item in each team's
kit bag and in each gear pool, and a log of every change to those levels. It sits beside the game-day site and uses
the same stack (Cloudflare Worker + Hono API + D1, SvelteKit static SPA).

## 1. Who and why

Gear volunteers keep each team bag's and pool's levels up to date: tapping + and − as gear comes and goes, moving
gear between teams and pools, and setting a level outright after a physical count. Every change is logged with who
made it, so the gear convenor can see what happened. The club's Kit Spec is a guide to what a bag should hold: it
decides which items are listed for a team, but levels are not compared against it.

There is no login. Anyone with the link can make changes, but must give their name first (§3.1), which is kept in
the browser and recorded against every change. A hidden admin page (§3.4) behind a shared passcode adds teams and
pools, hides them, and downloads CSVs.

## 2. Data sources

### Catalogue and Kit Spec
From `PCC Gear List 2026-27 Season - v7.xlsx` (Committee SharePoint → Gear), read by `scripts/import_gear.py` into
`shared/src/gear-data.json`, which is committed (no personal data). Rerun the script when the workbook changes.

| Data | Source |
|---|---|
| Catalogue | `Items` tab, excluding categories **Senior kit**, **Misc**, **Other safety** |
| Kit Spec | `Kit Spec` tab, one column per grade; only quantities above 0; columns with no quantities are dropped |

### Teams and pools
D1 `teams` (§6), managed on the admin page; seeded with the 27 game-day teams and the **Club pool**.

- A **team** has a Kit Spec column; its Kit Spec items are always listed.
- A **pool** has no Kit Spec column; every catalogue item is listed.
- A team with no dot colour shows a dashed empty dot; no mascot shows the ball.

## 3. Pages

### 3.1 Name
The first time a team or pool page is opened in a browser, a modal asks **"What's your name?"** (1–40 characters
after trimming). It cannot be dismissed without a name. The name is kept in `localStorage` and sent with every change;
the page shows **"Counting as Sam · change"**, where *change* reopens the modal. The admin page does not ask for a name: its
actions (adding and hiding teams) do not change levels.

### 3.2 Home `/`
Hero "Gear counter", then a grid of cards (mascot, name, dot + grade, or "Spare gear in storage" for a pool): visible
teams in their sort order, then visible pools (Club pool first, then pools in the order they were added).

### 3.3 Team or pool `/:slug`
- Header band: mascot, name, the grade with its dot (pools: "Spare gear in storage"), and "Counting as …".
- Summary: "68 items in this bag" (pool: "… in this pool") — the sum of levels.
- Listed items grouped by category in catalogue order. Each line: name, `[−] level [+]`, and a **⋯** button with
  **Move…** and **Set count…**. Items listed with **+ Add item** are tagged "Added".
- − is disabled at 0; levels never go below 0.
- **+ Add item** opens a modal of catalogue items not listed here, grouped by category, with a search box; tapping one
  lists it at 0.
- An added item (not in the team's Kit Spec) at level 0 with nothing queued shows ✕ instead of −; tapping it unlists it.
- **Move…** dialog: destination (any other visible team or pool), quantity (1 – current level), optional note.
  **Move** moves the gear: this level goes down, the destination's goes up, and the destination lists the item.
- **Set count…** dialog: new level (0–999), optional note. **Save** sets the level outright.
- **Recent changes**: the newest 50 log entries for this team or pool, newest first, e.g.
  - `Sam · 11 Oct, 2:14 pm · Tall cones +2`
  - `Jo · 11 Oct, 9:03 am · Moved 3 Helmets J to Parklands Pumas · "for Saturday"`
  - `Jo · 11 Oct, 9:03 am · Received 3 Helmets J from Club pool · "for Saturday"`
  - `Sam · 10 Oct, 4:40 pm · Set Bails (pair) 4 → 6`
  - `Migration · 10 Oct · Opening level Bails (pair) 4`
- The page re-reads levels and recent changes when it comes back into view and nothing is queued.

### 3.4 Admin `/admin`
Not linked from anywhere. Asks for the admin passcode once; when accepted it is kept in `localStorage` so later visits
go straight in. A 401 (e.g. after the passcode changes) forgets it and asks again.

- **Downloads**: **Club inventory (CSV)**, **Full log (CSV)**, and on each team/pool row **Levels CSV** and **Log CSV**.
- **Teams and pools** list: name, grade or "Pool", `/slug`, last change date (or "No changes"), the two CSV buttons,
  and **Hide**/**Unhide**. Hidden rows are marked "Hidden".
- **Add a team**: name, web address (filled in from the name, editable), Kit Spec column, grade shown on the site
  (defaults to the Kit Spec column), dot colour (known colours or none), mascot (images in `web/static/mascots`, or
  the ball). New teams sort after existing teams; their Kit Spec items are listed at 0.
- **Add a pool**: name and web address. New pools sort after existing pools; every item is listed at 0.
- Hiding removes the team/pool from the home page, the Move destinations, and its page shows "Team not found"; its
  levels and log are kept, still appear in the CSVs, and come back on Unhide. There is no delete.

Slugs are 2–30 characters of `a-z`, `0-9` and `-`, start with a letter, are unique (hidden included) and are not
`admin` or `api`. Names are 1–60 characters and unique ignoring case.

### 3.5 CSV downloads
UTF-8 with a BOM; values starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`; times are NZ local.

- **Club inventory** `club-inventory-YYYY-MM-DD.csv` (today, NZ): one row per catalogue item in catalogue order.
  Columns `Category`, `Item`, `Club total`, then one column per team/pool (teams, then pools; hidden included and
  marked "(hidden)"). Second row `Last change` with each team/pool's latest log date. A cell is the level, or blank
  when the item is not listed there.
- **Levels** `<slug>-levels-YYYY-MM-DD.csv`: listed items in catalogue order. Columns `Category`, `Item`, `Level`,
  `Kit Spec` (quantity, blank for none), `Listed` (`Kit Spec` or `Added`).
- **Log** `gear-log-YYYY-MM-DD.csv` or `<slug>-log-YYYY-MM-DD.csv`: every log entry, newest first. Columns `When`
  (`YYYY-MM-DD HH:MM`, NZ), `Who`, `Team`, `Item`, `Kind` (`Opening`, `Adjust`, `Move out`, `Move in`, `Set count`),
  `Change` (signed), `Level after`, `From`, `To`, `Note`.

### 3.6 Not found
Unknown or hidden slugs show "Team not found" with a link home.

## 4. Changes

### 4.1 + and − (adjust)
- Each tap updates the screen at once and is queued in `localStorage` as a net change per team and item, with the
  name, so a reload or lost signal loses nothing. The queue sends one item at a time and retries every few seconds
  and on reconnect; the page shows "Offline — will sync" / "Saving…" / "All changes saved".
- The server applies the change atomically (`level = max(0, level + delta)`) and returns the new level. The log
  records the change actually applied (less than asked for when the floor at 0 clipped it; nothing when 0).
- **Grouping**: a change is added to the newest log entry for that team and item when that entry is an `adjust`, by
  the same name (case-insensitive), last updated less than **2 minutes** before. Otherwise a new entry is created.
  An entry whose change nets to 0 is deleted. So "+1 +1 +1 −1" within a minute is one "+2" entry.
- Log times are the server's time when the change arrives (taps made offline are logged when they sync).

### 4.2 Move
Needs a connection. In one D1 transaction: refuse with 409 "Only N available" if the source level is below the
quantity; otherwise lower the source, raise the destination (listing the item there if needed), and write two log
entries sharing a `move_id`: `move` −qty on the source (`to` = destination) and `move` +qty on the destination
(`from` = source), both with the note. Source and destination must differ; both must be visible.

### 4.3 Set count
Needs a connection. Sets the level outright (last write wins) and writes a `count` entry with `change` = new − old
and `level after` = new, with the note. Setting the same level as now writes nothing.

### 4.4 Listing
**+ Add item** lists an item at 0 (idempotent, no log entry). Unlisting needs level 0 and an item that is not in the
team's Kit Spec (pools: never — every item is listed); otherwise 409. A move into a team lists the item there.

## 5. API (`/api`)

Every change takes `who` (1–40 characters after trimming; 400 without it). Errors are `{ error, message }` JSON.
Writes are rate limited per IP (300 per minute).

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/teams` | | Visible team summaries (teams, then pools) |
| GET | `/teams/:slug` | | `{ team, spec, levels, recent }`; 404 if hidden |
| POST | `/teams/:slug/items/:item/adjust` | `{ delta, who }` (integer −20…20, not 0) | `{ level }` |
| PUT | `/teams/:slug/items/:item` | `{ who }` | the listed level line |
| DELETE | `/teams/:slug/items/:item` | | 204; 409 if level > 0 or a Kit Spec item |
| POST | `/teams/:slug/items/:item/count` | `{ level, who, note? }` (0–999) | `{ level }` |
| POST | `/moves` | `{ from, to, item, qty, who, note? }` (qty 1–999) | `{ fromLevel, toLevel }`; 409 if short |

Notes are up to 200 characters. `levels` lines: `{ itemId, name, category, level, kitSpec, added }`. `recent`: the
newest 50 log entries `{ id, at, who, itemId, itemName, kind, change, levelAfter, from, to, note }`, where
`from`/`to` are `{ slug, name }` or null.

Admin routes need header `x-admin-passcode` matching the `ADMIN_PASSCODE` Worker secret (constant-time compare): 401
when wrong or missing, 503 when unset. Rate limited per IP (30 per minute) before the passcode check;
`cache-control: no-store`.

| Method | Path | Result |
|---|---|---|
| GET | `/admin/check` | `{ ok: true }` |
| GET | `/admin/teams` | All teams and pools with Kit Spec column, `hidden`, `lastChange` |
| POST | `/admin/teams` | Body `{ kind, name, slug, spec?, grade?, dot?, mascot? }` → the new team; 400 / 409 |
| PATCH | `/admin/teams/:slug` | Body `{ hidden }` → the team |
| GET | `/admin/export/club.csv` | Club inventory |
| GET | `/admin/export/teams/:slug.csv` | Levels CSV for one team |
| GET | `/admin/export/log.csv?team=slug` | Log CSV (all, or one team) |

## 6. Storage (D1)

```sql
teams(slug PK, name, kind 'team'|'pool', mascot, grade, spec, dot, sort, hidden 0|1, created_at)
levels(team_slug, item_id, level >= 0, added 0|1, updated_at, PRIMARY KEY(team_slug, item_id))
  -- a row exists exactly when the item is listed for that team/pool
log(id INTEGER PK, at, updated_at, team_slug, item_id, item_name,
    kind 'opening'|'adjust'|'move'|'count', change, level_after, move_id, from_slug, to_slug, note, who)
  INDEX (team_slug, id DESC), INDEX (team_slug, item_id, id DESC)
```

`item_name` is copied into the log so entries survive catalogue renames. Times are ISO UTC; display converts to NZ.

### Migration from stocktakes (`0003_levels.sql`)
Taken after a full export of production (`wrangler d1 export`). For each team/pool:
1. Every line of its latest stocktake becomes a `levels` row: `level` = count, `added` = the line's added flag.
2. Kit Spec items (teams) or all items (pools) not yet in `levels` are inserted at 0. Teams with no stocktake get only
   these.
3. Each level above 0 gets an `opening` log entry by `Migration`, dated that stocktake's `created_at`.
4. `stocktakes` and `lines` are dropped.

Kit Spec and catalogue rows for step 2 are generated into the migration from `gear-data.json` by
`scripts/levels_migration.py` (helper tables `mig_kit_spec` and `mig_catalogue`, created and dropped within it).

## 7. Deploy

Worker `pcc-gear-counter` in the club Cloudflare account on its workers.dev URL. Secret `ADMIN_PASSCODE`. `npm run
deploy` builds, applies D1 migrations, then deploys. Taps still queued on a phone from before this change cannot be
sent after it (their routes are gone) and are dropped with an error.

## 8. Tests

- Vitest (Workers runtime): `gear-data.json` integrity; seeded teams; adjust (atomic, concurrent, floor at 0, logs
  the applied change); grouping (same name within 2 minutes merges, case-insensitive; different name, later than 2
  minutes, different item or a non-adjust entry in between start a new entry; a group netting to 0 is deleted);
  list/unlist rules; set count (logs old → new, no-op when equal); moves (atomic, 409 when short, same team refused,
  hidden refused, destination listed, paired entries); `who` required; recent changes shape and limit; the migration
  applied to stocktake data; admin (passcode, rate limit, add/hide, all three CSVs incl. blanks, hidden columns,
  quoting and formula escaping, NZ times).
- Playwright: name modal on first visit → +/− → set count → move to another team → recent changes on both pages →
  add/unlist an item → offline taps sync → admin add pool, CSV downloads (club, levels, log), hide.
