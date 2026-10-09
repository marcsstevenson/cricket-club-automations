---
name: refresh-squad
description: Refresh the Parklands game-day form squad list (teams, players, PlayHQ grade IDs) from the Team Formation workbook in SharePoint and the PlayHQ Competition Participants Report, then upload it to production. Use when asked to recheck team data, add new teams/players, pick up PlayHQ grade allocations, or "repeat the squad update".
---

# Refresh the game-day squad list

The squad list (KV key `squad`, file `automations/src/game-day-form/squad.json`, git-ignored) decides which teams and
players the form shows. It holds **full names** — never commit it, never print more of it than you need, and delete
every downloaded/scratch copy when done.

Sources (neither alone is enough):

| Source | Gives | Notes |
|---|---|---|
| SharePoint **Team Formation 2026-27.xlsx** (Committee › Members) | who is in which team, grade names | The club's allocation sheet. Authoritative for teams. |
| PlayHQ **Competition Participants Report** (Saved Reports) | name → PlayHQ **Profile ID** (= `playhqId`) | Its *Team* column is unreliable (many blanks) — don't use it for allocation. |
| PlayHQ API `/v1/seasons/{id}/teams` | team IDs, new teams, grade IDs once allocated | Called by the script with the key in `automations/src/.env`. |

Paths below are relative to the repo root `D:\git\marcsstevenson\pcc`. App dir: `automations/src/game-day-form`.

## 1. Read the workbook

Microsoft 365 connector `read_resource` with:

```
file:///b!TsWciHsdt0uh56ZOyk324jYhiBGhhHlMiXjqJyyT2mcOi_UHWPqPRZHXBIMjkJUx/Members/Team Formation 2026-27.xlsx
```

It is too big to return inline; the tool saves it under the session's `tool-results/` folder. Use that path as `--dump`.
(New season: the file name changes — search SharePoint for "Team Formation".)

## 2. Download the PlayHQ report (needs the user's OK)

- Ask the user before downloading (file contains names, DOBs, contact and medical fields).
- Use the Chrome instance already logged in to PlayHQ as the Hardball Convenor (it was "Browser 2"; if unsure, list
  connected browsers and ask). Don't try to log in.
- Go to `https://nzc.playhq.com/org/73ce5541-a7ac-457a-a912-d6408aa96a74/reports/report-hub` → **Competition
  Participants Report** → download icon (⤓, next to "N rows") → CSV → Download. It lands in
  `C:\Users\marcs\Downloads\Competition Participants Report.csv`.
- The report grid and SQL editor are in a read-only iframe: you can't type into or read them. Download is the only way.

## 3. Dry run and review

```bash
python -I .claude/skills/refresh-squad/scripts/squad_refresh.py \
  --dump "<tool-results path from step 1>" \
  --report "C:/Users/marcs/Downloads/Competition Participants Report.csv" \
  --squad automations/src/game-day-form/squad.json \
  --env automations/src/.env
```

Read **CHANGES** and **REVIEW** before writing:

- `NEW TEAM` — added from PlayHQ automatically (slug = name without "Parklands"). Check `web/static/mascots/<slug>.webp`
  exists; if not, `mascot` falls back and the user may want to add an image (see app README "Mascots").
- `GRADE` — PlayHQ has allocated a grade; the team page will start showing its fixture.
- `ADDED (initial|fuzzy …)` — non-exact name match; confirm it's the child, not a coach/parent in the same column.
- `NOT MOVED … (non-exact match)` — usually a coach/parent row matching a child elsewhere; ignore unless real.
- `no PlayHQ match` — coach/parent, or a player not registered in PlayHQ yet (can't be added without a Profile ID;
  coaches use "Other" meanwhile). Tell the user about likely players.
- `IN SQUAD, NOT IN SHEET` — kept. Remove by hand only if the user confirms they left (and no saved report uses the key).
- `TEAM GONE FROM PLAYHQ` — kept; ask the user.

Player keys never change once issued (saved reports reference them). The script reuses existing keys and only mints
`p<first 8 of playhqId>` for new players.

## 4. Write, validate, upload, verify

```bash
S=<scratchpad>
cp automations/src/game-day-form/squad.json "$S/squad.before.json"        # rollback copy
python -I .claude/skills/refresh-squad/scripts/squad_refresh.py ...same args... --out automations/src/game-day-form/squad.json --write
cd automations/src/game-day-form
npx tsx ../../../.claude/skills/refresh-squad/scripts/check_squad.mts squad.json   # must say "full-surname labels 0"
npx wrangler kv key put squad --path=squad.json --binding=CONFIG --remote          # production only; takes ~60 s
curl -s https://gameday.parklandscricket.co.nz/api/teams                          # new teams listed?
curl -s https://gameday.parklandscricket.co.nz/api/teams/<slug>                   # grade + squad labels (first name + initial)
```

Leave the demo (`--env demo`, last season) alone.

## 5. Clean up and report

- Delete `C:\Users\marcs\Downloads\Competition Participants Report.csv`. Offer to delete `$S/squad.before.json` once
  the user is happy.
- Close any browser tab you opened.
- Report: teams added, grades allocated, players added/moved, unregistered players, anything kept for review.
