# PlayHQ API — working notes

Everything here was verified live against the PlayHQ production API and the NZC admin portal
on **2026-09-21**, using the Parklands Cricket Club credentials in `.env`.

Source of truth for the spec: [`playhq-openapi.yml`](./playhq-openapi.yml) (matches the published
endpoint list at <https://docs.playhq.com/tech/> exactly — the local copy is complete and current).

---

## 1. Credentials and identity

`.env` (git-ignored, see `.gitignore`):

| Key | Header / use | Value |
|---|---|---|
| `PLAYHQ_API_KEY` | `x-api-key` — also called the **Client ID**, a UUID | *(secret)* |
| `PLAYHQ_TENANT` | `x-phq-tenant` — sport short-name, lowercase | `nzc` (New Zealand Cricket) |
| `PLAYHQ_ORGANISATION_ID` | path param on org-scoped endpoints | `73ce5541-a7ac-457a-a912-d6408aa96a74` |

Base URL for AUS/NZ: `https://api.playhq.com` (EU: `api.euprod.playhq.com`, CA: `api.caprod.playhq.com`,
UAT: `api.uat.playhq.com`).

### Who we are

- **Parklands Cricket Club** — org `73ce5541-a7ac-457a-a912-d6408aa96a74`, a **club**
- Parent association: **Christchurch Metro Cricket Association/CJCA** — org `2f297636-7797-4c1d-9f17-321c573e0145`

### Competitions Parklands appears in

| Competition | ID |
|---|---|
| CJCA Junior Cricket | `9aabe512-d500-471f-9613-a9e28391b12b` |
| CMCA Adult | `5f2f8f79-ed46-4432-959e-daa201e9ba63` |
| Christchurch Festivals | `2d6d2ded-98aa-4247-959d-94b233ee3372` |
| CMCA Youth Boys (association only — Parklands fields no teams) | `c7cdde7e-b3eb-4949-95fc-2562781ef03c` |

### Useful season IDs

| Season | ID |
|---|---|
| CJCA Junior Cricket — Summer 2026/27 (active) | `38e4c7dd-86b4-4ca7-8c54-ccdbd8cf8fdb` |
| CMCA Adult — Summer 2026/27 (active) | `a6e84023-49d6-4120-b95b-fdba269bfb0b` |
| CJCA Junior Cricket — Summer 2025/26 | `bbcf486d-e9cc-466f-ab7b-12da37461b62` |
| CMCA Adult — Summer 2025/26 | `fc6778e0-3eb2-4661-ad95-f24b9cc65bbc` |

### Known Parklands teams (2025/26)

| Team | ID | Grade |
|---|---|---|
| Parklands Pumas | `7818a28c-31a4-4383-993d-641494fcfc0e` | Year 6 Section 3 (Morning) — `94c8c7aa-8b37-4973-95d9-6e89223e6b2c` |

Parklands fielded 23 teams across 16 grades in junior 2025/26, and 1 in adult 2025/26. Team names
are not returned by `/v1/seasons/{id}/teams` — to find a team by name, map IDs via
`/v1/grades/{id}/games` `competitors[]`.

---

## 2. Public vs private

The spec has **37 operations: 12 public, 25 private.**

- **Public** — send `x-api-key` + `x-phq-tenant`. Honours PlayHQ visibility settings: anything an admin
  marked HIDDEN is omitted, and hidden participants come back with blank names.
- **Private** — send `Authorization: Bearer {JWT}` from `POST /auth`. Restricted to **approved PlayHQ
  partners** under a formal agreement; ignores visibility settings. Every `/partner/*` path is private,
  as are the unprefixed `/organisations`, `/competitions`, `/teams`, `/grades`, `/games`, `/venues`
  list endpoints.

Our key is public-only. Clubs must request access through their association.

---

## 3. Cricket applicability — read this before picking an endpoint

Several endpoints return data for cricket but are documented as not applicable. **They return wrong
numbers rather than an error**, which is the main trap in this API.

| Endpoint | Cricket? |
|---|---|
| `GET /v2/grades/{id}/games` | ✅ use this |
| `GET /v2/games/{id}/summary` | ✅ use this |
| `GET /v2/grades/{id}/ladder` | ✅ use this |
| `GET /v1/grades/{id}/games` | ❌ "Not applicable to Cricket. Please refer to the v2 of this API." |
| `GET /v1/grades/{id}/ladder` | ❌ same |
| `GET /v1/games/{id}/summary` | ❌ "not applicable to Cricket" |
| `GET /v1/teams/{id}/fixture` | ❌ "not applicable to Cricket" |
| `GET /v1/grades/{id}/profiles/statistics` (Player Stats by Grade) | ❌ "not applicable to Cricket at present" |
| `GET /partner/v1/games/{id}/summary`, `/partner/v1/games/{id}/events` | ❌ not applicable to Cricket |

**Observed failure:** for game `66a3062e` the real result was 83 vs 145. `/v1/grades/{id}/games`
reported `scoreTotal: 241` and `113` — it appears to sum innings instead of reporting them separately.
No error, no warning. Always use v2 for cricket.

Endpoints with no v1/v2 split (`/v1/organisations/{id}/seasons`, `/v1/seasons/{id}/teams`,
`/v1/seasons/{id}/grades`) work fine for cricket.

---

## 4. What works

### Season / team / grade discovery

```
GET /v1/organisations/{orgId}/seasons     → seasons (see caveat in §6)
GET /v1/seasons/{seasonId}/teams          → teams, each with club {id,name} and grade {id,name}
GET /v1/seasons/{seasonId}/grades         → grades (empty if grades are not public yet)
```

### Results and fixtures — complete and reliable

```
GET /v2/grades/{gradeId}/games
```

Returns `{rounds: [{id, name, abbreviatedName, isFinalRound, byes, games: [...]}]}`.

Each game: `id`, `status` (`FINAL`, …), `type` (`t20`), `url`, `pool`, `match`, `createdAt`,
`updatedAt`, `schedule[].dateTime`, `teams[] {id, isHomeTeam, outcome}` and `periods[]`.

- `outcome`: `WON`, `LOST`, `WON_BY_FORFEIT`, …
- `periods[]`: one entry per innings, `name: FIRST_INNINGS`, `sequenceNo` 1 or 2,
  `teams[] {id, discipline: BATTING, outcome.statistics[]}` with types
  `TOTAL_SCORE`, `TOTAL_OUTS`, `TOTAL_OVERS`, `OVER_LIMIT`.

Verified on a Parklands Year 3 team: all 13 games returned with correct per-innings scores.

### Scorecards

```
GET /v2/games/{gameId}/summary
```

`data` keys: `id, gradeId, grade, organisation, round, status, type, schedule, appearances, teams,
coinToss, periods, playingSurfaces`.

- `coinToss`: `{winningTeamId, preference: "BAT"|"BOWL"}`
- `periods[].teams[]` split by `discipline`:
  - `BATTING` — team stats `TOTALS, TOTAL_SCORE, TOTAL_OUTS, TOTAL_OVERS, OVER_LIMIT`;
    per-player `TOTAL_RUNS, BALLS_FACED, FOURS, SIXES, STRIKE_RATE`
  - `BOWLING` — per-player `OVERS, RUNS, WICKETS, ECONOMY`
- `appearances[]` (top level): `id, firstName, lastName, roleType, teamId, isFillIn,
  isRegisteredPlayer, visible, captainRole, playerNumber, playerPosition`

**Name join:** `periods[].teams[].appearances[]` carries only `id`, `displayOrder` and `statistics`.
Map `id` → name via the **top-level** `appearances[]` array on the same response.

**Team names are not in any v2 response** — the v2 fixture and summary reference teams by ID only.
Build the map from `/v1/grades/{id}/games` `competitors[] {id, name}`, which is reliable for *names*
even though its *scores* are wrong for cricket (§3). `/v1/seasons/{id}/teams` does not include team
names at all — only club and grade.

**Scorecard coverage varies by age grade, not by API.** Electronic scoring is used in older grades
and not in younger ones:

| Grade | Games | With scorecards |
|---|---|---|
| Year 6 Section 3 (Morning) — Parklands Pumas | 8 | **8** (15–18 appearances each, batting + bowling both sides) |
| Year 3 North Section 1 | 13 | 2 |

Do not generalise from one team. Check `appearances` on the grade you care about before concluding
the data is unavailable.

### Ladders

```
GET /v2/grades/{gradeId}/ladder
```

Returns `{gradeId, ladders: [{headers[], pool, standings[]}], conferences}`. `headers` gives the
column config in display order (`played`, `competitionPoints`, `netRunRate`, `won`, `lost`, `ties`,
`noResults`) and `standings[].values` is a positional array matching it.

**Junior grades return `ladders: []`** — no ladder configured for public display. Adult grades work.

---

## 5. What is NOT available

### No registrations endpoint. At all.

There is no `GET` anywhere in the API — public or private — that returns who registered for a season.
Registration data is only reachable three ways:

1. **Webhooks** — `COMPETITION_REGISTRATION_TO_SEASON.CREATED`, `_TO_CLUB.CREATED`,
   `_TO_TEAM.CREATED`, `_TO_CLUB_TEAM.CREATED`, `COMPETITION_REGISTRATION.UPDATED`.
   Rich payload: full `participant` block (name, DOB, gender, address, email, mobile),
   `parentGuardians[]`, `emergencyContact`, plus `registration` with `role`, `registrationStatus`,
   `seasonRegisteredToId`, `teamName`, `schoolYear`, `optInMarketing`.
   Supports the `ORGANISATION_ANCESTOR` filter so it can be scoped to Parklands.
   **Subscriptions are provisioned by PlayHQ during partner onboarding, not self-serve.**
   Filter management lives at `/partner/v1/webhooks/subscribers/{subscriberId}/subscriptions/{subscriptionId}/filters/{entity}/ids`
   and needs a Bearer token. Forward-only — no backfill.
2. **DWH Competitions Extension** — flat-file feed, one row per registration, the only option with
   history. Commercial/partner arrangement.
   Fields documented at <https://docs.playhq.com/tech/dwh-integration/competitions-registrations>.
3. **Admin portal** — see §7.

### No club roster endpoint

The only player-bearing cricket endpoint is `/v2/games/{id}/summary`. You can walk
season → teams → grades → games → appearances and dedupe on the stable appearance `id`, but it
reconstructs who *played*, not who is in the club, and quality depends on the grade:

- Year 6 (electronically scored): full lineups every game — this works well
- Year 3 (not e-scored): 13 games, only 2 with any lineup — 10 people, of whom 1 player and 1 coach
  had `visible: false`
- `visible: false` blanks `firstName`/`lastName` but keeps a stable `id`
- cost is roughly one call per game — ~300 per season for Parklands' 23 junior teams

Fine for "who played for this team", not a substitute for a roster or a registration count.

### Club-scoped org teams is closed to us

`GET /partner/v1/organisations/{id}/teams` — "Supported for associations and administrative bodies;
**clubs are rejected with a 400**." Closed to Parklands even with partner access.

---

## 6. Gotchas

**The current season is missing from the season list.** `GET /v1/organisations/{id}/seasons` does not
return the active season even when it is live in admin. Both Summer 2026/27 seasons were absent, yet
`GET /v1/seasons/{id}/grades` and `/teams` returned HTTP 200 for both season IDs — the adult one with
fully populated public grades. Never conclude a season does not exist because it is not listed; test
the ID directly. Get current season IDs from the admin URL.

**Workaround — undocumented `GET /v1/organisations/{id}/registrations`** (public `x-api-key`, found by
probing on 2026-09-25, not in the spec). It lists the org's open **registration forms**, not participants,
and it *does* include the current seasons:

```json
{"id": "3b2d8860-…", "type": "PARTICIPANT_TO_CLUB", "registrationCode": "4c26cb",
 "startDate": {"date": "2026-08-02", …}, "endDate": {"date": "2026-09-27", …},
 "seasonId": "38e4c7dd-86b4-4ca7-8c54-ccdbd8cf8fdb", "seasonName": "Summer 2026/27",
 "competitionName": "CJCA Junior Cricket", "url": "https://www.playhq.com/new-zealand-cricket/register/4c26cb"}
```

`{data: [...]}` with no `metadata`. Use it to discover current season IDs. Being undocumented, it may
change without notice. Probed and 404: `/v1/seasons/{id}` and `/v1/seasons/{id}/participants|registrations`,
`/v2/seasons/{id}/participants`, `/v1/organisations/{id}/participants`,
`/v1/competitions/{id}` and `/v1/competitions/{id}/participants|seasons|registrations`,
`/v1/registrations/{formId|code}` and `/v1/registrations/{formId}/participants`, `/v1/registration-forms/{id}`.

**Club-scoped season lists are incomplete.** Querying the club returns 19 seasons; querying the
association returns 49. The club view drops CMCA Youth Boys entirely and shows only 1 of 12
Christchurch Festivals seasons. **Query the association and filter to Parklands.**

**Two response envelope shapes.** Most endpoints return `{data, metadata: {hasMore, nextCursor}}`.
`/v2/grades/{id}/games` returns `{rounds: [...]}` with no envelope and no cursor — different parse path.

**Pagination.** Cursor-based, ~100 items per page. Loop while `metadata.hasMore`, passing
`?cursor={metadata.nextCursor}`.

**Null clubs.** 2 of 277 teams in the 2025/26 junior season have `club: null`. `team['club']['name']`
will crash.

**Games reference teams by ID only** — no names in the fixture response. Build an ID→name map from
`/v1/seasons/{id}/teams` first.

**Public API honours visibility.** Hidden orgs, grades, teams and participants are omitted or
name-blanked. This is the usual explanation for "missing" data, not an auth problem.

---

## 7. Admin portal (`nzc.playhq.com`)

Logged in as a Parklands club admin. This is where registration data actually lives.

- Season participants: `/org/{orgId}/seasons/{seasonId}/participants`
  - `?type=PLAYER|COACH|TEAM_MANAGER|VOLUNTEER`
  - `?status=PENDING_ACTIVATION`
  - Filter panel also offers gender, age range and a New Registration yes/no flag
- **Reports → Report Builder** has a built-in **"Competition Participants"** report —
  "registration information, personal details and contact information". This is the export.
  Others: Advanced Fixtures, Advanced Venue, Fill-in Participants.
- The top-level **Participants** nav item is search-only — no list, no count.

### Snapshot, 2026-09-21

| Season | Participants | Players | Coaches | Volunteers |
|---|---|---|---|---|
| CJCA Junior Cricket — Summer 2026/27 (12/09/2026 – 21/03/2027) | 203 | 195 | 6 | 2 |
| CMCA Adult — Summer 2026/27 (01/09/2026 – 31/05/2027) | 30 | 26 | — | — |

All 203 junior registrations are Active (`PENDING_ACTIVATION` returns 0). The yellow "Pending"
badges in the list are the **payment** column, not registration status. No team managers yet, and
every grade still showed 0 teams — allocation had not happened.

---

## 8. Recipes

Loading `.env` and calling the API:

```python
import os, json, urllib.request, urllib.parse

K, T = os.environ['PLAYHQ_API_KEY'], os.environ['PLAYHQ_TENANT']

def get(path, **q):
    url = 'https://api.playhq.com' + path + ('?' + urllib.parse.urlencode(q) if q else '')
    req = urllib.request.Request(url, headers={'x-api-key': K, 'x-phq-tenant': T})
    return json.load(urllib.request.urlopen(req))

def pages(path):
    """Follow cursor pagination on {data, metadata} endpoints."""
    cursor, out = None, []
    while True:
        d = get(path, **({'cursor': cursor} if cursor else {}))
        out += d['data']
        meta = d.get('metadata') or {}
        if not meta.get('hasMore'):
            return out
        cursor = meta['nextCursor']
```

```bash
# quick smoke test — exercises all three env values at once
set -a && . ./.env && set +a
curl -s -H "x-api-key: $PLAYHQ_API_KEY" -H "x-phq-tenant: $PLAYHQ_TENANT" \
  "https://api.playhq.com/v1/organisations/$PLAYHQ_ORGANISATION_ID/seasons"
```

Parklands teams in a season:

```python
ASSOC = '2f297636-7797-4c1d-9f17-321c573e0145'
ORG   = os.environ['PLAYHQ_ORGANISATION_ID']

teams = pages(f'/v1/seasons/{SEASON}/teams')
mine  = [t for t in teams if t.get('club') and t['club']['id'] == ORG]   # note the null-club guard
names = {t['id']: (t['club']['name'] if t.get('club') else '?') for t in teams}
```

Results for one team:

```python
def stat(team, kind):
    return next((s['value'] for s in team['outcome']['statistics'] if s['type'] == kind), None)

for rnd in get(f'/v2/grades/{GRADE}/games')['rounds']:     # note: 'rounds', not 'data'
    for g in rnd['games']:
        if TEAM not in [t['id'] for t in g['teams']]:
            continue
        score = {tm['id']: f"{stat(tm,'TOTAL_SCORE')}/{stat(tm,'TOTAL_OUTS')} ({stat(tm,'TOTAL_OVERS')} ov)"
                 for p in g['periods'] for tm in p['teams']}
        me = next(t for t in g['teams'] if t['id'] == TEAM)
        print(rnd['abbreviatedName'], g['schedule'][0]['dateTime'][:10], g['status'], me['outcome'], score)
```

---

## 9. References

- API docs — <https://docs.playhq.com/tech/>
- Competition Registrations webhook — <https://docs.playhq.com/tech/api/competition-registrations>
- DWH Competition Registrations — <https://docs.playhq.com/tech/dwh-integration/competitions-registrations>
- Webhook subscriptions & filtering — <https://docs.playhq.com/tech/webhooks/subscriptions>
- Pagination guide — <https://docs.playhq.com/tech/guides/pagination>
- Matching teams to clubs — <https://docs.playhq.com/tech/guides/matching-teams-to-clubs-and-provinces>
- Game visibility — <https://docs.playhq.com/tech/guides/game-visibility>
- How to use PlayHQ APIs — <https://support.playhq.com/hc/en-us/articles/23949453276572-How-To-Use-PlayHQ-API-s>
