# Game Day Form — Functional Spec

**Status:** Approved 2026-10-05, amended during technical design (see [`technical-design.md`](./technical-design.md) §13)
· **Club:** Parklands Cricket Club (PCC)

Replaces the current Microsoft Form ("Game day form"). Covers what the form does, not how it is built.

---

## 1. Purpose

After each game, a coach or team manager records a game report for their team. Reports are used for:

- **Season awards** — tallying player of the day and mascot of the day per player.
- **Club records** — a lasting list of batting, bowling and hat-trick milestones per player.
- **Admin follow-up** — finding games that were not scored on PlayHQ, had scoring issues, or have no report.

Success means every played game has one report, player identities are consistent across the season, and
milestones and scores agree with PlayHQ wherever PlayHQ has the data.

## 2. Users and access

- **Coach / team manager** — fills in and edits reports for their team via the team link.
- **Club admin** — uses the all-games list and exports.
- **No sign-in** for the team pages, the all-games list or the public exports. Anyone with a link can view, submit
  and edit.
- **Full player names are never shown publicly.** Everywhere public, players appear as *First L.*
  (§5.1). Only the admin exports (§8.4), protected by a shared admin passcode, contain full names.

## 3. Data sources

### 3.1 Club-provided static JSON

PCC provides one JSON file containing the season, teams and players. The form reads it; it is not edited
through the form.

```json
{
  "season": { "name": "Summer 2026/27", "playhqSeasonId": "38e4c7dd-86b4-4ca7-8c54-ccdbd8cf8fdb" },
  "teams": [
    {
      "slug": "pumas",
      "name": "Parklands Pumas",
      "playhqTeamId": "7818a28c-31a4-4383-993d-641494fcfc0e",
      "playhqGradeId": "94c8c7aa-8b37-4973-95d9-6e89223e6b2c",
      "players": [
        { "key": "p0412", "firstName": "Logan", "lastName": "Smith", "playhqId": "8a77cc56-4168-4432-824e-e9d1c297f7ca" }
      ]
    }
  ]
}
```

- `slug` is the team's part of the link (`…/pumas`). Unique, matched case-insensitively.
- `playhqGradeId` is optional until PlayHQ allocates grades for the season. Without it, the team page shows
  *"Fixture not available from PlayHQ yet."*
- `key` is a short anonymous player ID chosen by the club (e.g. `p0412`). Required, unique, never changed or
  reused, and must not contain the player's name. It identifies the player in the public exports.
- `playhqId` (optional) is the player's PlayHQ appearance ID (the `appearances[].id` on a PlayHQ game summary),
  which is stable for a person across games. It is used to match PlayHQ stats to squad players.
- A team may have an empty `players` list; the player pickers then only offer **Other**.
- The file is held on the server and never sent to the browser.

### 3.2 PlayHQ (public API)

Read for the team's grade in the current season:

| Data | Used for |
|---|---|
| Fixture: games, rounds, dates, venues, status | Game dropdown, all-games list |
| Opposition team names | Game dropdown labels, opposition score label |
| Final team scores (runs, wickets) | Read-only scores |
| Per-player batting runs and bowling wickets | Prefilled milestones |

**"PlayHQ has the result"** means the game's PlayHQ status is final and both teams have a total score.

PlayHQ does **not** provide hat-tricks (no ball-by-ball data), so hat-tricks are always entered manually.

All dates and "today" are in New Zealand time (Pacific/Auckland).

PlayHQ data is cached to keep traffic low: the fixture for 6 hours, and a game's result and stats for 6 hours once
the game is final (15 minutes before that). **Refresh from PlayHQ** (§6.2) bypasses the cache.

---

## 4. Team page and game selection

**Home page (`…/`)** lists every team in the JSON, each linking to its team page, plus a link to the all-games
list.

**Link:** `…/{slug}`, e.g. `…/pumas`.

- If the slug is not in the JSON: show a **"Team not found"** page with a link to the home page.

**Header:** team name, grade name, season name.

**Game dropdown** lists every game for the team in the current season, in date order. Byes are excluded.
Each option shows:

> *Sat 30 Jan · R5 · v Tigers · Parklands Reserve* — **[status]**

| Status | Meaning | Selectable |
|---|---|---|
| Reported | A report exists | Yes |
| Not played | A report exists with answer "Game not played" | Yes |
| Not yet reported | Game date is today or earlier, no report | Yes |
| Upcoming | Game date is after today | **No** |

**Default selection:** the most recent game dated on or before today. If there is none, no game is selected
and the page shows *"No games played yet this season."*

**After selecting a game:**

- No report yet → the blank form (§5), prefilled from PlayHQ where available.
- Report exists → the read-only view (§7.2).

---

## 5. The form

Fields appear in this order. "Squad picker" is defined in §5.1.

### Q1. Did you score this game electronically on PlayHQ? *(required)*

| Answer | Effect |
|---|---|
| Yes | Continue |
| No | Continue |
| Yes but there were issues | Shows **"What were the issues?"** — required multi-line text |
| Game not played | Shows **Reason** — required: Rained out / Cancelled / Forfeit / Other. *Other* shows a required text box. All remaining questions are hidden; **Next** goes straight to review. |

If PlayHQ has the result: the answer defaults to **Yes**, and **No** is not offered.

### Q2. Scores *(required unless Game not played)*

Two score blocks, each with **Wickets** and **Runs**:

- **{Team name} score**
- **{Opposition name} score** — the opposition's actual name from PlayHQ

| Situation | Behaviour |
|---|---|
| PlayHQ has the result | Both blocks are **read-only**, labelled *"From PlayHQ"* |
| PlayHQ does not have the result | Both blocks are editable and required. Whole numbers only. Wickets 0–30, runs 0–999 |

### Q3. Player of the day *(required unless Game not played)*

Squad picker. Exactly one player.

### Q4. Mascot of the day *(required unless Game not played)*

Squad picker. Exactly one player. May be the same player as Q3.

### Q5. Any game highlights, special moments or comments you'd like to add? *(optional)*

- Multi-line text.
- Up to **5 photos**. JPEG, PNG or HEIC. Large photos are resized automatically.
- Photos can be removed before submitting.

### Q6. Any batting milestones to add? *(optional)*

Repeatable rows: **Player** (squad picker) + **Runs** (whole number, **25–999**).
"Add milestone" adds a row; each row has a remove button. No rows means none. A player may appear only once.

### Q7. Any bowling wicket milestones to add? *(optional)*

Repeatable rows: **Player** (squad picker) + **Wickets** (whole number, **3–19**).
Same add/remove and one-row-per-player rules as Q6.

### Q8. Any bowling hat-tricks to add? *(optional)*

Repeatable rows: **Player** (squad picker) only. Same add/remove and one-row-per-player rules as Q6.

### Q9. Your name *(optional)*

Free text. Recorded against this save so changes can be traced (§7.3).

### 5.1 Squad picker

- Lists the team's players from the JSON, sorted by first name, shown as **first name + last initial**
  (*Logan S.*).
- If two players would show the same label, add surname letters until they differ (*Sam Th.* / *Sam Ta.*).
- Last option: **Other** — shows a required **Full name** text box.
- "Other" names are stored in full but are not added to the squad. After saving, they are shown as
  *First L.* (first word + initial of the last word) everywhere, including when the report is reopened for editing.
  When editing, the coach can keep the saved person or replace them, but cannot see the saved full name.

---

## 6. PlayHQ prefill and refresh

### 6.1 Milestone prefill

When the blank form opens and PlayHQ has player stats for the game, rows are added for **this team's**
players only:

- Q6 — every batter with 25 or more runs.
- Q7 — every bowler with 3 or more wickets (and fewer than 20).

Each prefilled row is labelled *"From PlayHQ"* and is fully editable and removable.

**Matching** a PlayHQ player to the squad uses `playhqId` only:

- Match → the squad player is selected.
- No match (e.g. a fill-in from another team) → the row shows the player as *First L. (not in squad)* with
  *"Couldn't match to squad — please check."* The coach can keep it or pick a different player. The full name is
  stored server-side from PlayHQ.

### 6.2 Refresh from PlayHQ

A **Refresh from PlayHQ** button sits beside the scores and beside the milestones. It is available on a new
form and when editing an existing report. Pressing it re-reads PlayHQ for this game and:

| Item | Refresh behaviour |
|---|---|
| Scores | If PlayHQ has the result: replace the scores and make them read-only *"From PlayHQ"* (including when they were previously typed in). If not: leave the scores unchanged. |
| Q1 answer | If PlayHQ now has the result and the answer was **No**, change it to **Yes** and say so. |
| Milestone rows from PlayHQ that the coach has **not** changed | Update values to match PlayHQ; remove the row if the player no longer qualifies. |
| Milestone rows from PlayHQ that the coach **has** changed, and rows the coach added | Leave unchanged. |
| PlayHQ milestones with no existing row for that player | Add as new *"From PlayHQ"* rows. |

After a refresh, show a short summary of what changed, e.g.
*"Opposition score updated 128/4 → 131/4 · 1 batting milestone added"*, or *"No changes from PlayHQ."*

If PlayHQ can't be reached: *"Couldn't reach PlayHQ — try again later."* Nothing on the form changes.

Refresh is limited to once a minute per game. Pressing it again sooner shows *"Just refreshed — try again in a
minute."*

---

## 7. Review, submit and edit

### 7.1 Review before submit

- **Next** checks all fields (§9). Problems are shown beside the relevant fields and the review does not open.
- The review screen shows every answer read-only, grouped as on the form, with photo thumbnails.
  Questions hidden by "Game not played" are not shown.
- Each group has an **Edit** link back to that part of the form.
- **Submit** saves the report. A confirmation then shows the summary and a link back to the team page.

### 7.2 Viewing an existing report

Selecting a game with a report shows the same read-only layout as the review screen, plus:

> *Last updated 7 Feb 2026, 6:42pm by Sarah* (or *by unknown* if no name was given)

and an **Edit** button.

### 7.3 Editing

- **Edit** opens the form with the saved answers. Milestones are not re-prefilled automatically; use
  **Refresh from PlayHQ** to pull new PlayHQ data.
- Editing then follows review → submit as in §7.1.
- Reports can be edited at any time during the current season.
- Every save is kept with its date, time and the name given (Q9). Only the latest version is shown.
- **Two people editing at once:** if the report was saved by someone else after this person opened it, Submit
  does not save. It shows *"This report was updated by someone else — review their version first,"* and shows
  the latest version.

There is one report per team per game. Selecting a game always opens that game's single report.

### 7.4 Unsaved drafts

Answers are kept on the device while the form is being filled in. If the page is closed or reloaded before
submitting, reopening the same game offers *"Resume your unsaved report?"*. The draft is cleared on submit.

---

## 8. All-games list and export

**Link:** `…/games`. Club-wide, current season, no sign-in.

### 8.1 Table

One row per game across all teams in the JSON, sorted by date (newest first). Byes excluded.

| Column | Content |
|---|---|
| Date | Game date |
| Team | PCC team name |
| Round | e.g. R5 |
| Opposition | Opposition name |
| Venue | Venue name |
| Status | Reported / Not played / **Missing** / Upcoming |
| PlayHQ scoring | Q1 answer, with the issues text or not-played reason |
| Scores | *Team runs/wickets* v *Opposition runs/wickets* |
| Player of the day | *First L.* |
| Mascot of the day | *First L.* |
| Milestones | Count of batting + bowling + hat-trick rows |

- **Missing** = game date is before today and there is no report. Missing rows are highlighted.
- Each row links to that game's report on the team page (or the blank form if there is no report).

### 8.2 Filters

- Team (one or all)
- Status (any combination)
- **Needs follow-up** — Q1 answer is *No* or *Yes but there were issues*

### 8.3 Exports (CSV)

Both exports respect the current filters.

**`games.csv`** — one row per game:
date, team, round, opposition, venue, status, Q1 answer, issues text, not-played reason, team runs,
team wickets, opposition runs, opposition wickets, score source (PlayHQ / entered),
player of the day (*First L.*), player of the day ID, player of the day is Other (Y/N),
mascot of the day (*First L.*), mascot ID, mascot is Other (Y/N),
highlights text, photo links, last updated, last updated by.

**`milestones.csv`** — one row per milestone:
date, team, opposition, player (*First L.*), player ID, player is Other (Y/N),
type (Batting / Bowling / Hat-trick), runs or wickets (blank for hat-tricks), source (PlayHQ / entered).

"Player ID" is the squad `key`, or an anonymous ID for Other / not-in-squad players. Upcoming and Missing games
appear in `games.csv` with empty report fields.

Free-text fields (highlights, issues, "last updated by") are exported as typed. Coaches are asked not to type
full names there, but this is not enforced.

### 8.4 Admin exports

**Link:** `…/admin`. Asks for the club's admin passcode, then offers the same two CSVs with an added
**full name** column for every player column. Wrong passcodes are limited to 5 attempts a minute.

---

## 9. Validation summary

| Field | Rule |
|---|---|
| Q1 | Required |
| Issues text | Required when Q1 = Yes but there were issues |
| Not-played reason | Required when Q1 = Game not played; text required when reason = Other |
| Wickets (team scores, entered) | Required, whole number 0–30 |
| Runs (team scores, entered) | Required, whole number 0–999 |
| Player / mascot of the day | Required, exactly one each |
| Other → full name | Required, not blank |
| Photos | At most 5; JPEG, PNG or HEIC |
| Batting milestone runs | Whole number 25–999 |
| Bowling milestone wickets | Whole number 3–19 |
| Milestone rows | Player required; each player at most once per milestone type |

Numeric fields accept digits only.

---

## 10. General

- Designed for phones first (coaches fill it in at the ground); also works on desktop.
- Plain, friendly wording; no cricket jargon beyond the question text above.
- **On brand with <https://parklandscricket.co.nz/>:** club navy and teal colours, the club's fonts and
  horizontal logo. Text and buttons meet WCAG AA contrast, so primary buttons use navy text on teal rather than
  the site's white on teal.
- **Team mascots** (from the club's SharePoint *Team certs and mascots/Mascots* folder) appear on the home page team
  cards, the team page header and the submit confirmation. Teams without a mascot image show the club's teal ball.

## 11. Out of scope

- Season tallies (counts per player) — done from the exports.
- Notifications to admins (email/Teams).
- Past seasons.
- Reconciling "Other" names with the squad (done by the admin from the admin export).
- Editing the squad or teams through the form.
- Technical implementation (hosting, storage, PlayHQ call patterns) — to be specified separately.
