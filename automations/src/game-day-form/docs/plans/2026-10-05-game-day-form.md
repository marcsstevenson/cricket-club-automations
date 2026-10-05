# Game Day Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PCC game-day report app: a SvelteKit SPA and a Hono API in one Cloudflare Worker, with reports in D1, photos in R2, the squad and PlayHQ cache in KV.

**Architecture:** One Worker serves the built SPA as static assets and runs a Hono app for `/api/*`. All PlayHQ calls, squad data and full player names stay in the Worker; the browser only receives *First L.* labels and anonymous keys. Pure logic (validation, labels, refresh merge, dates) lives in `shared/` and runs in both browser and Worker.

**Tech Stack:** TypeScript, Cloudflare Workers + D1 + R2 + KV + Rate Limiting + Cron, Wrangler, Hono, valibot, SvelteKit 2 / Svelte 5 (`adapter-static`, `ssr = false`), Vitest + `@cloudflare/vitest-pool-workers`, Playwright, sharp.

**Spec:** [`../functional-spec.md`](../functional-spec.md) and [`../technical-design.md`](../technical-design.md). Read both before starting. Where this plan differs from the technical design, this plan wins (see "Design adjustments" below).

**Working directory:** `D:\git\marcsstevenson\pcc\automations\src\game-day-form` (called `game-day-form/` below). All commands run from there unless stated.

## Design adjustments made while planning

These refine the technical design; they are already reflected in every task.

1. **Two packages, not npm workspaces.** Root `package.json` holds the API, `shared/`, scripts and tests. `web/` is a standard SvelteKit project with its own `package.json`. The SPA imports shared code through the `$shared` alias (`../shared/src`).
2. **Injected dependencies.** `createApp(deps)` takes `{ fetch, now, id, limit }`. Production uses real ones; tests inject fakes. That makes PlayHQ, time, IDs and rate limits deterministic in tests without relying on `fetchMock`.
3. **Hand-written PlayHQ test fixtures** (small builders in `api/test/fixtures/playhq.ts`) instead of recorded responses. A local stub server (`scripts/playhq-stub.mjs`) serves the same shapes for end-to-end tests, selected with the `PLAYHQ_BASE_URL` var.
4. **valibot checks the request shape; `validateReport` checks the rules** (spec §9).
5. **Squad JSON gains optional `gradeName`** (PlayHQ fixture responses don't include the grade name).
6. **Mascot fallback happens in the browser** (`<img onerror>` swaps to the club ball); the API just returns `mascot ?? slug`.
7. **Scores on save:** if PlayHQ (cache or fetch) has the final result, the server stores PlayHQ's scores with `score_source = 'playhq'`; otherwise it stores the coach's validated scores with `score_source = 'entered'`.
8. **Named players carry `playhqId` to the client** (an ID only, never a name) so Refresh doesn't duplicate an already-saved "not in squad" milestone.

## Global Constraints

- Full player names (squad surnames, "Other" names, PlayHQ names) must **never** appear in any public API response or public CSV. Only `/api/admin/*` may return them.
- Player labels: `First L.`; duplicates extend the surname prefix (`Sam Th.` / `Sam Ta.`); identical names append the last 2 characters of the key.
- Team score wickets: whole number 0–30. Team score runs: whole number 0–999.
- Batting milestone runs: whole number 25–999. Bowling milestone wickets: whole number 3–19. Hat-tricks have no value.
- One milestone per player per type per report. Exactly one player of the day and one mascot of the day (unless Game not played).
- Photos: at most 5 per report; uploaded as JPEG only, ≤ 2 MB, resized in the browser to ≤ 1600 px longest side at quality 0.8.
- Text limits: issues 2000, highlights 5000, not-played "other" reason 200, "Other" full name 120, "Your name" 80 characters.
- All dates and "today" use `Pacific/Auckland`. A game is selectable when its date ≤ today. **Missing** = date < today and no report.
- PlayHQ: fixture from `GET /v1/grades/{gradeId}/games` (names, venue, `schedule.date`, status); scores and player stats only from `GET /v2/games/{gameId}/summary`. Never use v1 scores.
- PlayHQ cache: fixture fresh 6 h; summary fresh 6 h when `status === 'FINAL'`, else 15 min; stale entries are served while refreshing in the background; KV expiry 30 days.
- Rate limits: Refresh 1 per minute per game; saves and photo uploads 30 per minute per IP; admin requests 5 per minute per IP.
- API errors are always JSON `{ error, message, ...extra }`.
- CSV: UTF-8 with BOM, RFC 4180 quoting, cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`.
- Brand tokens: navy-900 `#02152B`, navy-700 `#052F5F`, teal-400 `#40BEB3`, teal-600 `#22948A`, blue-700 `#005377`, bg `#F4F4F4`, surface `#FFFFFF`, error `#B42318`. Primary buttons use **navy-900 text on teal-400**, never white on teal. Headings/buttons Outfit 800/700 uppercase; body Lexend 400/600; radius 0–4 px. Light theme only.
- No sign-in except the admin passcode (`X-Admin-Passcode` header, constant-time compare).
- Never commit `.env`, `.dev.vars`, real squad JSON, or the mascot originals.

## Review Focus

1. **A PlayHQ game with no date yet (TBC)** — must show as "Date TBC", not selectable, and never "Missing". Test in Task 7.
2. **A squad key removed from the JSON after reports were saved** — viewing that report must show "Unknown player", not crash. Test in Task 9.
3. **A coach double-taps Submit** — must save once and must not show the "updated by someone else" conflict. Submit is disabled while saving (Task 17) and the e2e test double-clicks it (Task 19).
4. **A game whose PlayHQ summary isn't final or only has one innings** (abandoned, or scoring still in progress) — no result, scores stay editable. Test in Task 8.
5. **A link typed with capitals (`/Pumas`)** — must open the team. Test in Task 5 (API) and handled in the page load (Task 15).

## File map

```
game-day-form/
  .gitignore, .dev.vars.example, package.json, tsconfig.json
  wrangler.jsonc, wrangler.test.jsonc, vitest.config.ts, playwright.config.ts
  migrations/0001_init.sql
  shared/src/   types.ts  api.ts  text.ts  dates.ts  labels.ts  validation.ts  merge.ts
  shared/test/  dates.test.ts  labels.test.ts  validation.test.ts  merge.test.ts
  api/src/
    index.ts  app.ts  env.ts  errors.ts  csv.ts
    squad/load.ts
    playhq/types.ts  client.ts  cache.ts  service.ts  fixture.ts  summary.ts
    reports/repo.ts  serialize.ts  resolve.ts
    photos/cleanup.ts
    list/rows.ts
    routes/context.ts  teams.ts  games.ts  reports.ts  photos.ts  list.ts  admin.ts
  api/test/
    setup.ts  env.d.ts  helpers.ts  builders.ts
    fixtures/squad.json  fixtures/playhq.ts
    app.test.ts  squad.test.ts  playhq-cache.test.ts  teams.test.ts  games.test.ts
    repo.test.ts  reports.test.ts  photos.test.ts  list.test.ts  csv.test.ts
  scripts/prepare-mascots.ts  scripts/playhq-stub.mjs
  web/  (SvelteKit project)
    svelte.config.js  vite.config.ts  src/app.html
    src/lib/api.ts  Mascot.svelte  styles/tokens.css  styles/app.css
    src/lib/game/GamePicker.svelte  GameView.svelte
    src/lib/form/game-form.svelte.ts  drafts.ts  ReportForm.svelte  FieldError.svelte
                 NumberInput.svelte  PlayerPicker.svelte  MilestoneList.svelte  PhotoPicker.svelte
    src/lib/report/ReportSummary.svelte
    src/lib/photos/resize.ts
    src/routes/+layout.ts  +layout.svelte  +error.svelte  +page.ts  +page.svelte
    src/routes/[team]/+page.ts  +page.svelte
    src/routes/games/+page.ts  +page.svelte
    src/routes/admin/+page.svelte
    static/brand/*  static/mascots/*
    tests/e2e/game-day.spec.ts
  docs/  functional-spec.md  technical-design.md  plans/  README section in Task 19
```

---

### Task 1: Project scaffold, Worker skeleton, D1 schema

**Files:**
- Create: `.gitignore`, `.dev.vars.example`, `package.json`, `tsconfig.json`, `wrangler.jsonc`, `wrangler.test.jsonc`, `vitest.config.ts`
- Create: `migrations/0001_init.sql`
- Create: `api/src/env.ts`, `api/src/errors.ts`, `api/src/app.ts`, `api/src/index.ts`
- Test: `api/test/setup.ts`, `api/test/env.d.ts`, `api/test/helpers.ts`, `api/test/app.test.ts`

**Interfaces:**
- Produces: `Env`, `Deps`, `AppEnv`, `LimitName`, `defaultDeps` (`api/src/env.ts`); `ApiError(status, code, message, extra?)` (`api/src/errors.ts`); `createApp(deps: Deps): Hono<AppEnv>` (`api/src/app.ts`); test helpers `testDeps(over?)`, `call(app, path, init?)`.

- [ ] **Step 1: Git and folders**

`D:\git\marcsstevenson\pcc` is not a git repository yet. Check, and initialise only if needed:

```bash
cd /d/git/marcsstevenson/pcc && (git rev-parse --is-inside-work-tree 2>/dev/null || git init)
cd automations/src/game-day-form
mkdir -p api/src/routes api/test/fixtures shared/src shared/test migrations scripts
```

- [ ] **Step 2: Config files**

`.gitignore`:

```gitignore
node_modules/
.wrangler/
.dev.vars
web/build/
web/.svelte-kit/
web/node_modules/
assets-src/
test-results/
playwright-report/
squad.json
```

`.dev.vars.example`:

```ini
# Copy to .dev.vars for `wrangler dev`. Never commit .dev.vars.
PLAYHQ_API_KEY=
ADMIN_PASSCODE=letmein
```

`package.json`:

```json
{
  "name": "pcc-game-day",
  "private": true,
  "type": "module",
  "scripts": {
    "build:web": "npm --prefix web run build",
    "build": "npm run build:web",
    "dev": "npm run build:web && wrangler dev",
    "dev:web": "npm --prefix web run dev",
    "test": "vitest run",
    "typecheck": "tsc --noEmit && npm --prefix web run check",
    "mascots": "tsx scripts/prepare-mascots.ts",
    "e2e:prepare": "node -e \"require('fs').rmSync('.wrangler/state',{recursive:true,force:true})\" && npm run build:web && wrangler d1 migrations apply pcc-game-day --local && wrangler kv key put squad --path=api/test/fixtures/squad.json --binding=CONFIG --local",
    "e2e": "playwright test",
    "deploy": "npm run build && wrangler d1 migrations apply pcc-game-day --remote && wrangler deploy"
  }
}
```

Install dependencies. `@cloudflare/vitest-pool-workers` pins a Vitest range — install the Vitest major it asks for:

```bash
npm i hono valibot
npm view @cloudflare/vitest-pool-workers peerDependencies
npm i -D wrangler typescript @cloudflare/workers-types @cloudflare/vitest-pool-workers vitest@<major from peerDependencies> tsx sharp @playwright/test
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["api", "shared"]
}
```

`wrangler.jsonc` (IDs are placeholders until Task 19's one-time setup; set `compatibility_date` to the day you scaffold):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "pcc-game-day",
  "main": "api/src/index.ts",
  "compatibility_date": "2026-10-05",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./web/build",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "pcc-game-day", "database_id": "local-placeholder", "migrations_dir": "migrations" }
  ],
  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "pcc-game-day-photos" }],
  "kv_namespaces": [{ "binding": "CONFIG", "id": "local-placeholder" }],
  "ratelimits": [
    { "name": "WRITE_LIMIT", "namespace_id": "1001", "simple": { "limit": 30, "period": 60 } },
    { "name": "REFRESH_LIMIT", "namespace_id": "1002", "simple": { "limit": 1, "period": 60 } },
    { "name": "ADMIN_LIMIT", "namespace_id": "1003", "simple": { "limit": 5, "period": 60 } }
  ],
  "triggers": { "crons": ["0 14 * * *"] },
  "vars": {
    "PLAYHQ_TENANT": "nzc",
    "PLAYHQ_ORG_ID": "73ce5541-a7ac-457a-a912-d6408aa96a74",
    "PLAYHQ_BASE_URL": "https://api.playhq.com"
  },
  "observability": { "enabled": true }
}
```

`wrangler.test.jsonc` (no assets, no rate limits — tests inject `deps.limit`):

```jsonc
{
  "name": "pcc-game-day-test",
  "main": "api/src/index.ts",
  "compatibility_date": "2026-10-05",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [{ "binding": "DB", "database_name": "test", "database_id": "test" }],
  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "test" }],
  "kv_namespaces": [{ "binding": "CONFIG", "id": "test" }],
  "vars": { "PLAYHQ_TENANT": "nzc", "PLAYHQ_ORG_ID": "org-test", "PLAYHQ_BASE_URL": "https://api.playhq.com" }
}
```

`vitest.config.ts` (if the installed pool's README shows a different config API, follow it — keep the same bindings, migrations and setup file):

```ts
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      include: ['shared/test/**/*.test.ts', 'api/test/**/*.test.ts'],
      setupFiles: ['./api/test/setup.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          isolatedStorage: true,
          wrangler: { configPath: './wrangler.test.jsonc' },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations, PLAYHQ_API_KEY: 'test-key', ADMIN_PASSCODE: 'letmein' },
          },
        },
      },
    },
  };
});
```

- [ ] **Step 3: D1 schema**

`migrations/0001_init.sql`:

```sql
CREATE TABLE named_players (
  id          TEXT PRIMARY KEY,
  full_name   TEXT NOT NULL,
  playhq_id   TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE reports (
  id                TEXT PRIMARY KEY,
  season_id         TEXT NOT NULL,
  team_slug         TEXT NOT NULL,
  game_id           TEXT NOT NULL,
  game_date         TEXT NOT NULL,
  scoring           TEXT NOT NULL CHECK (scoring IN ('yes','no','yes_issues','not_played')),
  issues            TEXT,
  not_played_reason TEXT CHECK (not_played_reason IN ('rain','cancelled','forfeit','other')),
  not_played_other  TEXT,
  team_runs INTEGER, team_wkts INTEGER, opp_runs INTEGER, opp_wkts INTEGER,
  score_source      TEXT CHECK (score_source IN ('playhq','entered')),
  potd_key TEXT,   potd_named_id TEXT REFERENCES named_players(id),
  mascot_key TEXT, mascot_named_id TEXT REFERENCES named_players(id),
  highlights        TEXT,
  version           INTEGER NOT NULL,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT,
  UNIQUE (season_id, team_slug, game_id)
);

CREATE TABLE milestones (
  id           TEXT PRIMARY KEY,
  report_id    TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('bat','bowl','hattrick')),
  player_key   TEXT,
  named_id     TEXT REFERENCES named_players(id),
  value        INTEGER,
  source       TEXT NOT NULL CHECK (source IN ('playhq','entered')),
  playhq_value INTEGER,
  touched      INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  report_id   TEXT REFERENCES reports(id) ON DELETE SET NULL,
  r2_key      TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE report_versions (
  report_id   TEXT NOT NULL REFERENCES reports(id),
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,
  saved_at    TEXT NOT NULL,
  saved_by    TEXT,
  PRIMARY KEY (report_id, version)
);

CREATE INDEX reports_list ON reports (season_id, game_date);
CREATE INDEX milestones_report ON milestones (report_id);
CREATE INDEX photos_orphans ON photos (report_id, created_at);
```

(`position` keeps milestone rows in the order the coach entered them.)

- [ ] **Step 4: Write the failing test**

`api/test/env.d.ts`:

```ts
import type { Env } from '../src/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

`api/test/setup.ts`:

```ts
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`api/test/helpers.ts`:

```ts
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import type { createApp } from '../src/app';
import type { Deps } from '../src/env';

export const NOW = new Date('2026-02-01T00:00:00Z'); // 1 Feb 2026, 1 pm in NZ

export function testDeps(over: Partial<Deps> = {}): Deps {
  let n = 0;
  return {
    fetch: async () => {
      throw new Error('unexpected fetch');
    },
    now: () => NOW,
    id: () => `id${String(++n).padStart(4, '0')}`,
    limit: async () => true,
    ...over,
  };
}

export async function call(app: ReturnType<typeof createApp>, path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const res = await app.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
```

`api/test/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { call, testDeps } from './helpers';

describe('app', () => {
  it('answers health checks', async () => {
    const res = await call(createApp(testDeps()), '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns a JSON 404 for unknown API paths', async () => {
    const res = await call(createApp(testDeps()), '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  it('turns unexpected errors into a 500 with a request id', async () => {
    const app = createApp(testDeps());
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    const res = await call(app, '/api/boom');
    expect(res.status).toBe(500);
    const body = await res.json<{ error: string; requestId: string }>();
    expect(body.error).toBe('internal');
    expect(body.requestId).toBeTruthy();
  });

  it('applies the D1 schema', async () => {
    const { env } = await import('cloudflare:test');
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'reports'").first();
    expect(row).toEqual({ name: 'reports' });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run api/test/app.test.ts`
Expected: FAIL — cannot resolve `../src/app`.

- [ ] **Step 6: Write minimal implementation**

`api/src/env.ts`:

```ts
export interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  CONFIG: KVNamespace;
  WRITE_LIMIT: RateLimit;
  REFRESH_LIMIT: RateLimit;
  ADMIN_LIMIT: RateLimit;
  PLAYHQ_API_KEY: string;
  PLAYHQ_TENANT: string;
  PLAYHQ_ORG_ID: string;
  PLAYHQ_BASE_URL: string;
  ADMIN_PASSCODE: string;
}

export type LimitName = 'WRITE_LIMIT' | 'REFRESH_LIMIT' | 'ADMIN_LIMIT';

export interface Deps {
  fetch: typeof fetch;
  now: () => Date;
  id: () => string;
  /** true = allowed, false = over the limit */
  limit: (env: Env, name: LimitName, key: string) => Promise<boolean>;
}

export const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  id: () => crypto.randomUUID().replaceAll('-', ''),
  limit: async (env, name, key) => (await env[name].limit({ key })).success,
};

export type AppEnv = { Bindings: Env; Variables: { deps: Deps } };
```

`api/src/errors.ts`:

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const clientIp = (header: string | undefined) => header ?? 'local';
```

`api/src/app.ts`:

```ts
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv, Deps } from './env';
import { ApiError } from './errors';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  // Route registrations are added here by later tasks.

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message, ...err.extra }, err.status as ContentfulStatusCode);
    }
    const requestId = deps.id();
    console.error(JSON.stringify({ msg: 'unhandled_error', requestId, error: String(err) }));
    return c.json({ error: 'internal', message: 'Something went wrong.', requestId }, 500);
  });

  return app;
}
```

`api/src/index.ts`:

```ts
import { createApp } from './app';
import { defaultDeps, type Env } from './env';

const app = createApp(defaultDeps);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run api/test/app.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat(game-day): scaffold worker, D1 schema and test harness"
```

### Task 2: Shared dates and player labels

**Files:**
- Create: `shared/src/dates.ts`, `shared/src/labels.ts`
- Test: `shared/test/dates.test.ts`, `shared/test/labels.test.ts`

**Interfaces:**
- Produces: `nzDate(d: Date): string` (YYYY-MM-DD in NZ); `formatGameDate(ymd: string): string` (`"Sat 31 Jan"`); `SquadPlayer { key; firstName; lastName; playhqId? }`; `squadLabels(players: SquadPlayer[]): Map<string, string>`; `otherLabel(fullName: string): string`.

- [ ] **Step 1: Write the failing tests**

`shared/test/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatGameDate, nzDate } from '../src/dates';

describe('nzDate', () => {
  it('converts UTC to the NZ calendar date (summer, +13)', () => {
    expect(nzDate(new Date('2026-01-30T20:00:00Z'))).toBe('2026-01-31');
  });
  it('handles winter time (+12) on either side of midnight', () => {
    expect(nzDate(new Date('2026-07-01T11:59:00Z'))).toBe('2026-07-01');
    expect(nzDate(new Date('2026-07-01T12:00:00Z'))).toBe('2026-07-02');
  });
});

describe('formatGameDate', () => {
  it('formats as short weekday, day and month', () => {
    expect(formatGameDate('2026-01-31')).toBe('Sat 31 Jan');
    expect(formatGameDate('2026-10-05')).toBe('Mon 5 Oct');
  });
});
```

`shared/test/labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { otherLabel, squadLabels } from '../src/labels';

const p = (key: string, firstName: string, lastName: string) => ({ key, firstName, lastName });

describe('squadLabels', () => {
  it('uses first name and last initial', () => {
    const l = squadLabels([p('a', 'Logan', 'Smith'), p('b', 'Ava', 'jones')]);
    expect(l.get('a')).toBe('Logan S.');
    expect(l.get('b')).toBe('Ava J.');
  });

  it('extends the surname only as far as needed to tell players apart', () => {
    const l = squadLabels([p('a', 'Sam', 'Thompson'), p('b', 'Sam', 'Taylor'), p('c', 'Sam', 'Thomas')]);
    expect(l.get('a')).toBe('Sam Thomp.');
    expect(l.get('b')).toBe('Sam Ta.');
    expect(l.get('c')).toBe('Sam Thoma.');
  });

  it('appends the key ending when names are identical', () => {
    const l = squadLabels([p('p0412', 'Sam', 'Lee'), p('p0413', 'Sam', 'Lee')]);
    expect(l.get('p0412')).toBe('Sam Lee. (12)');
    expect(l.get('p0413')).toBe('Sam Lee. (13)');
  });

  it('treats first names case-insensitively when grouping', () => {
    const l = squadLabels([p('a', 'sam', 'Taylor'), p('b', 'Sam', 'Thompson')]);
    expect(l.get('a')).toBe('sam Ta.');
    expect(l.get('b')).toBe('Sam Th.');
  });
});

describe('otherLabel', () => {
  it('uses the first word and the initial of the last word', () => {
    expect(otherLabel('Mary Jane Smith')).toBe('Mary S.');
    expect(otherLabel('  chris   pratt ')).toBe('chris P.');
  });
  it('keeps a single word as-is', () => {
    expect(otherLabel('Coach')).toBe('Coach');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`shared/src/dates.ts`:

```ts
const NZ = 'Pacific/Auckland';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar date in New Zealand, as YYYY-MM-DD. */
export function nzDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "2026-01-31" → "Sat 31 Jan" */
export function formatGameDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
```

`shared/src/labels.ts`:

```ts
export interface SquadPlayer {
  key: string;
  firstName: string;
  lastName: string;
  playhqId?: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function prefixLabel(first: string, last: string, n: number) {
  return `${first} ${cap(last.slice(0, n))}.`;
}

/** "First L." labels for one team, extended until unique within the team. */
export function squadLabels(players: SquadPlayer[]): Map<string, string> {
  const out = new Map<string, string>();
  const groups = new Map<string, SquadPlayer[]>();
  for (const p of players) {
    const id = `${p.firstName.trim().toLowerCase()}|${p.lastName.trim().charAt(0).toLowerCase()}`;
    groups.set(id, [...(groups.get(id) ?? []), p]);
  }
  for (const group of groups.values()) {
    for (const p of group) {
      const first = p.firstName.trim();
      const last = p.lastName.trim();
      const lower = last.toLowerCase();
      const others = group.filter((q) => q !== p).map((q) => q.lastName.trim().toLowerCase());
      let n = 1;
      while (n <= last.length && others.some((o) => o.slice(0, n) === lower.slice(0, n))) n++;
      out.set(p.key, n <= last.length ? prefixLabel(first, last, n) : `${prefixLabel(first, last, last.length)} (${p.key.slice(-2)})`);
    }
  }
  return out;
}

/** Label for a name typed by a coach or taken from PlayHQ. */
export function otherLabel(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words[0] ?? '';
  return `${words[0]} ${words.at(-1)!.charAt(0).toUpperCase()}.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(game-day): NZ date helpers and player labels"
```

---

### Task 3: Shared types, API types, display text and validation

**Files:**
- Create: `shared/src/types.ts`, `shared/src/api.ts`, `shared/src/text.ts`, `shared/src/validation.ts`
- Test: `shared/test/validation.test.ts`

**Interfaces:**
- Produces (types.ts): valibot schemas `PlayerRefInSchema`, `FormStateSchema`, `ReportInSchema`; types `Scoring`, `NotPlayedReason`, `MilestoneType`, `Source`, `PlayerChoice`, `PlayerRefOut`, `Score`, `MilestoneRow`, `FormState`, `ReportIn`, `MilestoneCandidate`, `PlayhqStartData`, `FieldErrors`; `emptyForm(): FormState`.
- Produces (api.ts): `TeamSummary`, `ReportStatus`, `GameOption`, `TeamPage`, `ReportOut`, `GamePage`, `RefreshResult`, `ListStatus`, `GameRow`, `GamesList`, `ApiErrorBody`.
- Produces (text.ts): `SCORING_TEXT`, `REASON_TEXT`, `STATUS_TEXT`, `MILESTONE_TEXT`.
- Produces (validation.ts): `LIMITS`, `playerIdentity(p): string`, `validateReport(r: FormState): FieldErrors`.

- [ ] **Step 1: Types (no test of their own — exercised by the validation tests)**

`shared/src/types.ts`:

```ts
import * as v from 'valibot';

const Str = (max: number) => v.pipe(v.string(), v.maxLength(max));
const NumOrNull = v.nullable(v.number());

export const PlayerRefInSchema = v.variant('kind', [
  v.object({ kind: v.literal('squad'), key: Str(64), label: v.optional(v.string()) }),
  v.object({ kind: v.literal('other'), fullName: Str(120), label: v.optional(v.string()) }),
  v.object({ kind: v.literal('playhq'), playhqId: Str(64), label: v.optional(v.string()) }),
  v.object({
    kind: v.literal('named'),
    id: Str(64),
    playhqId: v.optional(v.string()),
    label: v.optional(v.string()),
  }),
]);

const ScoreSchema = v.object({ runs: NumOrNull, wkts: NumOrNull });

export const MilestoneRowSchema = v.object({
  rowId: Str(64),
  type: v.picklist(['bat', 'bowl', 'hattrick']),
  player: v.nullable(PlayerRefInSchema),
  value: NumOrNull,
  source: v.picklist(['playhq', 'entered']),
  playhqValue: NumOrNull,
  touched: v.boolean(),
});

export const FormStateSchema = v.object({
  scoring: v.nullable(v.picklist(['yes', 'no', 'yes_issues', 'not_played'])),
  issues: Str(2000),
  notPlayedReason: v.nullable(v.picklist(['rain', 'cancelled', 'forfeit', 'other'])),
  notPlayedOther: Str(200),
  team: ScoreSchema,
  opp: ScoreSchema,
  scoreSource: v.picklist(['playhq', 'entered']),
  potd: v.nullable(PlayerRefInSchema),
  mascot: v.nullable(PlayerRefInSchema),
  highlights: Str(5000),
  photoIds: v.pipe(v.array(Str(64)), v.maxLength(20)),
  milestones: v.pipe(v.array(MilestoneRowSchema), v.maxLength(60)),
  updatedBy: Str(80),
});

export const ReportInSchema = v.object({
  ...FormStateSchema.entries,
  baseVersion: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export type FormState = v.InferOutput<typeof FormStateSchema>;
export type ReportIn = v.InferOutput<typeof ReportInSchema>;
export type PlayerChoice = v.InferOutput<typeof PlayerRefInSchema>;
export type PlayerRefOut = Exclude<PlayerChoice, { kind: 'other' }> & { label: string };
export type MilestoneRow = FormState['milestones'][number];
export type Score = FormState['team'];
export type Scoring = NonNullable<FormState['scoring']>;
export type NotPlayedReason = NonNullable<FormState['notPlayedReason']>;
export type MilestoneType = MilestoneRow['type'];
export type Source = MilestoneRow['source'];
export type FieldErrors = Record<string, string>;

export interface MilestoneCandidate {
  type: 'bat' | 'bowl';
  player: PlayerRefOut;
  value: number;
}

export interface PlayhqStartData {
  available: boolean;
  result: { team: { runs: number; wkts: number }; opp: { runs: number; wkts: number } } | null;
  candidates: MilestoneCandidate[];
}

export function emptyForm(): FormState {
  return {
    scoring: null,
    issues: '',
    notPlayedReason: null,
    notPlayedOther: '',
    team: { runs: null, wkts: null },
    opp: { runs: null, wkts: null },
    scoreSource: 'entered',
    potd: null,
    mascot: null,
    highlights: '',
    photoIds: [],
    milestones: [],
    updatedBy: '',
  };
}
```

`shared/src/api.ts`:

```ts
import type { FormState, NotPlayedReason, PlayhqStartData, Scoring } from './types';

export interface TeamSummary {
  slug: string;
  name: string;
  mascot: string;
}

export type ReportStatus = 'reported' | 'not_played' | 'not_reported' | 'upcoming';

export interface GameOption {
  gameId: string;
  date: string | null;
  dateLabel: string;
  round: string;
  opposition: string;
  venue: string;
  reportStatus: ReportStatus;
  selectable: boolean;
}

export interface TeamPage {
  team: TeamSummary & { grade: string | null };
  season: string;
  today: string;
  squad: { key: string; label: string }[];
  fixture: { available: boolean; games: GameOption[] };
  defaultGameId: string | null;
}

export type ReportOut = FormState & { version: number; updatedAt: string };

export interface GamePage {
  game: GameOption;
  report: ReportOut | null;
  start: PlayhqStartData | null;
}

export interface RefreshResult {
  start: PlayhqStartData;
  rateLimited?: boolean;
}

export type ListStatus = 'reported' | 'not_played' | 'missing' | 'upcoming';

export interface GameRow {
  gameId: string;
  teamSlug: string;
  teamName: string;
  date: string | null;
  dateLabel: string;
  round: string;
  opposition: string;
  venue: string;
  status: ListStatus;
  scoring: Scoring | null;
  issues: string;
  notPlayedReason: NotPlayedReason | null;
  notPlayedOther: string;
  score: string | null;
  potd: string | null;
  mascot: string | null;
  milestoneCount: number;
}

export interface GamesList {
  today: string;
  rows: GameRow[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  latest?: ReportOut | null;
  requestId?: string;
}
```

`shared/src/text.ts`:

```ts
export const SCORING_TEXT = {
  yes: 'Yes',
  no: 'No',
  yes_issues: 'Yes but there were issues',
  not_played: 'Game not played',
} as const;

export const REASON_TEXT = { rain: 'Rained out', cancelled: 'Cancelled', forfeit: 'Forfeit', other: 'Other' } as const;

export const STATUS_TEXT = {
  reported: 'Reported',
  not_played: 'Not played',
  not_reported: 'Not yet reported',
  missing: 'Missing',
  upcoming: 'Upcoming',
} as const;

export const MILESTONE_TEXT = { bat: 'Batting', bowl: 'Bowling', hattrick: 'Hat-trick' } as const;
```

- [ ] **Step 2: Write the failing test**

`shared/test/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyForm, type FormState, type MilestoneRow } from '../src/types';
import { validateReport } from '../src/validation';

const squad = (key: string) => ({ kind: 'squad' as const, key });

function valid(over: Partial<FormState> = {}): FormState {
  return {
    ...emptyForm(),
    scoring: 'yes',
    team: { runs: 145, wkts: 4 },
    opp: { runs: 128, wkts: 4 },
    potd: squad('p001'),
    mascot: squad('p002'),
    ...over,
  };
}

const row = (over: Partial<MilestoneRow>): MilestoneRow => ({
  rowId: 'r1', type: 'bat', player: squad('p001'), value: 30, source: 'entered', playhqValue: null, touched: true, ...over,
});

describe('validateReport', () => {
  it('accepts a complete report', () => {
    expect(validateReport(valid())).toEqual({});
  });

  it('requires the PlayHQ question', () => {
    expect(validateReport(valid({ scoring: null }))).toEqual({ scoring: 'Choose an answer.' });
  });

  it('requires issues text when there were issues', () => {
    expect(validateReport(valid({ scoring: 'yes_issues', issues: '  ' }))).toHaveProperty('issues');
    expect(validateReport(valid({ scoring: 'yes_issues', issues: 'App crashed' }))).toEqual({});
  });

  it('only needs a reason when the game was not played', () => {
    const base = { ...emptyForm(), scoring: 'not_played' as const };
    expect(validateReport(base)).toEqual({ notPlayedReason: 'Choose a reason.' });
    expect(validateReport({ ...base, notPlayedReason: 'other' })).toHaveProperty('notPlayedOther');
    expect(validateReport({ ...base, notPlayedReason: 'rain' })).toEqual({});
  });

  it('checks score ranges', () => {
    const e = validateReport(valid({ team: { runs: 1000, wkts: 31 }, opp: { runs: null, wkts: 2.5 } }));
    expect(Object.keys(e).sort()).toEqual(['opp.runs', 'opp.wkts', 'team.runs', 'team.wkts']);
    expect(validateReport(valid({ team: { runs: 0, wkts: 30 }, opp: { runs: 999, wkts: 0 } }))).toEqual({});
  });

  it('requires player and mascot of the day, and a name for Other', () => {
    const e = validateReport(valid({ potd: null, mascot: { kind: 'other', fullName: ' ' } }));
    expect(e).toEqual({ potd: 'Choose a player.', mascot: "Enter the player's full name." });
  });

  it('limits photos to 5', () => {
    expect(validateReport(valid({ photoIds: ['1', '2', '3', '4', '5', '6'] }))).toHaveProperty('photoIds');
  });

  it('checks milestone ranges by type', () => {
    const e = validateReport(valid({
      milestones: [
        row({ rowId: 'a', type: 'bat', value: 24 }),
        row({ rowId: 'b', type: 'bowl', value: 20, player: squad('p002') }),
        row({ rowId: 'c', type: 'hattrick', value: 3, player: squad('p003') }),
      ],
    }));
    expect(Object.keys(e).sort()).toEqual(['milestones.0.value', 'milestones.1.value', 'milestones.2.value']);
  });

  it('accepts milestone boundary values', () => {
    expect(validateReport(valid({
      milestones: [
        row({ rowId: 'a', type: 'bat', value: 25 }),
        row({ rowId: 'b', type: 'bowl', value: 3 }),
        row({ rowId: 'c', type: 'bowl', value: 19, player: squad('p002') }),
        row({ rowId: 'd', type: 'hattrick', value: null }),
      ],
    }))).toEqual({});
  });

  it('allows one milestone per player per type', () => {
    const e = validateReport(valid({
      milestones: [row({ rowId: 'a' }), row({ rowId: 'b', value: 40 })],
    }));
    expect(e).toEqual({ 'milestones.1.player': 'This player already has this milestone.' });
  });

  it('treats Other names case-insensitively for duplicates', () => {
    const other = (n: string) => ({ kind: 'other' as const, fullName: n });
    const e = validateReport(valid({
      milestones: [row({ rowId: 'a', player: other('Chris Pratt') }), row({ rowId: 'b', player: other(' chris pratt') })],
    }));
    expect(e).toHaveProperty('milestones.1.player');
  });

  it('requires a player on every milestone row', () => {
    expect(validateReport(valid({ milestones: [row({ player: null })] }))).toEqual({ 'milestones.0.player': 'Choose a player.' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run shared/test/validation.test.ts`
Expected: FAIL — `../src/validation` not found.

- [ ] **Step 4: Implement**

`shared/src/validation.ts`:

```ts
import type { FieldErrors, FormState, PlayerChoice } from './types';

export const LIMITS = {
  wkts: [0, 30],
  runs: [0, 999],
  bat: [25, 999],
  bowl: [3, 19],
  photos: 5,
} as const;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function checkInt(e: FieldErrors, path: string, v: number | null, [min, max]: readonly [number, number], what: string) {
  if (!isInt(v) || v < min || v > max) e[path] = `${what} must be a whole number from ${min} to ${max}.`;
}

function checkPlayer(e: FieldErrors, path: string, p: PlayerChoice | null) {
  if (!p) e[path] = 'Choose a player.';
  else if (p.kind === 'other' && !p.fullName.trim()) e[path] = "Enter the player's full name.";
}

export function playerIdentity(p: PlayerChoice): string {
  switch (p.kind) {
    case 'squad':
      return `s:${p.key}`;
    case 'named':
      return `n:${p.id}`;
    case 'playhq':
      return `p:${p.playhqId}`;
    case 'other':
      return `o:${p.fullName.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  }
}

/** Rules from functional spec §9. Returns {} when valid. */
export function validateReport(r: FormState): FieldErrors {
  const e: FieldErrors = {};
  if (!r.scoring) {
    e.scoring = 'Choose an answer.';
    return e;
  }

  if (r.scoring === 'not_played') {
    if (!r.notPlayedReason) e.notPlayedReason = 'Choose a reason.';
    else if (r.notPlayedReason === 'other' && !r.notPlayedOther.trim()) e.notPlayedOther = "Say why the game wasn't played.";
    return e;
  }

  if (r.scoring === 'yes_issues' && !r.issues.trim()) e.issues = 'Describe the issues.';

  for (const side of ['team', 'opp'] as const) {
    checkInt(e, `${side}.wkts`, r[side].wkts, LIMITS.wkts, 'Wickets');
    checkInt(e, `${side}.runs`, r[side].runs, LIMITS.runs, 'Runs');
  }

  checkPlayer(e, 'potd', r.potd);
  checkPlayer(e, 'mascot', r.mascot);

  if (r.photoIds.length > LIMITS.photos) e.photoIds = `You can add up to ${LIMITS.photos} photos.`;

  const seen = new Set<string>();
  r.milestones.forEach((m, i) => {
    const base = `milestones.${i}`;
    checkPlayer(e, `${base}.player`, m.player);
    if (m.type === 'bat') checkInt(e, `${base}.value`, m.value, LIMITS.bat, 'Runs');
    if (m.type === 'bowl') checkInt(e, `${base}.value`, m.value, LIMITS.bowl, 'Wickets');
    if (m.type === 'hattrick' && m.value !== null) e[`${base}.value`] = 'Hat-tricks have no number.';
    if (m.player && !(m.player.kind === 'other' && !m.player.fullName.trim())) {
      const id = `${m.type}|${playerIdentity(m.player)}`;
      if (seen.has(id)) e[`${base}.player`] = 'This player already has this milestone.';
      seen.add(id);
    }
  });

  return e;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run shared/test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared
git commit -m "feat(game-day): shared report types, API types and validation rules"
```

### Task 4: Refresh merge and starting form

**Files:**
- Create: `shared/src/merge.ts`
- Test: `shared/test/merge.test.ts`

**Interfaces:**
- Consumes: `FormState`, `MilestoneRow`, `PlayerChoice`, `PlayerRefOut`, `PlayhqStartData`, `MilestoneCandidate`, `emptyForm` (Task 3); `ReportOut` (Task 3 api.ts).
- Produces: `startForm(start: PlayhqStartData, newRowId?: () => string): FormState`; `reportToForm(r: ReportOut): FormState`; `merge(cur: FormState, fresh: PlayhqStartData, newRowId?: () => string): { next: FormState; changes: string[] }`; `samePlayer(a: PlayerChoice | null, b: PlayerRefOut): boolean`.

- [ ] **Step 1: Write the failing test**

`shared/test/merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { merge, reportToForm, startForm } from '../src/merge';
import { emptyForm, type FormState, type MilestoneRow, type PlayhqStartData } from '../src/types';

const alex = { kind: 'squad' as const, key: 'p001', label: 'Alex T.' };
const jordan = { kind: 'squad' as const, key: 'p004', label: 'Jordan L.' };
const fillIn = { kind: 'playhq' as const, playhqId: 'ph-fill', label: 'Kim W. (not in squad)' };

const ids = () => {
  let n = 0;
  return () => `new${++n}`;
};

const start = (over: Partial<PlayhqStartData> = {}): PlayhqStartData => ({
  available: true,
  result: { team: { runs: 145, wkts: 4 }, opp: { runs: 131, wkts: 4 } },
  candidates: [],
  ...over,
});

const row = (over: Partial<MilestoneRow>): MilestoneRow => ({
  rowId: 'r', type: 'bat', player: alex, value: 31, source: 'playhq', playhqValue: 31, touched: false, ...over,
});

describe('startForm', () => {
  it('prefills PlayHQ scores as read-only and answers Yes', () => {
    const f = startForm(start(), ids());
    expect(f.scoring).toBe('yes');
    expect(f.scoreSource).toBe('playhq');
    expect(f.team).toEqual({ runs: 145, wkts: 4 });
  });

  it('leaves scores blank when PlayHQ has no result', () => {
    const f = startForm(start({ result: null }), ids());
    expect(f).toMatchObject({ scoring: null, scoreSource: 'entered', team: { runs: null, wkts: null } });
  });

  it('adds a PlayHQ row per milestone candidate', () => {
    const f = startForm(start({ candidates: [{ type: 'bat', player: alex, value: 31 }, { type: 'bowl', player: fillIn, value: 3 }] }), ids());
    expect(f.milestones).toEqual([
      { rowId: 'new1', type: 'bat', player: alex, value: 31, source: 'playhq', playhqValue: 31, touched: false },
      { rowId: 'new2', type: 'bowl', player: fillIn, value: 3, source: 'playhq', playhqValue: 3, touched: false },
    ]);
  });
});

describe('merge', () => {
  const base = (over: Partial<FormState> = {}): FormState => ({ ...emptyForm(), scoring: 'yes', ...over });

  it('switches typed scores to PlayHQ and reports the change', () => {
    const cur = base({ team: { runs: 145, wkts: 4 }, opp: { runs: 128, wkts: 4 } });
    const { next, changes } = merge(cur, start(), ids());
    expect(next.scoreSource).toBe('playhq');
    expect(next.opp).toEqual({ runs: 131, wkts: 4 });
    expect(changes).toEqual(['Opposition score 128/4 → 131/4']);
  });

  it('changes No to Yes when PlayHQ has the result', () => {
    const { next, changes } = merge(base({ scoring: 'no' }), start(), ids());
    expect(next.scoring).toBe('yes');
    expect(changes).toContain('PlayHQ answer changed from No to Yes');
  });

  it('leaves Game not played alone', () => {
    expect(merge(base({ scoring: 'not_played' }), start(), ids()).next.scoring).toBe('not_played');
  });

  it('leaves scores alone when PlayHQ has no result', () => {
    const cur = base({ team: { runs: 10, wkts: 1 }, opp: { runs: 9, wkts: 2 } });
    const { next } = merge(cur, start({ result: null }), ids());
    expect(next.team).toEqual({ runs: 10, wkts: 1 });
    expect(next.scoreSource).toBe('entered');
  });

  it('updates untouched PlayHQ rows, removes ones that no longer qualify', () => {
    const cur = base({ milestones: [row({ rowId: 'a' }), row({ rowId: 'b', type: 'bowl', player: jordan, value: 3, playhqValue: 3 })] });
    const { next, changes } = merge(cur, start({ candidates: [{ type: 'bat', player: alex, value: 35 }] }), ids());
    expect(next.milestones).toEqual([row({ rowId: 'a', value: 35, playhqValue: 35 })]);
    expect(changes).toEqual(expect.arrayContaining(['1 batting milestone updated', '1 bowling milestone removed']));
  });

  it('keeps touched rows and rows the coach added', () => {
    const touched = row({ rowId: 'a', value: 40, touched: true });
    const entered = row({ rowId: 'b', type: 'hattrick', value: null, source: 'entered', playhqValue: null, touched: true });
    const { next } = merge(base({ milestones: [touched, entered] }), start({ candidates: [{ type: 'bat', player: alex, value: 35 }] }), ids());
    expect(next.milestones).toEqual([touched, entered]);
  });

  it('adds new candidates without duplicating existing players', () => {
    const cur = base({ milestones: [row({ rowId: 'a', source: 'entered', touched: true })] });
    const { next, changes } = merge(cur, start({ candidates: [{ type: 'bat', player: alex, value: 31 }, { type: 'bowl', player: jordan, value: 4 }] }), ids());
    expect(next.milestones.map((m) => m.rowId)).toEqual(['a', 'new1']);
    expect(changes).toContain('1 bowling milestone added');
  });

  it('matches a saved not-in-squad player by PlayHQ id', () => {
    const saved = row({ rowId: 'a', player: { kind: 'named', id: 'n1', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' }, value: 27, playhqValue: 27 });
    const { next } = merge(base({ milestones: [saved] }), start({ candidates: [{ type: 'bat', player: fillIn, value: 27 }] }), ids());
    expect(next.milestones).toHaveLength(1);
  });

  it('says when nothing changed', () => {
    const cur = startForm(start(), ids());
    expect(merge(cur, start(), ids()).changes).toEqual(['No changes from PlayHQ']);
  });
});

describe('reportToForm', () => {
  it('drops version fields', () => {
    const f = reportToForm({ ...emptyForm(), version: 3, updatedAt: '2026-02-01T00:00:00Z' });
    expect(f).toEqual(emptyForm());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/test/merge.test.ts`
Expected: FAIL — `../src/merge` not found.

- [ ] **Step 3: Implement**

`shared/src/merge.ts`:

```ts
import type { ReportOut } from './api';
import {
  emptyForm,
  type FormState,
  type MilestoneCandidate,
  type MilestoneRow,
  type PlayerChoice,
  type PlayerRefOut,
  type PlayhqStartData,
  type Score,
} from './types';

const defaultRowId = () => crypto.randomUUID();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function samePlayer(a: PlayerChoice | null, b: PlayerRefOut): boolean {
  if (!a) return false;
  if (a.kind === 'squad' && b.kind === 'squad') return a.key === b.key;
  const aPhq = a.kind === 'playhq' || a.kind === 'named' ? a.playhqId : undefined;
  const bPhq = b.kind === 'playhq' || b.kind === 'named' ? b.playhqId : undefined;
  return !!aPhq && aPhq === bPhq;
}

function candidateRow(c: MilestoneCandidate, rowId: string): MilestoneRow {
  return { rowId, type: c.type, player: clone(c.player), value: c.value, source: 'playhq', playhqValue: c.value, touched: false };
}

export function startForm(start: PlayhqStartData, newRowId: () => string = defaultRowId): FormState {
  const f = emptyForm();
  if (start.result) {
    f.scoring = 'yes';
    f.team = { ...start.result.team };
    f.opp = { ...start.result.opp };
    f.scoreSource = 'playhq';
  }
  f.milestones = start.candidates.map((c) => candidateRow(c, newRowId()));
  return f;
}

export function reportToForm(r: ReportOut): FormState {
  const { version: _v, updatedAt: _u, ...form } = clone(r);
  return form;
}

const fmt = (s: Score) => (s.runs === null || s.wkts === null ? '–' : `${s.runs}/${s.wkts}`);
const same = (a: Score, b: Score) => a.runs === b.runs && a.wkts === b.wkts;

export function merge(cur: FormState, fresh: PlayhqStartData, newRowId: () => string = defaultRowId) {
  const next: FormState = clone(cur);
  const changes: string[] = [];

  if (fresh.result) {
    const r = fresh.result;
    if (!same(cur.team, r.team)) changes.push(`Team score ${fmt(cur.team)} → ${fmt(r.team)}`);
    if (!same(cur.opp, r.opp)) changes.push(`Opposition score ${fmt(cur.opp)} → ${fmt(r.opp)}`);
    next.team = { ...r.team };
    next.opp = { ...r.opp };
    next.scoreSource = 'playhq';
    if (cur.scoring === 'no') {
      next.scoring = 'yes';
      changes.push('PlayHQ answer changed from No to Yes');
    } else if (cur.scoring === null) {
      next.scoring = 'yes';
    }
  }

  const counts = { bat: { added: 0, updated: 0, removed: 0 }, bowl: { added: 0, updated: 0, removed: 0 } };
  const kept: MilestoneRow[] = [];
  for (const row of next.milestones) {
    if (row.type === 'hattrick' || row.source !== 'playhq' || row.touched) {
      kept.push(row);
      continue;
    }
    const c = fresh.candidates.find((c) => c.type === row.type && samePlayer(row.player, c.player));
    if (!c) {
      counts[row.type].removed++;
      continue;
    }
    if (row.value !== c.value) counts[row.type].updated++;
    kept.push({ ...row, value: c.value, playhqValue: c.value });
  }
  for (const c of fresh.candidates) {
    if (kept.some((r) => r.type === c.type && samePlayer(r.player, c.player))) continue;
    kept.push(candidateRow(c, newRowId()));
    counts[c.type].added++;
  }
  next.milestones = kept;

  for (const type of ['bat', 'bowl'] as const) {
    const noun = type === 'bat' ? 'batting' : 'bowling';
    for (const action of ['added', 'updated', 'removed'] as const) {
      const n = counts[type][action];
      if (n) changes.push(`${n} ${noun} milestone${n > 1 ? 's' : ''} ${action}`);
    }
  }

  return { next, changes: changes.length ? changes : ['No changes from PlayHQ'] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(game-day): PlayHQ refresh merge and starting form"
```

---

### Task 5: Squad loading and the team list

**Files:**
- Create: `api/src/squad/load.ts`, `api/src/routes/teams.ts`
- Create: `api/test/fixtures/squad.json`
- Modify: `api/src/app.ts` (register routes), `api/test/helpers.ts` (add `seedSquad`)
- Test: `api/test/squad.test.ts`

**Interfaces:**
- Consumes: `SquadPlayer` (Task 2), `ApiError` (Task 1).
- Produces: `Team { slug; name; playhqTeamId; playhqGradeId?; gradeName?; mascot?; players: SquadPlayer[] }`; `Squad { season: { name; playhqSeasonId }; teams: Team[] }`; `parseSquad(json: unknown): Squad`; `loadSquad(env: Env, now: Date): Promise<Squad>`; `findTeam(squad: Squad, slug: string): Team`; `resetSquadCache(): void`; `teamSummary(t: Team): TeamSummary`; `registerTeams(app)`; test helper `seedSquad(): Promise<void>`.

- [ ] **Step 1: Test fixture**

`api/test/fixtures/squad.json` (fake names only; also used for local dev and e2e):

```json
{
  "season": { "name": "Summer 2025/26", "playhqSeasonId": "season-test" },
  "teams": [
    {
      "slug": "pumas",
      "name": "Parklands Pumas",
      "playhqTeamId": "team-pumas",
      "playhqGradeId": "grade-y6",
      "gradeName": "Year 6 Section 3 (Morning)",
      "mascot": "pumas",
      "players": [
        { "key": "p001", "firstName": "Alex", "lastName": "Turner", "playhqId": "ph-alex" },
        { "key": "p002", "firstName": "Sam", "lastName": "Thompson", "playhqId": "ph-sam" },
        { "key": "p003", "firstName": "Sam", "lastName": "Taylor" },
        { "key": "p004", "firstName": "Jordan", "lastName": "Lee", "playhqId": "ph-jordan" }
      ]
    },
    {
      "slug": "tigers",
      "name": "Parklands Tigers",
      "playhqTeamId": "team-tigers",
      "players": []
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Add to `api/test/helpers.ts`:

```ts
import squadFixture from './fixtures/squad.json';
import { resetSquadCache } from '../src/squad/load';

export async function seedSquad(squad: unknown = squadFixture) {
  resetSquadCache();
  await env.CONFIG.put('squad', JSON.stringify(squad));
}
```

`api/test/squad.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createApp } from '../src/app';
import { findTeam, parseSquad, resetSquadCache } from '../src/squad/load';
import squadFixture from './fixtures/squad.json';
import { call, seedSquad, testDeps } from './helpers';

describe('parseSquad', () => {
  it('accepts the fixture', () => {
    expect(parseSquad(squadFixture).teams).toHaveLength(2);
  });

  it('rejects duplicate player keys', () => {
    const bad = structuredClone(squadFixture);
    bad.teams[1].players.push({ key: 'p001', firstName: 'X', lastName: 'Y' } as never);
    expect(() => parseSquad(bad)).toThrow(/squad/i);
  });

  it('rejects slugs that are not lowercase', () => {
    const bad = structuredClone(squadFixture);
    bad.teams[0].slug = 'Pumas';
    expect(() => parseSquad(bad)).toThrow();
  });

  it('rejects blank surnames', () => {
    const bad = structuredClone(squadFixture);
    bad.teams[0].players[0].lastName = ' ';
    expect(() => parseSquad(bad)).toThrow();
  });
});

describe('findTeam', () => {
  it('matches the slug case-insensitively', () => {
    expect(findTeam(parseSquad(squadFixture), 'Pumas').slug).toBe('pumas');
  });
  it('throws a 404 for unknown teams', () => {
    let err: unknown;
    try {
      findTeam(parseSquad(squadFixture), 'pumaz');
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 404, code: 'team_not_found' });
  });
});

describe('GET /api/teams', () => {
  beforeEach(() => resetSquadCache());

  it('lists teams with their mascot, never players', async () => {
    await seedSquad();
    const res = await call(createApp(testDeps()), '/api/teams');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { slug: 'pumas', name: 'Parklands Pumas', mascot: 'pumas' },
      { slug: 'tigers', name: 'Parklands Tigers', mascot: 'tigers' },
    ]);
  });

  it('fails clearly when the squad is missing', async () => {
    await env.CONFIG.delete('squad');
    const res = await call(createApp(testDeps()), '/api/teams');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'squad_missing' });
  });

  it('fails clearly when the squad is invalid', async () => {
    await seedSquad({ season: {}, teams: 'nope' });
    const res = await call(createApp(testDeps()), '/api/teams');
    expect(await res.json()).toMatchObject({ error: 'squad_invalid' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run api/test/squad.test.ts`
Expected: FAIL — `../src/squad/load` not found.

- [ ] **Step 4: Implement**

`api/src/squad/load.ts`:

```ts
import * as v from 'valibot';
import type { TeamSummary } from '../../../shared/src/api';
import type { SquadPlayer } from '../../../shared/src/labels';
import type { Env } from '../env';
import { ApiError } from '../errors';

const NonBlank = v.pipe(v.string(), v.trim(), v.minLength(1));

const SquadSchema = v.object({
  season: v.object({ name: NonBlank, playhqSeasonId: NonBlank }),
  teams: v.array(
    v.object({
      slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
      name: NonBlank,
      playhqTeamId: NonBlank,
      playhqGradeId: v.optional(NonBlank),
      gradeName: v.optional(v.string()),
      mascot: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/))),
      players: v.array(
        v.object({
          key: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+$/)),
          firstName: NonBlank,
          lastName: NonBlank,
          playhqId: v.optional(NonBlank),
        }),
      ),
    }),
  ),
});

export type Squad = v.InferOutput<typeof SquadSchema>;
export type Team = Squad['teams'][number] & { players: SquadPlayer[] };

const invalid = (detail: unknown) => {
  console.error(JSON.stringify({ msg: 'squad_invalid', detail }));
  return new ApiError(500, 'squad_invalid', 'The squad data is invalid. Ask the club admin to re-upload it.');
};

export function parseSquad(json: unknown): Squad {
  const r = v.safeParse(SquadSchema, json);
  if (!r.success) throw invalid(v.flatten(r.issues));
  const slugs = new Set<string>();
  const keys = new Set<string>();
  for (const t of r.output.teams) {
    if (slugs.has(t.slug)) throw invalid(`duplicate squad slug ${t.slug}`);
    slugs.add(t.slug);
    for (const p of t.players) {
      if (keys.has(p.key)) throw invalid(`duplicate squad player key ${p.key}`);
      keys.add(p.key);
    }
  }
  return r.output;
}

let memo: { at: number; squad: Squad } | null = null;

export function resetSquadCache() {
  memo = null;
}

export async function loadSquad(env: Env, now: Date): Promise<Squad> {
  if (memo && now.getTime() - memo.at < 60_000) return memo.squad;
  const raw = await env.CONFIG.get('squad', 'json');
  if (!raw) throw new ApiError(500, 'squad_missing', 'Squad data has not been uploaded yet.');
  const squad = parseSquad(raw);
  memo = { at: now.getTime(), squad };
  return squad;
}

export function findTeam(squad: Squad, slug: string): Team {
  const team = squad.teams.find((t) => t.slug === slug.toLowerCase());
  if (!team) throw new ApiError(404, 'team_not_found', 'Team not found.');
  return team;
}

export const teamSummary = (t: Team): TeamSummary => ({ slug: t.slug, name: t.name, mascot: t.mascot ?? t.slug });
```

Note the error message test uses `/squad/i`: `ApiError.message` is "The squad data is invalid…", which matches.

`api/src/routes/teams.ts`:

```ts
import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { loadSquad, teamSummary } from '../squad/load';

export function registerTeams(app: Hono<AppEnv>) {
  app.get('/teams', async (c) => {
    const squad = await loadSquad(c.env, c.get('deps').now());
    return c.json(squad.teams.map(teamSummary));
  });
}
```

In `api/src/app.ts`, add the import at the top and replace the `// Route registrations…` comment:

```ts
import { registerTeams } from './routes/teams';
```

```ts
  registerTeams(app);
  // Route registrations are added here by later tasks.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run api/test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(game-day): squad loading from KV and team list endpoint"
```

### Task 6: PlayHQ client and stale-while-revalidate cache

**Files:**
- Create: `api/src/playhq/types.ts`, `api/src/playhq/client.ts`, `api/src/playhq/cache.ts`, `api/src/playhq/service.ts`
- Create: `api/test/fixtures/playhq.ts`
- Test: `api/test/playhq-cache.test.ts`

**Interfaces:**
- Consumes: `Env`, `Deps` (Task 1).
- Produces: types `Stat`, `V1Game`, `V2Appearance`, `V2PeriodTeam`, `V2Summary`; `createPlayhqClient(env, fetchFn): { fixture(gradeId): Promise<V1Game[]>; summary(gameId): Promise<V2Summary> }`; `swr<T>(opts): Promise<{ data: T; stale: boolean }>`; `playhqService(env, deps, waitUntil): { fixture(gradeId, force?); summary(gameId, force?) }`; constants `SIX_HOURS`, `FIFTEEN_MIN`. Test builders `PUMAS`, `OPP`, `GRADE`, `v1Game()`, `v1Page()`, `summary()`, `fakeFetch()`, `fail()`.

- [ ] **Step 1: Types and test builders**

`api/src/playhq/types.ts` (only the fields we use; shapes verified against the live API on 2026-10-05):

```ts
export interface Stat {
  type: string;
  value: number | null;
}

export interface V1Game {
  id: string;
  status: string; // 'FINAL' | 'PENDING' | …
  round: { name: string; abbreviatedName: string } | null;
  schedule: { date: string; time?: string; timezone?: string } | null; // date is already NZ local
  venue: { name: string } | null;
  competitors: { id: string; name: string }[];
}

export interface V2Appearance {
  id: string;
  firstName: string | null;
  lastName: string | null;
  teamId: string;
}

export interface V2PeriodTeam {
  id: string;
  discipline: 'BATTING' | 'BOWLING';
  statistics: Stat[];
  appearances: { id: string; statistics: Stat[] }[];
}

export interface V2Summary {
  id: string;
  status: string;
  teams: { id: string; name: string }[];
  appearances: V2Appearance[];
  periods: { name: string; sequenceNo: number; teams: V2PeriodTeam[] }[];
}
```

`api/test/fixtures/playhq.ts`:

```ts
import type { V1Game, V2Summary } from '../../src/playhq/types';

export const PUMAS = 'team-pumas';
export const OPP = 'team-opp';
export const GRADE = 'grade-y6';

export function v1Game(o: { id: string; date: string | null; opp?: string; status?: string; round?: number; teamId?: string }): V1Game {
  return {
    id: o.id,
    status: o.status ?? 'FINAL',
    round: { name: `Round ${o.round ?? 1}`, abbreviatedName: `R${o.round ?? 1}` },
    schedule: o.date ? { date: o.date, time: '09:00:00', timezone: 'Pacific/Auckland' } : null,
    venue: { name: 'Parklands Reserve' },
    competitors: [
      { id: o.teamId ?? PUMAS, name: 'Parklands Pumas' },
      { id: OPP, name: o.opp ?? 'Syd Martin Scorchers' },
    ],
  };
}

export const v1Page = (games: V1Game[], nextCursor: string | null = null) => ({
  data: games,
  metadata: { hasMore: nextCursor !== null, nextCursor },
});

type Totals = { runs: number; wkts: number };
const st = (pairs: [string, number][]) => pairs.map(([type, value]) => ({ type, value }));
const totals = (t?: Totals | null) => (t ? st([['TOTAL_SCORE', t.runs], ['TOTAL_OUTS', t.wkts]]) : []);

export function summary(o: {
  id: string;
  status?: string;
  team?: Totals | null;
  opp?: Totals | null;
  batting?: { id: string; runs: number }[];
  bowling?: { id: string; wkts: number }[];
  appearances?: { id: string; firstName: string | null; lastName: string | null }[];
}): V2Summary {
  return {
    id: o.id,
    status: o.status ?? 'FINAL',
    teams: [
      { id: PUMAS, name: 'Parklands Pumas' },
      { id: OPP, name: 'Syd Martin Scorchers' },
    ],
    appearances: (o.appearances ?? []).map((a) => ({ ...a, teamId: PUMAS })),
    periods: [
      {
        name: 'FIRST_INNINGS',
        sequenceNo: 1,
        teams: [
          { id: OPP, discipline: 'BATTING', statistics: totals(o.opp), appearances: [] },
          {
            id: PUMAS,
            discipline: 'BOWLING',
            statistics: [],
            appearances: (o.bowling ?? []).map((b) => ({ id: b.id, statistics: st([['WICKETS', b.wkts]]) })),
          },
        ],
      },
      {
        name: 'FIRST_INNINGS',
        sequenceNo: 2,
        teams: [
          {
            id: PUMAS,
            discipline: 'BATTING',
            statistics: totals(o.team),
            appearances: (o.batting ?? []).map((b) => ({ id: b.id, statistics: st([['TOTAL_RUNS', b.runs]]) })),
          },
          { id: OPP, discipline: 'BOWLING', statistics: [], appearances: [] },
        ],
      },
    ],
  };
}

type Route = unknown | ((url: URL) => Response | unknown);

/** Fake fetch keyed by URL path. Functions receive the URL; other values are returned as JSON. */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const headers: Headers[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname + url.search);
    headers.push(new Headers(init?.headers));
    const hit = routes[url.pathname];
    if (hit === undefined) return new Response('not found', { status: 404 });
    const value = typeof hit === 'function' ? (hit as (u: URL) => unknown)(url) : hit;
    return value instanceof Response ? value : Response.json(value);
  }) as typeof fetch;
  return { fetch: fn, calls, headers };
}

export const fail = () => new Response('boom', { status: 500 });
```

- [ ] **Step 2: Write the failing test**

`api/test/playhq-cache.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { swr } from '../src/playhq/cache';
import { createPlayhqClient } from '../src/playhq/client';
import { FIFTEEN_MIN, playhqService, SIX_HOURS } from '../src/playhq/service';
import { fail, fakeFetch, summary, v1Game, v1Page } from './fixtures/playhq';
import { NOW, testDeps } from './helpers';

function collector() {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), settle: () => Promise.all(pending) };
}

describe('createPlayhqClient', () => {
  it('sends the key and tenant headers', async () => {
    const f = fakeFetch({ '/v2/games/g1/summary': { data: summary({ id: 'g1' }) } });
    await createPlayhqClient(env, f.fetch).summary('g1');
    expect(f.headers[0].get('x-api-key')).toBe('test-key');
    expect(f.headers[0].get('x-phq-tenant')).toBe('nzc');
  });

  it('follows fixture pagination', async () => {
    const f = fakeFetch({
      '/v1/grades/gr/games': (u: URL) =>
        u.searchParams.get('cursor') ? v1Page([v1Game({ id: 'b', date: '2026-01-02' })]) : v1Page([v1Game({ id: 'a', date: '2026-01-01' })], 'c2'),
    });
    const games = await createPlayhqClient(env, f.fetch).fixture('gr');
    expect(games.map((g) => g.id)).toEqual(['a', 'b']);
    expect(f.calls).toEqual(['/v1/grades/gr/games', '/v1/grades/gr/games?cursor=c2']);
  });

  it('throws on HTTP errors', async () => {
    const f = fakeFetch({ '/v2/games/g1/summary': fail });
    await expect(createPlayhqClient(env, f.fetch).summary('g1')).rejects.toThrow(/PlayHQ 500/);
  });
});

describe('swr', () => {
  const base = { kv: env.CONFIG, key: 'k', freshFor: () => 1000 };

  it('fetches and stores on a miss', async () => {
    const c = collector();
    const r = await swr({ ...base, now: 0, load: async () => 'v1', waitUntil: c.waitUntil });
    expect(r).toEqual({ data: 'v1', stale: false });
    expect(await env.CONFIG.get('k', 'json')).toEqual({ fetchedAt: 0, data: 'v1' });
  });

  it('serves fresh entries without loading', async () => {
    await env.CONFIG.put('k', JSON.stringify({ fetchedAt: 0, data: 'old' }));
    const r = await swr({ ...base, now: 999, load: async () => { throw new Error('should not load'); }, waitUntil: collector().waitUntil });
    expect(r).toEqual({ data: 'old', stale: false });
  });

  it('serves stale entries and refreshes in the background', async () => {
    await env.CONFIG.put('k', JSON.stringify({ fetchedAt: 0, data: 'old' }));
    const c = collector();
    const r = await swr({ ...base, now: 5000, load: async () => 'new', waitUntil: c.waitUntil });
    expect(r).toEqual({ data: 'old', stale: true });
    await c.settle();
    expect(await env.CONFIG.get('k', 'json')).toEqual({ fetchedAt: 5000, data: 'new' });
  });

  it('keeps the stale entry when the background refresh fails', async () => {
    await env.CONFIG.put('k', JSON.stringify({ fetchedAt: 0, data: 'old' }));
    const c = collector();
    await swr({ ...base, now: 5000, load: async () => { throw new Error('down'); }, waitUntil: c.waitUntil });
    await c.settle();
    expect(await env.CONFIG.get('k', 'json')).toEqual({ fetchedAt: 0, data: 'old' });
  });

  it('throws on a miss when loading fails', async () => {
    await expect(swr({ ...base, now: 0, load: async () => { throw new Error('down'); }, waitUntil: collector().waitUntil })).rejects.toThrow('down');
  });

  it('bypasses the cache when forced', async () => {
    await env.CONFIG.put('k', JSON.stringify({ fetchedAt: 0, data: 'old' }));
    const r = await swr({ ...base, now: 1, force: true, load: async () => 'new', waitUntil: collector().waitUntil });
    expect(r).toEqual({ data: 'new', stale: false });
  });
});

describe('playhqService', () => {
  it('treats a non-final summary as fresh for 15 minutes only', async () => {
    const f = fakeFetch({ '/v2/games/g1/summary': { data: summary({ id: 'g1', status: 'PENDING' }) } });
    const svc = (offset: number) => playhqService(env, testDeps({ fetch: f.fetch, now: () => new Date(NOW.getTime() + offset) }), collector().waitUntil);
    await svc(0).summary('g1');
    expect((await svc(FIFTEEN_MIN - 1).summary('g1')).stale).toBe(false);
    expect((await svc(FIFTEEN_MIN + 1).summary('g1')).stale).toBe(true);
  });

  it('treats a final summary and the fixture as fresh for 6 hours', async () => {
    const f = fakeFetch({
      '/v2/games/g1/summary': { data: summary({ id: 'g1' }) },
      '/v1/grades/gr/games': v1Page([]),
    });
    const svc = (offset: number) => playhqService(env, testDeps({ fetch: f.fetch, now: () => new Date(NOW.getTime() + offset) }), collector().waitUntil);
    await svc(0).summary('g1');
    await svc(0).fixture('gr');
    expect((await svc(SIX_HOURS - 1).summary('g1')).stale).toBe(false);
    expect((await svc(SIX_HOURS - 1).fixture('gr')).stale).toBe(false);
    expect((await svc(SIX_HOURS + 1).fixture('gr')).stale).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run api/test/playhq-cache.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`api/src/playhq/client.ts`:

```ts
import type { Env } from '../env';
import type { V1Game, V2Summary } from './types';

export class PlayhqError extends Error {}

export function createPlayhqClient(env: Env, fetchFn: typeof fetch) {
  async function get<T>(path: string): Promise<T> {
    const res = await fetchFn(`${env.PLAYHQ_BASE_URL}${path}`, {
      headers: { 'x-api-key': env.PLAYHQ_API_KEY, 'x-phq-tenant': env.PLAYHQ_TENANT },
    });
    if (!res.ok) throw new PlayhqError(`PlayHQ ${res.status} for ${path}`);
    return res.json<T>();
  }

  return {
    async fixture(gradeId: string): Promise<V1Game[]> {
      const out: V1Game[] = [];
      let cursor: string | undefined;
      do {
        const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const page = await get<{ data: V1Game[]; metadata?: { hasMore: boolean; nextCursor: string | null } }>(
          `/v1/grades/${gradeId}/games${q}`,
        );
        out.push(...page.data);
        cursor = page.metadata?.hasMore && page.metadata.nextCursor ? page.metadata.nextCursor : undefined;
      } while (cursor);
      return out;
    },
    async summary(gameId: string): Promise<V2Summary> {
      return (await get<{ data: V2Summary }>(`/v2/games/${gameId}/summary`)).data;
    },
  };
}
```

`api/src/playhq/cache.ts`:

```ts
interface Entry<T> {
  fetchedAt: number;
  data: T;
}

export interface SwrOptions<T> {
  kv: KVNamespace;
  key: string;
  now: number;
  freshFor: (data: T) => number;
  load: () => Promise<T>;
  force?: boolean;
  waitUntil: (p: Promise<unknown>) => void;
}

const THIRTY_DAYS_S = 30 * 24 * 3600;

async function refresh<T>(o: SwrOptions<T>): Promise<T> {
  const data = await o.load();
  await o.kv.put(o.key, JSON.stringify({ fetchedAt: o.now, data } satisfies Entry<T>), { expirationTtl: THIRTY_DAYS_S });
  return data;
}

export async function swr<T>(o: SwrOptions<T>): Promise<{ data: T; stale: boolean }> {
  if (!o.force) {
    const hit = await o.kv.get<Entry<T>>(o.key, 'json');
    if (hit) {
      if (o.now - hit.fetchedAt < o.freshFor(hit.data)) return { data: hit.data, stale: false };
      o.waitUntil(
        refresh(o).catch((err) => console.warn(JSON.stringify({ msg: 'playhq_background_refresh_failed', key: o.key, error: String(err) }))),
      );
      return { data: hit.data, stale: true };
    }
  }
  return { data: await refresh(o), stale: false };
}
```

`api/src/playhq/service.ts`:

```ts
import type { Deps, Env } from '../env';
import { swr } from './cache';
import { createPlayhqClient } from './client';
import type { V2Summary } from './types';

export const SIX_HOURS = 6 * 3600 * 1000;
export const FIFTEEN_MIN = 15 * 60 * 1000;

export function playhqService(env: Env, deps: Deps, waitUntil: (p: Promise<unknown>) => void) {
  const client = createPlayhqClient(env, deps.fetch);
  const now = () => deps.now().getTime();
  return {
    fixture: (gradeId: string, force = false) =>
      swr({ kv: env.CONFIG, key: `phq:fixture:${gradeId}`, now: now(), freshFor: () => SIX_HOURS, load: () => client.fixture(gradeId), force, waitUntil }),
    summary: (gameId: string, force = false) =>
      swr<V2Summary>({
        kv: env.CONFIG,
        key: `phq:summary:${gameId}`,
        now: now(),
        freshFor: (s) => (s.status === 'FINAL' ? SIX_HOURS : FIFTEEN_MIN),
        load: () => client.summary(gameId),
        force,
        waitUntil,
      }),
  };
}

export type PlayhqService = ReturnType<typeof playhqService>;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run api/test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(game-day): PlayHQ client with stale-while-revalidate KV cache"
```

---

### Task 7: Team page endpoint (squad labels, fixture, report status)

**Files:**
- Create: `api/src/playhq/fixture.ts`, `api/src/reports/repo.ts` (first function only), `api/src/routes/context.ts`
- Modify: `api/src/routes/teams.ts`
- Test: `api/test/teams.test.ts`

**Interfaces:**
- Consumes: `loadSquad`, `findTeam`, `teamSummary`, `Team`, `Squad` (Task 5); `playhqService` (Task 6); `squadLabels` (Task 2); `nzDate`, `formatGameDate` (Task 2); `GameOption`, `TeamPage` (Task 3).
- Produces: `FixtureGame { gameId; date: string | null; round; opposition; venue; status }`; `teamFixture(games: V1Game[], teamId: string): FixtureGame[]`; `reportStatuses(db, seasonId, teamSlug): Promise<Map<string, 'reported' | 'not_played'>>`; `phq(c)`; `fixtureFor(c, squad, team, today): Promise<{ available: boolean; games: GameOption[] }>`; `toOption(g, status, today): GameOption`.

- [ ] **Step 1: Write the failing test**

`api/test/teams.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TeamPage } from '../../shared/src/api';
import { createApp } from '../src/app';
import { fail, fakeFetch, GRADE, v1Game, v1Page } from './fixtures/playhq';
import { call, seedSquad, testDeps } from './helpers';

const fixture = v1Page([
  v1Game({ id: 'g3', date: '2026-02-07', status: 'PENDING', round: 5 }),
  v1Game({ id: 'g1', date: '2026-01-24', round: 3, opp: 'Hornby Hawks' }),
  v1Game({ id: 'g2', date: '2026-01-31', round: 4 }),
  v1Game({ id: 'gTbc', date: null, status: 'PENDING', round: 6 }),
  v1Game({ id: 'other', date: '2026-01-31', teamId: 'someone-else' }),
]);

const get = async (path: string, routes = { [`/v1/grades/${GRADE}/games`]: fixture }) => {
  const res = await call(createApp(testDeps({ fetch: fakeFetch(routes).fetch })), path);
  return { res, body: (await res.json()) as TeamPage & { error?: string } };
};

describe('GET /api/teams/:slug', () => {
  beforeEach(() => seedSquad());

  it('returns team details and squad labels sorted by first name, without surnames', async () => {
    const { res, body } = await get('/api/teams/pumas');
    expect(res.status).toBe(200);
    expect(body.team).toEqual({ slug: 'pumas', name: 'Parklands Pumas', mascot: 'pumas', grade: 'Year 6 Section 3 (Morning)' });
    expect(body.season).toBe('Summer 2025/26');
    expect(body.squad).toEqual([
      { key: 'p001', label: 'Alex T.' },
      { key: 'p004', label: 'Jordan L.' },
      { key: 'p003', label: 'Sam Ta.' },
      { key: 'p002', label: 'Sam Th.' },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/Turner|Thompson|Taylor/);
  });

  it("lists only this team's games in date order with status and selectability", async () => {
    const { body } = await get('/api/teams/pumas');
    expect(body.today).toBe('2026-02-01');
    expect(body.fixture.available).toBe(true);
    expect(body.fixture.games.map((g) => [g.gameId, g.reportStatus, g.selectable])).toEqual([
      ['g1', 'not_reported', true],
      ['g2', 'not_reported', true],
      ['g3', 'upcoming', false],
      ['gTbc', 'upcoming', false],
    ]);
    expect(body.fixture.games[0]).toMatchObject({ dateLabel: 'Sat 24 Jan', round: 'R3', opposition: 'Hornby Hawks', venue: 'Parklands Reserve' });
    expect(body.fixture.games[3].dateLabel).toBe('Date TBC');
    expect(body.defaultGameId).toBe('g2');
  });

  it('marks reported and not-played games', async () => {
    const insert = (id: string, game: string, scoring: string) =>
      env.DB.prepare(
        `INSERT INTO reports (id, season_id, team_slug, game_id, game_date, scoring, version, updated_at)
         VALUES (?, 'season-test', 'pumas', ?, '2026-01-24', ?, 1, '2026-01-25T00:00:00Z')`,
      ).bind(id, game, scoring).run();
    await insert('r1', 'g1', 'yes');
    await insert('r2', 'g2', 'not_played');
    const { body } = await get('/api/teams/pumas');
    expect(body.fixture.games.slice(0, 2).map((g) => g.reportStatus)).toEqual(['reported', 'not_played']);
  });

  it('opens with capital letters in the link', async () => {
    expect((await get('/api/teams/Pumas')).res.status).toBe(200);
  });

  it('404s for unknown teams', async () => {
    const { res, body } = await get('/api/teams/pumaz');
    expect(res.status).toBe(404);
    expect(body.error).toBe('team_not_found');
  });

  it('reports the fixture as unavailable when the team has no grade yet', async () => {
    const { body } = await get('/api/teams/tigers');
    expect(body.fixture).toEqual({ available: false, games: [] });
    expect(body.defaultGameId).toBeNull();
  });

  it('still loads when PlayHQ is down and nothing is cached', async () => {
    const { res, body } = await get('/api/teams/pumas', { [`/v1/grades/${GRADE}/games`]: fail });
    expect(res.status).toBe(200);
    expect(body.fixture.available).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/test/teams.test.ts`
Expected: FAIL — 404 `not_found` (route not registered).

- [ ] **Step 3: Implement**

`api/src/playhq/fixture.ts`:

```ts
import type { V1Game } from './types';

export interface FixtureGame {
  gameId: string;
  date: string | null;
  round: string;
  opposition: string;
  venue: string;
  status: string;
}

export function teamFixture(games: V1Game[], teamId: string): FixtureGame[] {
  return games
    .filter((g) => g.competitors.some((c) => c.id === teamId))
    .map((g) => ({
      gameId: g.id,
      date: g.schedule?.date ?? null,
      round: g.round?.abbreviatedName ?? '',
      opposition: g.competitors.find((c) => c.id !== teamId)?.name ?? 'TBC',
      venue: g.venue?.name ?? 'TBC',
      status: g.status,
    }))
    .sort((a, b) => (a.date ?? '9999-99-99').localeCompare(b.date ?? '9999-99-99'));
}
```

`api/src/reports/repo.ts` (more functions are added in Task 9):

```ts
export async function reportStatuses(db: D1Database, seasonId: string, teamSlug: string) {
  const { results } = await db
    .prepare('SELECT game_id, scoring FROM reports WHERE season_id = ? AND team_slug = ?')
    .bind(seasonId, teamSlug)
    .all<{ game_id: string; scoring: string }>();
  return new Map(results.map((r) => [r.game_id, r.scoring === 'not_played' ? ('not_played' as const) : ('reported' as const)]));
}
```

`api/src/routes/context.ts`:

```ts
import type { Context } from 'hono';
import type { GameOption } from '../../../shared/src/api';
import { formatGameDate } from '../../../shared/src/dates';
import type { AppEnv } from '../env';
import { teamFixture, type FixtureGame } from '../playhq/fixture';
import { playhqService } from '../playhq/service';
import { reportStatuses } from '../reports/repo';
import type { Squad, Team } from '../squad/load';

export type Ctx = Context<AppEnv>;

export const phq = (c: Ctx) => playhqService(c.env, c.get('deps'), (p) => c.executionCtx.waitUntil(p));

export function toOption(g: FixtureGame, status: 'reported' | 'not_played' | undefined, today: string): GameOption {
  const selectable = g.date !== null && g.date <= today;
  return {
    gameId: g.gameId,
    date: g.date,
    dateLabel: g.date ? formatGameDate(g.date) : 'Date TBC',
    round: g.round,
    opposition: g.opposition,
    venue: g.venue,
    reportStatus: status ?? (selectable ? 'not_reported' : 'upcoming'),
    selectable,
  };
}

export async function fixtureFor(c: Ctx, squad: Squad, team: Team, today: string) {
  if (!team.playhqGradeId) return { available: false, games: [] as GameOption[] };
  let games: FixtureGame[];
  try {
    games = teamFixture((await phq(c).fixture(team.playhqGradeId)).data, team.playhqTeamId);
  } catch (err) {
    console.warn(JSON.stringify({ msg: 'fixture_unavailable', team: team.slug, error: String(err) }));
    return { available: false, games: [] as GameOption[] };
  }
  const statuses = await reportStatuses(c.env.DB, squad.season.playhqSeasonId, team.slug);
  return { available: true, games: games.map((g) => toOption(g, statuses.get(g.gameId), today)) };
}
```

Replace `api/src/routes/teams.ts` with:

```ts
import type { Hono } from 'hono';
import type { TeamPage } from '../../../shared/src/api';
import { nzDate } from '../../../shared/src/dates';
import { squadLabels } from '../../../shared/src/labels';
import type { AppEnv } from '../env';
import { findTeam, loadSquad, teamSummary } from '../squad/load';
import { fixtureFor } from './context';

export function registerTeams(app: Hono<AppEnv>) {
  app.get('/teams', async (c) => {
    const squad = await loadSquad(c.env, c.get('deps').now());
    return c.json(squad.teams.map(teamSummary));
  });

  app.get('/teams/:slug', async (c) => {
    const deps = c.get('deps');
    const squad = await loadSquad(c.env, deps.now());
    const team = findTeam(squad, c.req.param('slug'));
    const labels = squadLabels(team.players);
    const today = nzDate(deps.now());
    const fixture = await fixtureFor(c, squad, team, today);
    const players = [...team.players].sort(
      (a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName),
    );
    const body: TeamPage = {
      team: { ...teamSummary(team), grade: team.gradeName ?? null },
      season: squad.season.name,
      today,
      squad: players.map((p) => ({ key: p.key, label: labels.get(p.key)! })),
      fixture,
      defaultGameId: fixture.games.filter((g) => g.selectable).at(-1)?.gameId ?? null,
    };
    return c.json(body);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(game-day): team page endpoint with fixture and report status"
```

### Task 8: Game start data and Refresh from PlayHQ

**Files:**
- Create: `api/src/playhq/summary.ts`, `api/src/routes/games.ts`
- Modify: `api/src/routes/context.ts` (add `loadGameContext`), `api/src/app.ts` (register)
- Test: `api/test/games.test.ts`

**Interfaces:**
- Consumes: `fixtureFor`, `phq` (Task 7); `squadLabels`, `otherLabel` (Task 2); `PlayhqStartData`, `PlayerRefOut`, `MilestoneCandidate` (Task 3); `GamePage`, `RefreshResult` (Task 3).
- Produces: `startData(s: V2Summary, team: Team, labels: Map<string,string>): PlayhqStartData`; `UNAVAILABLE: PlayhqStartData`; `loadGameContext(c, slug, gameId): Promise<GameContext>` where `GameContext = { squad; team; labels; today; game: GameOption; summary(force?: boolean): Promise<V2Summary | null> }`; `registerGames(app)`.

- [ ] **Step 1: Write the failing test**

`api/test/games.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { GamePage, RefreshResult } from '../../shared/src/api';
import { createApp } from '../src/app';
import { startData } from '../src/playhq/summary';
import { findTeam, parseSquad } from '../src/squad/load';
import { squadLabels } from '../../shared/src/labels';
import squadFixture from './fixtures/squad.json';
import { fail, fakeFetch, GRADE, summary, v1Game, v1Page } from './fixtures/playhq';
import { call, seedSquad, testDeps } from './helpers';

const team = findTeam(parseSquad(squadFixture), 'pumas');
const labels = squadLabels(team.players);

const full = summary({
  id: 'g2',
  team: { runs: 145, wkts: 4 },
  opp: { runs: 128, wkts: 4 },
  batting: [{ id: 'ph-alex', runs: 31 }, { id: 'ph-sam', runs: 24 }, { id: 'ph-fill', runs: 27 }],
  bowling: [{ id: 'ph-jordan', wkts: 3 }, { id: 'ph-sam', wkts: 2 }, { id: 'ph-alex', wkts: 20 }],
  appearances: [
    { id: 'ph-alex', firstName: 'Alex', lastName: 'Turner' },
    { id: 'ph-fill', firstName: 'Kim', lastName: 'Walker' },
  ],
});

describe('startData', () => {
  it('reads both final scores', () => {
    expect(startData(full, team, labels).result).toEqual({ team: { runs: 145, wkts: 4 }, opp: { runs: 128, wkts: 4 } });
  });

  it('finds milestones for this team only, within the limits', () => {
    expect(startData(full, team, labels).candidates).toEqual([
      { type: 'bat', player: { kind: 'squad', key: 'p001', label: 'Alex T.' }, value: 31 },
      { type: 'bat', player: { kind: 'playhq', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' }, value: 27 },
      { type: 'bowl', player: { kind: 'squad', key: 'p004', label: 'Jordan L.' }, value: 3 },
    ]);
  });

  it('has no result while the game is not final', () => {
    expect(startData({ ...full, status: 'PENDING' }, team, labels).result).toBeNull();
  });

  it('has no result when only one innings has a total (abandoned or in progress)', () => {
    expect(startData(summary({ id: 'g', team: { runs: 50, wkts: 2 }, opp: null }), team, labels).result).toBeNull();
  });

  it('labels an unnamed hidden PlayHQ player without leaking anything', () => {
    const s = summary({ id: 'g', batting: [{ id: 'ph-hidden', runs: 40 }], appearances: [{ id: 'ph-hidden', firstName: null, lastName: null }] });
    expect(startData(s, team, labels).candidates[0].player.label).toBe('Unnamed player (not in squad)');
  });
});

const routes = (over: Record<string, unknown> = {}) => ({
  [`/v1/grades/${GRADE}/games`]: v1Page([v1Game({ id: 'g2', date: '2026-01-31' }), v1Game({ id: 'g3', date: '2026-02-07', status: 'PENDING' })]),
  '/v2/games/g2/summary': { data: full },
  ...over,
});

describe('GET /api/teams/:slug/games/:gameId', () => {
  beforeEach(() => seedSquad());

  it('returns PlayHQ start data when there is no report', async () => {
    const res = await call(createApp(testDeps({ fetch: fakeFetch(routes()).fetch })), '/api/teams/pumas/games/g2');
    const body = await res.json<GamePage>();
    expect(res.status).toBe(200);
    expect(body.report).toBeNull();
    expect(body.game.gameId).toBe('g2');
    expect(body.start?.result?.team).toEqual({ runs: 145, wkts: 4 });
    expect(JSON.stringify(body)).not.toMatch(/Turner|Walker/);
  });

  it('still opens the form when PlayHQ is down', async () => {
    const res = await call(createApp(testDeps({ fetch: fakeFetch(routes({ '/v2/games/g2/summary': fail })).fetch })), '/api/teams/pumas/games/g2');
    expect((await res.json<GamePage>()).start).toEqual({ available: false, result: null, candidates: [] });
  });

  it('404s for a game that is not in the fixture', async () => {
    const res = await call(createApp(testDeps({ fetch: fakeFetch(routes()).fetch })), '/api/teams/pumas/games/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'game_not_found' });
  });
});

describe('POST /api/teams/:slug/games/:gameId/refresh', () => {
  beforeEach(() => seedSquad());

  it('bypasses the cache', async () => {
    const f = fakeFetch(routes());
    const app = createApp(testDeps({ fetch: f.fetch }));
    await call(app, '/api/teams/pumas/games/g2');
    await call(app, '/api/teams/pumas/games/g2/refresh', { method: 'POST' });
    expect(f.calls.filter((p) => p === '/v2/games/g2/summary')).toHaveLength(2);
  });

  it('returns the cached copy with rateLimited when pressed again too soon', async () => {
    const f = fakeFetch(routes());
    const app = createApp(testDeps({ fetch: f.fetch, limit: async (_e, name) => name !== 'REFRESH_LIMIT' }));
    const res = await call(app, '/api/teams/pumas/games/g2/refresh', { method: 'POST' });
    const body = await res.json<RefreshResult>();
    expect(body.rateLimited).toBe(true);
    expect(body.start.result).not.toBeNull();
  });

  it("says PlayHQ couldn't be reached", async () => {
    const app = createApp(testDeps({ fetch: fakeFetch(routes({ '/v2/games/g2/summary': fail })).fetch }));
    const res = await call(app, '/api/teams/pumas/games/g2/refresh', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'playhq_unavailable', message: "Couldn't reach PlayHQ — try again later." });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/test/games.test.ts`
Expected: FAIL — `../src/playhq/summary` not found.

- [ ] **Step 3: Implement**

`api/src/playhq/summary.ts`:

```ts
import { otherLabel } from '../../../shared/src/labels';
import type { MilestoneCandidate, PlayerRefOut, PlayhqStartData } from '../../../shared/src/types';
import type { Team } from '../squad/load';
import type { Stat, V2Summary } from './types';

export const UNAVAILABLE: PlayhqStartData = { available: false, result: null, candidates: [] };

const stat = (stats: Stat[], type: string) => stats.find((s) => s.type === type)?.value ?? null;

export function startData(s: V2Summary, team: Team, labels: Map<string, string>): PlayhqStartData {
  const teamId = team.playhqTeamId;
  const oppId = s.teams.find((t) => t.id !== teamId)?.id;
  const totals = new Map<string, { runs: number; wkts: number }>();
  const bat = new Map<string, number>();
  const bowl = new Map<string, number>();

  for (const period of s.periods) {
    for (const t of period.teams) {
      if (t.discipline === 'BATTING') {
        const runs = stat(t.statistics, 'TOTAL_SCORE');
        const wkts = stat(t.statistics, 'TOTAL_OUTS');
        if (runs !== null && wkts !== null) totals.set(t.id, { runs, wkts });
      }
      if (t.id !== teamId) continue;
      for (const a of t.appearances) {
        const value = stat(a.statistics, t.discipline === 'BATTING' ? 'TOTAL_RUNS' : 'WICKETS');
        if (value === null) continue;
        const map = t.discipline === 'BATTING' ? bat : bowl;
        map.set(a.id, Math.max(map.get(a.id) ?? 0, value));
      }
    }
  }

  const mine = totals.get(teamId);
  const theirs = oppId ? totals.get(oppId) : undefined;
  const result = s.status === 'FINAL' && mine && theirs ? { team: mine, opp: theirs } : null;

  const byPlayhqId = new Map(team.players.filter((p) => p.playhqId).map((p) => [p.playhqId!, p]));
  const names = new Map(s.appearances.map((a) => [a.id, `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim()]));
  const ref = (id: string): PlayerRefOut => {
    const p = byPlayhqId.get(id);
    if (p) return { kind: 'squad', key: p.key, label: labels.get(p.key)! };
    const name = names.get(id);
    return { kind: 'playhq', playhqId: id, label: name ? `${otherLabel(name)} (not in squad)` : 'Unnamed player (not in squad)' };
  };

  const candidates: MilestoneCandidate[] = [
    ...[...bat].filter(([, r]) => r >= 25 && r <= 999).map(([id, r]) => ({ type: 'bat' as const, player: ref(id), value: r })),
    ...[...bowl].filter(([, w]) => w >= 3 && w <= 19).map(([id, w]) => ({ type: 'bowl' as const, player: ref(id), value: w })),
  ];
  return { available: true, result, candidates };
}
```

Append to `api/src/routes/context.ts`:

```ts
import { nzDate } from '../../../shared/src/dates';
import { squadLabels } from '../../../shared/src/labels';
import { ApiError } from '../errors';
import type { V2Summary } from '../playhq/types';
import { findTeam, loadSquad } from '../squad/load';

export async function loadGameContext(c: Ctx, slug: string, gameId: string) {
  const deps = c.get('deps');
  const squad = await loadSquad(c.env, deps.now());
  const team = findTeam(squad, slug);
  const labels = squadLabels(team.players);
  const today = nzDate(deps.now());
  const fixture = await fixtureFor(c, squad, team, today);
  const game = fixture.games.find((g) => g.gameId === gameId);
  if (!game) throw new ApiError(404, 'game_not_found', "This game isn't in the team's fixture.");
  const service = phq(c);
  return {
    squad,
    team,
    labels,
    today,
    game,
    /** Cached summary; null if PlayHQ is unreachable. With force=true, errors are thrown instead. */
    async summary(force = false): Promise<V2Summary | null> {
      try {
        return (await service.summary(gameId, force)).data;
      } catch (err) {
        if (force) throw err;
        console.warn(JSON.stringify({ msg: 'summary_unavailable', gameId, error: String(err) }));
        return null;
      }
    },
  };
}

export type GameContext = Awaited<ReturnType<typeof loadGameContext>>;
```

(Merge these imports into the existing import block at the top of the file.)

`api/src/routes/games.ts`:

```ts
import type { Hono } from 'hono';
import type { GamePage, RefreshResult } from '../../../shared/src/api';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { startData, UNAVAILABLE } from '../playhq/summary';
import { loadGameContext } from './context';

export function registerGames(app: Hono<AppEnv>) {
  app.get('/teams/:slug/games/:gameId', async (c) => {
    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    const s = await ctx.summary();
    return c.json<GamePage>({ game: ctx.game, report: null, start: s ? startData(s, ctx.team, ctx.labels) : UNAVAILABLE });
  });

  app.post('/teams/:slug/games/:gameId/refresh', async (c) => {
    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    const allowed = await c.get('deps').limit(c.env, 'REFRESH_LIMIT', ctx.game.gameId);
    if (!allowed) {
      const s = await ctx.summary();
      return c.json<RefreshResult>({ start: s ? startData(s, ctx.team, ctx.labels) : UNAVAILABLE, rateLimited: true });
    }
    let s;
    try {
      s = (await ctx.summary(true))!;
    } catch {
      throw new ApiError(503, 'playhq_unavailable', "Couldn't reach PlayHQ — try again later.");
    }
    return c.json<RefreshResult>({ start: startData(s, ctx.team, ctx.labels) });
  });
}
```

In `api/src/app.ts` add `import { registerGames } from './routes/games';` and call `registerGames(app);` after `registerTeams(app);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(game-day): game start data from PlayHQ and refresh endpoint"
```

---

### Task 9: Report storage and public serialisation

**Files:**
- Modify: `api/src/reports/repo.ts`
- Create: `api/src/reports/serialize.ts`
- Test: `api/test/repo.test.ts`

**Interfaces:**
- Consumes: `FormState`, `PlayerChoice`, `Scoring`, `NotPlayedReason`, `MilestoneType`, `Source` (Task 3); `ReportOut` (Task 3); `otherLabel` (Task 2).
- Produces:
  - `NamedPlayer { id; fullName; playhqId: string | null }`
  - `StoredMilestone { id; type; playerKey: string | null; namedId: string | null; value: number | null; source: Source; playhqValue: number | null; touched: boolean }`
  - `ReportRow` (all `reports` columns in camelCase, see code) and `StoredReport = ReportRow & { id; version; milestones: StoredMilestone[]; photoIds: string[]; named: Map<string, NamedPlayer> }`
  - `loadReports(db, seasonId, filter?: { teamSlug: string; gameId: string }): Promise<StoredReport[]>`
  - `getReport(db, seasonId, teamSlug, gameId): Promise<StoredReport | null>`
  - `SaveInput` and `saveReport(db, input: SaveInput): Promise<void>`
  - `refOut(key, namedId, named, labels): PlayerChoice | null`; `toReportOut(r: StoredReport, labels): ReportOut`

- [ ] **Step 1: Write the failing test**

`api/test/repo.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getReport, loadReports, saveReport, type SaveInput } from '../src/reports/repo';
import { toReportOut } from '../src/reports/serialize';

const labels = new Map([['p001', 'Alex T.']]);

function input(over: Partial<SaveInput> = {}): SaveInput {
  return {
    reportId: 'r1',
    version: 1,
    row: {
      seasonId: 's', teamSlug: 'pumas', gameId: 'g1', gameDate: '2026-01-24', scoring: 'yes', issues: null,
      notPlayedReason: null, notPlayedOther: null, teamRuns: 145, teamWkts: 4, oppRuns: 128, oppWkts: 4,
      scoreSource: 'playhq', potdKey: 'p001', potdNamedId: null, mascotKey: null, mascotNamedId: 'n1',
      highlights: 'Great game', updatedAt: '2026-01-25T00:00:00Z', updatedBy: 'Sarah',
    },
    newNamed: [{ id: 'n1', fullName: 'Chris Pratt', playhqId: null }, { id: 'n2', fullName: 'Kim Walker', playhqId: 'ph-fill' }],
    milestones: [
      { id: 'm1', type: 'bat', playerKey: 'p001', namedId: null, value: 31, source: 'playhq', playhqValue: 31, touched: false },
      { id: 'm2', type: 'bat', playerKey: null, namedId: 'n2', value: 27, source: 'playhq', playhqValue: 27, touched: true },
    ],
    photoIds: [],
    snapshot: '{}',
    ...over,
  };
}

describe('saveReport / getReport', () => {
  it('round-trips a report with milestones and named players', async () => {
    await saveReport(env.DB, input());
    const r = await getReport(env.DB, 's', 'pumas', 'g1');
    expect(r).toMatchObject({ id: 'r1', version: 1, teamRuns: 145, potdKey: 'p001', mascotNamedId: 'n1', updatedBy: 'Sarah' });
    expect(r!.milestones.map((m) => [m.id, m.value, m.touched])).toEqual([['m1', 31, false], ['m2', 27, true]]);
    expect(r!.named.get('n1')).toEqual({ id: 'n1', fullName: 'Chris Pratt', playhqId: null });
    const versions = await env.DB.prepare('SELECT version, saved_by FROM report_versions').all();
    expect(versions.results).toEqual([{ version: 1, saved_by: 'Sarah' }]);
  });

  it('replaces milestones and moves photos on update', async () => {
    await env.DB.batch(['pA', 'pB'].map((id) =>
      env.DB.prepare("INSERT INTO photos (id, report_id, r2_key, bytes, created_at) VALUES (?, NULL, ?, 1, '2026-01-25T00:00:00Z')").bind(id, `photos/${id}.jpg`),
    ));
    await saveReport(env.DB, input({ photoIds: ['pA'] }));
    await saveReport(env.DB, input({ version: 2, newNamed: [], milestones: [], photoIds: ['pB'], row: { ...input().row, mascotNamedId: 'n1' } }));
    const r = await getReport(env.DB, 's', 'pumas', 'g1');
    expect(r!.version).toBe(2);
    expect(r!.milestones).toEqual([]);
    expect(r!.photoIds).toEqual(['pB']);
    const detached = await env.DB.prepare("SELECT report_id FROM photos WHERE id = 'pA'").first();
    expect(detached).toEqual({ report_id: null });
  });

  it('returns null when there is no report', async () => {
    expect(await getReport(env.DB, 's', 'pumas', 'nope')).toBeNull();
  });

  it('loads every report in a season', async () => {
    await saveReport(env.DB, input());
    // The second report reuses named player n1, which the first save created.
    await saveReport(env.DB, input({ reportId: 'r2', row: { ...input().row, gameId: 'g2' }, newNamed: [], milestones: [] }));
    expect((await loadReports(env.DB, 's')).map((r) => r.gameId).sort()).toEqual(['g1', 'g2']);
  });
});

describe('toReportOut', () => {
  it('returns labels, never full names', async () => {
    await saveReport(env.DB, input());
    const out = toReportOut((await getReport(env.DB, 's', 'pumas', 'g1'))!, labels);
    expect(out.potd).toEqual({ kind: 'squad', key: 'p001', label: 'Alex T.' });
    expect(out.mascot).toEqual({ kind: 'named', id: 'n1', label: 'Chris P.' });
    expect(out.milestones[1].player).toEqual({ kind: 'named', id: 'n2', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' });
    expect(JSON.stringify(out)).not.toMatch(/Pratt|Walker/);
  });

  it('shows Unknown player when a squad key was removed from the JSON', async () => {
    await saveReport(env.DB, input());
    const out = toReportOut((await getReport(env.DB, 's', 'pumas', 'g1'))!, new Map());
    expect(out.potd).toEqual({ kind: 'squad', key: 'p001', label: 'Unknown player' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/test/repo.test.ts`
Expected: FAIL — `saveReport` is not exported.

- [ ] **Step 3: Implement**

Append to `api/src/reports/repo.ts`:

```ts
import type { MilestoneType, NotPlayedReason, Scoring, Source } from '../../../shared/src/types';

export interface NamedPlayer {
  id: string;
  fullName: string;
  playhqId: string | null;
}

export interface StoredMilestone {
  id: string;
  type: MilestoneType;
  playerKey: string | null;
  namedId: string | null;
  value: number | null;
  source: Source;
  playhqValue: number | null;
  touched: boolean;
}

export interface ReportRow {
  seasonId: string;
  teamSlug: string;
  gameId: string;
  gameDate: string;
  scoring: Scoring;
  issues: string | null;
  notPlayedReason: NotPlayedReason | null;
  notPlayedOther: string | null;
  teamRuns: number | null;
  teamWkts: number | null;
  oppRuns: number | null;
  oppWkts: number | null;
  scoreSource: Source | null;
  potdKey: string | null;
  potdNamedId: string | null;
  mascotKey: string | null;
  mascotNamedId: string | null;
  highlights: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export type StoredReport = ReportRow & {
  id: string;
  version: number;
  milestones: StoredMilestone[];
  photoIds: string[];
  named: Map<string, NamedPlayer>;
};

export interface SaveInput {
  reportId: string;
  version: number;
  row: ReportRow;
  newNamed: NamedPlayer[];
  milestones: StoredMilestone[];
  photoIds: string[];
  snapshot: string;
}

type Db = Record<string, unknown>;
const WHERE = 'r.season_id = ?1 AND (?2 IS NULL OR r.team_slug = ?2) AND (?3 IS NULL OR r.game_id = ?3)';

export async function loadReports(db: D1Database, seasonId: string, filter?: { teamSlug: string; gameId: string }) {
  const binds = [seasonId, filter?.teamSlug ?? null, filter?.gameId ?? null];
  const [reports, milestones, photos, named] = await db.batch<Db>([
    db.prepare(`SELECT r.* FROM reports r WHERE ${WHERE}`).bind(...binds),
    db.prepare(`SELECT m.* FROM milestones m JOIN reports r ON r.id = m.report_id WHERE ${WHERE} ORDER BY m.position`).bind(...binds),
    db.prepare(`SELECT p.id, p.report_id FROM photos p JOIN reports r ON r.id = p.report_id WHERE ${WHERE} ORDER BY p.created_at, p.id`).bind(...binds),
    db.prepare(
      `SELECT n.* FROM named_players n WHERE n.id IN (
         SELECT r.potd_named_id FROM reports r WHERE ${WHERE}
         UNION SELECT r.mascot_named_id FROM reports r WHERE ${WHERE}
         UNION SELECT m.named_id FROM milestones m JOIN reports r ON r.id = m.report_id WHERE ${WHERE})`,
    ).bind(...binds),
  ]);

  const namedById = new Map(
    named.results.map((n) => [n.id as string, { id: n.id as string, fullName: n.full_name as string, playhqId: (n.playhq_id as string) ?? null }]),
  );

  return reports.results.map((r): StoredReport => {
    const id = r.id as string;
    const ms = milestones.results.filter((m) => m.report_id === id);
    const own = new Map<string, NamedPlayer>();
    for (const nid of [r.potd_named_id, r.mascot_named_id, ...ms.map((m) => m.named_id)]) {
      if (typeof nid === 'string' && namedById.has(nid)) own.set(nid, namedById.get(nid)!);
    }
    return {
      id,
      version: r.version as number,
      seasonId: r.season_id as string,
      teamSlug: r.team_slug as string,
      gameId: r.game_id as string,
      gameDate: r.game_date as string,
      scoring: r.scoring as Scoring,
      issues: r.issues as string | null,
      notPlayedReason: r.not_played_reason as NotPlayedReason | null,
      notPlayedOther: r.not_played_other as string | null,
      teamRuns: r.team_runs as number | null,
      teamWkts: r.team_wkts as number | null,
      oppRuns: r.opp_runs as number | null,
      oppWkts: r.opp_wkts as number | null,
      scoreSource: r.score_source as Source | null,
      potdKey: r.potd_key as string | null,
      potdNamedId: r.potd_named_id as string | null,
      mascotKey: r.mascot_key as string | null,
      mascotNamedId: r.mascot_named_id as string | null,
      highlights: r.highlights as string | null,
      updatedAt: r.updated_at as string,
      updatedBy: r.updated_by as string | null,
      milestones: ms.map((m) => ({
        id: m.id as string,
        type: m.type as MilestoneType,
        playerKey: m.player_key as string | null,
        namedId: m.named_id as string | null,
        value: m.value as number | null,
        source: m.source as Source,
        playhqValue: m.playhq_value as number | null,
        touched: m.touched === 1,
      })),
      photoIds: photos.results.filter((p) => p.report_id === id).map((p) => p.id as string),
      named: own,
    };
  });
}

export async function getReport(db: D1Database, seasonId: string, teamSlug: string, gameId: string) {
  return (await loadReports(db, seasonId, { teamSlug, gameId }))[0] ?? null;
}

export async function saveReport(db: D1Database, s: SaveInput): Promise<void> {
  const r = s.row;
  const stmts: D1PreparedStatement[] = [];

  for (const n of s.newNamed) {
    stmts.push(
      db.prepare('INSERT INTO named_players (id, full_name, playhq_id, created_at) VALUES (?, ?, ?, ?)').bind(n.id, n.fullName, n.playhqId, r.updatedAt),
    );
  }

  stmts.push(
    db.prepare(
      `INSERT INTO reports (id, season_id, team_slug, game_id, game_date, scoring, issues, not_played_reason, not_played_other,
         team_runs, team_wkts, opp_runs, opp_wkts, score_source, potd_key, potd_named_id, mascot_key, mascot_named_id,
         highlights, version, updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
       ON CONFLICT(id) DO UPDATE SET
         game_date = excluded.game_date, scoring = excluded.scoring, issues = excluded.issues,
         not_played_reason = excluded.not_played_reason, not_played_other = excluded.not_played_other,
         team_runs = excluded.team_runs, team_wkts = excluded.team_wkts, opp_runs = excluded.opp_runs, opp_wkts = excluded.opp_wkts,
         score_source = excluded.score_source, potd_key = excluded.potd_key, potd_named_id = excluded.potd_named_id,
         mascot_key = excluded.mascot_key, mascot_named_id = excluded.mascot_named_id, highlights = excluded.highlights,
         version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(
      s.reportId, r.seasonId, r.teamSlug, r.gameId, r.gameDate, r.scoring, r.issues, r.notPlayedReason, r.notPlayedOther,
      r.teamRuns, r.teamWkts, r.oppRuns, r.oppWkts, r.scoreSource, r.potdKey, r.potdNamedId, r.mascotKey, r.mascotNamedId,
      r.highlights, s.version, r.updatedAt, r.updatedBy,
    ),
  );

  stmts.push(db.prepare('DELETE FROM milestones WHERE report_id = ?').bind(s.reportId));
  s.milestones.forEach((m, i) =>
    stmts.push(
      db.prepare(
        `INSERT INTO milestones (id, report_id, type, player_key, named_id, value, source, playhq_value, touched, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(m.id, s.reportId, m.type, m.playerKey, m.namedId, m.value, m.source, m.playhqValue, m.touched ? 1 : 0, i),
    ),
  );

  stmts.push(db.prepare('UPDATE photos SET report_id = NULL WHERE report_id = ?').bind(s.reportId));
  for (const pid of s.photoIds) stmts.push(db.prepare('UPDATE photos SET report_id = ? WHERE id = ?').bind(s.reportId, pid));

  stmts.push(
    db.prepare('INSERT INTO report_versions (report_id, version, snapshot, saved_at, saved_by) VALUES (?, ?, ?, ?, ?)').bind(
      s.reportId, s.version, s.snapshot, r.updatedAt, r.updatedBy,
    ),
  );

  await db.batch(stmts); // one transaction
}
```

(Move the new `import type` line to the top of the file.)

`api/src/reports/serialize.ts`:

```ts
import type { ReportOut } from '../../../shared/src/api';
import { otherLabel } from '../../../shared/src/labels';
import type { PlayerChoice } from '../../../shared/src/types';
import type { NamedPlayer, StoredReport } from './repo';

export function refOut(
  key: string | null,
  namedId: string | null,
  named: Map<string, NamedPlayer>,
  labels: Map<string, string>,
): PlayerChoice | null {
  if (key) return { kind: 'squad', key, label: labels.get(key) ?? 'Unknown player' };
  if (!namedId) return null;
  const n = named.get(namedId);
  if (!n) return { kind: 'named', id: namedId, label: 'Unknown player' };
  if (n.playhqId) return { kind: 'named', id: namedId, playhqId: n.playhqId, label: `${otherLabel(n.fullName)} (not in squad)` };
  return { kind: 'named', id: namedId, label: otherLabel(n.fullName) };
}

export function toReportOut(r: StoredReport, labels: Map<string, string>): ReportOut {
  return {
    scoring: r.scoring,
    issues: r.issues ?? '',
    notPlayedReason: r.notPlayedReason,
    notPlayedOther: r.notPlayedOther ?? '',
    team: { runs: r.teamRuns, wkts: r.teamWkts },
    opp: { runs: r.oppRuns, wkts: r.oppWkts },
    scoreSource: r.scoreSource ?? 'entered',
    potd: refOut(r.potdKey, r.potdNamedId, r.named, labels),
    mascot: refOut(r.mascotKey, r.mascotNamedId, r.named, labels),
    highlights: r.highlights ?? '',
    photoIds: r.photoIds,
    milestones: r.milestones.map((m) => ({
      rowId: m.id,
      type: m.type,
      player: refOut(m.playerKey, m.namedId, r.named, labels),
      value: m.value,
      source: m.source,
      playhqValue: m.playhqValue,
      touched: m.touched,
    })),
    updatedBy: r.updatedBy ?? '',
    version: r.version,
    updatedAt: r.updatedAt,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(game-day): D1 report storage and label-only serialisation"
```

### Task 10: Saving reports and viewing saved reports

**Files:**
- Create: `api/src/reports/resolve.ts`, `api/src/routes/reports.ts`
- Modify: `api/src/routes/games.ts` (return saved report), `api/src/app.ts` (register)
- Create: `api/test/builders.ts`
- Test: `api/test/reports.test.ts`

**Interfaces:**
- Consumes: `loadGameContext` (Task 8); `startData` (Task 8); `getReport`, `saveReport`, `StoredReport`, `NamedPlayer`, `StoredMilestone` (Task 9); `toReportOut` (Task 9); `ReportInSchema`, `validateReport` (Task 3); `clientIp` (Task 1).
- Produces: `makeResolver({ team, existing, summary, newId })` → `{ resolve(path, ref) → { key, namedId }, newNamed, fields }`; `registerReports(app)`; test builders `form(over?)`, `put(app, gameId, body)`, `pumasRoutes(over?)`.

- [ ] **Step 1: Builders**

`api/test/builders.ts`:

```ts
import { emptyForm, type FormState, type ReportIn } from '../../shared/src/types';
import type { createApp } from '../src/app';
import { fakeFetch, GRADE, summary, v1Game, v1Page } from './fixtures/playhq';
import { call } from './helpers';

export function form(over: Partial<ReportIn> = {}): ReportIn {
  const base: FormState = {
    ...emptyForm(),
    scoring: 'no',
    team: { runs: 100, wkts: 5 },
    opp: { runs: 90, wkts: 7 },
    potd: { kind: 'squad', key: 'p001' },
    mascot: { kind: 'squad', key: 'p002' },
  };
  return { ...base, baseVersion: 0, ...over };
}

/** g1 = played, not e-scored. g2 = played, final on PlayHQ. g3 = future. */
export const pumasRoutes = (over: Record<string, unknown> = {}) =>
  fakeFetch({
    [`/v1/grades/${GRADE}/games`]: v1Page([
      v1Game({ id: 'g1', date: '2026-01-24', round: 3, opp: 'Hornby Hawks' }),
      v1Game({ id: 'g2', date: '2026-01-31', round: 4 }),
      v1Game({ id: 'g3', date: '2026-02-07', status: 'PENDING', round: 5 }),
    ]),
    '/v2/games/g1/summary': { data: summary({ id: 'g1' }) },
    '/v2/games/g2/summary': {
      data: summary({
        id: 'g2',
        team: { runs: 145, wkts: 4 },
        opp: { runs: 128, wkts: 4 },
        batting: [{ id: 'ph-alex', runs: 31 }, { id: 'ph-fill', runs: 27 }],
        appearances: [{ id: 'ph-fill', firstName: 'Kim', lastName: 'Walker' }],
      }),
    },
    '/v2/games/g3/summary': { data: summary({ id: 'g3', status: 'PENDING' }) },
    ...over,
  });

export const put = (app: ReturnType<typeof createApp>, gameId: string, body: unknown) =>
  call(app, `/api/teams/pumas/games/${gameId}/report`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
```

- [ ] **Step 2: Write the failing test**

`api/test/reports.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GamePage, ReportOut } from '../../shared/src/api';
import { createApp } from '../src/app';
import { form, pumasRoutes, put } from './builders';
import { call, seedSquad, testDeps } from './helpers';

const app = () => createApp(testDeps({ fetch: pumasRoutes().fetch }));

describe('PUT report', () => {
  beforeEach(() => seedSquad());

  it('creates a report and returns labels only', async () => {
    const res = await put(app(), 'g1', form({ mascot: { kind: 'other', fullName: 'Chris Pratt' }, updatedBy: 'Sarah' }));
    expect(res.status).toBe(200);
    const body = await res.json<ReportOut>();
    expect(body.version).toBe(1);
    expect(body.potd).toEqual({ kind: 'squad', key: 'p001', label: 'Alex T.' });
    expect(body.mascot).toMatchObject({ kind: 'named', label: 'Chris P.' });
    expect(body.scoreSource).toBe('entered');
    expect(JSON.stringify(body)).not.toMatch(/Turner|Pratt/);
  });

  it('shows the saved report on the game endpoint', async () => {
    const a = app();
    await put(a, 'g1', form());
    const page = await (await call(a, '/api/teams/pumas/games/g1')).json<GamePage>();
    expect(page.report?.version).toBe(1);
    expect(page.start).toBeNull();
  });

  it('uses PlayHQ scores when PlayHQ has the result, whatever the client sent', async () => {
    const body = await (await put(app(), 'g2', form({ scoring: 'yes', team: { runs: 1, wkts: 1 } }))).json<ReportOut>();
    expect(body.team).toEqual({ runs: 145, wkts: 4 });
    expect(body.scoreSource).toBe('playhq');
  });

  it('stores an unmatched PlayHQ player by id and labels them', async () => {
    const body = await (
      await put(app(), 'g2', form({
        scoring: 'yes',
        milestones: [{ rowId: 'x', type: 'bat', player: { kind: 'playhq', playhqId: 'ph-fill' }, value: 27, source: 'playhq', playhqValue: 27, touched: false }],
      }))
    ).json<ReportOut>();
    expect(body.milestones[0].player).toMatchObject({ kind: 'named', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' });
    const named = await env.DB.prepare('SELECT full_name FROM named_players WHERE playhq_id = ?').bind('ph-fill').first();
    expect(named).toEqual({ full_name: 'Kim Walker' });
  });

  it('clears everything but the reason when the game was not played', async () => {
    const body = await (await put(app(), 'g1', form({ scoring: 'not_played', notPlayedReason: 'rain' }))).json<ReportOut>();
    expect(body).toMatchObject({ scoring: 'not_played', notPlayedReason: 'rain', potd: null, mascot: null, team: { runs: null, wkts: null }, milestones: [] });
  });

  it('increments the version on edit and keeps history', async () => {
    const a = app();
    await put(a, 'g1', form());
    const res = await put(a, 'g1', form({ baseVersion: 1, highlights: 'Edited' }));
    expect((await res.json<ReportOut>()).version).toBe(2);
    const { results } = await env.DB.prepare('SELECT version FROM report_versions ORDER BY version').all();
    expect(results).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it('keeps a saved Other person when sent back as named', async () => {
    const a = app();
    const first = await (await put(a, 'g1', form({ mascot: { kind: 'other', fullName: 'Chris Pratt' } }))).json<ReportOut>();
    const second = await (await put(a, 'g1', form({ baseVersion: 1, mascot: first.mascot }))).json<ReportOut>();
    expect(second.mascot).toEqual(first.mascot);
  });

  it('409s with the latest report on a version conflict', async () => {
    const a = app();
    await put(a, 'g1', form());
    const res = await put(a, 'g1', form({ baseVersion: 0 }));
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string; latest: ReportOut }>();
    expect(body.error).toBe('version_conflict');
    expect(body.latest.version).toBe(1);
  });

  it('422s with field errors', async () => {
    const res = await put(app(), 'g1', form({ potd: null }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'validation_failed', fields: { potd: 'Choose a player.' } });
  });

  it('rejects squad keys from another team, named ids from other reports and unknown PlayHQ ids', async () => {
    const res = await put(app(), 'g1', form({
      potd: { kind: 'squad', key: 'nope' },
      mascot: { kind: 'named', id: 'someone-elses' },
      milestones: [{ rowId: 'x', type: 'bat', player: { kind: 'playhq', playhqId: 'ph-ghost' }, value: 30, source: 'playhq', playhqValue: 30, touched: false }],
    }));
    expect(res.status).toBe(422);
    const { fields } = await res.json<{ fields: Record<string, string> }>();
    expect(Object.keys(fields).sort()).toEqual(['mascot', 'milestones.0.player', 'potd']);
  });

  it('refuses future games', async () => {
    const res = await put(app(), 'g3', form());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'game_not_selectable' });
  });

  it('rejects malformed bodies', async () => {
    const res = await put(app(), 'g1', { scoring: 'maybe' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects unknown photo ids', async () => {
    const res = await put(app(), 'g1', form({ photoIds: ['nope'] }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ fields: { photoIds: expect.any(String) } });
  });

  it('429s when over the save limit', async () => {
    const a = createApp(testDeps({ fetch: pumasRoutes().fetch, limit: async () => false }));
    expect((await put(a, 'g1', form())).status).toBe(429);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run api/test/reports.test.ts`
Expected: FAIL — PUT returns 404 `not_found`.

- [ ] **Step 4: Implement**

`api/src/reports/resolve.ts`:

```ts
import type { FieldErrors, PlayerChoice } from '../../../shared/src/types';
import type { V2Summary } from '../playhq/types';
import type { Team } from '../squad/load';
import type { NamedPlayer, StoredReport } from './repo';

export function makeResolver(o: { team: Team; existing: StoredReport | null; summary: V2Summary | null; newId: () => string }) {
  const newNamed: NamedPlayer[] = [];
  const fields: FieldErrors = {};
  const squadKeys = new Set(o.team.players.map((p) => p.key));
  const appearances = new Map((o.summary?.appearances ?? []).map((a) => [a.id, a]));

  function resolve(path: string, ref: PlayerChoice | null): { key: string | null; namedId: string | null } {
    if (!ref) return { key: null, namedId: null };
    switch (ref.kind) {
      case 'squad':
        if (!squadKeys.has(ref.key)) fields[path] = 'This player is not in the squad.';
        return { key: ref.key, namedId: null };
      case 'named':
        if (!o.existing?.named.has(ref.id)) fields[path] = 'This player is not part of this report.';
        return { key: null, namedId: ref.id };
      case 'other': {
        const id = o.newId();
        newNamed.push({ id, fullName: ref.fullName.trim().replace(/\s+/g, ' '), playhqId: null });
        return { key: null, namedId: id };
      }
      case 'playhq': {
        const a = appearances.get(ref.playhqId);
        if (!a) {
          fields[path] = 'This PlayHQ player is not in this game.';
          return { key: null, namedId: null };
        }
        const id = o.newId();
        newNamed.push({ id, fullName: `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || 'Unnamed player', playhqId: a.id });
        return { key: null, namedId: id };
      }
    }
  }

  return { resolve, newNamed, fields };
}
```

`api/src/routes/reports.ts`:

```ts
import type { Hono } from 'hono';
import * as v from 'valibot';
import { ReportInSchema } from '../../../shared/src/types';
import { validateReport } from '../../../shared/src/validation';
import type { AppEnv } from '../env';
import { ApiError, clientIp } from '../errors';
import { startData } from '../playhq/summary';
import { getReport, saveReport, type SaveInput, type StoredMilestone } from '../reports/repo';
import { makeResolver } from '../reports/resolve';
import { toReportOut } from '../reports/serialize';
import { loadGameContext } from './context';

export function registerReports(app: Hono<AppEnv>) {
  app.put('/teams/:slug/games/:gameId/report', async (c) => {
    const deps = c.get('deps');
    if (!(await deps.limit(c.env, 'WRITE_LIMIT', clientIp(c.req.header('cf-connecting-ip'))))) {
      throw new ApiError(429, 'rate_limited', 'Too many saves — wait a minute and try again.');
    }

    const parsed = v.safeParse(ReportInSchema, await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'The report could not be read.');
    const body = parsed.output;

    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    if (!ctx.game.selectable) throw new ApiError(400, 'game_not_selectable', "This game hasn't been played yet.");

    const ruleErrors = validateReport(body);
    if (Object.keys(ruleErrors).length) {
      throw new ApiError(422, 'validation_failed', 'Please fix the highlighted answers.', { fields: ruleErrors });
    }

    const seasonId = ctx.squad.season.playhqSeasonId;
    const existing = await getReport(c.env.DB, seasonId, ctx.team.slug, ctx.game.gameId);
    if ((existing?.version ?? 0) !== body.baseVersion) {
      throw new ApiError(409, 'version_conflict', 'This report was updated by someone else — review their version first.', {
        latest: existing ? toReportOut(existing, ctx.labels) : null,
      });
    }

    const played = body.scoring !== 'not_played';
    const summary = played ? await ctx.summary() : null;
    const r = makeResolver({ team: ctx.team, existing, summary, newId: deps.id });

    const potd = played ? r.resolve('potd', body.potd) : { key: null, namedId: null };
    const mascot = played ? r.resolve('mascot', body.mascot) : { key: null, namedId: null };
    const milestones: StoredMilestone[] = played
      ? body.milestones.map((m, i) => {
          const p = r.resolve(`milestones.${i}.player`, m.player);
          return {
            id: deps.id(),
            type: m.type,
            playerKey: p.key,
            namedId: p.namedId,
            value: m.type === 'hattrick' ? null : m.value,
            source: m.source,
            playhqValue: m.playhqValue,
            touched: m.touched,
          };
        })
      : [];

    const photoIds = played ? body.photoIds : [];
    for (const pid of photoIds) {
      const row = await c.env.DB.prepare('SELECT report_id FROM photos WHERE id = ?').bind(pid).first<{ report_id: string | null }>();
      if (!row || (row.report_id && row.report_id !== existing?.id)) {
        r.fields.photoIds = 'A photo could not be found — remove it and add it again.';
      }
    }

    if (Object.keys(r.fields).length) {
      throw new ApiError(422, 'validation_failed', 'Please fix the highlighted answers.', { fields: r.fields });
    }

    const result = summary ? startData(summary, ctx.team, ctx.labels).result : null;
    const scores = !played
      ? { teamRuns: null, teamWkts: null, oppRuns: null, oppWkts: null, scoreSource: null }
      : result
        ? { teamRuns: result.team.runs, teamWkts: result.team.wkts, oppRuns: result.opp.runs, oppWkts: result.opp.wkts, scoreSource: 'playhq' as const }
        : { teamRuns: body.team.runs, teamWkts: body.team.wkts, oppRuns: body.opp.runs, oppWkts: body.opp.wkts, scoreSource: 'entered' as const };

    const input: SaveInput = {
      reportId: existing?.id ?? deps.id(),
      version: body.baseVersion + 1,
      row: {
        seasonId,
        teamSlug: ctx.team.slug,
        gameId: ctx.game.gameId,
        gameDate: ctx.game.date!,
        scoring: body.scoring!,
        issues: body.scoring === 'yes_issues' ? body.issues.trim() : null,
        notPlayedReason: played ? null : body.notPlayedReason,
        notPlayedOther: !played && body.notPlayedReason === 'other' ? body.notPlayedOther.trim() : null,
        ...scores,
        potdKey: potd.key,
        potdNamedId: potd.namedId,
        mascotKey: mascot.key,
        mascotNamedId: mascot.namedId,
        highlights: played ? body.highlights.trim() || null : null,
        updatedAt: deps.now().toISOString(),
        updatedBy: body.updatedBy.trim() || null,
      },
      newNamed: r.newNamed,
      milestones,
      photoIds,
      snapshot: '',
    };
    input.snapshot = JSON.stringify({ ...input, snapshot: undefined });

    try {
      await saveReport(c.env.DB, input);
    } catch (err) {
      // Two first-time saves at once: the UNIQUE(season, team, game) constraint rolls the second back.
      if (String(err).includes('UNIQUE')) {
        const latest = await getReport(c.env.DB, seasonId, ctx.team.slug, ctx.game.gameId);
        throw new ApiError(409, 'version_conflict', 'This report was updated by someone else — review their version first.', {
          latest: latest ? toReportOut(latest, ctx.labels) : null,
        });
      }
      throw err;
    }

    const saved = (await getReport(c.env.DB, seasonId, ctx.team.slug, ctx.game.gameId))!;
    console.log(JSON.stringify({ msg: 'report_saved', team: ctx.team.slug, gameId: ctx.game.gameId, version: saved.version }));
    return c.json(toReportOut(saved, ctx.labels));
  });
}
```

In `api/src/routes/games.ts`, make the GET return a saved report without calling PlayHQ:

```ts
import { getReport } from '../reports/repo';
import { toReportOut } from '../reports/serialize';
```

```ts
  app.get('/teams/:slug/games/:gameId', async (c) => {
    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    const saved = await getReport(c.env.DB, ctx.squad.season.playhqSeasonId, ctx.team.slug, ctx.game.gameId);
    if (saved) return c.json<GamePage>({ game: ctx.game, report: toReportOut(saved, ctx.labels), start: null });
    const s = await ctx.summary();
    return c.json<GamePage>({ game: ctx.game, report: null, start: s ? startData(s, ctx.team, ctx.labels) : UNAVAILABLE });
  });
```

In `api/src/app.ts` add `import { registerReports } from './routes/reports';` and `registerReports(app);` after `registerGames(app);`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run api/test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(game-day): save, edit and view reports with conflict detection"
```

### Task 11: Photo upload, serving and nightly cleanup

**Files:**
- Create: `api/src/routes/photos.ts`, `api/src/photos/cleanup.ts`
- Modify: `api/src/app.ts` (register), `api/src/index.ts` (cron)
- Test: `api/test/photos.test.ts`

**Interfaces:**
- Consumes: `ApiError`, `clientIp` (Task 1); `put`, `form`, `pumasRoutes` (Task 10).
- Produces: `MAX_PHOTO_BYTES = 2 * 1024 * 1024`; `DAY_MS`; `registerPhotos(app)`; `cleanupOrphanPhotos(env: Env, now: Date): Promise<number>`.

- [ ] **Step 1: Write the failing test**

`api/test/photos.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReportOut } from '../../shared/src/api';
import { createApp } from '../src/app';
import { cleanupOrphanPhotos } from '../src/photos/cleanup';
import { form, pumasRoutes, put } from './builders';
import { call, NOW, seedSquad, testDeps } from './helpers';

const jpeg = (size = 10) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff]);
  return b;
};
const upload = (app: ReturnType<typeof createApp>, body: BodyInit, type = 'image/jpeg') =>
  call(app, '/api/photos', { method: 'POST', headers: { 'content-type': type }, body });

describe('photos', () => {
  beforeEach(() => seedSquad());

  it('uploads, serves and attaches a photo', async () => {
    const app = createApp(testDeps({ fetch: pumasRoutes().fetch }));
    const res = await upload(app, jpeg());
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    const img = await call(app, `/api/photos/${id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');

    const saved = await (await put(app, 'g1', form({ photoIds: [id] }))).json<ReportOut>();
    expect(saved.photoIds).toEqual([id]);
  });

  it('rejects non-JPEG and oversized uploads', async () => {
    const app = createApp(testDeps());
    expect((await upload(app, jpeg(), 'image/png')).status).toBe(415);
    expect((await upload(app, new Uint8Array([1, 2, 3, 4]))).status).toBe(415);
    expect((await upload(app, jpeg(2 * 1024 * 1024 + 1))).status).toBe(413);
  });

  it('stops serving unattached photos after 24 hours', async () => {
    const id = (await (await upload(createApp(testDeps()), jpeg())).json<{ id: string }>()).id;
    const later = createApp(testDeps({ now: () => new Date(NOW.getTime() + 25 * 3600 * 1000) }));
    expect((await call(later, `/api/photos/${id}`)).status).toBe(404);
  });

  it('cleans up orphans older than a day, keeping attached photos', async () => {
    const app = createApp(testDeps({ fetch: pumasRoutes().fetch }));
    const orphan = (await (await upload(app, jpeg())).json<{ id: string }>()).id;
    const kept = (await (await upload(app, jpeg())).json<{ id: string }>()).id;
    await put(app, 'g1', form({ photoIds: [kept] }));

    expect(await cleanupOrphanPhotos(env, new Date(NOW.getTime() + 3600 * 1000))).toBe(0);
    expect(await cleanupOrphanPhotos(env, new Date(NOW.getTime() + 25 * 3600 * 1000))).toBe(1);
    expect(await env.PHOTOS.head(`photos/${orphan}.jpg`)).toBeNull();
    expect(await env.PHOTOS.head(`photos/${kept}.jpg`)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/test/photos.test.ts`
Expected: FAIL — `../src/photos/cleanup` not found.

- [ ] **Step 3: Implement**

`api/src/photos/cleanup.ts`:

```ts
import type { Env } from '../env';

export const DAY_MS = 24 * 3600 * 1000;

export async function cleanupOrphanPhotos(env: Env, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const { results } = await env.DB.prepare('SELECT id, r2_key FROM photos WHERE report_id IS NULL AND created_at < ? LIMIT 500')
    .bind(cutoff)
    .all<{ id: string; r2_key: string }>();
  if (!results.length) return 0;
  await env.PHOTOS.delete(results.map((r) => r.r2_key));
  await env.DB.batch(results.map((r) => env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(r.id)));
  return results.length;
}
```

`api/src/routes/photos.ts`:

```ts
import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, clientIp } from '../errors';
import { DAY_MS } from '../photos/cleanup';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export function registerPhotos(app: Hono<AppEnv>) {
  app.post('/photos', async (c) => {
    const deps = c.get('deps');
    if (!(await deps.limit(c.env, 'WRITE_LIMIT', clientIp(c.req.header('cf-connecting-ip'))))) {
      throw new ApiError(429, 'rate_limited', 'Too many uploads — wait a minute and try again.');
    }
    const notJpeg = new ApiError(415, 'unsupported_type', 'Photos must be JPEG.');
    if (c.req.header('content-type') !== 'image/jpeg') throw notJpeg;
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength > MAX_PHOTO_BYTES) throw new ApiError(413, 'too_large', 'Photos must be under 2 MB.');
    if (buf.byteLength < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw notJpeg;

    const id = deps.id();
    const key = `photos/${id}.jpg`;
    await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: 'image/jpeg' } });
    await c.env.DB.prepare('INSERT INTO photos (id, report_id, r2_key, bytes, created_at) VALUES (?, NULL, ?, ?, ?)')
      .bind(id, key, buf.byteLength, deps.now().toISOString())
      .run();
    return c.json({ id }, 201);
  });

  app.get('/photos/:id', async (c) => {
    const row = await c.env.DB.prepare('SELECT report_id, r2_key, created_at FROM photos WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ report_id: string | null; r2_key: string; created_at: string }>();
    const recent = row && Date.parse(row.created_at) > c.get('deps').now().getTime() - DAY_MS;
    if (!row || (!row.report_id && !recent)) throw new ApiError(404, 'not_found', 'Photo not found.');
    const obj = await c.env.PHOTOS.get(row.r2_key);
    if (!obj) throw new ApiError(404, 'not_found', 'Photo not found.');
    return new Response(obj.body, {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
    });
  });
}
```

In `api/src/app.ts`: `import { registerPhotos } from './routes/photos';` and `registerPhotos(app);` after `registerReports(app);`.

Replace `api/src/index.ts`:

```ts
import { createApp } from './app';
import { defaultDeps, type Env } from './env';
import { cleanupOrphanPhotos } from './photos/cleanup';

const app = createApp(defaultDeps);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      cleanupOrphanPhotos(env, new Date()).then((deleted) => console.log(JSON.stringify({ msg: 'photo_cleanup', deleted }))),
    );
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(game-day): photo upload, serving and orphan cleanup cron"
```

---

### Task 12: All-games list, CSV exports and admin exports

**Files:**
- Create: `api/src/csv.ts`, `api/src/list/rows.ts`, `api/src/routes/list.ts`, `api/src/routes/admin.ts`
- Modify: `api/src/app.ts` (register)
- Test: `api/test/csv.test.ts`, `api/test/list.test.ts`

**Interfaces:**
- Consumes: `loadSquad` (Task 5); `phq` (Task 7); `teamFixture`, `FixtureGame` (Task 7); `loadReports`, `StoredReport` (Task 9); `squadLabels`, `otherLabel`, `nzDate`, `formatGameDate` (Task 2); `GameRow`, `GamesList`, `ListStatus` (Task 3); `SCORING_TEXT`, `REASON_TEXT`, `STATUS_TEXT`, `MILESTONE_TEXT` (Task 3).
- Produces: `toCsv(header: string[], rows: Cell[][]): string`; `Row = GameRow & { report: StoredReport | null; team: Team }`; `buildRows(...)`, `applyFilters(rows, params)`, `person(key, namedId, report, team, labels)`; `allRows(c)`; `registerList(app)`; `registerAdmin(app)`; `gamesCsv(rows, origin, admin)`, `milestonesCsv(rows, admin)`.

- [ ] **Step 1: Write the failing tests**

`api/test/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/csv';

describe('toCsv', () => {
  it('adds a BOM, quotes where needed and uses CRLF', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [1, null]])).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n1,\r\n');
  });

  it('neutralises spreadsheet formulas in text', () => {
    expect(toCsv(['h'], [['=HYPERLINK("x")'], ['+1'], ['-2'], ['@a'], ['\tz']])).toBe(
      '﻿h\r\n"\'=HYPERLINK(""x"")"\r\n\'+1\r\n\'-2\r\n\'@a\r\n\'\tz\r\n',
    );
  });

  it('leaves negative numbers alone', () => {
    expect(toCsv(['n'], [[-5]])).toBe('﻿n\r\n-5\r\n');
  });
});
```

`api/test/list.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { GamesList } from '../../shared/src/api';
import { createApp } from '../src/app';
import { form, pumasRoutes, put } from './builders';
import { call, seedSquad, testDeps } from './helpers';

async function seeded() {
  await seedSquad();
  const app = createApp(testDeps({ fetch: pumasRoutes().fetch }));
  await put(app, 'g1', form({
    scoring: 'yes_issues',
    issues: 'Tablet died',
    mascot: { kind: 'other', fullName: 'Chris Pratt' },
    highlights: '=cmd()',
    milestones: [{ rowId: 'x', type: 'hattrick', player: { kind: 'squad', key: 'p004' }, value: null, source: 'entered', playhqValue: null, touched: true }],
  }));
  return app;
}

describe('GET /api/games', () => {
  beforeEach(() => seedSquad());

  it('lists every game with status, newest first', async () => {
    const app = await seeded();
    const body = await (await call(app, '/api/games')).json<GamesList>();
    expect(body.rows.map((r) => [r.gameId, r.status])).toEqual([
      ['g3', 'upcoming'],
      ['g2', 'missing'],
      ['g1', 'reported'],
    ]);
    expect(body.rows[2]).toMatchObject({ potd: 'Alex T.', mascot: 'Chris P.', score: '100/5 v 90/7', milestoneCount: 1, issues: 'Tablet died' });
    expect(JSON.stringify(body)).not.toMatch(/Turner|Pratt/);
  });

  it('filters by team, status and follow-up', async () => {
    const app = await seeded();
    const q = async (qs: string) => (await (await call(app, `/api/games?${qs}`)).json<GamesList>()).rows.map((r) => r.gameId);
    expect(await q('status=missing,upcoming')).toEqual(['g3', 'g2']);
    expect(await q('followUp=1')).toEqual(['g1']);
    expect(await q('team=tigers')).toEqual([]);
  });
});

describe('exports', () => {
  it('public CSVs never contain full names', async () => {
    const app = await seeded();
    const games = await (await call(app, '/api/export/games.csv')).text();
    const milestones = await (await call(app, '/api/export/milestones.csv')).text();
    expect(games).toContain('Chris P.');
    expect(games).toContain("'=cmd()");
    expect(games + milestones).not.toMatch(/Turner|Pratt|Lee\b/);
    expect(milestones).toContain('Jordan L.,p004,N,Hat-trick');
  });

  it('admin CSVs add full names with the right passcode', async () => {
    const app = await seeded();
    const res = await call(app, '/api/admin/export/games.csv', { headers: { 'x-admin-passcode': 'letmein' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('games-full-names.csv');
    const text = await res.text();
    expect(text).toContain('Alex Turner');
    expect(text).toContain('Chris Pratt');
  });

  it('admin rejects a wrong passcode and rate-limits', async () => {
    const app = await seeded();
    expect((await call(app, '/api/admin/check', { headers: { 'x-admin-passcode': 'nope' } })).status).toBe(401);
    expect((await call(app, '/api/admin/check', { headers: { 'x-admin-passcode': 'letmein' } })).status).toBe(200);
    const limited = createApp(testDeps({ limit: async (_e, name) => name !== 'ADMIN_LIMIT' }));
    expect((await call(limited, '/api/admin/check', { headers: { 'x-admin-passcode': 'letmein' } })).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run api/test/csv.test.ts api/test/list.test.ts`
Expected: FAIL — modules not found / 404.

- [ ] **Step 3: Implement**

`api/src/csv.ts`:

```ts
export type Cell = string | number | null | undefined;

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
```

`api/src/list/rows.ts`:

```ts
import type { GameRow, ListStatus } from '../../../shared/src/api';
import { formatGameDate } from '../../../shared/src/dates';
import { otherLabel } from '../../../shared/src/labels';
import type { FixtureGame } from '../playhq/fixture';
import type { StoredReport } from '../reports/repo';
import type { Squad, Team } from '../squad/load';

export type Row = GameRow & { report: StoredReport | null; team: Team };

export function person(key: string | null, namedId: string | null, r: StoredReport, team: Team, labels: Map<string, string>) {
  if (key) {
    const p = team.players.find((p) => p.key === key);
    return { label: labels.get(key) ?? 'Unknown player', id: key, isOther: false, fullName: p ? `${p.firstName} ${p.lastName}` : '' };
  }
  if (namedId) {
    const n = r.named.get(namedId);
    return { label: n ? otherLabel(n.fullName) : 'Unknown player', id: namedId, isOther: true, fullName: n?.fullName ?? '' };
  }
  return { label: '', id: '', isOther: false, fullName: '' };
}

function makeRow(team: Team, g: FixtureGame, r: StoredReport | null, today: string, labels: Map<string, string>): Row {
  const status: ListStatus = r
    ? r.scoring === 'not_played'
      ? 'not_played'
      : 'reported'
    : g.date && g.date < today
      ? 'missing'
      : 'upcoming';
  return {
    gameId: g.gameId,
    teamSlug: team.slug,
    teamName: team.name,
    date: g.date,
    dateLabel: g.date ? formatGameDate(g.date) : 'Date TBC',
    round: g.round,
    opposition: g.opposition,
    venue: g.venue,
    status,
    scoring: r?.scoring ?? null,
    issues: r?.issues ?? '',
    notPlayedReason: r?.notPlayedReason ?? null,
    notPlayedOther: r?.notPlayedOther ?? '',
    score: r && r.teamRuns !== null ? `${r.teamRuns}/${r.teamWkts} v ${r.oppRuns}/${r.oppWkts}` : null,
    potd: r ? person(r.potdKey, r.potdNamedId, r, team, labels).label || null : null,
    mascot: r ? person(r.mascotKey, r.mascotNamedId, r, team, labels).label || null : null,
    milestoneCount: r?.milestones.length ?? 0,
    report: r,
    team,
  };
}

export function buildRows(i: {
  squad: Squad;
  fixtures: Map<string, FixtureGame[] | null>;
  reports: StoredReport[];
  today: string;
  labels: Map<string, Map<string, string>>;
}): Row[] {
  const rows: Row[] = [];
  const byKey = new Map(i.reports.map((r) => [`${r.teamSlug}|${r.gameId}`, r]));
  const used = new Set<string>();
  for (const team of i.squad.teams) {
    for (const g of i.fixtures.get(team.slug) ?? []) {
      const k = `${team.slug}|${g.gameId}`;
      const r = byKey.get(k) ?? null;
      if (r) used.add(k);
      rows.push(makeRow(team, g, r, i.today, i.labels.get(team.slug)!));
    }
  }
  // Reports whose game isn't in a fixture we could load (e.g. PlayHQ down).
  for (const r of i.reports) {
    if (used.has(`${r.teamSlug}|${r.gameId}`)) continue;
    const team = i.squad.teams.find((t) => t.slug === r.teamSlug);
    if (!team) continue;
    const g: FixtureGame = { gameId: r.gameId, date: r.gameDate, round: '', opposition: '—', venue: '—', status: '' };
    rows.push(makeRow(team, g, r, i.today, i.labels.get(team.slug)!));
  }
  return rows.sort((a, b) => (b.date ?? '0000').localeCompare(a.date ?? '0000'));
}

export function applyFilters(rows: Row[], q: URLSearchParams): Row[] {
  const team = q.get('team');
  const statuses = (q.get('status') ?? '').split(',').filter(Boolean);
  const followUp = q.get('followUp') === '1';
  return rows.filter(
    (r) =>
      (!team || r.teamSlug === team) &&
      (!statuses.length || statuses.includes(r.status)) &&
      (!followUp || r.scoring === 'no' || r.scoring === 'yes_issues'),
  );
}
```

`api/src/routes/list.ts`:

```ts
import type { Hono } from 'hono';
import type { GamesList } from '../../../shared/src/api';
import { nzDate } from '../../../shared/src/dates';
import { squadLabels } from '../../../shared/src/labels';
import { MILESTONE_TEXT, REASON_TEXT, SCORING_TEXT, STATUS_TEXT } from '../../../shared/src/text';
import { toCsv, type Cell } from '../csv';
import type { AppEnv } from '../env';
import { applyFilters, buildRows, person, type Row } from '../list/rows';
import { teamFixture, type FixtureGame } from '../playhq/fixture';
import type { V1Game } from '../playhq/types';
import { loadReports } from '../reports/repo';
import { loadSquad } from '../squad/load';
import { phq, type Ctx } from './context';

export async function allRows(c: Ctx): Promise<Row[]> {
  const deps = c.get('deps');
  const squad = await loadSquad(c.env, deps.now());
  const service = phq(c);
  const byGrade = new Map<string, Promise<V1Game[] | null>>();
  const fixtures = new Map<string, FixtureGame[] | null>();
  for (const team of squad.teams) {
    const grade = team.playhqGradeId;
    if (!grade) {
      fixtures.set(team.slug, null);
      continue;
    }
    if (!byGrade.has(grade)) byGrade.set(grade, service.fixture(grade).then((r) => r.data).catch(() => null));
    const games = await byGrade.get(grade)!;
    fixtures.set(team.slug, games ? teamFixture(games, team.playhqTeamId) : null);
  }
  const rows = buildRows({
    squad,
    fixtures,
    reports: await loadReports(c.env.DB, squad.season.playhqSeasonId),
    today: nzDate(deps.now()),
    labels: new Map(squad.teams.map((t) => [t.slug, squadLabels(t.players)])),
  });
  return applyFilters(rows, new URL(c.req.url).searchParams);
}

const yn = (b: boolean) => (b ? 'Y' : 'N');

export function gamesCsv(rows: Row[], origin: string, admin: boolean): string {
  const header = [
    'Date', 'Team', 'Round', 'Opposition', 'Venue', 'Status', 'PlayHQ scoring', 'Issues', 'Not played reason',
    'Team runs', 'Team wickets', 'Opposition runs', 'Opposition wickets', 'Score source',
    'Player of the day', 'Player of the day ID', 'Player of the day is Other', ...(admin ? ['Player of the day full name'] : []),
    'Mascot of the day', 'Mascot ID', 'Mascot is Other', ...(admin ? ['Mascot full name'] : []),
    'Highlights', 'Photo links', 'Last updated', 'Last updated by',
  ];
  const body = rows.map((row): Cell[] => {
    const r = row.report;
    const labels = new Map<string, string>();
    const potd = r ? person(r.potdKey, r.potdNamedId, r, row.team, labels) : null;
    const mascot = r ? person(r.mascotKey, r.mascotNamedId, r, row.team, labels) : null;
    const reason = r?.notPlayedReason ? (r.notPlayedReason === 'other' ? `Other: ${r.notPlayedOther ?? ''}` : REASON_TEXT[r.notPlayedReason]) : '';
    return [
      row.date, row.teamName, row.round, row.opposition, row.venue, STATUS_TEXT[row.status],
      r ? SCORING_TEXT[r.scoring] : '', r?.issues ?? '', reason,
      r?.teamRuns, r?.teamWkts, r?.oppRuns, r?.oppWkts, r?.scoreSource === 'playhq' ? 'PlayHQ' : r?.scoreSource ? 'Entered' : '',
      row.potd, potd?.id, potd ? yn(potd.isOther) : '', ...(admin ? [potd?.fullName] : []),
      row.mascot, mascot?.id, mascot ? yn(mascot.isOther) : '', ...(admin ? [mascot?.fullName] : []),
      r?.highlights ?? '', (r?.photoIds ?? []).map((id) => `${origin}/api/photos/${id}`).join(' '), r?.updatedAt, r?.updatedBy,
    ];
  });
  return toCsv(header, body);
}

export function milestonesCsv(rows: Row[], admin: boolean): string {
  const header = ['Date', 'Team', 'Opposition', 'Player', 'Player ID', 'Player is Other', 'Type', 'Runs or wickets', 'Source', ...(admin ? ['Full name'] : [])];
  const body: Cell[][] = [];
  for (const row of rows) {
    if (!row.report) continue;
    const labels = squadLabels(row.team.players);
    for (const m of row.report.milestones) {
      const p = person(m.playerKey, m.namedId, row.report, row.team, labels);
      body.push([
        row.date, row.teamName, row.opposition, p.label, p.id, yn(p.isOther), MILESTONE_TEXT[m.type], m.value,
        m.source === 'playhq' ? 'PlayHQ' : 'Entered', ...(admin ? [p.fullName] : []),
      ]);
    }
  }
  return toCsv(header, body);
}

export const csvResponse = (text: string, filename: string) =>
  new Response(text, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` },
  });

export function registerList(app: Hono<AppEnv>) {
  app.get('/games', async (c) => {
    const rows = await allRows(c);
    const body: GamesList = { today: nzDate(c.get('deps').now()), rows: rows.map(({ report: _r, team: _t, ...row }) => row) };
    return c.json(body);
  });
  app.get('/export/games.csv', async (c) => csvResponse(gamesCsv(await allRows(c), new URL(c.req.url).origin, false), 'games.csv'));
  app.get('/export/milestones.csv', async (c) => csvResponse(milestonesCsv(await allRows(c), false), 'milestones.csv'));
}
```

`gamesCsv` passes an empty `labels` map to `person` only to get `id`, `isOther` and `fullName`; the display labels come from `row.potd` / `row.mascot`, which `buildRows` computed with the team's real labels.

`api/src/routes/admin.ts`:

```ts
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, clientIp } from '../errors';
import { allRows, csvResponse, gamesCsv, milestonesCsv } from './list';

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function requireAdmin(c: Context<AppEnv>) {
  if (!(await c.get('deps').limit(c.env, 'ADMIN_LIMIT', clientIp(c.req.header('cf-connecting-ip'))))) {
    throw new ApiError(429, 'rate_limited', 'Too many attempts — wait a minute and try again.');
  }
  if (!(await safeEqual(c.req.header('x-admin-passcode') ?? '', c.env.ADMIN_PASSCODE))) {
    throw new ApiError(401, 'unauthorised', 'Wrong passcode.');
  }
}

export function registerAdmin(app: Hono<AppEnv>) {
  app.get('/admin/check', async (c) => {
    await requireAdmin(c);
    return c.json({ ok: true });
  });
  app.get('/admin/export/games.csv', async (c) => {
    await requireAdmin(c);
    return csvResponse(gamesCsv(await allRows(c), new URL(c.req.url).origin, true), 'games-full-names.csv');
  });
  app.get('/admin/export/milestones.csv', async (c) => {
    await requireAdmin(c);
    return csvResponse(milestonesCsv(await allRows(c), true), 'milestones-full-names.csv');
  });
}
```

In `api/src/app.ts`: import and call `registerList(app);` and `registerAdmin(app);` after `registerPhotos(app);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/test`
Expected: PASS. Also run `npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(game-day): all-games list, public and admin CSV exports"
```

### Task 13: SvelteKit SPA scaffold, branding and home page

**Files:**
- Create: `web/` (SvelteKit project), `web/svelte.config.js`, `web/vite.config.ts`, `web/src/app.html`
- Create: `web/src/lib/api.ts`, `web/src/lib/Mascot.svelte`, `web/src/lib/styles/tokens.css`, `web/src/lib/styles/app.css`
- Create: `web/src/routes/+layout.ts`, `+layout.svelte`, `+error.svelte`, `+page.ts`, `+page.svelte`
- Create: `web/static/brand/pcc-logo-horizontal.svg`, `pcc-logo-horizontal-dark.svg`, `pcc-ball-teal.png`

**Interfaces:**
- Consumes: `TeamSummary`, `TeamPage`, `GamePage`, `RefreshResult`, `ReportOut`, `GamesList`, `ApiErrorBody` (Task 3); `ReportIn` (Task 3); API routes from Tasks 5–12.
- Produces: `api(f?: typeof fetch)` returning `{ teams(), team(slug), game(slug, gameId), refresh(slug, gameId), save(slug, gameId, body), uploadPhoto(blob), games(qs) }`; `ApiFailure { status; code; message; body: ApiErrorBody | null }`; `<Mascot name size? alt? />`; global CSS classes `.btn`, `.btn-secondary`, `.btn-link`, `.card`, `.field`, `.choice`, `.error`, `.note`, `.badge`, `.badge-phq`, `.badge-reported`, `.badge-missing`, `.badge-upcoming`, `.badge-not_played`, `.badge-not_reported`, `.team-band`, `.hero`, `.banner`.

- [ ] **Step 1: Create the SvelteKit project**

```bash
npx sv create web --template minimal --types ts --no-add-ons --install npm
npm --prefix web i -D @sveltejs/adapter-static
npm --prefix web i @fontsource/outfit @fontsource/lexend
npm --prefix web uninstall @sveltejs/adapter-auto
```

`web/svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ fallback: 'index.html' }),
    alias: { $shared: '../shared/src' },
  },
};
```

`web/vite.config.ts`:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8787' }, // `wrangler dev` in the other terminal
  },
});
```

`web/src/app.html`:

```html
<!doctype html>
<html lang="en-NZ">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/brand/pcc-ball-teal.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#052F5F" />
    <title>Game day reports · Parklands Cricket Club</title>
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

Brand assets (club's own files from its website):

```bash
mkdir -p web/static/brand web/static/mascots
curl -fsSL -o web/static/brand/pcc-logo-horizontal.svg https://parklandscricket.co.nz/wp-content/uploads/2025/08/PCC-Logo-Horizontal-Solid-Main.svg
curl -fsSL -o web/static/brand/pcc-logo-horizontal-dark.svg https://parklandscricket.co.nz/wp-content/uploads/2025/09/PCC-Logo-Horizontal-Dark-Bkg.svg
curl -fsSL -o web/static/brand/pcc-ball-teal.png https://parklandscricket.co.nz/wp-content/uploads/2025/09/cropped-PCC-Ball-Teal-192x192.png \
  || curl -fsSL -o web/static/brand/pcc-ball-teal.png https://parklandscricket.co.nz/wp-content/uploads/2025/09/cropped-PCC-Ball-Teal-32x32.png
```

- [ ] **Step 2: Styles**

`web/src/lib/styles/tokens.css`:

```css
:root {
  --pcc-navy-900: #02152b;
  --pcc-navy-700: #052f5f;
  --pcc-teal-400: #40beb3;
  --pcc-teal-600: #22948a;
  --pcc-blue-700: #005377;
  --pcc-bg: #f4f4f4;
  --pcc-surface: #ffffff;
  --pcc-error: #b42318;
  --pcc-grey-600: #5d5d5d;
  --pcc-grey-300: #c0c4c6;
  --font-head: 'Outfit', system-ui, sans-serif;
  --font-body: 'Lexend', system-ui, sans-serif;
  --radius: 4px;
  --gutter: 16px;
}
```

`web/src/lib/styles/app.css`:

```css
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--pcc-bg); color: var(--pcc-navy-900); font: 400 16px/1.5 var(--font-body); }
main { max-width: 720px; margin: 0 auto; padding: var(--gutter); }
h1, h2, h3, legend { font-family: var(--font-head); font-weight: 800; text-transform: uppercase; color: var(--pcc-navy-700); line-height: 1.15; }
h1 { font-size: clamp(1.8rem, 6vw, 2.6rem); margin: 0 0 0.25em; }
h2 { font-size: 1.4rem; }
h3 { font-size: 1.05rem; margin: 0.5em 0; }
a { color: var(--pcc-blue-700); }
:focus-visible { outline: 3px solid var(--pcc-teal-600); outline-offset: 2px; }

.site-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px var(--gutter); background: var(--pcc-surface); border-top: 6px solid var(--pcc-navy-900); }
.site-header img { display: block; height: 40px; width: auto; }
.site-header nav a { font-family: var(--font-head); font-weight: 700; text-transform: uppercase; text-decoration: none; color: var(--pcc-navy-700); }

.hero, .team-band { background: var(--pcc-navy-700); color: #fff; margin: calc(-1 * var(--gutter)) calc(-1 * var(--gutter)) var(--gutter); padding: 24px var(--gutter); }
.hero h1, .team-band h1 { color: var(--pcc-teal-400); }
.team-band { display: flex; align-items: center; gap: 16px; }
.team-band p { margin: 0; color: #fff; }

.card { background: var(--pcc-surface); border: 1px solid var(--pcc-grey-300); border-radius: var(--radius); padding: 16px; margin: 0 0 16px; min-width: 0; }
fieldset.card { display: block; }
legend { float: left; width: 100%; padding: 0; margin-bottom: 8px; font-size: 1.05rem; }
legend + * { clear: left; }

.field { display: block; margin: 12px 0 4px; font-weight: 600; }
.field input, .field select, .field textarea, select, input[type='text'], textarea {
  display: block; width: 100%; margin-top: 4px; padding: 10px 12px; font: inherit; color: inherit;
  background: #fff; border: 1px solid var(--pcc-grey-600); border-radius: var(--radius);
}
input[readonly] { background: var(--pcc-bg); border-style: dashed; }
.choice { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-weight: 400; }
.choice input { width: 20px; height: 20px; accent-color: var(--pcc-navy-700); }

.btn, .btn-secondary {
  display: inline-block; padding: 12px 22px; font: 700 1rem var(--font-head); text-transform: uppercase; text-decoration: none;
  border-radius: 0; cursor: pointer; border: 2px solid transparent;
}
.btn { background: var(--pcc-teal-400); color: var(--pcc-navy-900); }
.btn-secondary { background: transparent; color: var(--pcc-navy-700); border-color: var(--pcc-navy-700); }
.btn[disabled], .btn-secondary[disabled] { opacity: 0.6; cursor: progress; }
.btn-link { background: none; border: 0; padding: 4px; color: var(--pcc-blue-700); text-decoration: underline; font: inherit; cursor: pointer; }

.error { color: var(--pcc-error); font-weight: 600; margin: 4px 0; }
.note { color: var(--pcc-grey-600); }
.banner { background: #e8f6f5; border-left: 4px solid var(--pcc-teal-600); padding: 12px; margin-bottom: 16px; }

.badge { display: inline-block; padding: 2px 8px; font-size: 0.8rem; font-weight: 600; border-radius: var(--radius); border: 1px solid transparent; }
.badge-phq, .badge-reported { background: #d9f2ef; color: var(--pcc-navy-900); }
.badge-missing { background: #fbe4e2; color: var(--pcc-navy-900); }
.badge-upcoming, .badge-not_reported { background: #ececec; color: var(--pcc-navy-900); }
.badge-not_played { border-color: var(--pcc-grey-600); color: var(--pcc-navy-900); }

.team-grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.team-card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px; background: var(--pcc-surface); border: 1px solid var(--pcc-grey-300); text-decoration: none; color: var(--pcc-navy-900); font-weight: 600; text-align: center; }
```

- [ ] **Step 3: API client, mascot, layout and pages**

`web/src/lib/api.ts`:

```ts
import type { ApiErrorBody, GamePage, GamesList, RefreshResult, ReportOut, TeamPage, TeamSummary } from '$shared/api';
import type { ReportIn } from '$shared/types';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public body: ApiErrorBody | null) {
    super(message);
  }
}

export function api(f: typeof fetch = fetch) {
  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await f(`/api${path}`, init);
    } catch {
      throw new ApiFailure(0, 'network', 'Could not reach the server — check your connection and try again.', null);
    }
    const body = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
    if (!res.ok) throw new ApiFailure(res.status, body?.error ?? 'error', body?.message ?? 'Something went wrong.', body);
    return body as T;
  }
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    teams: () => req<TeamSummary[]>('/teams'),
    team: (slug: string) => req<TeamPage>(`/teams/${encodeURIComponent(slug)}`),
    game: (slug: string, gameId: string) => req<GamePage>(`/teams/${slug}/games/${encodeURIComponent(gameId)}`),
    refresh: (slug: string, gameId: string) => req<RefreshResult>(`/teams/${slug}/games/${encodeURIComponent(gameId)}/refresh`, { method: 'POST' }),
    save: (slug: string, gameId: string, body: ReportIn) => req<ReportOut>(`/teams/${slug}/games/${encodeURIComponent(gameId)}/report`, json('PUT', body)),
    uploadPhoto: (blob: Blob) => req<{ id: string }>('/photos', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob }),
    games: (qs: string) => req<GamesList>(`/games${qs ? `?${qs}` : ''}`),
  };
}
```

`web/src/lib/Mascot.svelte`:

```svelte
<script lang="ts">
  let { name, size = 'lg', alt = '' }: { name: string; size?: 'lg' | 'sm'; alt?: string } = $props();
  let failed = $state(false);
  const src = $derived(failed ? '/brand/pcc-ball-teal.png' : `/mascots/${name}${size === 'sm' ? '-sm' : ''}.webp`);
</script>

<span class="mascot {size}"><img {src} {alt} onerror={() => (failed = true)} /></span>

<style>
  .mascot { display: inline-grid; place-items: center; background: #fff; border-radius: 12px; overflow: hidden; flex: none; }
  .lg { width: 112px; height: 112px; }
  .sm { width: 72px; height: 72px; }
  img { width: 100%; height: 100%; object-fit: contain; }
</style>
```

`web/src/routes/+layout.ts`:

```ts
export const ssr = false;
export const prerender = false;
```

`web/src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import '@fontsource/outfit/latin-700.css';
  import '@fontsource/outfit/latin-800.css';
  import '@fontsource/lexend/latin-400.css';
  import '@fontsource/lexend/latin-600.css';
  import '$lib/styles/tokens.css';
  import '$lib/styles/app.css';

  let { children } = $props();
</script>

<header class="site-header">
  <a href="/"><img src="/brand/pcc-logo-horizontal.svg" alt="Parklands Cricket Club" width="172" height="40" /></a>
  <nav><a href="/games">All games</a></nav>
</header>
<main>{@render children()}</main>
```

`web/src/routes/+error.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/state';
</script>

<section class="card">
  <h1>{page.status === 404 ? 'Team not found' : 'Something went wrong'}</h1>
  {#if page.status !== 404}<p>{page.error?.message}</p>{/if}
  <p><a href="/">See all teams</a></p>
</section>
```

`web/src/routes/+page.ts`:

```ts
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => ({ teams: await api(fetch).teams() });
```

`web/src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import Mascot from '$lib/Mascot.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<section class="hero">
  <h1>Game day reports</h1>
  <p>Choose your team to report on a game.</p>
</section>

<ul class="team-grid">
  {#each data.teams as t (t.slug)}
    <li><a class="team-card" href="/{t.slug}"><Mascot name={t.mascot} size="sm" />{t.name}</a></li>
  {/each}
</ul>
<p><a href="/games">See all games →</a></p>
```

- [ ] **Step 4: Verify**

Run: `npm --prefix web run check && npm run build:web`
Expected: svelte-check reports 0 errors; `web/build/index.html` exists.

Run (two terminals): `cp .dev.vars.example .dev.vars` (put the real PlayHQ key in `.dev.vars`), `npx wrangler d1 migrations apply pcc-game-day --local`, `npx wrangler kv key put squad --path=api/test/fixtures/squad.json --binding=CONFIG --local`, then `npx wrangler dev`.
Open `http://127.0.0.1:8787/`. Expected: club logo header, navy hero with teal "GAME DAY REPORTS", two team cards (the club ball shows until Task 14 adds mascots). Check at 375 px wide: no horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(game-day): SvelteKit SPA scaffold with club branding and team list"
```

---

### Task 14: Team mascots pipeline

**Files:**
- Create: `scripts/prepare-mascots.ts`
- Create: `web/static/mascots/*.webp` (generated)

**Interfaces:**
- Produces: `web/static/mascots/{name}.webp` (512 px) and `{name}-sm.webp` (128 px), consumed by `<Mascot>` (Task 13).

- [ ] **Step 1: Get the originals**

Ask the user to download the SharePoint folder **PCC Committee → Documents → Marketing → Team certs and mascots → Mascots** (27 images, ~70 MB; skip the `PSDs` subfolder) and put the PNG/JPG files in `game-day-form/assets-src/mascots/`. `assets-src/` is git-ignored.

- [ ] **Step 2: Write the script**

`scripts/prepare-mascots.ts`:

```ts
import { mkdir, readdir } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const SRC = 'assets-src/mascots';
const OUT = 'web/static/mascots';

const files = (await readdir(SRC)).filter((f) => /\.(png|jpe?g)$/i.test(f));
if (!files.length) {
  console.error(`No images in ${SRC}. Download the Mascots folder from SharePoint first.`);
  process.exit(1);
}
await mkdir(OUT, { recursive: true });

for (const f of files) {
  const name = parse(f).name.toLowerCase();
  const trimmed = await sharp(join(SRC, f)).flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 20 }).toBuffer();
  const { width = 1, height = 1 } = await sharp(trimmed).metadata();
  const side = Math.max(width, height);
  const pad = Math.round(side * 0.06);
  const square = await sharp(trimmed)
    .resize({ width: side, height: side, fit: 'contain', background: '#ffffff' })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#ffffff' })
    .toBuffer();
  for (const [suffix, px] of [['', 512], ['-sm', 128]] as const) {
    await sharp(square).resize(px, px).webp({ quality: 82 }).toFile(join(OUT, `${name}${suffix}.webp`));
  }
  console.log(`✓ ${name}`);
}
```

- [ ] **Step 3: Run and verify**

Run: `npm run mascots && ls -l web/static/mascots | head -5 && ls web/static/mascots | wc -l`
Expected: one `✓` line per image; file count = 2 × number of originals (54 for 27); 512 px files roughly 20–80 KB.

Open `http://127.0.0.1:8787/` after `npm run build:web`. Expected: the Pumas card shows the Pumas mascot; Tigers shows the tiger.

- [ ] **Step 4: Commit**

```bash
git add scripts/prepare-mascots.ts web/static/mascots
git commit -m "feat(game-day): optimised team mascots from SharePoint originals"
```

### Task 15: Team page and game picker

**Files:**
- Create: `web/src/routes/[team]/+page.ts`, `web/src/routes/[team]/+page.svelte`, `web/src/lib/game/GamePicker.svelte`

**Interfaces:**
- Consumes: `api`, `ApiFailure`, `Mascot` (Task 13); `TeamPage`, `GameOption` (Task 3); `STATUS_TEXT` (Task 3).
- Produces: team route data `{ team: TeamPage }`; `<GamePicker games selected onselect />`; the selected game id lives in `?game=`. Task 17 adds `<GameView>` under the picker.

- [ ] **Step 1: Implement**

`web/src/routes/[team]/+page.ts`:

```ts
import { error } from '@sveltejs/kit';
import { api, ApiFailure } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  try {
    return { team: await api(fetch).team(params.team.toLowerCase()) };
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) error(404, 'Team not found');
    throw e;
  }
};
```

`web/src/lib/game/GamePicker.svelte`:

```svelte
<script lang="ts">
  import type { GameOption } from '$shared/api';
  import { STATUS_TEXT } from '$shared/text';

  let { games, selected, onselect }: { games: GameOption[]; selected: string | null; onselect: (id: string) => void } = $props();
</script>

<label class="field card">
  Game
  <select id="game" value={selected ?? ''} onchange={(e) => onselect(e.currentTarget.value)}>
    {#each games as g (g.gameId)}
      <option value={g.gameId} disabled={!g.selectable}>
        {g.dateLabel} · {g.round} · v {g.opposition} · {g.venue} — {STATUS_TEXT[g.reportStatus]}
      </option>
    {/each}
  </select>
</label>
```

`web/src/routes/[team]/+page.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Mascot from '$lib/Mascot.svelte';
  import GamePicker from '$lib/game/GamePicker.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const team = $derived(data.team);
  const gameId = $derived(page.url.searchParams.get('game') ?? team.defaultGameId);

  function select(id: string) {
    goto(`?game=${encodeURIComponent(id)}`, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head><title>{team.team.name} · Game day report</title></svelte:head>

<section class="team-band">
  <Mascot name={team.team.mascot} alt="" />
  <div>
    <h1>{team.team.name}</h1>
    <p>{[team.team.grade, team.season].filter(Boolean).join(' · ')}</p>
  </div>
</section>

{#if !team.fixture.available}
  <p class="card note">Fixture not available from PlayHQ yet.</p>
{:else if !gameId}
  <GamePicker games={team.fixture.games} selected={null} onselect={select} />
  <p class="card note">No games played yet this season.</p>
{:else}
  <GamePicker games={team.fixture.games} selected={gameId} onselect={select} />
  <!-- GameView is added in Task 17 -->
{/if}
```

- [ ] **Step 2: Verify**

Run: `npm --prefix web run check && npm run build:web`, restart `npx wrangler dev`.
Open `http://127.0.0.1:8787/pumas` (with the real squad or the test squad and a real PlayHQ key). Expected: navy band with the Pumas mascot, team name in teal capitals, grade and season in white; dropdown defaults to the most recent played game; future games greyed out and not selectable; choosing a game changes the URL to `?game=…` and Back returns to the previous choice.
Open `/Pumas`: same page. Open `/pumaz`: "Team not found" with a link to all teams. Open `/tigers`: "Fixture not available from PlayHQ yet."

- [ ] **Step 3: Commit**

```bash
git add web
git commit -m "feat(game-day): team page with game picker"
```

---

### Task 16: Form model, drafts and form components

**Files:**
- Create: `web/src/lib/form/game-form.svelte.ts`, `web/src/lib/form/drafts.ts`
- Create: `web/src/lib/form/FieldError.svelte`, `NumberInput.svelte`, `PlayerPicker.svelte`, `MilestoneList.svelte`, `PhotoPicker.svelte`, `ReportForm.svelte`
- Create: `web/src/lib/photos/resize.ts`

**Interfaces:**
- Consumes: `FormState`, `FieldErrors`, `PlayerChoice`, `MilestoneType`, `emptyForm` (Task 3); `merge` (Task 4); `SCORING_TEXT`, `REASON_TEXT` (Task 3); `api` (Task 13); `TeamPage` (Task 3).
- Produces:
  - `class GameForm { state: FormState; errors: FieldErrors; baseVersion: number; initialJson: string; draftKey: string; reset(s: FormState, baseVersion: number): void }`
  - `Draft { state: FormState; baseVersion: number; savedAt: string }`; `loadDraft(key)`, `saveDraft(key, d)`, `clearDraft(key)`
  - `resizePhoto(file: Blob, maxSide?, quality?): Promise<Blob>`; `PhotoReadError`
  - `<ReportForm form team gameId onnext />` — renders every question, Refresh buttons, and calls `onnext()` on submit. Section ids: `sec-scoring`, `sec-scores`, `sec-awards`, `sec-highlights`, `sec-milestones`, `sec-name`. Input ids used by e2e: `team-wkts`, `team-runs`, `opp-wkts`, `opp-runs`, `potd`, `potd-other`, `mascot`, `mascot-other`, `highlights`, `updated-by`.

- [ ] **Step 1: Model, drafts, photo resize**

`web/src/lib/form/game-form.svelte.ts`:

```ts
import { emptyForm, type FieldErrors, type FormState } from '$shared/types';

export class GameForm {
  state = $state<FormState>(emptyForm());
  errors = $state<FieldErrors>({});
  baseVersion = $state(0);
  initialJson = '';

  constructor(public draftKey: string) {}

  reset(s: FormState, baseVersion: number) {
    this.state = JSON.parse(JSON.stringify(s));
    this.baseVersion = baseVersion;
    this.errors = {};
    this.initialJson = JSON.stringify(this.state);
  }
}
```

`web/src/lib/form/drafts.ts`:

```ts
import type { FormState } from '$shared/types';

export interface Draft {
  state: FormState;
  baseVersion: number;
  savedAt: string;
}

export function loadDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, d: Draft) {
  try {
    localStorage.setItem(key, JSON.stringify(d));
  } catch {
    /* storage full or blocked — drafts are a convenience only */
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
```

`web/src/lib/photos/resize.ts`:

```ts
export class PhotoReadError extends Error {}

/** Decode, orient, shrink to maxSide and re-encode as JPEG (drops EXIF, including GPS). */
export async function resizePhoto(file: Blob, maxSide = 1600, quality = 0.8): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoReadError('decode');
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new PhotoReadError('encode');
  return blob;
}
```

- [ ] **Step 2: Small components**

`web/src/lib/form/FieldError.svelte`:

```svelte
<script lang="ts">
  let { msg }: { msg?: string } = $props();
</script>

{#if msg}<p class="error" role="alert">{msg}</p>{/if}
```

`web/src/lib/form/NumberInput.svelte` (digits only; one-way value plus `oninput` so Refresh can overwrite it):

```svelte
<script lang="ts">
  import FieldError from './FieldError.svelte';

  let {
    value = $bindable(),
    id,
    label,
    maxDigits = 3,
    readonly = false,
    error,
    onedit,
  }: { value: number | null; id: string; label: string; maxDigits?: number; readonly?: boolean; error?: string; onedit?: () => void } = $props();
</script>

<label class="field" for={id}>{label}</label>
<input
  {id}
  type="text"
  inputmode="numeric"
  autocomplete="off"
  {readonly}
  value={value ?? ''}
  aria-invalid={!!error}
  oninput={(e) => {
    const digits = e.currentTarget.value.replace(/\D/g, '').slice(0, maxDigits);
    e.currentTarget.value = digits;
    value = digits === '' ? null : Number(digits);
    onedit?.();
  }}
/>
<FieldError msg={error} />
```

`web/src/lib/form/PlayerPicker.svelte`:

```svelte
<script lang="ts">
  import { untrack } from 'svelte';
  import type { PlayerChoice } from '$shared/types';
  import FieldError from './FieldError.svelte';

  let {
    value = $bindable(),
    squad,
    id,
    label,
    error,
    onedit,
  }: { value: PlayerChoice | null; squad: { key: string; label: string }[]; id: string; label: string; error?: string; onedit?: () => void } = $props();

  // A saved or PlayHQ person who isn't in the squad stays selectable even after switching away.
  const original = untrack(() => (value && (value.kind === 'named' || value.kind === 'playhq') ? $state.snapshot(value) : null));

  const selected = $derived(
    !value ? '' : value.kind === 'squad' ? `s:${value.key}` : value.kind === 'other' ? 'other' : 'current',
  );

  function choose(v: string) {
    if (v === '') value = null;
    else if (v === 'other') value = { kind: 'other', fullName: '' };
    else if (v === 'current') value = original;
    else {
      const key = v.slice(2);
      value = { kind: 'squad', key, label: squad.find((p) => p.key === key)?.label };
    }
    onedit?.();
  }
</script>

<label class="field" for={id}>{label}</label>
<select {id} value={selected} onchange={(e) => choose(e.currentTarget.value)} aria-invalid={!!error}>
  <option value="">Choose a player…</option>
  {#each squad as p (p.key)}<option value={`s:${p.key}`}>{p.label}</option>{/each}
  {#if original}<option value="current">{original.label}</option>{/if}
  <option value="other">Other…</option>
</select>
{#if value?.kind === 'other'}
  <label class="field" for={`${id}-other`}>Full name</label>
  <input
    id={`${id}-other`}
    type="text"
    maxlength="120"
    autocomplete="off"
    value={value.fullName}
    oninput={(e) => {
      value = { kind: 'other', fullName: e.currentTarget.value };
      onedit?.();
    }}
  />
{/if}
{#if value?.kind === 'playhq'}<p class="note">Couldn't match to squad — please check.</p>{/if}
<FieldError msg={error} />
```

`web/src/lib/form/MilestoneList.svelte`:

```svelte
<script lang="ts">
  import type { MilestoneType } from '$shared/types';
  import type { GameForm } from './game-form.svelte';
  import NumberInput from './NumberInput.svelte';
  import PlayerPicker from './PlayerPicker.svelte';

  let { form, type, squad, title, valueLabel = '', maxDigits = 3 }: {
    form: GameForm;
    type: MilestoneType;
    squad: { key: string; label: string }[];
    title: string;
    valueLabel?: string;
    maxDigits?: number;
  } = $props();

  function add() {
    form.state.milestones.push({ rowId: crypto.randomUUID(), type, player: null, value: null, source: 'entered', playhqValue: null, touched: true });
  }
  function remove(rowId: string) {
    form.state.milestones = form.state.milestones.filter((m) => m.rowId !== rowId);
  }
</script>

<h3>{title}</h3>
{#each form.state.milestones as row, i (row.rowId)}
  {#if row.type === type}
    <div class="milestone">
      {#if row.source === 'playhq'}<span class="badge badge-phq">From PlayHQ</span>{/if}
      <PlayerPicker bind:value={row.player} {squad} id={`m-${row.rowId}`} label="Player" error={form.errors[`milestones.${i}.player`]} onedit={() => (row.touched = true)} />
      {#if type !== 'hattrick'}
        <NumberInput bind:value={row.value} id={`m-${row.rowId}-value`} label={valueLabel} {maxDigits} error={form.errors[`milestones.${i}.value`]} onedit={() => (row.touched = true)} />
      {/if}
      <button type="button" class="btn-link" onclick={() => remove(row.rowId)}>Remove</button>
    </div>
  {/if}
{/each}
<button type="button" class="btn-secondary" onclick={add}>Add {title.toLowerCase()}</button>

<style>
  .milestone { border-left: 3px solid var(--pcc-teal-400); padding: 4px 0 8px 12px; margin: 12px 0; }
</style>
```

`web/src/lib/form/PhotoPicker.svelte`:

```svelte
<script lang="ts">
  import { api } from '$lib/api';
  import { PhotoReadError, resizePhoto } from '$lib/photos/resize';
  import type { GameForm } from './game-form.svelte';
  import FieldError from './FieldError.svelte';

  let { form }: { form: GameForm } = $props();
  let busy = $state(false);
  let msg = $state('');

  async function pick(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = '';
    msg = '';
    for (const file of files) {
      if (form.state.photoIds.length >= 5) {
        msg = 'You can add up to 5 photos.';
        break;
      }
      busy = true;
      try {
        const { id } = await api().uploadPhoto(await resizePhoto(file));
        form.state.photoIds.push(id);
      } catch (e) {
        msg = e instanceof PhotoReadError ? "Couldn't read this photo — try a JPEG or PNG." : 'Upload failed — try again.';
      } finally {
        busy = false;
      }
    }
  }
</script>

<div class="thumbs">
  {#each form.state.photoIds as id (id)}
    <figure>
      <img src="/api/photos/{id}" alt="Game photo" loading="lazy" />
      <button type="button" class="btn-link" onclick={() => (form.state.photoIds = form.state.photoIds.filter((p) => p !== id))}>Remove</button>
    </figure>
  {/each}
</div>
{#if form.state.photoIds.length < 5}
  <label class="btn-secondary">
    {busy ? 'Uploading…' : 'Add photos'}
    <input type="file" accept="image/*" multiple hidden disabled={busy} onchange={(e) => pick(e.currentTarget)} />
  </label>
{/if}
<FieldError msg={msg || form.errors.photoIds} />

<style>
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
  figure { margin: 0; width: 96px; }
  img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--radius); display: block; }
</style>
```

- [ ] **Step 3: The form**

`web/src/lib/form/ReportForm.svelte`:

```svelte
<script lang="ts">
  import { api } from '$lib/api';
  import type { TeamPage } from '$shared/api';
  import { merge } from '$shared/merge';
  import { REASON_TEXT, SCORING_TEXT } from '$shared/text';
  import type { FormState } from '$shared/types';
  import FieldError from './FieldError.svelte';
  import type { GameForm } from './game-form.svelte';
  import MilestoneList from './MilestoneList.svelte';
  import NumberInput from './NumberInput.svelte';
  import PhotoPicker from './PhotoPicker.svelte';
  import PlayerPicker from './PlayerPicker.svelte';

  let { form, team, gameId, onnext }: { form: GameForm; team: TeamPage; gameId: string; onnext: () => void } = $props();

  const SCORINGS = ['yes', 'no', 'yes_issues', 'not_played'] as const;
  const REASONS = ['rain', 'cancelled', 'forfeit', 'other'] as const;
  const fromPlayhq = $derived(form.state.scoreSource === 'playhq');
  const opposition = $derived(team.fixture.games.find((g) => g.gameId === gameId)?.opposition ?? 'Opposition');
  let refreshing = $state(false);
  let refreshMsg = $state('');

  async function refresh() {
    refreshing = true;
    refreshMsg = 'Checking PlayHQ…';
    try {
      const r = await api().refresh(team.team.slug, gameId);
      if (r.rateLimited) {
        refreshMsg = 'Just refreshed — try again in a minute.';
        return;
      }
      const { next, changes } = merge($state.snapshot(form.state) as FormState, r.start);
      form.state = next;
      refreshMsg = changes.join(' · ');
    } catch {
      refreshMsg = "Couldn't reach PlayHQ — try again later.";
    } finally {
      refreshing = false;
    }
  }
</script>

{#snippet refreshButton()}
  <button type="button" class="btn-secondary" onclick={refresh} disabled={refreshing}>Refresh from PlayHQ</button>
  {#if refreshMsg}<p class="note" role="status">{refreshMsg}</p>{/if}
{/snippet}

<form novalidate onsubmit={(e) => { e.preventDefault(); onnext(); }}>
  <fieldset class="card" id="sec-scoring">
    <legend>Did you score this game electronically on PlayHQ?</legend>
    {#each SCORINGS as v (v)}
      {#if !(v === 'no' && fromPlayhq)}
        <label class="choice"><input type="radio" name="scoring" value={v} bind:group={form.state.scoring} /> {SCORING_TEXT[v]}</label>
      {/if}
    {/each}
    <FieldError msg={form.errors.scoring} />

    {#if form.state.scoring === 'yes_issues'}
      <label class="field" for="issues">What were the issues?</label>
      <textarea id="issues" rows="3" maxlength="2000" bind:value={form.state.issues}></textarea>
      <FieldError msg={form.errors.issues} />
    {/if}

    {#if form.state.scoring === 'not_played'}
      <p class="field">Reason</p>
      {#each REASONS as r (r)}
        <label class="choice"><input type="radio" name="reason" value={r} bind:group={form.state.notPlayedReason} /> {REASON_TEXT[r]}</label>
      {/each}
      <FieldError msg={form.errors.notPlayedReason} />
      {#if form.state.notPlayedReason === 'other'}
        <label class="field" for="not-played-other">Why wasn't it played?</label>
        <input id="not-played-other" type="text" maxlength="200" bind:value={form.state.notPlayedOther} />
        <FieldError msg={form.errors.notPlayedOther} />
      {/if}
    {/if}
  </fieldset>

  {#if form.state.scoring !== 'not_played'}
    <fieldset class="card" id="sec-scores">
      <legend>Scores</legend>
      {#if fromPlayhq}<span class="badge badge-phq">From PlayHQ</span>{/if}
      <h3>{team.team.name} score</h3>
      <NumberInput id="team-wkts" label="Wickets" maxDigits={2} readonly={fromPlayhq} bind:value={form.state.team.wkts} error={form.errors['team.wkts']} />
      <NumberInput id="team-runs" label="Runs" readonly={fromPlayhq} bind:value={form.state.team.runs} error={form.errors['team.runs']} />
      <h3>{opposition} score</h3>
      <NumberInput id="opp-wkts" label="Wickets" maxDigits={2} readonly={fromPlayhq} bind:value={form.state.opp.wkts} error={form.errors['opp.wkts']} />
      <NumberInput id="opp-runs" label="Runs" readonly={fromPlayhq} bind:value={form.state.opp.runs} error={form.errors['opp.runs']} />
      {@render refreshButton()}
    </fieldset>

    <fieldset class="card" id="sec-awards">
      <legend>Awards</legend>
      <PlayerPicker id="potd" label="Player of the day" squad={team.squad} bind:value={form.state.potd} error={form.errors.potd} />
      <PlayerPicker id="mascot" label="Mascot of the day" squad={team.squad} bind:value={form.state.mascot} error={form.errors.mascot} />
    </fieldset>

    <fieldset class="card" id="sec-highlights">
      <legend>Highlights</legend>
      <label class="field" for="highlights">Any game highlights, special moments or comments you'd like to add?</label>
      <textarea id="highlights" rows="4" maxlength="5000" bind:value={form.state.highlights}></textarea>
      <PhotoPicker {form} />
    </fieldset>

    <fieldset class="card" id="sec-milestones">
      <legend>Milestones</legend>
      <MilestoneList {form} type="bat" squad={team.squad} title="Batting milestone" valueLabel="Runs (25 or more)" />
      <MilestoneList {form} type="bowl" squad={team.squad} title="Bowling milestone" valueLabel="Wickets (3 to 19)" maxDigits={2} />
      <MilestoneList {form} type="hattrick" squad={team.squad} title="Hat-trick" />
      {@render refreshButton()}
    </fieldset>
  {/if}

  <fieldset class="card" id="sec-name">
    <legend>Your name (optional)</legend>
    <input id="updated-by" type="text" maxlength="80" autocomplete="name" bind:value={form.state.updatedBy} />
  </fieldset>

  <button type="submit" class="btn">Next: review</button>
</form>
```

- [ ] **Step 4: Verify**

Run: `npm --prefix web run check`
Expected: 0 errors, 0 warnings about these files. (The form isn't on a page until Task 17.)

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(game-day): report form components, drafts and photo resizing"
```

### Task 17: Review, submit, read-only view, edit and conflicts

**Files:**
- Create: `web/src/lib/report/ReportSummary.svelte`, `web/src/lib/game/GameView.svelte`
- Modify: `web/src/routes/[team]/+page.svelte` (render `GameView`)

**Interfaces:**
- Consumes: `GameForm`, `loadDraft`, `saveDraft`, `clearDraft`, `ReportForm` (Task 16); `startForm`, `reportToForm` (Task 4); `validateReport` (Task 3); `api`, `ApiFailure`, `Mascot` (Task 13); `TeamPage`, `GamePage`, `ReportOut` (Task 3); `SCORING_TEXT`, `REASON_TEXT`, `MILESTONE_TEXT` (Task 3).
- Produces: `<ReportSummary report team gameId onedit? />`; `<GameView team gameId />` with modes `loading | error | readonly | form | review | done | conflict`.

- [ ] **Step 1: Read-only summary**

`web/src/lib/report/ReportSummary.svelte`:

```svelte
<script lang="ts">
  import type { TeamPage } from '$shared/api';
  import { MILESTONE_TEXT, REASON_TEXT, SCORING_TEXT } from '$shared/text';
  import type { FormState, PlayerChoice, Score } from '$shared/types';

  let { report, team, gameId, onedit }: { report: FormState; team: TeamPage; gameId: string; onedit?: (sectionId: string) => void } = $props();

  const opposition = $derived(team.fixture.games.find((g) => g.gameId === gameId)?.opposition ?? 'Opposition');
  const who = (p: PlayerChoice | null) => (!p ? '—' : p.kind === 'other' ? p.fullName : (p.label ?? '—'));
  const score = (s: Score) => (s.runs === null || s.wkts === null ? '—' : `${s.runs}/${s.wkts}`);
  const played = $derived(report.scoring !== 'not_played');
</script>

{#snippet head(title: string, section: string)}
  <header class="row">
    <h3>{title}</h3>
    {#if onedit}<button type="button" class="btn-link" onclick={() => onedit(section)}>Edit</button>{/if}
  </header>
{/snippet}

<section class="card">
  {@render head('PlayHQ scoring', 'sec-scoring')}
  <p>{report.scoring ? SCORING_TEXT[report.scoring] : '—'}</p>
  {#if report.scoring === 'yes_issues'}<p><strong>Issues:</strong> {report.issues}</p>{/if}
  {#if report.scoring === 'not_played' && report.notPlayedReason}
    <p><strong>Reason:</strong> {report.notPlayedReason === 'other' ? report.notPlayedOther : REASON_TEXT[report.notPlayedReason]}</p>
  {/if}
</section>

{#if played}
  <section class="card">
    {@render head('Scores', 'sec-scores')}
    <p>{team.team.name}: <strong>{score(report.team)}</strong></p>
    <p>{opposition}: <strong>{score(report.opp)}</strong></p>
    {#if report.scoreSource === 'playhq'}<span class="badge badge-phq">From PlayHQ</span>{/if}
  </section>

  <section class="card">
    {@render head('Awards', 'sec-awards')}
    <p>Player of the day: <strong>{who(report.potd)}</strong></p>
    <p>Mascot of the day: <strong>{who(report.mascot)}</strong></p>
  </section>

  {#if report.highlights || report.photoIds.length}
    <section class="card">
      {@render head('Highlights', 'sec-highlights')}
      {#if report.highlights}<p class="pre">{report.highlights}</p>{/if}
      <div class="thumbs">
        {#each report.photoIds as id (id)}<img src="/api/photos/{id}" alt="Game photo" loading="lazy" />{/each}
      </div>
    </section>
  {/if}

  <section class="card">
    {@render head('Milestones', 'sec-milestones')}
    {#if report.milestones.length}
      <ul>
        {#each report.milestones as m (m.rowId)}
          <li>{MILESTONE_TEXT[m.type]}: {who(m.player)}{m.value !== null ? ` — ${m.value} ${m.type === 'bat' ? 'runs' : 'wickets'}` : ''}</li>
        {/each}
      </ul>
    {:else}
      <p>None</p>
    {/if}
  </section>
{/if}

<style>
  .row { display: flex; justify-content: space-between; align-items: baseline; }
  .pre { white-space: pre-wrap; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
  .thumbs img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--radius); }
</style>
```

(In review the coach sees the full name they typed for "Other"; saved reports only ever come back from the API as labels.)

- [ ] **Step 2: The game controller**

`web/src/lib/game/GameView.svelte`:

```svelte
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { api, ApiFailure } from '$lib/api';
  import Mascot from '$lib/Mascot.svelte';
  import { clearDraft, loadDraft, saveDraft } from '$lib/form/drafts';
  import { GameForm } from '$lib/form/game-form.svelte';
  import ReportForm from '$lib/form/ReportForm.svelte';
  import ReportSummary from '$lib/report/ReportSummary.svelte';
  import type { ReportOut, TeamPage } from '$shared/api';
  import { reportToForm, startForm } from '$shared/merge';
  import type { FormState } from '$shared/types';
  import { validateReport } from '$shared/validation';

  let { team, gameId }: { team: TeamPage; gameId: string } = $props();

  type Mode = 'loading' | 'error' | 'readonly' | 'form' | 'review' | 'done' | 'conflict';
  let mode = $state<Mode>('loading');
  let message = $state('');
  let report = $state<ReportOut | null>(null);
  let latest = $state<ReportOut | null>(null);
  let saving = $state(false);
  let draftOffer = $state(false);
  // svelte-ignore state_referenced_locally
  const form = new GameForm(`draft:${team.team.slug}:${gameId}`);

  const stamp = (iso: string) =>
    new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  onMount(async () => {
    try {
      const page = await api().game(team.team.slug, gameId);
      if (page.report) {
        report = page.report;
        mode = 'readonly';
      } else {
        form.reset(startForm(page.start!), 0);
        offerDraft();
        mode = 'form';
      }
    } catch (e) {
      message = e instanceof ApiFailure ? e.message : 'Could not load this game.';
      mode = 'error';
    }
  });

  // Keep an on-device draft while the coach is editing (functional spec §7.4).
  $effect(() => {
    if (mode !== 'form' && mode !== 'review') return;
    const snap = JSON.stringify(form.state);
    if (snap === form.initialJson) return;
    const baseVersion = form.baseVersion;
    const t = setTimeout(() => saveDraft(form.draftKey, { state: JSON.parse(snap), baseVersion, savedAt: new Date().toISOString() }), 500);
    return () => clearTimeout(t);
  });

  function offerDraft() {
    const d = loadDraft(form.draftKey);
    draftOffer = !!d && d.baseVersion === form.baseVersion && JSON.stringify(d.state) !== form.initialJson;
  }
  function resumeDraft() {
    const d = loadDraft(form.draftKey);
    if (d) form.state = d.state;
    draftOffer = false;
  }
  function discardDraft() {
    clearDraft(form.draftKey);
    draftOffer = false;
  }

  function edit(from: ReportOut) {
    form.reset(reportToForm(from), from.version);
    offerDraft();
    message = '';
    mode = 'form';
  }

  async function next() {
    form.errors = validateReport($state.snapshot(form.state) as FormState);
    if (Object.keys(form.errors).length === 0) {
      mode = 'review';
      await tick();
      window.scrollTo({ top: 0 });
    } else {
      await tick();
      document.querySelector('.error')?.scrollIntoView({ block: 'center' });
    }
  }

  async function toSection(id: string) {
    mode = 'form';
    await tick();
    document.getElementById(id)?.scrollIntoView();
  }

  async function submit() {
    if (saving) return;
    saving = true;
    message = '';
    try {
      report = await api().save(team.team.slug, gameId, { ...($state.snapshot(form.state) as FormState), baseVersion: form.baseVersion });
      clearDraft(form.draftKey);
      mode = 'done';
      await invalidateAll(); // refresh the dropdown status
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 409) {
        latest = e.body?.latest ?? null;
        mode = 'conflict';
      } else if (e instanceof ApiFailure && e.status === 422) {
        form.errors = e.body?.fields ?? {};
        mode = 'form';
      } else {
        message = e instanceof ApiFailure ? e.message : 'Could not save — check your connection and try again.';
      }
    } finally {
      saving = false;
    }
  }
</script>

{#if mode === 'loading'}
  <p class="note">Loading…</p>
{:else if mode === 'error'}
  <p class="error" role="alert">{message}</p>
{:else if mode === 'readonly' && report}
  <div class="card">
    <p class="note">Last updated {stamp(report.updatedAt)} by {report.updatedBy || 'unknown'}</p>
    <button type="button" class="btn" onclick={() => edit(report!)}>Edit</button>
  </div>
  <ReportSummary {report} {team} {gameId} />
{:else if mode === 'form'}
  {#if draftOffer}
    <div class="banner" role="status">
      Resume your unsaved report?
      <button type="button" class="btn" onclick={resumeDraft}>Resume</button>
      <button type="button" class="btn-secondary" onclick={discardDraft}>Discard</button>
    </div>
  {/if}
  <ReportForm {form} {team} {gameId} onnext={next} />
{:else if mode === 'review'}
  <h2>Check your report</h2>
  <ReportSummary report={form.state} {team} {gameId} onedit={toSection} />
  {#if message}<p class="error" role="alert">{message}</p>{/if}
  <button type="button" class="btn" onclick={submit} disabled={saving}>{saving ? 'Saving…' : 'Submit'}</button>
{:else if mode === 'done' && report}
  <div class="card done">
    <Mascot name={team.team.mascot} />
    <h2>Thanks — report saved.</h2>
  </div>
  <ReportSummary {report} {team} {gameId} />
  <button type="button" class="btn-secondary" onclick={() => (mode = 'readonly')}>Back to the report</button>
{:else if mode === 'conflict'}
  <p class="error" role="alert">This report was updated by someone else — review their version first.</p>
  {#if latest}
    <h2>Their version</h2>
    <ReportSummary report={latest} {team} {gameId} />
  {/if}
  <h2>Your unsaved changes</h2>
  <ReportSummary report={form.state} {team} {gameId} />
  {#if latest}<button type="button" class="btn" onclick={() => edit(latest!)}>Edit their version</button>{/if}
{/if}

<style>
  .done { display: flex; align-items: center; gap: 16px; }
</style>
```

- [ ] **Step 3: Render it on the team page**

In `web/src/routes/[team]/+page.svelte`, add the import and replace the placeholder comment:

```ts
  import GameView from '$lib/game/GameView.svelte';
```

```svelte
  <GamePicker games={team.fixture.games} selected={gameId} onselect={select} />
  {#key gameId}<GameView {team} {gameId} />{/key}
```

- [ ] **Step 4: Verify**

Run: `npm --prefix web run check && npm run build:web`, restart `npx wrangler dev` (real PlayHQ key, test squad — the test squad's PlayHQ IDs won't match real games, so use a game from the real Pumas 2025/26 grade for prefill checks or wait for Task 19's stub).
Manually check, at 375 px wide:
1. A game with no report opens the form. "Next: review" with nothing filled shows errors next to the questions and scrolls to the first one.
2. Choosing *Yes but there were issues* shows the issues box; *Game not played* hides everything except the reason and your name.
3. Fill in a valid report → Review shows every answer with Edit links that jump back to the right section → Submit shows "Thanks — report saved." with the mascot, and the dropdown now says "Reported".
4. Reselect the game → read-only view with "Last updated … by …" → Edit → change something → Review → Submit works.
5. Type something, reload the page → "Resume your unsaved report?" → Resume restores it.
6. Submit while offline (DevTools → Offline) → error message, the form isn't lost.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(game-day): review, submit, read-only view, edit and conflict handling"
```

---

### Task 18: All-games page and admin export page

**Files:**
- Create: `web/src/routes/games/+page.ts`, `web/src/routes/games/+page.svelte`, `web/src/routes/admin/+page.svelte`

**Interfaces:**
- Consumes: `api` (Task 13); `GamesList`, `ListStatus`, `TeamSummary` (Task 3); `STATUS_TEXT`, `SCORING_TEXT`, `REASON_TEXT` (Task 3); `/api/games`, `/api/export/*.csv`, `/api/admin/check`, `/api/admin/export/*.csv` (Task 12).
- Produces: `/games` and `/admin` pages.

- [ ] **Step 1: Implement**

`web/src/routes/games/+page.ts`:

```ts
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => ({ teams: await api(fetch).teams() });
```

`web/src/routes/games/+page.svelte`:

```svelte
<script lang="ts">
  import { api } from '$lib/api';
  import type { GamesList, ListStatus } from '$shared/api';
  import { REASON_TEXT, SCORING_TEXT, STATUS_TEXT } from '$shared/text';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const STATUSES: ListStatus[] = ['missing', 'reported', 'not_played', 'upcoming'];

  let team = $state('');
  let statuses = $state<ListStatus[]>([]);
  let followUp = $state(false);
  let list = $state<GamesList | null>(null);
  let error = $state('');
  let seq = 0;

  const qs = $derived(
    new URLSearchParams({
      ...(team ? { team } : {}),
      ...(statuses.length ? { status: statuses.join(',') } : {}),
      ...(followUp ? { followUp: '1' } : {}),
    }).toString(),
  );

  $effect(() => {
    const q = qs;
    const mine = ++seq;
    api()
      .games(q)
      .then((r) => {
        if (mine === seq) {
          list = r;
          error = '';
        }
      })
      .catch(() => {
        if (mine === seq) error = 'Could not load games.';
      });
  });
</script>

<svelte:head><title>All games · Parklands Cricket Club</title></svelte:head>

<section class="hero"><h1>All games</h1><p>Current season, every team.</p></section>

<form class="card filters" onsubmit={(e) => e.preventDefault()}>
  <label class="field">Team
    <select bind:value={team}>
      <option value="">All teams</option>
      {#each data.teams as t (t.slug)}<option value={t.slug}>{t.name}</option>{/each}
    </select>
  </label>
  <fieldset>
    <legend>Status</legend>
    {#each STATUSES as s (s)}
      <label class="choice"><input type="checkbox" value={s} bind:group={statuses} /> {STATUS_TEXT[s]}</label>
    {/each}
  </fieldset>
  <label class="choice"><input type="checkbox" bind:checked={followUp} /> Needs follow-up</label>
  <p>
    <a class="btn-secondary" href="/api/export/games.csv{qs ? `?${qs}` : ''}" download>Export games</a>
    <a class="btn-secondary" href="/api/export/milestones.csv{qs ? `?${qs}` : ''}" download>Export milestones</a>
  </p>
</form>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if list}
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Date</th><th>Team</th><th>Game</th><th>Status</th><th>PlayHQ scoring</th><th>Score</th><th>Player</th><th>Mascot</th><th>Milestones</th></tr>
      </thead>
      <tbody>
        {#each list.rows as r (r.teamSlug + r.gameId)}
          <tr class:missing={r.status === 'missing'}>
            <td>{r.dateLabel}</td>
            <td>{r.teamName}</td>
            <td><a href="/{r.teamSlug}?game={r.gameId}">{r.round} v {r.opposition}</a><br /><small>{r.venue}</small></td>
            <td><span class="badge badge-{r.status}">{STATUS_TEXT[r.status]}</span></td>
            <td>
              {r.scoring ? SCORING_TEXT[r.scoring] : ''}
              {#if r.issues}<br /><small>{r.issues}</small>{/if}
              {#if r.notPlayedReason}<br /><small>{r.notPlayedReason === 'other' ? r.notPlayedOther : REASON_TEXT[r.notPlayedReason]}</small>{/if}
            </td>
            <td>{r.score ?? ''}</td>
            <td>{r.potd ?? ''}</td>
            <td>{r.mascot ?? ''}</td>
            <td>{r.milestoneCount || ''}</td>
          </tr>
        {:else}
          <tr><td colspan="9">No games match these filters.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .filters fieldset { border: 0; padding: 0; margin: 8px 0; }
  .filters legend { float: none; font-size: 1rem; }
  .table-wrap { overflow-x: auto; background: var(--pcc-surface); border: 1px solid var(--pcc-grey-300); }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--pcc-grey-300); vertical-align: top; }
  th { font-family: var(--font-head); text-transform: uppercase; color: var(--pcc-navy-700); }
  tr.missing { background: #fbe4e2; }
</style>
```

`web/src/routes/admin/+page.svelte`:

```svelte
<script lang="ts">
  let passcode = $state('');
  let ok = $state(false);
  let msg = $state('');
  let busy = $state(false);

  try {
    passcode = sessionStorage.getItem('pcc-admin') ?? '';
  } catch {
    /* storage blocked */
  }

  const headers = () => ({ 'x-admin-passcode': passcode });

  async function check() {
    busy = true;
    msg = '';
    try {
      const res = await fetch('/api/admin/check', { headers: headers() });
      ok = res.ok;
      if (ok) {
        try {
          sessionStorage.setItem('pcc-admin', passcode);
        } catch {
          /* ignore */
        }
      } else {
        msg = res.status === 429 ? 'Too many attempts — wait a minute.' : 'Wrong passcode.';
      }
    } finally {
      busy = false;
    }
  }

  async function download(name: 'games' | 'milestones') {
    msg = '';
    const res = await fetch(`/api/admin/export/${name}.csv`, { headers: headers() });
    if (!res.ok) {
      msg = res.status === 429 ? 'Too many requests — wait a minute.' : 'Download failed.';
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-full-names.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>Admin exports · Parklands Cricket Club</title></svelte:head>

<section class="hero"><h1>Admin exports</h1><p>Exports with full player names. Keep these files private.</p></section>

{#if !ok}
  <form class="card" onsubmit={(e) => { e.preventDefault(); check(); }}>
    <label class="field" for="passcode">Admin passcode</label>
    <input id="passcode" type="password" autocomplete="current-password" bind:value={passcode} />
    <p><button class="btn" disabled={busy}>Continue</button></p>
  </form>
{:else}
  <div class="card">
    <p><button type="button" class="btn" onclick={() => download('games')}>Download games (full names)</button></p>
    <p><button type="button" class="btn" onclick={() => download('milestones')}>Download milestones (full names)</button></p>
  </div>
{/if}
{#if msg}<p class="error" role="alert">{msg}</p>{/if}
```

- [ ] **Step 2: Verify**

Run: `npm --prefix web run check && npm run build:web`, restart `npx wrangler dev`.
Open `/games`: table lists every game, Missing rows are highlighted red, filters update the table and the export links, "Needs follow-up" shows only *No* / *issues* games. Export buttons download CSVs that open cleanly in Excel. Open `/admin`: wrong passcode → "Wrong passcode."; `letmein` (from `.dev.vars`) → two download buttons; the files include full names.

- [ ] **Step 3: Commit**

```bash
git add web
git commit -m "feat(game-day): all-games list page and admin export page"
```

### Task 19: End-to-end tests, README and first deploy

**Files:**
- Create: `scripts/playhq-stub.mjs`, `playwright.config.ts`, `web/tests/e2e/game-day.spec.ts`, `README.md`

**Interfaces:**
- Consumes: everything above; the `PLAYHQ_BASE_URL` var (Task 1); the test squad (Task 5); `e2e:prepare` script (Task 1).
- Produces: a passing Playwright suite against `wrangler dev`, and a deployed Worker.

- [ ] **Step 1: PlayHQ stub**

`scripts/playhq-stub.mjs` (dates are relative to today in NZ so the suite never goes stale):

```js
import { createServer } from 'node:http';

function nzDay(offsetDays) {
  const parts = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() + offsetDays * 864e5));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const PUMAS = 'team-pumas';
const OPP = 'team-opp';
const game = (id, offset, opp, status, round) => ({
  id,
  status,
  round: { name: `Round ${round}`, abbreviatedName: `R${round}` },
  schedule: { date: nzDay(offset), time: '09:00:00', timezone: 'Pacific/Auckland' },
  venue: { name: 'Parklands Reserve' },
  competitors: [{ id: PUMAS, name: 'Parklands Pumas' }, { id: OPP, name: opp }],
});

const games = [
  game('e2e-g1', -14, 'Hornby Hawks', 'FINAL', 3),
  game('e2e-g2', -7, 'Syd Martin Scorchers', 'FINAL', 4),
  game('e2e-g3', 7, 'Riccarton Rams', 'PENDING', 5),
];

const st = (pairs) => pairs.map(([type, value]) => ({ type, value }));
const summary = (id, withStats) => ({
  id,
  status: 'FINAL',
  teams: [{ id: PUMAS, name: 'Parklands Pumas' }, { id: OPP, name: 'Opposition' }],
  appearances: withStats ? [{ id: 'ph-fill', firstName: 'Kim', lastName: 'Walker', teamId: PUMAS }] : [],
  periods: withStats
    ? [
        { name: 'FIRST_INNINGS', sequenceNo: 1, teams: [
          { id: OPP, discipline: 'BATTING', statistics: st([['TOTAL_SCORE', 128], ['TOTAL_OUTS', 4]]), appearances: [] },
          { id: PUMAS, discipline: 'BOWLING', statistics: [], appearances: [{ id: 'ph-jordan', statistics: st([['WICKETS', 3]]) }] },
        ] },
        { name: 'FIRST_INNINGS', sequenceNo: 2, teams: [
          { id: PUMAS, discipline: 'BATTING', statistics: st([['TOTAL_SCORE', 145], ['TOTAL_OUTS', 4]]),
            appearances: [{ id: 'ph-alex', statistics: st([['TOTAL_RUNS', 31]]) }, { id: 'ph-fill', statistics: st([['TOTAL_RUNS', 27]]) }] },
          { id: OPP, discipline: 'BOWLING', statistics: [], appearances: [] },
        ] },
      ]
    : [],
});

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (path === '/v1/grades/grade-y6/games') return send({ data: games, metadata: { hasMore: false, nextCursor: null } });
  const m = path.match(/^\/v2\/games\/(e2e-g[123])\/summary$/);
  if (m) return send({ data: summary(m[1], m[1] === 'e2e-g2') });
  res.writeHead(404).end();
}).listen(8790, '127.0.0.1', () => console.log('PlayHQ stub on http://127.0.0.1:8790'));
```

- [ ] **Step 2: Playwright config and tests**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'web/tests/e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787' },
  webServer: [
    { command: 'node scripts/playhq-stub.mjs', url: 'http://127.0.0.1:8790/v1/grades/grade-y6/games', reuseExistingServer: false },
    {
      command: 'npm run e2e:prepare && npx wrangler dev --port 8787 --var PLAYHQ_BASE_URL:http://127.0.0.1:8790',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
```

`.dev.vars` must exist (copy `.dev.vars.example`; `ADMIN_PASSCODE=letmein`). Install the browser once: `npx playwright install chromium`.

`web/tests/e2e/game-day.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('home lists teams', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Parklands Pumas/ })).toBeVisible();
});

test('unknown team shows Team not found', async ({ page }) => {
  await page.goto('/pumaz');
  await expect(page.getByRole('heading', { name: 'Team not found' })).toBeVisible();
});

test('a PlayHQ-scored game is prefilled', async ({ page }) => {
  await page.goto('/Pumas');
  await expect(page.locator('#game')).toHaveValue('e2e-g2'); // most recent played game
  await expect(page.locator('#team-runs')).toHaveValue('145');
  await expect(page.locator('#team-runs')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('No', { exact: true })).toHaveCount(0);
  await expect(page.getByText("Couldn't match to squad — please check.")).toBeVisible();
  await expect(page.getByRole('option', { name: 'Riccarton Rams', exact: false })).toBeDisabled();
});

test('submit once, view read-only without full names, then edit', async ({ page }) => {
  await page.goto('/pumas?game=e2e-g1');
  await page.getByLabel('No', { exact: true }).check();
  await page.locator('#team-wkts').fill('5');
  await page.locator('#team-runs').fill('100');
  await page.locator('#opp-wkts').fill('7');
  await page.locator('#opp-runs').fill('9a0'); // non-digits are dropped
  await expect(page.locator('#opp-runs')).toHaveValue('90');
  await page.locator('#potd').selectOption({ label: 'Alex T.' });
  await page.locator('#mascot').selectOption('other');
  await page.locator('#mascot-other').fill('Chris Pratt');
  await page.getByRole('button', { name: 'Next: review' }).click();

  await expect(page.getByRole('heading', { name: 'Check your report' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).dblclick(); // double-tap must save once
  await expect(page.getByText('Thanks — report saved.')).toBeVisible();
  await expect(page.getByText('updated by someone else')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('Chris P.')).toBeVisible();
  expect(await page.content()).not.toContain('Pratt');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#highlights').fill('Great catch by the keeper');
  await page.getByRole('button', { name: 'Next: review' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Great catch by the keeper')).toBeVisible();
});

test('validation errors show next to the questions', async ({ page }) => {
  await page.goto('/pumas?game=e2e-g2');
  await page.getByRole('button', { name: 'Next: review' }).click();
  await expect(page.getByText('Choose a player.').first()).toBeVisible();
});

test('all games marks the unreported past game as Missing', async ({ page }) => {
  await page.goto('/games');
  await expect(page.locator('tr.missing')).toContainText('Syd Martin Scorchers');
  await expect(page.locator('tr', { hasText: 'Hornby Hawks' })).toContainText('Reported');
  await expect(page.locator('tr', { hasText: 'Riccarton Rams' })).toContainText('Upcoming');
});
```

- [ ] **Step 3: Run the whole suite**

Run: `npm test && npm run typecheck && npm run e2e`
Expected: all Vitest tests PASS; `tsc` and `svelte-check` report 0 errors; 6 Playwright tests PASS.

If an e2e test fails, fix the code (not the test) unless the test contradicts the spec.

- [ ] **Step 4: README**

`README.md`:

````markdown
# PCC Game Day Form

Game-day reports for Parklands Cricket Club teams. Spec: `docs/functional-spec.md`. Design: `docs/technical-design.md`.

## Local development

```bash
npm install && npm --prefix web install
cp .dev.vars.example .dev.vars          # add the PlayHQ API key
npx wrangler d1 migrations apply pcc-game-day --local
npx wrangler kv key put squad --path=api/test/fixtures/squad.json --binding=CONFIG --local
npm run dev                             # builds the SPA, then wrangler dev on :8787
npm run dev:web                         # optional: Vite hot reload on :5173, proxying /api to :8787
```

## Tests

```bash
npm test            # shared + API (Vitest, Workers runtime)
npm run typecheck   # tsc + svelte-check
npm run e2e         # Playwright against wrangler dev + PlayHQ stub
```

## Squad data

The squad JSON (format in `docs/technical-design.md` §4.2) is never committed. Upload it with:

```bash
npx wrangler kv key put squad --path=squad.json --binding=CONFIG --remote
```

It takes effect within a minute. Never change or reuse a player's `key`.

## Mascots

Download *Team certs and mascots/Mascots* from SharePoint into `assets-src/mascots/`, then `npm run mascots`.

## Deploy

```bash
npm run deploy      # build SPA, apply D1 migrations, wrangler deploy
```

## New season

Upload a new squad JSON with the new `playhqSeasonId` (and grade IDs once PlayHQ allocates them).
````

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "test(game-day): end-to-end suite with PlayHQ stub, README"
```

- [ ] **Step 6: First deploy (ask the user before running — this creates Cloudflare resources and a public URL)**

Confirm with the user, then (they may need to run `npx wrangler login` themselves first):

```bash
npx wrangler d1 create pcc-game-day                 # copy database_id into wrangler.jsonc
npx wrangler r2 bucket create pcc-game-day-photos
npx wrangler kv namespace create CONFIG             # copy id into wrangler.jsonc
npx wrangler secret put PLAYHQ_API_KEY
npx wrangler secret put ADMIN_PASSCODE
npx wrangler kv key put squad --path=squad.json --binding=CONFIG --remote   # the real squad file from the user
npm run deploy
```

Expected: `wrangler deploy` prints `https://pcc-game-day.<account>.workers.dev`. Open it: the team list shows real teams; `/pumas` loads the real fixture once grades are allocated (until then: "Fixture not available from PlayHQ yet.").

Commit the real `database_id` and KV `id` in `wrangler.jsonc`:

```bash
git add wrangler.jsonc
git commit -m "chore(game-day): production resource ids"
```

---

## Self-review notes

- **Spec coverage:** team link and errors (Tasks 5, 7, 13, 15); dropdown, statuses, default game (7, 15); Q1–Q9 and validation (3, 16); PlayHQ prefill, matching, refresh, caching, rate limit (4, 6, 8, 16); review, submit, read-only, edit, history, conflicts, drafts (9, 10, 17); photos (11, 16); all-games list, filters, Missing, exports, admin (12, 18); full names never public (9, 10, 12 tests; e2e); branding and mascots (13, 14); deploy and season rollover (19, README).
- **Type names** used across tasks: `FormState`, `ReportIn`, `ReportOut`, `PlayerChoice`, `PlayerRefOut`, `PlayhqStartData`, `GameOption`, `TeamPage`, `GamePage`, `GameRow`, `StoredReport`, `SaveInput`, `Team`, `Squad`, `V1Game`, `V2Summary`, `GameForm` — each defined once (Tasks 3, 5, 6, 9, 16).

