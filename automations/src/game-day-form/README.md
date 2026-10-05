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
