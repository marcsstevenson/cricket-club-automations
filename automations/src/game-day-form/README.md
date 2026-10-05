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

End-to-end prerequisites:

- Create `.dev.vars` from `.dev.vars.example`.
- Run `npx playwright install chromium` once.
- Port 8787 must be free.
- `npm run e2e` wipes local `.wrangler/state` (your local dev data).

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

## First deploy

One-time setup. `wrangler.jsonc` ships with placeholder ids; replace them before deploying.

```bash
npx wrangler login
npx wrangler d1 create pcc-game-day              # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create pcc-game-day-photos
npx wrangler kv namespace create CONFIG          # paste id into wrangler.jsonc
npx wrangler secret put PLAYHQ_API_KEY
npx wrangler secret put ADMIN_PASSCODE
npx wrangler kv key put squad --path=squad.json --binding=CONFIG --remote
npm run deploy
```

## New season

Upload a new squad JSON with the new `playhqSeasonId` (and grade IDs once PlayHQ allocates them).

## Demo (last season, frozen clock)

A separate Worker, `pcc-game-day-demo`, runs 2025/26 with "now" frozen at Saturday 21 March 2026, 9 pm NZ (`FAKE_NOW` in `wrangler.jsonc` → `env.demo`). It has its own D1, KV and R2, so nothing touches production.

```bash
npm run build:web && npx wrangler deploy --env demo
npx wrangler d1 migrations apply pcc-game-day-demo --env demo --remote
npx wrangler kv key put squad --path=squad.demo.json --binding=CONFIG --env demo --remote
```

`squad.demo.json` (git-ignored) maps this season's players onto last season's teams and grades. To remove the demo: `npx wrangler delete --env demo`, then delete the `pcc-game-day-demo` D1 database, KV namespace and `pcc-game-day-demo-photos` bucket.
