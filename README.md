# Cricket Club Automations

Tools and automations for **Parklands Cricket Club** (Christchurch, New Zealand).

## What's here

| Path | What it is |
|---|---|
| [`automations/src/game-day-form/`](automations/src/game-day-form/) | **Game Day Form** — the web app coaches use after each junior game to report scores, player and mascot of the day, highlights and photos, and batting/bowling/hat-trick milestones. Scores and milestones are pre-filled from PlayHQ. Runs on Cloudflare Workers. See its [README](automations/src/game-day-form/README.md). |
| [`automations/src/PLAYHQ-API-NOTES.md`](automations/src/PLAYHQ-API-NOTES.md) | Working notes on the PlayHQ API: which endpoints work for cricket, gotchas, and recipes. |
| [`automations/src/playhq-openapi.yml`](automations/src/playhq-openapi.yml) | Local copy of PlayHQ's published OpenAPI spec. |

## Game Day Form at a glance

- **Stack:** SvelteKit single-page app + Hono API in one Cloudflare Worker; D1 (reports), R2 (photos), KV (squad list and PlayHQ cache).
- **Privacy:** full player names never leave the server. Public pages and CSV exports show *First L.* only; full-name exports need the admin passcode.
- **Docs:** [functional spec](automations/src/game-day-form/docs/functional-spec.md), [technical design](automations/src/game-day-form/docs/technical-design.md), [implementation plan](automations/src/game-day-form/docs/plans/2026-10-05-game-day-form.md).
- **Quick start:**

  ```bash
  cd automations/src/game-day-form
  npm install && npm --prefix web install
  npm test
  ```

  Local development, the demo environment and deployment are covered in the app's README.

## Secrets and data

Nothing secret or personal is committed. Keep these out of git (they are already git-ignored):

- `automations/src/.env` — PlayHQ API credentials
- `automations/src/game-day-form/.dev.vars` — local Worker secrets
- `automations/src/game-day-form/squad*.json` — real squad lists (player names)
- `automations/src/game-day-form/assets-src/` — original mascot artwork

Production secrets (`PLAYHQ_API_KEY`, `ADMIN_PASSCODE`) live in Cloudflare and are set with `wrangler secret put`.
