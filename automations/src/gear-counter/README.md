# PCC Gear Counter

Current gear levels for each team's kit bag and each gear pool, with a log of every change. Spec: `docs/spec.md`.
Same stack as `../game-day-form`: Cloudflare Worker (Hono API + D1) serving a SvelteKit static SPA.

## Local development

```bash
npm install && npm --prefix web install
npx wrangler d1 migrations apply pcc-gear-counter --local
npm run dev                             # builds the SPA, then wrangler dev on :8788
npm run dev:web                         # optional: Vite hot reload on :5173, proxying /api to :8788
```

## Tests

```bash
npm test            # shared + API (Vitest, Workers runtime)
npm run typecheck   # tsc + svelte-check
npm run e2e         # Playwright against wrangler dev; wipes local .wrangler/state
```

## Gear data

The catalogue and the Kit Spec live in `shared/src/gear-data.json`, built from the gear workbook. After the
workbook changes, rebuild it, check the diff, then deploy:

```bash
pip install openpyxl   # once
python scripts/import_gear.py --workbook "C:\Users\marcs\Parklands Cricket Club Inc\PCC Committee - Documents\Gear\PCC Gear List 2026-27 Season - v7.xlsx"
```

Existing stocktakes keep the quantities they started with.

## Teams, pools and admin

Teams and pools are in D1 (`teams`); each listed item's current level is in `levels` and every change is in `log` (see `docs/spec.md` §6). Add, hide and export them at
`/admin` (not linked anywhere), which needs the `ADMIN_PASSCODE` Worker secret:

```bash
npx wrangler secret put ADMIN_PASSCODE
```

Locally, `npm run e2e` starts wrangler with `ADMIN_PASSCODE=e2e-passcode`; for `npm run dev`, put
`ADMIN_PASSCODE=...` in `.dev.vars` (git-ignored).

## Deploy

```bash
npm run deploy      # build, apply D1 migrations, wrangler deploy
```
