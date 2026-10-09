# PCC Gear Counter

Stocktake each team's kit bag (and the club pool) against the Kit Spec for its grade. Spec: `docs/spec.md`.
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

Teams, grades, dot colours, the catalogue and the Kit Spec live in `shared/src/gear-data.json`, built from the
gear workbook and the game-day team list. After the workbook changes, rebuild it, check the diff, then deploy:

```bash
pip install openpyxl   # once
python scripts/import_gear.py --workbook "C:\Users\marcs\Parklands Cricket Club Inc\PCC Committee - Documents\Gear\PCC Gear List 2026-27 Season - v7.xlsx"
```

Use `--teams-sheet "<tab>"` when the grade and dot colour tab is renamed (default `Oct Gear check`). The script
stops if a game-day team is missing from that tab or has a grade it doesn't know; add new grades to `GRADES`
in the script. Existing stocktakes keep the quantities they started with.

## Deploy

```bash
npm run deploy      # build, apply D1 migrations, wrangler deploy
```
