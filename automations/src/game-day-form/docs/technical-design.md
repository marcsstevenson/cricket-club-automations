# Game Day Form — Technical Design

**Status:** Draft for review · **Date:** 2026-10-05
**Implements:** [`functional-spec.md`](./functional-spec.md) (as amended in §13)
**PlayHQ reference:** [`../../PLAYHQ-API-NOTES.md`](../../PLAYHQ-API-NOTES.md)

---

## 1. Summary

A single Cloudflare Worker, deployed with `wrangler deploy`, that serves:

- a **SvelteKit single-page app** (client-rendered, `ssr = false`) as static assets, and
- a **Hono JSON API** under `/api/*`.

Reports live in **D1**, photos in **R2**, and the squad JSON plus PlayHQ response cache in **KV**. The PlayHQ API key
and the squad JSON never reach the browser; the API only ever returns players as *First L.* labels with an
anonymous player key.

```
 Browser (SvelteKit SPA)
   │  same origin, JSON
   ▼
 Worker ──► static assets (web/build, SPA fallback)
   │
   └─ /api/* ─► Hono ──► D1  (reports, milestones, named players, photos, versions)
                     ├─► R2  (photo files)
                     ├─► KV  (squad JSON, PlayHQ cache)
                     └─► PlayHQ public API (x-api-key secret)
 Cron (daily) ─► delete orphaned photo uploads
```

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Rendering | Client-rendered SPA, no SSR | Secrets are protected by the API boundary, not by SSR. The SPA keeps the server simple. |
| UI framework | SvelteKit, `adapter-static`, `ssr = false` | Lightweight (~25–35 KB), file-based routing, conventional Svelte project layout. |
| API framework | Hono | Small, Workers-native router with typed context bindings. |
| Hosting | One Worker with Static Assets, `run_worker_first: ["/api/*"]` | One deploy, one origin, no CORS. |
| Database | D1 | Relational data (reports ↔ milestones ↔ photos), unique constraints, SQL for the list and exports. |
| Photos | R2, served through the Worker | No public bucket; unguessable IDs; access checks in one place. |
| Squad data | KV key `squad`, uploaded with wrangler | Kept out of git and out of the client bundle; updatable without redeploying. |
| PlayHQ cache | KV, stale-while-revalidate | Minimal PlayHQ traffic; keeps serving the last good copy if PlayHQ is down. |
| Validation | Shared module (valibot) used by both sides | Instant feedback in the browser; the Worker is the authority on save. |
| Admin protection | Shared passcode (Worker secret) | Simple on `*.workers.dev`. Switch to Cloudflare Access when a custom domain is added. |
| Language | TypeScript throughout | Types are shared between UI and API. |

## 3. Repository layout

`automations/src/game-day-form/` — two packages: the root (API, `shared/`, scripts, tests) and `web/` (SvelteKit),
which imports `shared/` through the `$shared` alias:

```
package.json            root package: API, shared, scripts, tests; top-level scripts
wrangler.jsonc          Worker config (main = api/src/index.ts, assets = web/build)
migrations/             D1 SQL migrations (0001_init.sql, …)
shared/src/
  types.ts              API request/response types, PlayerRef, Report, Milestone
  validation.ts         valibot schemas + rules from functional spec §9
  labels.ts             "First L." label generation + de-duplication
  merge.ts              refresh merge (§8.1), pure function
  dates.ts              NZ "today", game-date helpers
api/src/
  index.ts              export default { fetch: app.fetch, scheduled }
  app.ts                Hono app, error handler, route mounting
  routes/               teams.ts, games.ts, reports.ts, photos.ts, list.ts, export.ts, admin.ts
  playhq/               client.ts (fetch + headers), cache.ts (SWR), fixture.ts, summary.ts
  squad/                load.ts (KV read + schema check), match.ts
  reports/              repo.ts (D1 queries), serialize.ts (public vs admin shapes)
  photos/               store.ts (R2), cleanup.ts (cron)
  csv.ts                CSV writer with formula-injection guard
api/test/               Vitest (workers pool) + fixtures/
web/src/
  routes/+layout.ts     export const ssr = false
  routes/+page.svelte           /         team list
  routes/[team]/+page.svelte    /{team}   game picker, form, review, read-only
  routes/games/+page.svelte     /games    all-games list + exports
  routes/admin/+page.svelte     /admin    passcode + full-name exports
  lib/api.ts            typed fetch wrapper
  lib/form/             form store, sections, milestone rows, photo picker
  lib/photos/resize.ts  browser resize/re-encode
web/tests/e2e/          Playwright
web/static/brand/       club logos + favicon (§15.4)
web/static/mascots/     optimised team mascots (§15.5)
scripts/
  playhq-stub.mjs             local PlayHQ stand-in for end-to-end tests
  prepare-mascots.ts          SharePoint originals → web/static/mascots/*.webp
assets-src/             git-ignored originals (mascot PNGs)
docs/                   functional-spec.md, technical-design.md
```

## 4. Configuration

### 4.1 `wrangler.jsonc` (shape)

```jsonc
{
  "name": "pcc-game-day",
  "main": "api/src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./web/build",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "pcc-game-day", "database_id": "<id>" }],
  "r2_buckets":   [{ "binding": "PHOTOS", "bucket_name": "pcc-game-day-photos" }],
  "kv_namespaces":[{ "binding": "CONFIG", "id": "<id>" }],
  "ratelimits": [
    { "name": "WRITE_LIMIT",   "namespace_id": "1001", "simple": { "limit": 30, "period": 60 } },
    { "name": "REFRESH_LIMIT", "namespace_id": "1002", "simple": { "limit": 1,  "period": 60 } },
    { "name": "ADMIN_LIMIT",   "namespace_id": "1003", "simple": { "limit": 5,  "period": 60 } }
  ],
  "triggers": { "crons": ["0 14 * * *"] },
  "vars": { "PLAYHQ_TENANT": "nzc", "PLAYHQ_ORG_ID": "73ce5541-a7ac-457a-a912-d6408aa96a74" },
  "observability": { "enabled": true }
}
```

Secrets (`wrangler secret put`): `PLAYHQ_API_KEY`, `ADMIN_PASSCODE`.
Local secrets for `wrangler dev` go in `.dev.vars` (git-ignored).

### 4.2 Squad JSON (KV key `squad`)

```json
{
  "season": { "name": "Summer 2026/27", "playhqSeasonId": "38e4c7dd-86b4-4ca7-8c54-ccdbd8cf8fdb" },
  "teams": [
    {
      "slug": "pumas",
      "name": "Parklands Pumas",
      "playhqTeamId": "7818a28c-31a4-4383-993d-641494fcfc0e",
      "playhqGradeId": "94c8c7aa-8b37-4973-95d9-6e89223e6b2c",
      "mascot": "pumas",
      "players": [
        { "key": "p0412", "firstName": "Logan", "lastName": "Smith", "playhqId": "8a77cc56-…" }
      ]
    }
  ]
}
```

| Field | Rule |
|---|---|
| `season.playhqSeasonId` | Required. Reports are stored against it. |
| `teams[].slug` | Required, unique, lowercase `a-z0-9-`. |
| `teams[].playhqTeamId` | Required. |
| `teams[].playhqGradeId` | **Optional** — absent until PlayHQ allocates grades; the team page then shows "Fixture not available from PlayHQ yet". |
| `teams[].gradeName` | Optional. Shown in the team header (PlayHQ fixture responses don't include it). |
| `teams[].mascot` | Optional. Mascot image name (§15.5); defaults to `slug`. |
| `players[].key` | Required, unique across the file, **never reused or changed**, must not contain a name (e.g. `p0412`). |
| `players[].playhqId` | Optional. PlayHQ appearance ID; used to match PlayHQ stats. |

`squad/load.ts` validates the JSON with a valibot schema on every read (cached in isolate memory for 60 s). An invalid
file returns `500 {"error":"squad_invalid"}` and logs the schema errors.

Upload: `npx wrangler kv key put squad --path=squad.json --binding=CONFIG --remote`.

## 5. Data model (D1)

```sql
-- migrations/0001_init.sql
CREATE TABLE named_players (           -- people not in the squad JSON
  id          TEXT PRIMARY KEY,        -- random, exposed to the client as an opaque handle
  full_name   TEXT NOT NULL,
  playhq_id   TEXT,                    -- set when the name came from PlayHQ
  created_at  TEXT NOT NULL
);

CREATE TABLE reports (
  id              TEXT PRIMARY KEY,
  season_id       TEXT NOT NULL,
  team_slug       TEXT NOT NULL,
  game_id         TEXT NOT NULL,       -- PlayHQ game ID
  game_date       TEXT NOT NULL,       -- YYYY-MM-DD (NZ), copied from fixture for listing/export
  scoring         TEXT NOT NULL CHECK (scoring IN ('yes','no','yes_issues','not_played')),
  issues          TEXT,
  not_played_reason TEXT CHECK (not_played_reason IN ('rain','cancelled','forfeit','other')),
  not_played_other  TEXT,
  team_runs INTEGER, team_wkts INTEGER, opp_runs INTEGER, opp_wkts INTEGER,
  score_source    TEXT CHECK (score_source IN ('playhq','entered')),
  potd_key TEXT,   potd_named_id TEXT REFERENCES named_players(id),
  mascot_key TEXT, mascot_named_id TEXT REFERENCES named_players(id),
  highlights      TEXT,
  version         INTEGER NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  UNIQUE (season_id, team_slug, game_id)
);

CREATE TABLE milestones (
  id          TEXT PRIMARY KEY,
  report_id   TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('bat','bowl','hattrick')),
  player_key  TEXT, named_id TEXT REFERENCES named_players(id),
  value       INTEGER,                 -- runs or wickets; NULL for hattrick
  source      TEXT NOT NULL CHECK (source IN ('playhq','entered')),
  playhq_value INTEGER,                -- PlayHQ value when the row was created/last refreshed
  touched     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE photos (
  id          TEXT PRIMARY KEY,        -- random 128-bit, URL-safe
  report_id   TEXT REFERENCES reports(id) ON DELETE SET NULL,
  r2_key      TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE report_versions (
  report_id   TEXT NOT NULL REFERENCES reports(id),
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,           -- full report JSON incl. milestones + photo IDs
  saved_at    TEXT NOT NULL,
  saved_by    TEXT,
  PRIMARY KEY (report_id, version)
);

CREATE INDEX reports_list ON reports (season_id, game_date);
CREATE INDEX milestones_report ON milestones (report_id);
CREATE INDEX photos_orphans ON photos (report_id, created_at);
```

A player reference in a row is **exactly one of** a squad `*_key` or a `*_named_id`. Uniqueness of "one milestone
per player per type" is enforced in validation (squad key or named player identity) rather than by index, because a
player can be referenced either way.

## 6. Player references and labels

### 6.1 Wire format

```ts
// shared/types.ts
type PlayerRefIn =                       // client → API
  | { kind: 'squad';  key: string }
  | { kind: 'other';  fullName: string } // newly typed "Other"
  | { kind: 'playhq'; playhqId: string } // unmatched PlayHQ player from prefill/refresh
  | { kind: 'named';  id: string };      // keep an already-saved Other/PlayHQ person

type PlayerRefOut =                      // API → client (never contains a full name)
  | { kind: 'squad';  key: string; label: string }
  | { kind: 'playhq'; playhqId: string; label: string }   // e.g. "Logan S. (not in squad)"
  | { kind: 'named';  id: string; label: string };
```

On save:

- `squad` → stored as `*_key`, must exist in the team's squad.
- `other` → inserts a `named_players` row.
- `playhq` → the Worker looks up the full name in the game's PlayHQ summary (cache, else fetch) and inserts a
  `named_players` row with `playhq_id`. Rejected if the ID is not in that game.
- `named` → must already be referenced by **this report**; otherwise rejected (stops guessing other reports' IDs).

### 6.2 Labels (`shared/labels.ts`)

- Squad players: `First L.`; within a team, extend the surname prefix until labels are unique
  (`Sam Th.` / `Sam Ta.`); if still identical, append the player key's last 2 characters.
- Other / PlayHQ names: first word + initial of the last word (`Mary Jane Smith` → `Mary S.`). PlayHQ unmatched
  players add ` (not in squad)`.
- Labels are computed **server-side**; the client never sees surnames.

## 7. PlayHQ integration

### 7.1 Calls

| Purpose | Endpoint | Gives |
|---|---|---|
| Fixture for a grade | `GET /v1/grades/{gradeId}/games` | Game IDs, round, `schedule.dateTime`, status, `competitors[] {id, name, isHomeTeam}`, `venue {name}` |
| One game's result + stats | `GET /v2/games/{gameId}/summary` | Team totals (`TOTAL_SCORE`, `TOTAL_OUTS`) per innings, per-player `TOTAL_RUNS` / `WICKETS`, `appearances[]`, status |

v1 scores are **ignored** (wrong for cricket — see API notes §3). Scores and stats only come from the v2 summary.
Headers: `x-api-key: PLAYHQ_API_KEY`, `x-phq-tenant: PLAYHQ_TENANT`. Pagination on the v1 call follows
`metadata.nextCursor` (one page in practice for a grade).

### 7.2 Cache (`playhq/cache.ts`)

KV entries store `{ fetchedAt, data }` with a 30-day KV expiry. Freshness is decided in code:

| Key | Fresh for | Notes |
|---|---|---|
| `phq:fixture:{gradeId}` | 6 h | Shared by all teams in the grade |
| `phq:summary:{gameId}` | 6 h if status is final, 15 min otherwise | |

Read path:

1. Fresh → return it.
2. Stale → return it immediately, and refresh in the background with `ctx.waitUntil`.
3. Missing → fetch, store, return. If the fetch fails → `PlayhqUnavailable`.
4. Background refresh failure keeps the stale copy and logs a warning.

`refresh=true` (the Refresh button) skips steps 1–2, fetches directly, and overwrites the cache. It is limited by
`REFRESH_LIMIT` keyed on `gameId` (1/min); over the limit, the API returns the cached copy with
`"rateLimited": true` and the UI says *"Just refreshed — try again in a minute."*

Expected traffic: ≤ 1 fixture call per grade per 6 h (only when someone views a page), plus 1 summary call the first
time a game's form is opened, plus manual refreshes.

### 7.3 Mapping

- **Fixture → games for a team:** filter `competitors[].id == playhqTeamId`; opposition = the other competitor's
  `name`; venue = `venue.name`; date = `schedule[0].dateTime` converted to `Pacific/Auckland`; bye rounds have no
  game and are naturally excluded.
- **"PlayHQ has the result":** summary status is final **and** both teams have a `TOTAL_SCORE` on a `BATTING`
  period. Runs = `TOTAL_SCORE`, wickets = `TOTAL_OUTS`.
- **Milestone candidates:** for the PCC team's `BATTING` appearances with `TOTAL_RUNS ≥ 25` → `bat`; `BOWLING`
  appearances with `3 ≤ WICKETS ≤ 19` → `bowl`. Match `appearance.id` to `players[].playhqId`; unmatched → a
  `playhq` ref with a label built from the top-level `appearances[]` name.

## 8. Browser behaviour

### 8.1 Refresh merge (`shared/merge.ts`)

`merge(current: FormState, fresh: PlayhqStartData) → { next: FormState, changes: string[] }`

- **Scores:** if `fresh.result` → set all four scores, `scoreSource = 'playhq'`, read-only; if `scoring == 'no'` →
  set to `'yes'` and record the change. Otherwise leave the scores alone.
- For each milestone type (`bat`, `bowl`):
  - Row with `source = 'playhq'` and `touched = false`: update `value` / `playhqValue` from `fresh`, or remove it if
    the player is no longer a candidate.
  - Row that is `touched` or `source = 'entered'`: unchanged.
  - Candidate with no row for that player and type: add with `source = 'playhq'`.
- `touched` becomes `true` the first time a row's player or value is edited, and is saved with the row.
- `changes` produces the one-line summary, e.g. `Opposition score 128/4 → 131/4 · 1 batting milestone added`, or
  `No changes from PlayHQ`.

### 8.2 Form state and drafts

- One Svelte store per (team, game) holding `FormState`. Form, review and confirmation are views of the same store,
  so switching between them never loses input.
- The store is mirrored to `localStorage` (`draft:{team}:{gameId}`), debounced 500 ms, inside try/catch. On opening a
  game with a draft, offer *"Resume your unsaved report?"*. The draft is cleared on successful submit.
- The selected game is in the URL (`/pumas?game={gameId}`), so links can be shared and the back button works.

### 8.3 Photos (`web/src/lib/photos/resize.ts`)

- `<input type="file" accept="image/*" multiple>`; iOS Safari converts HEIC to JPEG at this point.
- `createImageBitmap(file, { imageOrientation: 'from-image' })` → canvas → `toBlob('image/jpeg', 0.8)`, longest side
  ≤ 1600 px. Re-encoding strips EXIF (including GPS).
- Files the browser can't decode show *"Couldn't read this photo — try a JPEG or PNG."*
- Each photo uploads immediately after resizing (`POST /api/photos`); the form holds the returned IDs. Removing a
  photo before submit just drops the ID (the cron job cleans it up).

### 8.4 Concurrent edits

`PUT …/report` carries `baseVersion`. If the stored `version` differs, the API returns `409` with the latest
report. The UI shows that version read-only plus a **"Your unsaved changes"** panel rendered from the local store,
so the coach can redo their edits on top of it.

## 9. API

All responses are JSON unless noted. Errors: `{ "error": "<code>", "message": "<human text>", "fields"?: {…} }`.

| Method & path | Request | Response | Notes |
|---|---|---|---|
| `GET /api/teams` | — | `[{slug, name, mascot}]` | Team list for `/` |
| `GET /api/teams/:slug` | — | `{team:{slug,name,grade,mascot}, season, today, squad:[{key,label}], fixture: {available, games:[{gameId, date, round, opposition, venue, status, reportStatus, selectable}]}, defaultGameId}` | `404 team_not_found`. `fixture.available=false` when no grade or PlayHQ unreachable with no cache. |
| `GET /api/teams/:slug/games/:gameId` | — | `{game, report?: ReportOut, start?: PlayhqStartData}` | `report` if one exists (no PlayHQ call); else `start` (summary-derived scores, milestone candidates, Q1 default). `start.available=false` if PlayHQ is unreachable. |
| `POST /api/teams/:slug/games/:gameId/refresh` | — | `{start: PlayhqStartData, rateLimited?: true}` | Bypasses cache; `REFRESH_LIMIT`. |
| `PUT /api/teams/:slug/games/:gameId/report` | `ReportIn` incl. `baseVersion` (0 for new) | `ReportOut` | Validates with `shared/validation.ts` + server checks (§9.1). `409 version_conflict` with `{latest: ReportOut}`. `WRITE_LIMIT` per IP. |
| `POST /api/photos` | `image/jpeg` body ≤ 2 MB | `{id}` | Checks JPEG magic bytes. `WRITE_LIMIT` per IP. |
| `GET /api/photos/:id` | — | image | Served if attached to a report, or created < 24 h ago. `Cache-Control: public, max-age=31536000, immutable`. |
| `GET /api/games` | `?team=&status=&followUp=` | `{today, rows:[GameRow]}` | Current season, all teams. Fixtures from cache per grade; reports from D1. |
| `GET /api/export/games.csv` | same filters | CSV | Public: labels + player keys only. |
| `GET /api/export/milestones.csv` | same filters | CSV | Public: labels + player keys only. |
| `GET /api/admin/export/games.csv`, `…/milestones.csv` | header `X-Admin-Passcode` | CSV | Adds full-name columns. `401` on wrong passcode; `ADMIN_LIMIT` per IP. Constant-time compare. |

### 9.1 Server-side save checks (beyond shared validation)

- `gameId` is in the team's fixture and its date is on or before NZ today.
- Squad keys exist in this team; `named` IDs belong to this report; `playhq` IDs are in this game's summary.
- If PlayHQ has the result (from cache/fetch at save time), stored scores come from PlayHQ and `score_source =
  'playhq'`; client-sent scores are ignored. If PlayHQ is unreachable at save time, client scores are accepted only
  when the client marks them `entered`.
- At most 5 photo IDs; each exists and is unattached or attached to this report.
- Save is one D1 `batch()`: upsert report (incrementing `version`), replace milestones, attach/detach photos, insert
  `named_players` rows, insert `report_versions` snapshot.

### 9.2 CSV

- RFC 4180 quoting, UTF-8 with BOM (opens cleanly in Excel).
- **Formula-injection guard:** any cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`.
- Columns follow functional spec §8.3 as amended (§13): public files use `label` + `player_key` (or `named_id`);
  admin files add `full_name`.

## 10. Scheduled job

Daily cron (`0 14 * * *` UTC ≈ 2–3 am NZ):

- Delete photos with `report_id IS NULL AND created_at < now − 24 h` from R2 and D1.
- Delete photos detached by an edit (also `report_id IS NULL`) the same way.

## 11. Errors and observability

- Hono `onError` maps known errors (`team_not_found`, `validation_failed`, `version_conflict`, `rate_limited`,
  `squad_invalid`, `playhq_unavailable`) to status codes; unknown errors → `500 internal` with a request ID.
- The UI shows field errors inline and other errors as a banner; the form is never blocked by PlayHQ failures.
- Worker logs (`observability.enabled`) record PlayHQ fetches (status, duration, cache hit/stale/miss), save
  conflicts and validation failures. Logs never include full names or the passcode.

## 12. Testing

| Layer | Tool | Covers |
|---|---|---|
| `shared/` | Vitest | Validation rules (spec §9), label generation and de-duplication, refresh merge cases, NZ date helpers |
| API | Vitest + `@cloudflare/vitest-pool-workers` (local D1/R2/KV) | Routes, PlayHQ caching (fresh / stale / miss / failure), refresh rate limit, save checks, 409 conflict, photo lifecycle + cron cleanup, public CSVs contain **no** full names, admin passcode |
| End-to-end | Playwright against `wrangler dev` | Open team → fill form → review → submit → reopen read-only → edit → save |

`createApp(deps)` takes injected `fetch`, `now`, `id` and `limit` functions, so tests supply a fake PlayHQ (small
hand-written builders in `api/test/fixtures/playhq.ts`, shaped like the live responses), a fixed clock and an
always-allow rate limiter. End-to-end tests run `wrangler dev` against `scripts/playhq-stub.mjs` via the
`PLAYHQ_BASE_URL` var. A fake `squad.json` (no real names) is checked in for tests and local dev.

## 13. Amendments to the functional spec

Agreed during technical design; applied to `functional-spec.md`:

1. **Full names nowhere public.** All public screens, the all-games list and public exports show *First L.* plus an
   anonymous player key. "Other" names are stored in full but displayed as *First L.*, including when editing.
2. **Unmatched PlayHQ players** show as *First L. (not in squad)*; the full name is stored server-side.
3. **Admin exports** with full names at `/admin`, protected by a shared passcode.
4. **Squad JSON** gains a required, never-changing `key` per player; `playhqId` becomes optional;
   `playhqGradeId` is optional until grades are allocated.
5. **`/` lists all teams**, each linking to `/{slug}`. Unknown teams still get "Team not found", linking to `/`.
6. **PlayHQ data is cached** (fixture 6 h; game result 6 h once final, 15 min before) and Refresh is limited to once
   a minute per game.
7. **Unsaved drafts** are kept on the device and offered back when the game is reopened.

## 14. Deployment

### 14.1 One-time setup

```bash
npx wrangler d1 create pcc-game-day            # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create pcc-game-day-photos
npx wrangler kv namespace create CONFIG        # paste id into wrangler.jsonc
npx wrangler secret put PLAYHQ_API_KEY
npx wrangler secret put ADMIN_PASSCODE
npx wrangler kv key put squad --path=squad.json --binding=CONFIG --remote
```

### 14.2 Release

```bash
npm run build                                   # builds web/ → web/build
npx wrangler d1 migrations apply pcc-game-day --remote
npx wrangler deploy
```

### 14.3 Environments

- **Local:** `npm run dev` → `wrangler dev` with local D1/R2/KV, `.dev.vars` secrets, the fake test squad, and either
  live PlayHQ or the local stub (`--var PLAYHQ_BASE_URL:http://127.0.0.1:8790`).
- **Production:** `pcc-game-day.<account>.workers.dev`.

### 14.4 Season rollover

Upload a new `squad.json` with the new `playhqSeasonId` (and new grade IDs once allocated). Old reports stay in D1
keyed by season and drop out of the current-season views.

### 14.5 Moving to a custom domain later

Add the route in `wrangler.jsonc`, then put Cloudflare Access in front of `/admin*` and `/api/admin/*` and remove the
passcode check.

## 15. Branding

Matches <https://parklandscricket.co.nz/> (values read from the live site on 2026-10-05). Light theme only, as on the
club site.

### 15.1 Tokens (`web/src/lib/styles/tokens.css`)

| Token | Value | Site usage | Use here |
|---|---|---|---|
| `--pcc-navy-900` | `#02152B` | Body text | Body text, text on teal buttons |
| `--pcc-navy-700` | `#052F5F` | Header bar, hero, h2 | Team header band, secondary buttons, headings on light |
| `--pcc-teal-400` | `#40BEB3` | Hero h1, buttons, ball icon | Primary button fill, team name on navy, accents |
| `--pcc-teal-600` | `#22948A` | Accents | Focus ring, icons, borders (not body text) |
| `--pcc-blue-700` | `#005377` | Links | Links on light backgrounds |
| `--pcc-bg` | `#F4F4F4` | Page background | Page background |
| `--pcc-surface` | `#FFFFFF` | Cards | Form sections, cards, mascot backing |
| `--pcc-error` | `#B42318` | *(not on site)* | Validation errors, Missing status |

**Contrast (WCAG AA).** The club site uses white text on teal buttons, which is only **2.27:1** and fails AA. This
app uses **navy-900 text on teal-400 (8.07:1)** for primary buttons instead, keeping the same look. Other pairs used:
teal-400 on navy-700 5.85:1 (team name — large text), white on navy-700 13.3:1, navy-900 on bg 16.7:1,
blue-700 on bg 7.6:1. Teal-600 (3.7:1 on white) is used only for non-text elements.

### 15.2 Type

- **Headings and buttons:** Outfit, weight 800 (headings) / 700 (buttons), uppercase — as on the site.
- **Body and form fields:** Lexend 400 / 600.
- Self-hosted via `@fontsource/outfit` and `@fontsource/lexend` (latin subset, woff2), so no third-party font
  requests.
- Square corners (0–4 px radius) on buttons and inputs, as on the site.

### 15.3 Layout

- **Header:** light bar with the club's horizontal logo (links to `/`) and an **All games** link.
- **Team header band** (team page): navy-700 background; mascot on a white rounded card on the left; team name in
  Outfit 800 uppercase teal-400; grade and season in white.
- **Home page (`/`):** grid of team cards — mascot thumbnail plus team name — linking to each team page.
- **Form:** each question group in a white card on the light page background; one column on phones.
- **Status badges:** Reported (teal-400 tint, navy text), Not played (grey outline), Missing (error tint, navy
  text), Upcoming (grey).
- **Confirmation screen:** team mascot with *"Thanks — report saved."*
- **Favicon:** the club's teal ball.

### 15.4 Brand assets

Copied once into `web/static/brand/` from the club site:

| File | Source |
|---|---|
| `pcc-logo-horizontal.svg` | `…/wp-content/uploads/2025/08/PCC-Logo-Horizontal-Solid-Main.svg` (light backgrounds) |
| `pcc-logo-horizontal-dark.svg` | `…/wp-content/uploads/2025/09/PCC-Logo-Horizontal-Dark-Bkg.svg` (dark backgrounds) |
| `pcc-ball-teal.png` | Site favicon (`PCC-Ball-Teal`), also used as the fallback mascot |

### 15.5 Team mascots

**Source:** SharePoint → PCC Committee → Documents → `Marketing/Team certs and mascots/Mascots`. There are 27 team
images (`bears.png` … `wombats.png`, plus `Lions.jpg`). They are 3000 × 2250 px, opaque white background, and
0.5–3.7 MB each, so they are too large to serve as-is.

**Pipeline:** `scripts/prepare-mascots.ts` (uses `sharp`):

1. Reads originals from a git-ignored `assets-src/mascots/` folder (downloaded from SharePoint).
2. Trims the surrounding white space, then pads it back evenly to a square.
3. Writes `web/static/mascots/{name}.webp` (512 px, ~30–60 KB) and `{name}-sm.webp` (128 px) for each image,
   with the file name lower-cased.

Mascots are public and not sensitive, so they ship as static assets with the UI.

**Squad JSON:** each team gets an optional `mascot` field (e.g. `"pumas"`). It defaults to the team `slug`. If no
file matches, the PCC teal ball is shown. `GET /api/teams` and `GET /api/teams/:slug` return the resolved mascot
name.

Because the images have white backgrounds, they are always shown on a white card or circle, never directly on navy or
the grey page background.

## 16. Open questions

None blocking. To confirm during implementation:

- The exact v1 `status` values PlayHQ uses for cancelled/abandoned games, to show them in the dropdown.
- Whether PlayHQ appearance IDs stay stable for a player across seasons (affects reusing `playhqId` in next season's
  squad file; does not affect this season).
