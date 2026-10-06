# Game Day Form — Functional Spec

**Status:** Approved 2026-10-05, amended during technical design (see [`technical-design.md`](./technical-design.md) §13);
pairs-cricket milestone limits added 2026-10-07 (§6.3)
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
| Per-player balls faced and overs bowled | Pairs-cricket limit checks (§6.3) |
| The game's over limit per innings and grade name | Which milestone rules apply (§6.3) |

**"PlayHQ has the result"** means the game's PlayHQ status is final and both teams have a total score.

PlayHQ provides **totals only, no ball-by-ball data**. So hat-tricks are always entered manually, and PlayHQ
cannot say *when* in a player's innings or spell a run or wicket came (§6.3).

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

Q6–Q8 each show a one-line rule under the heading that depends on the game's grade, and in pairs grades the
milestones section has an explainer and may show check flags. See §6.3.

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

Each prefilled row is labelled *"From PlayHQ"* and is fully editable and removable. In pairs grades, rows
for players who went over their share are still prefilled, with a check flag (§6.3).

*Example:* Rhinos v OBC 34, 21 Mar 2026 (Year 4, pairs, 12 balls / 2 overs). Frederick R. took 3 wickets in 3
overs, so he is prefilled with a bowling flag. Kaiser M. scored 26 off 16 balls, so he is prefilled with a
batting flag.

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

Refresh also re-evaluates check flags (§6.3.3) and includes them in the summary, e.g.
*"1 milestone needs checking"*.

### 6.3 Milestone limits in pairs cricket

In pairs grades a player's milestones count only within their **fair share**: their first **N balls** batting
and their **first 2 overs** bowling. Non-pairs grades have no limits.

Because PlayHQ gives totals only (§3.2), the form cannot tell whether a milestone was reached inside the share
when a player batted or bowled more than it. The club prefers wrongly awarding a milestone to wrongly missing
one, so such milestones are **still prefilled and awarded**, but carry a **check flag** for the scorer.

#### 6.3.1 Which rules apply

The rule is chosen mainly from **this game's overs per innings**: the over limit PlayHQ shows for the game. A
zero value counts as not known. Scorers enter this figure, so an odd game can get the wrong rule (e.g. a Year 6
game shortened to 16 overs after Christmas gets pairs flags). Milestones are awarded regardless, so the cost is a
stray flag.

| This game's overs | Rule | Batting share | Bowling share |
|---|---|---|---|
| 18 or fewer (Kiwi 12; Year 3/4, Mini Mags, Fab 4 16) | Pairs | 12 balls | 2 overs |
| Over 18 and under 27 (normally 20) | Pairs, **except** as below | 15 balls | 2 overs |
| 27 or more (Year 7/8, Premier) | No limits | — | — |

**20-over exceptions**, checked against the **PlayHQ grade name** (case-insensitive):

- Contains "Hardball" **and** "Div 3" or "Division 3" (girls Intermediate Hardball): **no limits**, all season.
- Game dated **1 January or later** in the season, and the name contains "Year 6" (but not "Super 8"), or "Div 3"
  or "Division 3" (girls Intermediate Incrediball): **no limits**.

So Year 5 Hardball, Year 5/6 Super 8 and girls Division 4 are pairs all season, and Year 6 and girls Division 3
Incrediball are pairs until 31 December.

**Fallback when the game has no overs figure** (not scored on PlayHQ, or PlayHQ can't be reached). Use the PlayHQ
grade name, or the team's `gradeName` from the squad JSON if PlayHQ can't be reached:

- Contains "Kiwi", "Year 3", "Year 4" or "Mini Mags": pairs, 12 balls / 2 overs.
- Anything else: no limits.

These games have no PlayHQ player figures, so no check flags are possible. Only the explainer wording depends on
the fallback.

- The bowling share is 2 overs in every pairs grade, including when a short-handed team lets players bowl 3.
- Anything unrecognised gets no limits. Under the over-award preference, the worst case is a missing check flag.

#### 6.3.2 Explainers

**Pairs grades** (shown with that grade's batting share, here 12 balls):

> **How are these worked out?** *(collapsed by default)*
> In pairs cricket, milestones only count a player's fair share: their **first 12 balls** batting and **first 2
> overs** bowling. We fill these in from PlayHQ where we can. PlayHQ shows totals, not ball-by-ball, so when a
> player batted or bowled more than their share we can't tell whether the milestone came inside it. Those are
> marked ⚠ for you to check against the scorebook. Please don't remove a milestone we've filled in unless the
> scorebook shows it's wrong.

| Question | One-line rule under the heading |
|---|---|
| Q6 Batting | 25 or more runs from the batter's first 12 balls. |
| Q7 Bowling | 3 or more wickets in the bowler's first 2 overs. |
| Q8 Hat-trick | 3 wickets from 3 balls in a row by the same bowler. They can span two of the bowler's overs, but all three must come in their first 2 overs. |

**Grades with no limits:** no "How are these worked out?" section and no check flags.

| Question | One-line rule under the heading |
|---|---|
| Q6 Batting | 25 or more runs in the innings. |
| Q7 Bowling | 3 or more wickets in the innings. |
| Q8 Hat-trick | 3 wickets from 3 balls in a row by the same bowler. They can span two of the bowler's overs. |

Hat-tricks are never flagged. Scorers judge them from the scorebook.

#### 6.3.3 Check flags

A batting or bowling milestone row carries a check flag when **all** of these are true:

- the game's rule is pairs (§6.3.1);
- PlayHQ has figures for that player in this game;
- the player went over their share: **balls faced > batting share** (batting), or **overs bowled > 2**
  (bowling, including part overs, e.g. 2.3).

The flag depends on PlayHQ's figures for the player, **not on how the row got there**. A row the scorer added by
hand, or re-added after removing it, is flagged the same way. If PlayHQ has no figures for the player (e.g. a game
not scored electronically), there is no flag and the one-line rule is the only guidance.

A flagged row shows:

> ⚠ Bowled 3 overs. Only wickets in the first 2 count. Check the scorebook.
> ☐ Checked: 3 wickets by the end of the 2nd over

> ⚠ Faced 16 balls. Only runs from the first 12 count. Check the scorebook.
> ☐ Checked: 25 runs by the 12th ball

- **Ticking "Checked"** confirms the milestone was reached inside the share and clears the flag. If the scorebook
  shows it wasn't, the scorer removes the row.
- The flag never blocks submitting. An unticked flag is saved with the report.
- **Editing the value** (e.g. 3 → 4 wickets) keeps the flag and the tick.
- **Refresh from PlayHQ** resets the tick only if that player's balls faced or overs bowled changed. It adds a flag
  if the player is now over their share, and removes it if they no longer are.

---

## 7. Review, submit and edit

### 7.1 Review before submit

- **Next** checks all fields (§9). Problems are shown beside the relevant fields and the review does not open.
- The review screen shows every answer read-only, grouped as on the form, with photo thumbnails.
  Questions hidden by "Game not played" are not shown.
- Each group has an **Edit** link back to that part of the form.
- Flagged milestones (§6.3.3) show *"⚠ Not checked"* or *"Checked ✓"* beside them.
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
| Milestones | Count of batting + bowling + hat-trick rows, plus unchecked flags, e.g. *3 (1 to check)* |

- **Missing** = game date is before today and there is no report. Missing rows are highlighted.
- Each row links to that game's report on the team page (or the blank form if there is no report).

### 8.2 Filters

- Team (one or all)
- Status (any combination)
- **Needs follow-up** — Q1 answer is *No* or *Yes but there were issues*, or the report has an unchecked
  milestone flag (§6.3.3)

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
type (Batting / Bowling / Hat-trick), runs or wickets (blank for hat-tricks), source (PlayHQ / entered),
check (blank / *Needs check* / *Checked*, §6.3.3).

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
