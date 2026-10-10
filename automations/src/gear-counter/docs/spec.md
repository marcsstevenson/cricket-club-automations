# PCC Gear Counter — spec

A phone-first website for stocktaking Parklands Cricket Club gear, one team bag at a time, plus gear pools.
It sits beside the game-day site and uses the same stack (Cloudflare Worker + Hono API + D1, SvelteKit static SPA).

## 1. Who and why

Gear volunteers count what is in each team's kit bag. The club's Kit Spec is a guide to what a bag
should hold: it decides which items are listed, but counts are not compared against it. Pools (spare gear in
storage, starting with the **Club pool**) are counted the same way. Counting needs no login: anyone with the link
can count, like the game-day team pages. A hidden admin page (§3, `/admin`) behind a shared passcode adds teams
and pools, hides them, and downloads CSVs.

## 2. Data sources

### Catalogue and Kit Spec
From `PCC Gear List 2026-27 Season - v7.xlsx` (Committee SharePoint → Gear), read by `scripts/import_gear.py`
into `shared/src/gear-data.json`, which is committed (it holds no personal data). Rerun the script when the
workbook changes.

| Data | Source |
|---|---|
| Catalogue | `Items` tab, excluding categories **Senior kit**, **Misc**, **Other safety** |
| Expected quantities | `Kit Spec` tab, one column per grade (e.g. `Kiwi Y1`, `Year 5`, `Div 3 Hardball`); only quantities above 0; columns with no quantities are dropped |

### Teams and pools
Stored in D1 (`teams`, §6) and managed on the admin page. Migration `0002_teams.sql` seeded them with the 27
game-day teams (slug, name and mascot from the game-day site; display grade, Kit Spec column and dot colour from
the workbook's `Oct Gear check` tab) plus the **Club pool**.

- A **team** has a Kit Spec column; its stocktakes start with that column's items at 0.
- A **pool** has no Kit Spec column; its stocktakes start with every catalogue item at 0.
- A team with no dot colour shows a dashed empty dot. A team or pool with no mascot shows the ball.

## 3. Pages

### Home `/`
Hero "Gear counter", then a grid of cards (mascot, name, dot + grade, or "Spare gear in storage" for a pool):
visible teams in their sort order, then visible pools (Club pool first, then pools in the order they were added).

### Team `/:slug` (teams and pools)
- Header band: mascot, name, and the grade with its dot (no colour name); pools show "Spare gear in storage".
- **Stocktake** dropdown: the team's stocktakes, named by NZ date (e.g. "9 Oct 2026"), newest first, with
  **New (today)** as the last option. Opening the page selects the newest. If the team has none, or New is chosen and
  there is nothing dated today, the page shows an unsaved draft of today's stocktake (the spec lines at 0) and the
  option reads "New (today) — not saved yet". Nothing is written until a count is entered or an item is added: the
  first + (queued like any tap, so it works offline) or + Add item creates today's stocktake. Choosing New when one is
  already dated today opens it (at most one per team per day).
- A summary line with the total: "23 items counted".
- Lines grouped by category in catalogue order. Each line: name and `[−] count [+]`. The Kit Spec quantity
  is not shown and there is no complete/short/over marking. Added lines are tagged "Added".
- − is disabled at 0. Counts never go below 0.
- A **+ Add item** button opens a modal listing catalogue items not already in this stocktake, grouped by
  category, with a search box. Tapping one adds it at count 0 and closes the modal.
- An added line shows ✕ while its count is 0; tapping it removes the line. Kit Spec lines cannot be removed.

### Admin `/admin`
Not linked from anywhere. Asks for the admin passcode once; when accepted it is kept in that browser
(`localStorage`) so later visits go straight in. A later 401 (e.g. after the passcode changes) forgets it and asks again.

- **Downloads**: **Club inventory (CSV)**, and a **CSV** button on each team/pool row (disabled when it has no stocktake).
- **Teams and pools** table: name, kind (team grade or "Pool"), latest stocktake date (or "None"), CSV button and
  **Hide**/**Unhide**. Hidden rows are marked "Hidden".
- **Add a team**: name (required), web address (slug, filled in from the name, editable), Kit Spec column
  (dropdown of the columns in `gear-data.json`), grade shown on the site (defaults to the Kit Spec column),
  dot colour (dropdown of the known colours, or none), mascot (dropdown of the images in `web/static/mascots`,
  or the ball). New teams sort after the existing teams.
- **Add a pool**: name and web address only. New pools sort after the existing pools.
- Hiding removes the team/pool from the home page and its page shows "Team not found"; its stocktakes are
  kept, still count in the CSVs, and come back on Unhide. There is no delete.

Rules: slugs are 2–30 characters of `a-z`, `0-9` and `-`, start with a letter, are unique (hidden ones included)
and cannot be `admin` or `api`. Names are 1–60 characters and unique (ignoring case).

### CSV downloads
Both use each team/pool's **latest** stocktake. Values that start with `=`, `+`, `-`, `@`, tab or CR are prefixed
with `'` so spreadsheets don't run them; files are UTF-8 with a BOM.

- **Club inventory** `club-inventory-YYYY-MM-DD.csv` (today's NZ date): one row per catalogue item in catalogue
  order. Columns: `Category`, `Item`, `Club total`, then one column per team/pool (teams, then pools, hidden ones
  included and marked "(hidden)"). The second row is `Stocktake date` with each column's stocktake date. A cell is
  the count, or blank when that stocktake has no line for the item or the team has no stocktake. `Club total` sums
  the row.
- **Team** `<slug>-YYYY-MM-DD.csv` (the stocktake's date): one row per line in the stocktake. Columns: `Category`,
  `Item`, `Count`, `Kit Spec`, `Added` (`Yes` or blank). 404 when the team has no stocktake.

### Not found
Unknown or hidden slugs show "Team not found" with a link home.

## 4. Saving

- Each tap is applied on screen immediately and queued as a change (+1/−1) per line. The queue sends changes
  one at a time; the server applies them atomically (`count = max(0, count + delta)`) and returns the new count,
  so two people counting the same bag never overwrite each other.
- The queue lives in `localStorage`, so a reload or flat battery between taps loses nothing. With no signal,
  the page shows "Offline — will sync" and retries every few seconds and when the browser comes back online.
- The page re-reads the stocktake when it regains focus and nothing is queued, to pick up other people's counts.
- Adding and removing lines need a connection; failures show an error and change nothing.
- A stocktake's lines (and their Kit Spec quantities, kept in `expected` but not displayed) are copied from
  the spec when it is created, so later Kit Spec changes do not rewrite earlier stocktakes.

## 5. API (`/api`)

| Method | Path | Result |
|---|---|---|
| GET | `/teams` | Visible team summaries (teams, then pools) |
| GET | `/teams/:slug` | Team, its Kit Spec column, today's NZ date, stocktakes (newest first); 404 if hidden |
| POST | `/teams/:slug/stocktakes` | Create or reopen today's stocktake → full stocktake |
| GET | `/stocktakes/:id` | Full stocktake with lines |
| POST | `/stocktakes/:id/lines/:itemId/adjust` | Body `{ delta }` (integer, −20…20, not 0) → `{ count }` |
| PUT | `/stocktakes/:id/lines/:itemId` | Add a catalogue item at 0 (idempotent) → line |
| DELETE | `/stocktakes/:id/lines/:itemId` | Remove an added line with count 0; otherwise 409 |

Admin routes need header `x-admin-passcode` matching the `ADMIN_PASSCODE` Worker secret (compared in constant
time): 401 when wrong or missing, 503 when the secret is not set. They are rate limited per IP (30 per minute,
`ADMIN_LIMIT`) before the passcode is checked, and send `cache-control: no-store`.

| Method | Path | Result |
|---|---|---|
| GET | `/admin/check` | `{ ok: true }` |
| GET | `/admin/teams` | All teams and pools, hidden included, with Kit Spec column, `hidden` and latest stocktake date |
| POST | `/admin/teams` | Body `{ kind, name, slug, spec?, grade?, dot?, mascot? }` → the new team; 400 invalid, 409 duplicate |
| PATCH | `/admin/teams/:slug` | Body `{ hidden }` → the team |
| GET | `/admin/export/club.csv` | Club inventory CSV |
| GET | `/admin/export/teams/:slug.csv` | Team CSV |

Errors are `{ error, message }` JSON. Writes are rate limited per IP (300 per minute).

## 6. Storage (D1)

```sql
teams(slug PK, name, kind 'team'|'pool', mascot, grade, spec, dot, sort, hidden 0|1, created_at)
stocktakes(id PK, team_slug, date 'YYYY-MM-DD' (NZ), created_at, UNIQUE(team_slug, date))
lines(stocktake_id → stocktakes, item_id, name, category, sort, expected, count, added, updated_at,
      PRIMARY KEY(stocktake_id, item_id))
```

Name, category and sort order are copied into each line so a stocktake still renders if the catalogue later changes.

## 7. Deploy

Worker `pcc-gear-counter` in the club Cloudflare account on its workers.dev URL. No custom domain, no demo
environment, no cron. Secret `ADMIN_PASSCODE` (`wrangler secret put ADMIN_PASSCODE`). Mascot and brand images are
copied from game day.

## 8. Tests

- Vitest (Workers runtime): `gear-data.json` integrity (exclusions, every Kit Spec column has items), the seeded
  teams (the 27 game-day teams + Club pool with their grades, Kit Spec columns and dots), the summary total, NZ
  dates, every API route including concurrent adjusts, the floor at 0 and same-day reopen, and every admin route
  (wrong/missing passcode, rate limit, add team/pool validation and duplicates, hide/unhide, both CSVs including
  blanks, hidden columns, quoting and formula escaping).
- Playwright: home → team → count up/down → add a line → remove it → new stocktake reopens today's → pool, and
  admin: passcode → add a pool → it appears on the home page → count on it → download both CSVs → hide it.
