# PCC Gear Counter — spec

A phone-first website for stocktaking Parklands Cricket Club gear, one team bag at a time, plus the club pool.
It sits beside the game-day site and uses the same stack (Cloudflare Worker + Hono API + D1, SvelteKit static SPA).

## 1. Who and why

Gear volunteers count what is in each team's kit bag. The club's Kit Spec is a guide to what a bag
should hold: it decides which items are listed, but counts are not compared against it. The club pool (spare gear in storage) is counted the same way. There is no login
and no admin: anyone with the link can count, like the game-day team pages.

## 2. Data sources

All from `PCC Gear List 2026-27 Season - v7.xlsx` (Committee SharePoint → Gear), read by `scripts/import_gear.py`
into `shared/src/gear-data.json`, which is committed (it holds no personal data). Rerun the script when the workbook changes.

| Data | Source |
|---|---|
| Teams (slug, name, mascot) | The game-day site's public `/api/teams` — the same 27 teams |
| Grade and dot colour | `Oct Gear check` tab (`Grade`, `Dot colour`), matched by the first word of the team name |
| Catalogue | `Items` tab, excluding categories **Senior kit**, **Misc**, **Other safety** |
| Expected quantities | `Kit Spec` tab, the column for the team's grade; only quantities above 0 |

Grade → Kit Spec column:

| Oct Gear check grade | Kit Spec column |
|---|---|
| Kiwi - Year 1, Kiwi - Year 1/2 | Kiwi Y1 (identical to Kiwi Y2) |
| Kiwi - Year 2 | Kiwi Y2 |
| Year 3, Year 4, Year 5 | same name |
| Y6, Y7 | Year 6, Year 7 |
| Division 5, Division 4 | Div 5, Div 4 |
| Div 3 - Hardball | Div 3 Hardball |

An unknown grade, an unmatched team or a missing sheet stops the import with an error. A team with no dot colour shows a dashed empty dot.

The **Club pool** is an extra "team" (`/pool`) whose spec is every catalogue item at 0.

## 3. Pages

### Home `/`
Hero "Gear counter", then a grid of team cards (mascot, name, dot, grade) in the game-day order, with the
Club pool card last.

### Team `/:slug`
- Header band: mascot, team name, and the grade with its dot (no colour name).
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

### Not found
Unknown slugs show "Team not found" with a link home.

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
| GET | `/teams` | Team summaries (pool last) |
| GET | `/teams/:slug` | Team, today's NZ date, stocktakes (newest first) |
| POST | `/teams/:slug/stocktakes` | Create or reopen today's stocktake → full stocktake |
| GET | `/stocktakes/:id` | Full stocktake with lines |
| POST | `/stocktakes/:id/lines/:itemId/adjust` | Body `{ delta }` (integer, −20…20, not 0) → `{ count }` |
| PUT | `/stocktakes/:id/lines/:itemId` | Add a catalogue item at 0 (idempotent) → line |
| DELETE | `/stocktakes/:id/lines/:itemId` | Remove an added line with count 0; otherwise 409 |

Errors are `{ error, message }` JSON. Writes are rate limited per IP (300 per minute).

## 6. Storage (D1)

```sql
stocktakes(id PK, team_slug, date 'YYYY-MM-DD' (NZ), created_at, UNIQUE(team_slug, date))
lines(stocktake_id → stocktakes, item_id, name, category, sort, expected, count, added, updated_at,
      PRIMARY KEY(stocktake_id, item_id))
```

Name, category and sort order are copied into each line so a stocktake still renders if the catalogue later changes.

## 7. Deploy

Worker `pcc-gear-counter` in the club Cloudflare account on its workers.dev URL. No custom domain, no demo
environment, no cron, no admin. Mascot and brand images are copied from game day.

## 8. Tests

- Vitest (Workers runtime): data integrity of `gear-data.json` (exclusions, every team has a spec), the summary total,
  NZ dates, and every API route including concurrent adjusts, the floor at 0 and same-day reopen.
- Playwright: home → team → count up/down → add a line → remove it → new stocktake reopens today's → pool.
