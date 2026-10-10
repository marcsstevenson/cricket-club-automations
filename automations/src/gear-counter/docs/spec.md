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
Stored in D1 (§6) and edited on the admin Items page (§3.7). Migration `0004_catalogue.sql` seeded them from the
gear workbook `PCC Gear List 2026-27 Season - v7.xlsx` (via the former `gear-data.json`): 62 items in 11 categories
(excluding the workbook's **Senior kit**, **Misc** and **Other safety**) and 17 Kit Spec columns with their
quantities. Since then the admin page is the only source; the workbook import is retired.

- **Categories** have a name and an order. **Items** have a name, a category, an order within it, and may be
  **retired**. **Kit Spec columns** (one per grade, e.g. `Year 5`) give each item a quantity 0–99.
- Catalogue order is category order, then item order within the category.
- Item ids (e.g. `STU-03`) never change and are never shown; new items get a generated id (`X-` + 6 hex digits).

### Teams and pools
D1 `teams` (§6), managed on the admin page; seeded with the 27 game-day teams and the **Club pool**.

- A **team** has a Kit Spec column; its Kit Spec items (quantity > 0, not retired) are always listed.
- A **pool** has no Kit Spec column; every item that is not retired is always listed.
- Other items are listed while a team/pool holds them or after **+ Add item**; at level 0 they can be removed (✕).
  A retired item, or one dropped from the team's Kit Spec, stays listed wherever it is held until it reaches 0.
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
- **+ Add item** opens a modal of items (not retired) not listed here, grouped by category, with a search box; tapping one
  lists it at 0.
- Items that are not always listed here (retired, dropped from the Kit Spec, or added) are tagged "Retired" or
  "Added"; at level 0 with nothing queued they show ✕ instead of −, and tapping it unlists them.
- **Move…** dialog: destination (any other visible team or pool), quantity (1 – current level), optional note.
  **Move** moves the gear: this level goes down, the destination's goes up, and the destination lists the item.
- **Set count…** dialog: new level (0–999), optional note. **Save** sets the level outright.
- **Recent changes**: the newest 50 log entries for this team or pool, newest first, e.g.
  - `Sam · 11 Oct, 2:14 pm · Tall cones +2`
  - `Jo · 11 Oct, 9:03 am · Moved 3 Helmets J to Parklands Pumas · "for Saturday"`
  - `Jo · 11 Oct, 9:03 am · Received 3 Helmets J from Club pool · "for Saturday"`
  - `Sam · 10 Oct, 4:40 pm · Set Bails (pair) 4 → 6`
  - `Migration · 10 Oct, 9:31 am · Opening level Bails (pair) 4`
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

### 3.7 Admin Items `/admin/items`
Linked from `/admin` ("Edit items") and behind the same passcode.

- **Categories**: list in order with **↑ / ↓**, **Rename**, **Delete** (only when it has no items), and **Add a
  category** (added last).
- **Items**, grouped by category in order: each row shows the name, where it is held ("3 teams · 12 in the club"),
  **↑ / ↓** within its category, **Edit** (name, category — moving category puts it last there) and
  **Retire** / **Unretire**. Retired items are shown greyed and tagged "Retired". **Add an item**: name and category
  (added last in the category).
- **Kit Spec**: choose a grade column; its items are listed by category with a quantity box each (0–99, blank = 0);
  **Save** replaces that column's quantities. **Add a grade**, **Rename** (teams using it follow), and **Delete**
  (only when no team uses it). Retired items are not shown in the grid.
- Names are 1–60 characters after trimming and unique ignoring case: categories and grades across the catalogue, items
  within their category (several categories have items called "J" or "Y").
- Catalogue changes are not logged in the gear log. Teams pick up new Kit Spec items and pools pick up new items
  (at 0) the next time their page or CSV is loaded.

### 3.5 CSV downloads
UTF-8 with a BOM; values starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`; times are NZ local.

- **Club inventory** `club-inventory-YYYY-MM-DD.csv` (today, NZ): one row per item in catalogue order (retired items
  only while someone holds them, marked "(retired)").
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
**+ Add item** lists an item at 0 (idempotent, no log entry); retired items cannot be added (409). Unlisting needs
level 0 and an item that is not always listed there (§2); otherwise 409. A move into a team lists the item there.

## 5. API (`/api`)

Every change takes `who` (1–40 characters after trimming; 400 without it). Errors are `{ error, message }` JSON.
Writes are rate limited per IP (300 per minute).

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/catalogue` | | `{ categories, items, specs }`: categories and items (not retired) in order, Kit Spec column names |
| GET | `/teams` | | Visible team summaries (teams, then pools) |
| GET | `/teams/:slug` | | `{ team, spec, levels, recent }`; 404 if hidden |
| POST | `/teams/:slug/items/:item/adjust` | `{ delta, who }` (integer −20…20, not 0) | `{ level }` |
| PUT | `/teams/:slug/items/:item` | `{ who }` | the listed level line |
| DELETE | `/teams/:slug/items/:item` | | 204; 409 if level > 0 or a Kit Spec item |
| POST | `/teams/:slug/items/:item/count` | `{ level, who, note? }` (0–999) | `{ level }` |
| POST | `/moves` | `{ from, to, item, qty, who, note? }` (qty 1–999) | `{ fromLevel, toLevel }`; 409 if short |

Notes are up to 200 characters. `levels` lines: `{ itemId, name, category, level, kitSpec, added, retired, pinned }` (`pinned` = always listed). `recent`: the
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
| GET | `/admin/catalogue` | Categories, all items (retired included) with `holders` and `total`, Kit Spec columns with quantities and `teams` using each |
| POST | `/admin/categories` | `{ name }` → category; PATCH `/admin/categories/:id` `{ name }`; DELETE (409 unless empty) |
| POST | `/admin/categories/:id/move` | `{ direction: "up" or "down" }` |
| POST | `/admin/items` | `{ name, categoryId }` → item; PATCH `/admin/items/:id` `{ name?, categoryId?, retired? }` |
| POST | `/admin/items/:id/move` | `{ direction }` (within its category) |
| POST | `/admin/kit-specs` | `{ name }` → column; PATCH `/admin/kit-specs/:id` `{ name }`; DELETE (409 if a team uses it) |
| PUT | `/admin/kit-specs/:id/items` | `{ [itemId]: qty }` (0–99) replaces the column's quantities |

## 6. Storage (D1)

```sql
categories(id INTEGER PK, name UNIQUE NOCASE, sort)
items(id TEXT PK, category_id → categories, name, sort, retired 0|1, created_at, UNIQUE(category_id, name NOCASE))
kit_specs(id INTEGER PK, name UNIQUE NOCASE, sort)
kit_spec_items(spec_id → kit_specs, item_id → items, qty 1–99, PRIMARY KEY(spec_id, item_id))
teams(slug PK, name, kind 'team'|'pool', mascot, grade, spec (kit_specs.name), dot, sort, hidden 0|1, created_at)
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

### Catalogue migration (`0004_catalogue.sql`)
Generated once from `gear-data.json` by `scripts/catalogue_migration.py`; afterwards `gear-data.json`, `import_gear.py`
and `levels_migration.py` are removed (a copy of `gear-data.json` stays as a test fixture to check the seed).

## 7. Deploy

Worker `pcc-gear-counter` in the club Cloudflare account on its workers.dev URL. Secret `ADMIN_PASSCODE`. `npm run
deploy` builds, applies D1 migrations, then deploys. Taps still queued on a phone from before this change cannot be
sent after it (their routes are gone) and are dropped with an error.

## 8. Tests

- Vitest (Workers runtime): the catalogue seed matches the old `gear-data.json` exactly; every catalogue admin route
  (validation, uniqueness, ordering, delete only when empty/unused, rename follows teams, column save), retired and
  dropped-from-Kit-Spec items staying while held and removable at 0, new items/Kit Spec items reaching pools/teams;
  seeded teams; adjust (atomic, concurrent, floor at 0, logs
  the applied change); grouping (same name within 2 minutes merges, case-insensitive; different name, later than 2
  minutes, different item or a non-adjust entry in between start a new entry; a group netting to 0 is deleted);
  list/unlist rules; set count (logs old → new, no-op when equal); moves (atomic, 409 when short, same team refused,
  hidden refused, destination listed, paired entries); `who` required; recent changes shape and limit; the migration
  applied to stocktake data; admin (passcode, rate limit, add/hide, all three CSVs incl. blanks, hidden columns,
  quoting and formula escaping, NZ times).
- Playwright: name modal on first visit → +/− → set count → move to another team → recent changes on both pages →
  add/unlist an item → offline taps sync → admin add pool, CSV downloads (club, levels, log), hide.
