# Pairs-Cricket Milestone Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In pairs-cricket grades, flag batting and bowling milestones where the player batted or bowled more than their fair share. The milestone stays awarded, and the scorer gets a "Checked" tick, explainer text and follow-up reporting.

**Architecture:** A pure shared module (`shared/src/milestone-rules.ts`) picks the rule (pairs 12 / pairs 15 / open) from the game's PlayHQ over limit, grade name and date. It then derives a per-row `check` from PlayHQ per-player figures (balls faced, overs). The Worker adds `rule` + `figures` to `PlayhqStartData`, always returns it on the game endpoint, recomputes checks on save and persists them in D1. The SvelteKit form reapplies checks reactively and shows the warnings, the tick and the explainers. The list and CSV surface unchecked flags.

**Tech Stack:** TypeScript 7, valibot, Hono on Cloudflare Workers (D1/KV), SvelteKit 2 SPA with Svelte 5 runes, Vitest with `@cloudflare/vitest-pool-workers`, Playwright.

**Spec:** `docs/functional-spec.md` §6.3 (plus §3.2, §6.1, §6.2, §7.1, §8.1–8.3). Technical design: `docs/technical-design.md` §5 (migration 0002), §7.1, §7.3, §8.5, §9.

All paths below are relative to `automations/src/game-day-form/`.

## Global Constraints

- Full player names never appear in any public API response or public CSV; only *First L.* labels and keys.
- `MilestoneRow.check` is **optional** in the valibot schema (`v.optional(v.nullable(...))`), so old drafts and old clients still parse.
- Hat-trick rows always have `check: null`. Hat-tricks are never flagged.
- Flags never block validation or submit.
- When PlayHQ data is unavailable (`available: false`), existing `check` values are left exactly as they are, on both client and server.
- Rule thresholds, verbatim: overs > 0 and ≤ 18 → pairs 12 balls / 2 overs; ≥ 27 → open; otherwise pairs 15 / 2, except: name has `hardball` and matches `/\bdiv(ision)?\s*3\b/` → open; game month Jan–Aug, and the name has (`year 6` and not `super 8`) or matches div 3 → open. No overs figure: name has `kiwi`, `year 3`, `year 4` or `mini mags` → pairs 12; else open. Name matching is case-insensitive.
- A flag needs balls faced **>** share (bat) or overs **>** 2 (bowl). Exactly 12 balls or exactly 2 overs is not flagged; 2.3 overs is.
- User-facing copy is exactly as written in the tasks below (from spec §6.3.2–6.3.3).
- Test commands: `npm test` (Vitest: shared + api), `npm run typecheck`, `npm run e2e`. Run them from `automations/src/game-day-form`.
- Commit after each task. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JgSDmhaicPCpDtm8scDnbP
  ```

## Review Focus

1. **Old data without `check`:** existing D1 rows (migration default) and stored drafts lacking the field must load, render and save. Covered by Task 1 (schema parse test) and Task 4 (migration columns nullable/default).
2. **PlayHQ unreachable while editing a flagged report:** flags must survive, not be wiped. Covered by Task 1 (`withChecks` with `available: false`) and Task 4 (save with summary failing keeps the client's `check`).
3. **Saved not-in-squad players** (`kind: 'named'` with `playhqId`) must still match figures, while "Other" names (no PlayHQ ID) are never flagged. Covered by Task 1 tests.
4. **Boundary values:** exactly 12 balls / 2 overs is not flagged; 2.3 overs is; a changed figure resets the tick, and a changed value does not. Covered by Task 1 tests.
5. **Reactive re-check must settle:** no loop and no change to state when nothing differs. Covered by Task 1 (idempotence test) and Task 6 (write back only when JSON differs).

---

### Task 1: Shared milestone rules module

**Files:**
- Create: `shared/src/players.ts`
- Create: `shared/src/milestone-rules.ts`
- Create: `shared/test/milestone-rules.test.ts`
- Modify: `shared/src/types.ts` (MilestoneRowSchema, new types)
- Modify: `shared/src/merge.ts:16-22` (move `samePlayer` out)
- Modify: `shared/src/text.ts` (append copy helpers)

**Interfaces:**
- Consumes: `PlayerChoice`, `PlayerRefOut`, `MilestoneRow` from `shared/src/types.ts`.
- Produces:
  - `samePlayer(a: PlayerChoice | null, b: PlayerRefOut): boolean` from `shared/src/players.ts`, still re-exported by `merge.ts`.
  - Types in `types.ts`:
    - `MilestoneCheck = { actual: number; share: number; checked: boolean }`
    - `MilestoneRule = { kind: 'pairs'; batBalls: number; bowlOvers: number } | { kind: 'open' }`
    - `PlayerFigures = { player: PlayerRefOut; ballsFaced: number | null; overs: number | null }`
    - `CheckContext = { available: boolean; rule: MilestoneRule; figures: PlayerFigures[] }`
  - `MilestoneRow.check?: MilestoneCheck | null`.
  - From `milestone-rules.ts`:
    - `OPEN`
    - `afterChristmas(gameDate: string | null): boolean`
    - `ruleFor(i: { overLimit: number | null; gradeName: string | null; gameDate: string | null }): MilestoneRule`
    - `expectedCheck(rule: MilestoneRule, figures: PlayerFigures[], row: MilestoneRow): { actual: number; share: number } | null`
    - `withChecks(rows: MilestoneRow[], ctx: CheckContext): MilestoneRow[]`
    - `needsCheck(rows: MilestoneRow[]): number`
  - From `text.ts`: `milestoneRuleText(rule)` returning `{ bat, bowl, hattrick }`, and `checkText(type, check)` returning `{ warning, confirm }`.

- [ ] **Step 1: Write the failing tests**

Create `shared/test/milestone-rules.test.ts`:

```ts
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { afterChristmas, expectedCheck, needsCheck, OPEN, ruleFor, withChecks } from '../src/milestone-rules';
import { checkText, milestoneRuleText } from '../src/text';
import { MilestoneRowSchema, type CheckContext, type MilestoneRow, type PlayerFigures } from '../src/types';

const PAIRS12 = { kind: 'pairs', batBalls: 12, bowlOvers: 2 } as const;
const PAIRS15 = { kind: 'pairs', batBalls: 15, bowlOvers: 2 } as const;

const fred = { kind: 'squad' as const, key: 'p010', label: 'Frederick R.' };
const kaiser = { kind: 'squad' as const, key: 'p011', label: 'Kaiser M.' };
const fill = { kind: 'playhq' as const, playhqId: 'ph-fill', label: 'Kim W. (not in squad)' };

const figures: PlayerFigures[] = [
  { player: fred, ballsFaced: 16, overs: 3 },
  { player: kaiser, ballsFaced: 16, overs: 2 },
  { player: fill, ballsFaced: 12, overs: 2.3 },
];

const row = (over: Partial<MilestoneRow>): MilestoneRow => ({
  rowId: 'r', type: 'bowl', player: fred, value: 3, source: 'playhq', playhqValue: 3, touched: false, ...over,
});

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({ available: true, rule: PAIRS12, figures, ...over });

describe('ruleFor', () => {
  const r = (overLimit: number | null, gradeName: string | null, gameDate: string | null = '2025-11-15') => ruleFor({ overLimit, gradeName, gameDate });

  it('uses the over limit for last season grades', () => {
    expect(r(12, 'Kiwi North - Section 1')).toEqual(PAIRS12);
    expect(r(16, 'Year 4 North - Section 2')).toEqual(PAIRS12);
    expect(r(16, 'Year 4 - City Wide Fab 4')).toEqual(PAIRS12);
    expect(r(16, 'Mini Mags Fab 4')).toEqual(PAIRS12);
    expect(r(18, 'Year 3 North - Section 2')).toEqual(PAIRS12);
    expect(r(20, 'Year 5 Hardball Section 1')).toEqual(PAIRS15);
    expect(r(20, 'Junior Girls Incrediball - Div 4 - Section 2')).toEqual(PAIRS15);
    expect(r(20, 'Year 6 Section 3 (Morning)')).toEqual(PAIRS15);
    expect(r(27, 'Year 7 Morning')).toEqual(OPEN);
    expect(r(30, 'Year 7/8 Premier')).toEqual(OPEN);
  });

  it('never limits girls Division 3 Hardball', () => {
    expect(r(20, 'Intermediate Girls Hardball Division 3 - Section 2')).toEqual(OPEN);
    expect(r(20, 'Girls Hardball Div 3')).toEqual(OPEN);
  });

  it('switches Year 6 and Division 3 Incrediball to open from 1 January', () => {
    expect(r(20, 'Year 6 Section 3 (Morning)', '2026-01-10')).toEqual(OPEN);
    expect(r(20, 'Intermediate Girls Incrediball Division 3', '2025-12-13')).toEqual(PAIRS15);
    expect(r(20, 'Intermediate Girls Incrediball Division 3', '2026-02-07')).toEqual(OPEN);
  });

  it('keeps Super 8, Year 5 and Div 4 as pairs all season', () => {
    expect(r(20, 'Year 5/6 Super 8', '2026-02-07')).toEqual(PAIRS15);
    expect(r(20, 'Year 6 Super 8 Incrediball', '2026-02-07')).toEqual(PAIRS15);
    expect(r(20, 'Year 5 Hardball Section 2', '2026-03-21')).toEqual(PAIRS15);
    expect(r(20, 'Junior Girls Incrediball - Div 4', '2026-03-21')).toEqual(PAIRS15);
  });

  it('treats odd 20-ish figures as 20 and a shortened Year 6 game as pairs 12', () => {
    expect(r(22, 'Year 5 Hardball')).toEqual(PAIRS15);
    expect(r(16, 'Year 6 Section 3 (Morning)', '2026-02-07')).toEqual(PAIRS12);
  });

  it('falls back to name keywords when there is no overs figure', () => {
    expect(r(null, 'Kiwi Cricket — Year 1')).toEqual(PAIRS12);
    expect(r(0, 'Year 3')).toEqual(PAIRS12);
    expect(r(null, 'Mini Mags')).toEqual(PAIRS12);
    expect(r(null, 'Year 5')).toEqual(OPEN);
    expect(r(null, null)).toEqual(OPEN);
  });

  it('knows which dates are after Christmas', () => {
    expect(afterChristmas('2026-01-01')).toBe(true);
    expect(afterChristmas('2026-03-21')).toBe(true);
    expect(afterChristmas('2025-12-31')).toBe(false);
    expect(afterChristmas('2025-10-18')).toBe(false);
    expect(afterChristmas(null)).toBe(false);
  });
});

describe('expectedCheck', () => {
  it('flags a bowler over 2 overs and a batter over the ball share', () => {
    expect(expectedCheck(PAIRS12, figures, row({}))).toEqual({ actual: 3, share: 2 });
    expect(expectedCheck(PAIRS12, figures, row({ type: 'bat', player: kaiser, value: 26 }))).toEqual({ actual: 16, share: 12 });
  });

  it('does not flag exactly the share, and flags part overs', () => {
    expect(expectedCheck(PAIRS12, figures, row({ player: kaiser }))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ type: 'bat', player: fill }))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ player: fill }))).toEqual({ actual: 2.3, share: 2 });
  });

  it('uses the 15-ball share', () => {
    expect(expectedCheck(PAIRS15, figures, row({ type: 'bat', player: kaiser }))).toEqual({ actual: 16, share: 15 });
    expect(expectedCheck(PAIRS15, [{ player: kaiser, ballsFaced: 15, overs: null }], row({ type: 'bat', player: kaiser }))).toBeNull();
  });

  it('matches a saved not-in-squad player by PlayHQ id, never an Other name', () => {
    const named = { kind: 'named' as const, id: 'n1', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' };
    expect(expectedCheck(PAIRS12, figures, row({ player: named }))).toEqual({ actual: 2.3, share: 2 });
    expect(expectedCheck(PAIRS12, figures, row({ player: { kind: 'other', fullName: 'Frederick R' } }))).toBeNull();
  });

  it('never flags open grades, hat-tricks, empty players or players without figures', () => {
    expect(expectedCheck(OPEN, figures, row({}))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ type: 'hattrick', value: null }))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ player: null }))).toBeNull();
    expect(expectedCheck(PAIRS12, figures, row({ player: { kind: 'squad', key: 'p999', label: 'Zed Z.' } }))).toBeNull();
    expect(expectedCheck(PAIRS12, [{ player: fred, ballsFaced: null, overs: null }], row({}))).toBeNull();
  });
});

describe('withChecks', () => {
  it('adds an unticked flag, and null on rows that are fine', () => {
    const out = withChecks([row({ rowId: 'a' }), row({ rowId: 'b', player: kaiser })], ctx());
    expect(out.map((r) => r.check)).toEqual([{ actual: 3, share: 2, checked: false }, null]);
  });

  it('keeps the tick while the figure is unchanged, whatever the value', () => {
    const ticked = row({ value: 4, touched: true, check: { actual: 3, share: 2, checked: true } });
    expect(withChecks([ticked], ctx())[0].check).toEqual({ actual: 3, share: 2, checked: true });
  });

  it('resets the tick when the figure changes', () => {
    const ticked = row({ check: { actual: 2.4, share: 2, checked: true } });
    expect(withChecks([ticked], ctx())[0].check).toEqual({ actual: 3, share: 2, checked: false });
  });

  it('removes a flag when the rule becomes open', () => {
    const flagged = row({ check: { actual: 3, share: 2, checked: false } });
    expect(withChecks([flagged], ctx({ rule: OPEN }))[0].check).toBeNull();
  });

  it('leaves rows untouched when PlayHQ data is unavailable', () => {
    const flagged = row({ check: { actual: 3, share: 2, checked: true } });
    expect(withChecks([flagged], ctx({ available: false, figures: [] }))).toEqual([flagged]);
  });

  it('is idempotent', () => {
    const once = withChecks([row({ rowId: 'a' }), row({ rowId: 'b', type: 'hattrick', value: null })], ctx());
    expect(withChecks(once, ctx())).toEqual(once);
  });

  it('counts unticked flags', () => {
    expect(needsCheck([row({ check: { actual: 3, share: 2, checked: false } }), row({ check: { actual: 3, share: 2, checked: true } }), row({ check: null }), row({})])).toBe(1);
  });
});

describe('row schema', () => {
  it('accepts rows with and without a check', () => {
    const base = { rowId: 'r', type: 'bowl', player: null, value: 3, source: 'entered', playhqValue: null, touched: true };
    expect(v.safeParse(MilestoneRowSchema, base).success).toBe(true);
    expect(v.safeParse(MilestoneRowSchema, { ...base, check: null }).success).toBe(true);
    expect(v.safeParse(MilestoneRowSchema, { ...base, check: { actual: 3, share: 2, checked: true } }).success).toBe(true);
    expect(v.safeParse(MilestoneRowSchema, { ...base, check: { actual: 3 } }).success).toBe(false);
  });
});

describe('copy', () => {
  it('words the per-question rules for pairs and open grades', () => {
    expect(milestoneRuleText(PAIRS12)).toEqual({
      bat: "25 or more runs from the batter's first 12 balls.",
      bowl: "3 or more wickets in the bowler's first 2 overs.",
      hattrick: "3 wickets from 3 balls in a row by the same bowler. They can span two of the bowler's overs, but all three must come in their first 2 overs.",
    });
    expect(milestoneRuleText(OPEN)).toEqual({
      bat: '25 or more runs in the innings.',
      bowl: '3 or more wickets in the innings.',
      hattrick: "3 wickets from 3 balls in a row by the same bowler. They can span two of the bowler's overs.",
    });
  });

  it('words flag warnings and confirmations', () => {
    expect(checkText('bowl', { actual: 3, share: 2 })).toEqual({
      warning: '⚠ Bowled 3 overs. Only wickets in the first 2 count. Check the scorebook.',
      confirm: 'Checked: 3 wickets by the end of the 2nd over',
    });
    expect(checkText('bat', { actual: 16, share: 12 })).toEqual({
      warning: '⚠ Faced 16 balls. Only runs from the first 12 count. Check the scorebook.',
      confirm: 'Checked: 25 runs by the 12th ball',
    });
    expect(checkText('bat', { actual: 18, share: 15 }).confirm).toBe('Checked: 25 runs by the 15th ball');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/test/milestone-rules.test.ts`
Expected: FAIL, because `../src/milestone-rules` can't be resolved.

- [ ] **Step 3: Add the types**

In `shared/src/types.ts`, add above `MilestoneRowSchema`:

```ts
export const MilestoneCheckSchema = v.object({ actual: v.number(), share: v.number(), checked: v.boolean() });
```

Add a `check` entry as the last property of `MilestoneRowSchema`:

```ts
  touched: v.boolean(),
  check: v.optional(v.nullable(MilestoneCheckSchema)),
});
```

Append after the `MilestoneCandidate` interface:

```ts
export type MilestoneCheck = v.InferOutput<typeof MilestoneCheckSchema>;

/** Functional spec §6.3.1: pairs grades limit milestones to a fair share; open grades have no limits. */
export type MilestoneRule = { kind: 'pairs'; batBalls: number; bowlOvers: number } | { kind: 'open' };

export interface PlayerFigures {
  player: PlayerRefOut;
  ballsFaced: number | null;
  overs: number | null;
}

export interface CheckContext {
  available: boolean;
  rule: MilestoneRule;
  figures: PlayerFigures[];
}
```

- [ ] **Step 4: Move `samePlayer` into `shared/src/players.ts`**

Create `shared/src/players.ts`:

```ts
import type { PlayerChoice, PlayerRefOut } from './types';

/** True when a form/report player and a PlayHQ-derived player are the same person. */
export function samePlayer(a: PlayerChoice | null, b: PlayerRefOut): boolean {
  if (!a) return false;
  if (a.kind === 'squad' && b.kind === 'squad') return a.key === b.key;
  const aPhq = a.kind === 'playhq' || a.kind === 'named' ? a.playhqId : undefined;
  const bPhq = b.kind === 'playhq' || b.kind === 'named' ? b.playhqId : undefined;
  return !!aPhq && aPhq === bPhq;
}
```

In `shared/src/merge.ts`, delete the `samePlayer` function (lines 16–22) and add after the imports:

```ts
import { samePlayer } from './players';

export { samePlayer };
```

Drop `type PlayerChoice` and `type PlayerRefOut` from merge.ts's `./types` import if they are now unused.

- [ ] **Step 5: Write `shared/src/milestone-rules.ts`**

```ts
import { samePlayer } from './players';
import type { CheckContext, MilestoneRow, MilestoneRule, PlayerFigures } from './types';

export const OPEN: MilestoneRule = { kind: 'open' };
const pairs = (batBalls: number): MilestoneRule => ({ kind: 'pairs', batBalls, bowlOvers: 2 });
const DIV3 = /\bdiv(ision)?\s*3\b/;

/** Seasons run September to March, so a game dated January to August is after Christmas. */
export function afterChristmas(gameDate: string | null): boolean {
  if (!gameDate) return false;
  const month = Number(gameDate.slice(5, 7));
  return month >= 1 && month <= 8;
}

/** Functional spec §6.3.1. `overLimit` is this game's PlayHQ over limit per innings. */
export function ruleFor(i: { overLimit: number | null; gradeName: string | null; gameDate: string | null }): MilestoneRule {
  const name = (i.gradeName ?? '').toLowerCase();
  const div3 = DIV3.test(name);
  if (i.overLimit !== null && i.overLimit > 0) {
    if (i.overLimit <= 18) return pairs(12);
    if (i.overLimit >= 27) return OPEN;
    if (name.includes('hardball') && div3) return OPEN;
    const year6 = name.includes('year 6') && !name.includes('super 8');
    if (afterChristmas(i.gameDate) && (year6 || div3)) return OPEN;
    return pairs(15);
  }
  if (['kiwi', 'year 3', 'year 4', 'mini mags'].some((w) => name.includes(w))) return pairs(12);
  return OPEN;
}

/** The flag a row should carry (without the tick), or null. Functional spec §6.3.3. */
export function expectedCheck(rule: MilestoneRule, figures: PlayerFigures[], row: MilestoneRow): { actual: number; share: number } | null {
  if (rule.kind !== 'pairs' || row.type === 'hattrick' || !row.player) return null;
  const f = figures.find((x) => samePlayer(row.player, x.player));
  if (!f) return null;
  if (row.type === 'bat') {
    return f.ballsFaced !== null && f.ballsFaced > rule.batBalls ? { actual: f.ballsFaced, share: rule.batBalls } : null;
  }
  return f.overs !== null && f.overs > rule.bowlOvers ? { actual: f.overs, share: rule.bowlOvers } : null;
}

/**
 * Re-derives every row's check flag. The tick survives only while the PlayHQ figure is unchanged.
 * Without PlayHQ data the rows are returned untouched, so saved flags are never wiped. Idempotent.
 */
export function withChecks(rows: MilestoneRow[], ctx: CheckContext): MilestoneRow[] {
  if (!ctx.available) return rows;
  return rows.map((row) => {
    const exp = expectedCheck(ctx.rule, ctx.figures, row);
    const prev = row.check ?? null;
    return { ...row, check: exp ? { ...exp, checked: prev?.checked === true && prev.actual === exp.actual } : null };
  });
}

export const needsCheck = (rows: MilestoneRow[]) => rows.filter((r) => r.check && !r.check.checked).length;
```

- [ ] **Step 6: Add the copy to `shared/src/text.ts`**

Add this import at the top of the file (it has none today), then append the code below it:

```ts
import type { MilestoneRule, MilestoneType } from './types';
```

```ts
const HAT_TRICK = "3 wickets from 3 balls in a row by the same bowler. They can span two of the bowler's overs";

/** One-line rule shown under each milestone question (functional spec §6.3.2). */
export function milestoneRuleText(rule: MilestoneRule): Record<MilestoneType, string> {
  if (rule.kind === 'open') {
    return { bat: '25 or more runs in the innings.', bowl: '3 or more wickets in the innings.', hattrick: `${HAT_TRICK}.` };
  }
  return {
    bat: `25 or more runs from the batter's first ${rule.batBalls} balls.`,
    bowl: `3 or more wickets in the bowler's first ${rule.bowlOvers} overs.`,
    hattrick: `${HAT_TRICK}, but all three must come in their first ${rule.bowlOvers} overs.`,
  };
}

const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** Warning and tick label on a flagged row (functional spec §6.3.3). */
export function checkText(type: MilestoneType, c: { actual: number; share: number }) {
  return type === 'bat'
    ? {
        warning: `⚠ Faced ${c.actual} balls. Only runs from the first ${c.share} count. Check the scorebook.`,
        confirm: `Checked: 25 runs by the ${ordinal(c.share)} ball`,
      }
    : {
        warning: `⚠ Bowled ${c.actual} overs. Only wickets in the first ${c.share} count. Check the scorebook.`,
        confirm: `Checked: 3 wickets by the end of the ${ordinal(c.share)} over`,
      };
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run shared`
Expected: PASS (the new file and the existing merge/validation/labels/dates tests).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add shared/src/players.ts shared/src/milestone-rules.ts shared/src/types.ts shared/src/merge.ts shared/src/text.ts shared/test/milestone-rules.test.ts
git commit -m "feat(game-day): shared pairs-cricket milestone rules and check flags"
```

---

### Task 2: PlayHQ start data carries the rule and player figures

**Files:**
- Modify: `shared/src/types.ts` (`PlayhqStartData`)
- Modify: `shared/src/api.ts:33-37` (`GamePage.start` non-null)
- Modify: `api/src/playhq/types.ts` (`V2Summary.grade`)
- Modify: `api/src/playhq/summary.ts` (figures, over limit, rule, `unavailableStart`)
- Modify: `api/src/routes/games.ts` (always return `start`)
- Modify: `api/src/routes/reports.ts:74` (new `startData` signature)
- Modify: `api/test/fixtures/playhq.ts` (`summary()` options)
- Modify: `api/test/games.test.ts`, `api/test/reports.test.ts:24-30`, `shared/test/merge.test.ts:14-19`

**Interfaces:**
- Consumes: `ruleFor`, `CheckContext`, `PlayerFigures` from Task 1.
- Produces:
  - `PlayhqStartData` extends `CheckContext`: `{ available, result, candidates, rule, figures }`.
  - `startData(s: V2Summary, team: Team, labels: Map<string, string>, gameDate: string | null): PlayhqStartData`.
  - `unavailableStart(team: Team, gameDate: string | null): PlayhqStartData` (replaces the `UNAVAILABLE` constant).
  - `GET /api/teams/:slug/games/:gameId` returns `{ game, report: ReportOut | null, start: PlayhqStartData }`.
  - Test builder `summary()` gains `overLimit?: number`, `grade?: string`, `batting[].balls?: number` and `bowling[].overs?: number`.

- [ ] **Step 1: Extend the test fixture builder**

In `api/test/fixtures/playhq.ts`, replace `totals` and `summary` with:

```ts
const totals = (t?: Totals | null, overLimit?: number) =>
  t ? st([['TOTAL_SCORE', t.runs], ['TOTAL_OUTS', t.wkts], ...(overLimit !== undefined ? [['OVER_LIMIT', overLimit] as [string, number]] : [])]) : [];

export function summary(o: {
  id: string;
  status?: string;
  team?: Totals | null;
  opp?: Totals | null;
  batting?: { id: string; runs: number; balls?: number }[];
  bowling?: { id: string; wkts: number; overs?: number }[];
  appearances?: { id: string; firstName: string | null; lastName: string | null }[];
  overLimit?: number;
  grade?: string;
}): V2Summary {
  return {
    id: o.id,
    status: o.status ?? 'FINAL',
    grade: o.grade ? { id: 'grade-y6', name: o.grade } : undefined,
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
          { id: OPP, discipline: 'BATTING', statistics: totals(o.opp, o.overLimit), appearances: [] },
          {
            id: PUMAS,
            discipline: 'BOWLING',
            statistics: [],
            appearances: (o.bowling ?? []).map((b) => ({
              id: b.id,
              statistics: st([['WICKETS', b.wkts], ...(b.overs !== undefined ? [['OVERS', b.overs] as [string, number]] : [])]),
            })),
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
            statistics: totals(o.team, o.overLimit),
            appearances: (o.batting ?? []).map((b) => ({
              id: b.id,
              statistics: st([['TOTAL_RUNS', b.runs], ...(b.balls !== undefined ? [['BALLS_FACED', b.balls] as [string, number]] : [])]),
            })),
          },
          { id: OPP, discipline: 'BOWLING', statistics: [], appearances: [] },
        ],
      },
    ],
  };
}
```

In `api/src/playhq/types.ts`, add to `V2Summary` after `status`:

```ts
  grade?: { id: string; name: string } | null;
```

- [ ] **Step 2: Write the failing tests**

In `api/test/games.test.ts`:
- Change every `startData(x, team, labels)` call to `startData(x, team, labels, '2026-01-31')`.
- Change the import to `import { startData, unavailableStart } from '../src/playhq/summary';`.
- Add this `describe` block after the existing `describe('startData', …)`:

```ts
describe('startData — milestone rule and figures', () => {
  const pairs = summary({
    id: 'g4',
    team: { runs: 120, wkts: 0 },
    opp: { runs: 89, wkts: 0 },
    overLimit: 16,
    grade: 'Year 4 North - Section 2',
    batting: [{ id: 'ph-alex', runs: 26, balls: 16 }, { id: 'ph-fill', runs: 10, balls: 12 }],
    bowling: [{ id: 'ph-jordan', wkts: 3, overs: 3 }, { id: 'ph-sam', wkts: 0, overs: 2 }],
    appearances: [{ id: 'ph-fill', firstName: 'Kim', lastName: 'Walker' }],
  });

  it('picks the rule from the over limit and grade name', () => {
    expect(startData(pairs, team, labels, '2026-03-21').rule).toEqual({ kind: 'pairs', batBalls: 12, bowlOvers: 2 });
    expect(startData({ ...pairs, grade: null }, team, labels, '2026-03-21').rule).toEqual({ kind: 'pairs', batBalls: 12, bowlOvers: 2 });
    const twenty = summary({ id: 'g5', team: { runs: 1, wkts: 0 }, opp: { runs: 1, wkts: 0 }, overLimit: 20 });
    // No grade on the summary → squad gradeName "Year 6 Section 3 (Morning)"; after Christmas → open.
    expect(startData(twenty, team, labels, '2026-01-31').rule).toEqual({ kind: 'open' });
    expect(startData(twenty, team, labels, '2025-11-01').rule).toEqual({ kind: 'pairs', batBalls: 15, bowlOvers: 2 });
  });

  it('lists balls faced and overs bowled for this team, with labels only', () => {
    const s = startData(pairs, team, labels, '2026-03-21');
    expect(s.figures).toEqual(
      expect.arrayContaining([
        { player: { kind: 'squad', key: 'p001', label: 'Alex T.' }, ballsFaced: 16, overs: null },
        { player: { kind: 'playhq', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' }, ballsFaced: 12, overs: null },
        { player: { kind: 'squad', key: 'p004', label: 'Jordan L.' }, ballsFaced: null, overs: 3 },
        { player: { kind: 'squad', key: 'p002', label: 'Sam Th.' }, ballsFaced: null, overs: 2 },
      ]),
    );
    expect(s.figures).toHaveLength(4);
    expect(JSON.stringify(s)).not.toMatch(/Walker|Turner/);
  });

  it('uses the squad grade name when PlayHQ is unavailable', () => {
    const tigers = findTeam(parseSquad({ ...squadFixture, teams: [{ ...squadFixture.teams[1], gradeName: 'Year 3' }] }), 'tigers');
    expect(unavailableStart(tigers, '2026-01-31')).toEqual({
      available: false, result: null, candidates: [], figures: [], rule: { kind: 'pairs', batBalls: 12, bowlOvers: 2 },
    });
  });
});
```

Also in `games.test.ts`:
- Change the expectation in `'still opens the form when PlayHQ is down'` to:

```ts
    expect((await res.json<GamePage>()).start).toEqual({ available: false, result: null, candidates: [], figures: [], rule: { kind: 'open' } });
```

- Add to `describe('GET /api/teams/:slug/games/:gameId', …)`:

```ts
  it('returns start data alongside a saved report', async () => {
    const { put, form } = await import('./builders');
    const app = createApp(testDeps({ fetch: fakeFetch(routes()).fetch }));
    await put(app, 'g2', form({ scoring: 'yes' }));
    const body = await (await call(app, '/api/teams/pumas/games/g2')).json<GamePage>();
    expect(body.report?.version).toBe(1);
    expect(body.start.available).toBe(true);
    expect(body.start.rule).toEqual({ kind: 'open' });
  });
```

In `api/test/reports.test.ts`, test `'shows the saved report on the game endpoint'`, replace `expect(page.start).toBeNull();` with:

```ts
    expect(page.start.available).toBe(true);
```

In `shared/test/merge.test.ts`, change the `start` helper so the type includes the new fields:

```ts
const start = (over: Partial<PlayhqStartData> = {}): PlayhqStartData => ({
  available: true,
  result: { team: { runs: 145, wkts: 4 }, opp: { runs: 131, wkts: 4 } },
  candidates: [],
  rule: { kind: 'open' },
  figures: [],
  ...over,
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run api/test/games.test.ts api/test/reports.test.ts`
Expected: FAIL. `unavailableStart` isn't exported, `rule`/`figures` are undefined, and `start` is null for saved reports.

- [ ] **Step 4: Implement**

In `shared/src/types.ts`, replace the `PlayhqStartData` interface with:

```ts
export interface PlayhqStartData extends CheckContext {
  result: { team: { runs: number; wkts: number }; opp: { runs: number; wkts: number } } | null;
  candidates: MilestoneCandidate[];
}
```

(TypeScript interfaces are hoisted, so declaration order in the file does not matter.)

In `shared/src/api.ts`, change `GamePage.start` to `start: PlayhqStartData;`.

Replace `api/src/playhq/summary.ts` with:

```ts
import { otherLabel } from '../../../shared/src/labels';
import { ruleFor } from '../../../shared/src/milestone-rules';
import type { MilestoneCandidate, PlayerFigures, PlayerRefOut, PlayhqStartData } from '../../../shared/src/types';
import type { Team } from '../squad/load';
import type { Stat, V2Summary } from './types';

/** Start data when PlayHQ can't be reached: no figures, and the rule falls back to the squad grade name. */
export function unavailableStart(team: Team, gameDate: string | null): PlayhqStartData {
  return {
    available: false,
    result: null,
    candidates: [],
    figures: [],
    rule: ruleFor({ overLimit: null, gradeName: team.gradeName ?? null, gameDate }),
  };
}

const stat = (stats: Stat[], type: string) => stats.find((s) => s.type === type)?.value ?? null;
const keepMax = (map: Map<string, number>, id: string, value: number | null) => {
  if (value !== null) map.set(id, Math.max(map.get(id) ?? 0, value));
};

export function startData(s: V2Summary, team: Team, labels: Map<string, string>, gameDate: string | null): PlayhqStartData {
  const teamId = team.playhqTeamId;
  const oppId = s.teams.find((t) => t.id !== teamId)?.id;
  const totals = new Map<string, { runs: number; wkts: number }>();
  const bat = new Map<string, number>();
  const bowl = new Map<string, number>();
  const balls = new Map<string, number>();
  const overs = new Map<string, number>();
  let overLimit: number | null = null;

  for (const period of s.periods) {
    for (const t of period.teams) {
      if (t.discipline === 'BATTING') {
        const runs = stat(t.statistics, 'TOTAL_SCORE');
        const wkts = stat(t.statistics, 'TOTAL_OUTS');
        if (runs !== null && wkts !== null) totals.set(t.id, { runs, wkts });
        const limit = stat(t.statistics, 'OVER_LIMIT');
        if (limit !== null && limit > 0) overLimit = Math.max(overLimit ?? 0, limit);
      }
      if (t.id !== teamId) continue;
      for (const a of t.appearances) {
        if (t.discipline === 'BATTING') {
          keepMax(bat, a.id, stat(a.statistics, 'TOTAL_RUNS'));
          keepMax(balls, a.id, stat(a.statistics, 'BALLS_FACED'));
        } else {
          keepMax(bowl, a.id, stat(a.statistics, 'WICKETS'));
          keepMax(overs, a.id, stat(a.statistics, 'OVERS'));
        }
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
  const figures: PlayerFigures[] = [...new Set([...balls.keys(), ...overs.keys()])].map((id) => ({
    player: ref(id),
    ballsFaced: balls.get(id) ?? null,
    overs: overs.get(id) ?? null,
  }));
  const rule = ruleFor({ overLimit, gradeName: s.grade?.name ?? team.gradeName ?? null, gameDate });
  return { available: true, result, candidates, rule, figures };
}
```

This keeps the existing candidate behaviour: for each appearance, the max per id of `TOTAL_RUNS` and of `WICKETS` when present.

Replace the body of `registerGames` in `api/src/routes/games.ts` with:

```ts
export function registerGames(app: Hono<AppEnv>) {
  const startFor = (ctx: GameContext, s: V2Summary | null) =>
    s ? startData(s, ctx.team, ctx.labels, ctx.game.date) : unavailableStart(ctx.team, ctx.game.date);

  app.get('/teams/:slug/games/:gameId', async (c) => {
    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    const saved = await getReport(c.env.DB, ctx.squad.season.playhqSeasonId, ctx.team.slug, ctx.game.gameId);
    const start = startFor(ctx, await ctx.summary());
    return c.json<GamePage>({ game: ctx.game, report: saved ? toReportOut(saved, ctx.labels) : null, start });
  });

  app.post('/teams/:slug/games/:gameId/refresh', async (c) => {
    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    const allowed = await c.get('deps').limit(c.env, 'REFRESH_LIMIT', ctx.game.gameId);
    if (!allowed) return c.json<RefreshResult>({ start: startFor(ctx, await ctx.summary()), rateLimited: true });
    let s;
    try {
      s = (await ctx.summary(true))!;
    } catch {
      throw new ApiError(503, 'playhq_unavailable', "Couldn't reach PlayHQ — try again later.");
    }
    return c.json<RefreshResult>({ start: startFor(ctx, s) });
  });
}
```

Update the imports in `games.ts`:

```ts
import { startData, unavailableStart } from '../playhq/summary';
import type { V2Summary } from '../playhq/types';
import { loadGameContext, type GameContext } from './context';
```

In `api/src/routes/reports.ts` line 74, change the call to `startData(summary, ctx.team, ctx.labels, ctx.game.date).result`. Task 4 replaces this line again.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test`
Expected: PASS (all shared and api tests).

Run: `npm run typecheck`
Expected: PASS. `web/src/lib/game/GameView.svelte`'s `page.start!` is still valid.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts shared/src/api.ts api/src/playhq/types.ts api/src/playhq/summary.ts api/src/routes/games.ts api/src/routes/reports.ts api/test shared/test/merge.test.ts
git commit -m "feat(game-day): PlayHQ start data carries milestone rule and player figures"
```

---

### Task 3: Prefill and refresh apply check flags

**Files:**
- Modify: `shared/src/merge.ts` (`startForm`, `merge`)
- Modify: `shared/test/merge.test.ts`

**Interfaces:**
- Consumes: `withChecks` and `needsCheck` from Task 1. `PlayhqStartData` with `rule`/`figures` from Task 2.
- Produces: `startForm` rows carry `check`. `merge(...).changes` ends with `"N milestone(s) need(s) checking"` when any unticked flags remain.

- [ ] **Step 1: Write the failing tests**

In `shared/test/merge.test.ts`:
- Add `check: null` to the default row in the `row` helper (after `touched: false`).
- In the `'adds a PlayHQ row per milestone candidate'` expectation, add `check: null` to both expected rows.
- Append:

```ts
describe('check flags', () => {
  const pairs = { kind: 'pairs' as const, batBalls: 12, bowlOvers: 2 };
  const flaggedStart = start({
    rule: pairs,
    candidates: [{ type: 'bowl', player: jordan, value: 3 }],
    figures: [{ player: jordan, ballsFaced: null, overs: 3 }],
  });

  it('prefills an over-share milestone with an unticked flag', () => {
    expect(startForm(flaggedStart, ids()).milestones[0].check).toEqual({ actual: 3, share: 2, checked: false });
  });

  it('flags rows the coach added, and says how many need checking after a refresh', () => {
    const cur = { ...emptyForm(), scoring: 'yes' as const, milestones: [row({ rowId: 'a', type: 'bowl', player: jordan, value: 4, source: 'entered', playhqValue: null, touched: true })] };
    const { next, changes } = merge(cur, flaggedStart, ids());
    expect(next.milestones).toHaveLength(1);
    expect(next.milestones[0].check).toEqual({ actual: 3, share: 2, checked: false });
    expect(changes.at(-1)).toBe('1 milestone needs checking');
  });

  it('keeps a tick across a refresh when the figure is unchanged', () => {
    const cur = startForm(flaggedStart, ids());
    cur.milestones[0].check!.checked = true;
    const { next, changes } = merge(cur, flaggedStart, ids());
    expect(next.milestones[0].check?.checked).toBe(true);
    expect(changes).toEqual(['No changes from PlayHQ']);
  });

  it('pluralises the checking note', () => {
    const two = start({
      rule: pairs,
      candidates: [{ type: 'bowl', player: jordan, value: 3 }, { type: 'bat', player: alex, value: 30 }],
      figures: [{ player: jordan, ballsFaced: null, overs: 3 }, { player: alex, ballsFaced: 14, overs: null }],
    });
    expect(merge({ ...emptyForm(), scoring: 'yes' }, two, ids()).changes.at(-1)).toBe('2 milestones need checking');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/test/merge.test.ts`
Expected: FAIL. Rows lack `check`, and there is no checking note.

- [ ] **Step 3: Implement**

In `shared/src/merge.ts`:
- Add `import { needsCheck, withChecks } from './milestone-rules';`.
- Change `candidateRow` to return `check: null` as the last property:

```ts
function candidateRow(c: MilestoneCandidate, rowId: string): MilestoneRow {
  return { rowId, type: c.type, player: clone(c.player), value: c.value, source: 'playhq', playhqValue: c.value, touched: false, check: null };
}
```

- In `startForm`, replace the milestones line with:

```ts
  f.milestones = withChecks(start.candidates.map((c) => candidateRow(c, newRowId())), start);
```

- In `merge`, replace `next.milestones = kept;` with `next.milestones = withChecks(kept, fresh);`.
- Replace the final `return` with:

```ts
  const result = changes.length ? changes : ['No changes from PlayHQ'];
  const n = needsCheck(next.milestones);
  if (n) result.push(`${n} milestone${n > 1 ? 's need' : ' needs'} checking`);
  return { next, changes: result };
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/merge.ts shared/test/merge.test.ts
git commit -m "feat(game-day): prefill and refresh apply milestone check flags"
```

---

### Task 4: Store check flags and recompute them on save

**Files:**
- Create: `migrations/0002_milestone_checks.sql`
- Modify: `api/src/reports/repo.ts` (`StoredMilestone`, load and save)
- Modify: `api/src/reports/serialize.ts` (row `check`)
- Modify: `api/src/routes/reports.ts` (recompute with `withChecks`)
- Modify: `api/test/reports.test.ts`

**Interfaces:**
- Consumes: `withChecks` (Task 1), `startData(…, gameDate)` (Task 2).
- Produces: `StoredMilestone.check: MilestoneCheck | null`. `ReportOut.milestones[].check` is always present (`null` when there is no flag). Later tasks rely on `StoredMilestone.check`.

- [ ] **Step 1: Write the failing tests**

Append to `api/test/reports.test.ts`:

```ts
describe('milestone check flags', () => {
  beforeEach(() => seedSquad());

  const pairsG2 = (over: Record<string, unknown> = {}) =>
    pumasRoutes({
      '/v2/games/g2/summary': {
        data: summary({
          id: 'g2',
          team: { runs: 120, wkts: 0 },
          opp: { runs: 89, wkts: 0 },
          overLimit: 16,
          bowling: [{ id: 'ph-jordan', wkts: 3, overs: 3 }, { id: 'ph-sam', wkts: 3, overs: 2 }],
        }),
      },
      ...over,
    });
  const bowlRow = (key: string, check?: unknown) => ({
    rowId: key, type: 'bowl', player: { kind: 'squad', key }, value: 3, source: 'playhq', playhqValue: 3, touched: false, ...(check === undefined ? {} : { check }),
  });
  const save = async (routes: ReturnType<typeof pumasRoutes>, milestones: unknown[]) =>
    (await put(createApp(testDeps({ fetch: routes.fetch })), 'g2', form({ scoring: 'yes', milestones: milestones as never }))).json<ReportOut>();

  it('flags an over-share bowler from PlayHQ even when the client sent no flag', async () => {
    const body = await save(pairsG2(), [bowlRow('p004'), bowlRow('p002')]);
    expect(body.milestones.map((m) => m.check)).toEqual([{ actual: 3, share: 2, checked: false }, null]);
  });

  it('keeps the tick when it matches the PlayHQ figure', async () => {
    const ok = await save(pairsG2(), [bowlRow('p004', { actual: 3, share: 2, checked: true })]);
    expect(ok.milestones[0].check).toEqual({ actual: 3, share: 2, checked: true });
  });

  it('drops a tick made against a different figure', async () => {
    const stale = await save(pairsG2(), [bowlRow('p004', { actual: 2.4, share: 2, checked: true })]);
    expect(stale.milestones[0].check).toEqual({ actual: 3, share: 2, checked: false });
  });

  it("clears a flag PlayHQ doesn't support", async () => {
    const body = await save(pairsG2(), [bowlRow('p002', { actual: 9, share: 2, checked: false })]);
    expect(body.milestones[0].check).toBeNull();
  });

  it("stores the client's flag as sent when PlayHQ can't be reached", async () => {
    const body = await save(pairsG2({ '/v2/games/g2/summary': fail }), [bowlRow('p004', { actual: 3, share: 2, checked: true })]);
    expect(body.milestones[0].check).toEqual({ actual: 3, share: 2, checked: true });
  });

  it('round-trips the flag through D1', async () => {
    await save(pairsG2(), [bowlRow('p004')]);
    const row = await env.DB.prepare('SELECT check_actual, check_share, checked FROM milestones').first();
    expect(row).toEqual({ check_actual: 3, check_share: 2, checked: 0 });
  });
});
```

Update the imports at the top of `reports.test.ts`:

```ts
import { fail, summary } from './fixtures/playhq';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run api/test/reports.test.ts`
Expected: FAIL. There are no `check_*` columns, and the response has no `check`.

- [ ] **Step 3: Implement**

Create `migrations/0002_milestone_checks.sql`:

```sql
-- Pairs-cricket check flags (functional spec §6.3.3). NULL check_actual = no flag.
ALTER TABLE milestones ADD COLUMN check_actual REAL;
ALTER TABLE milestones ADD COLUMN check_share INTEGER;
ALTER TABLE milestones ADD COLUMN checked INTEGER NOT NULL DEFAULT 0;
```

In `api/src/reports/repo.ts`:
- Import `MilestoneCheck` alongside the existing type imports from `../../../shared/src/types`.
- Add `check: MilestoneCheck | null;` to `StoredMilestone`.
- In `loadReports`, add to the milestone mapping:

```ts
        check: m.check_actual === null || m.check_actual === undefined
          ? null
          : { actual: m.check_actual as number, share: m.check_share as number, checked: m.checked === 1 },
```

- In `saveReport`, replace the milestone insert with:

```ts
  s.milestones.forEach((m, i) =>
    stmts.push(
      db.prepare(
        `INSERT INTO milestones (id, report_id, type, player_key, named_id, value, source, playhq_value, touched, position,
           check_actual, check_share, checked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        m.id, s.reportId, m.type, m.playerKey, m.namedId, m.value, m.source, m.playhqValue, m.touched ? 1 : 0, i,
        m.check?.actual ?? null, m.check?.share ?? null, m.check?.checked ? 1 : 0,
      ),
    ),
  );
```

In `api/src/reports/serialize.ts`, add `check: m.check,` after `touched: m.touched,` in the milestone mapping.

In `api/src/routes/reports.ts`:
- Add `import { withChecks } from '../../../shared/src/milestone-rules';`.
- Replace the `summary`/`milestones` section so the start data is computed once and checks are recomputed before storing:

```ts
    const played = body.scoring !== 'not_played';
    const summary = played ? await ctx.summary() : null;
    const start = summary ? startData(summary, ctx.team, ctx.labels, ctx.game.date) : null;
    const r = makeResolver({ team: ctx.team, existing, summary, newId: deps.id });

    const potd = played ? r.resolve('potd', body.potd) : { key: null, namedId: null };
    const mascot = played ? r.resolve('mascot', body.mascot) : { key: null, namedId: null };
    // Recompute flags from PlayHQ when we have it; otherwise keep what the client sent (spec §6.3.3).
    const rows = start ? withChecks(body.milestones, start) : body.milestones;
    const milestones: StoredMilestone[] = played
      ? rows.map((m, i) => {
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
            check: m.type === 'hattrick' ? null : (m.check ?? null),
          };
        })
      : [];
```

- Replace the later `const result = summary ? startData(...).result : null;` line with `const result = start?.result ?? null;`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. The test pool applies migrations from `./migrations` automatically.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/0002_milestone_checks.sql api/src/reports api/src/routes/reports.ts api/test/reports.test.ts
git commit -m "feat(game-day): store milestone check flags and recompute them on save"
```

---

### Task 5: All-games list, follow-up filter and CSV show unchecked flags

**Files:**
- Modify: `shared/src/api.ts` (`GameRow.uncheckedCount`)
- Modify: `api/src/list/rows.ts` (`makeRow`, `applyFilters`)
- Modify: `api/src/routes/list.ts` (JSON row, `milestonesCsv` Check column)
- Modify: `web/src/routes/games/+page.svelte:89`
- Modify: `api/test/list.test.ts`

**Interfaces:**
- Consumes: `StoredMilestone.check` (Task 4).
- Produces:
  - `GameRow.uncheckedCount: number`.
  - `followUp=1` also matches `uncheckedCount > 0`.
  - `milestones.csv` gets a `Check` column after `Source` (blank / `Needs check` / `Checked`). Admin full name stays last.

- [ ] **Step 1: Write the failing tests**

Append to `api/test/list.test.ts`:

```ts
describe('unchecked milestone flags', () => {
  beforeEach(() => seedSquad());

  async function flagged() {
    const routes = pumasRoutes({
      '/v2/games/g2/summary': {
        data: summary({ id: 'g2', team: { runs: 120, wkts: 0 }, opp: { runs: 89, wkts: 0 }, overLimit: 16, bowling: [{ id: 'ph-jordan', wkts: 3, overs: 3 }] }),
      },
    });
    const app = createApp(testDeps({ fetch: routes.fetch }));
    await put(app, 'g2', form({
      scoring: 'yes',
      milestones: [{ rowId: 'x', type: 'bowl', player: { kind: 'squad', key: 'p004' }, value: 3, source: 'playhq', playhqValue: 3, touched: false }],
    }));
    return app;
  }

  it('counts unchecked flags and includes them in follow-up', async () => {
    const app = await flagged();
    const body = await (await call(app, '/api/games')).json<GamesList>();
    expect(body.rows.find((r) => r.gameId === 'g2')).toMatchObject({ milestoneCount: 1, uncheckedCount: 1 });
    const followUp = await (await call(app, '/api/games?followUp=1')).json<GamesList>();
    expect(followUp.rows.map((r) => r.gameId)).toEqual(['g2']);
  });

  it('adds a Check column to milestones.csv', async () => {
    const app = await flagged();
    const csv = await (await call(app, '/api/export/milestones.csv')).text();
    expect(csv).toContain('Type,Runs or wickets,Source,Check');
    expect(csv).toContain('Jordan L.,p004,N,Bowling,3,PlayHQ,Needs check');
  });
});
```

Update the imports at the top of `list.test.ts`:

```ts
import { summary } from './fixtures/playhq';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run api/test/list.test.ts`
Expected: FAIL. `uncheckedCount` is undefined, and there is no Check column.

- [ ] **Step 3: Implement**

In `shared/src/api.ts`, add `uncheckedCount: number;` after `milestoneCount` in `GameRow`.

In `api/src/list/rows.ts`, `makeRow`, add after `milestoneCount`:

```ts
    uncheckedCount: r?.milestones.filter((m) => m.check && !m.check.checked).length ?? 0,
```

and change the follow-up clause in `applyFilters` to:

```ts
      (!followUp || r.scoring === 'no' || r.scoring === 'yes_issues' || r.uncheckedCount > 0),
```

In `api/src/routes/list.ts`:
- In the `GET /games` row mapping, add `uncheckedCount: row.uncheckedCount,` after `milestoneCount: row.milestoneCount,`.
- In `milestonesCsv`, make the header `[..., 'Runs or wickets', 'Source', 'Check', ...(admin ? ['Full name'] : [])]`.
- Make the row `[..., m.source === 'playhq' ? 'PlayHQ' : 'Entered', m.check ? (m.check.checked ? 'Checked' : 'Needs check') : '', ...(admin ? [p.fullName] : [])]`.

In `web/src/routes/games/+page.svelte` line 89, replace the cell with:

```svelte
            <td>{r.milestoneCount || ''}{r.uncheckedCount ? ` (${r.uncheckedCount} to check)` : ''}</td>
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. The existing `'Jordan L.,p004,N,Hat-trick'` assertion still matches.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/api.ts api/src/list/rows.ts api/src/routes/list.ts web/src/routes/games/+page.svelte api/test/list.test.ts
git commit -m "feat(game-day): list, follow-up filter and CSV show unchecked milestone flags"
```

---

### Task 6: Form explainers, flag warnings and the Checked tick

**Files:**
- Modify: `web/src/lib/form/game-form.svelte.ts` (hold `start`)
- Modify: `web/src/lib/game/GameView.svelte` (set `form.start`)
- Modify: `web/src/lib/form/ReportForm.svelte` (re-check effect, explainer, rule lines, refresh updates `start`)
- Modify: `web/src/lib/form/MilestoneList.svelte` (`hint` prop, flag UI)
- Modify: `web/src/lib/report/ReportSummary.svelte` (Not checked / Checked badges)
- Modify: `web/src/lib/styles/app.css` (`.flag`, `.badge-check`, `.explainer`)

**Interfaces:**
- Consumes: `withChecks` (Task 1), `milestoneRuleText` and `checkText` (Task 1), `GamePage.start` (Task 2), row `check` (Tasks 1–4).
- Produces: UI only.

There are no unit tests for Svelte components in this project; Task 7 covers this task end to end. Verify with `npm run typecheck` and a manual check in `npm run dev`.

- [ ] **Step 1: `GameForm` holds the start data**

In `web/src/lib/form/game-form.svelte.ts`:

```ts
import { emptyForm, type FieldErrors, type FormState, type PlayhqStartData } from '$shared/types';

export class GameForm {
  state = $state<FormState>(emptyForm());
  errors = $state<FieldErrors>({});
  baseVersion = $state(0);
  /** PlayHQ start data for this game: milestone rule and player figures for check flags. */
  start = $state<PlayhqStartData | null>(null);
  initialJson = '';
```

(the rest is unchanged).

- [ ] **Step 2: `GameView` sets it**

In `web/src/lib/game/GameView.svelte` `onMount`, set the start data before branching:

```ts
      const page = await api().game(team.team.slug, gameId);
      form.start = page.start;
      if (page.report) {
        report = page.report;
        mode = 'readonly';
      } else {
        form.reset(startForm(page.start), 0);
        offerDraft();
        mode = 'form';
      }
```

- [ ] **Step 3: `ReportForm` re-checks, explains, and updates on refresh**

In `web/src/lib/form/ReportForm.svelte` `<script>`:
- Add the imports:

```ts
  import { withChecks } from '$shared/milestone-rules';
  import { milestoneRuleText } from '$shared/text';
  import type { MilestoneRow } from '$shared/types';
```

- Add, after `refreshMsg`:

```ts
  const rule = $derived(form.start?.rule ?? { kind: 'open' as const });
  const ruleText = $derived(milestoneRuleText(rule));

  // Keep check flags in step with the rows (added rows, player changes, resumed drafts). Writes only on change.
  $effect(() => {
    const start = form.start;
    if (!start) return;
    const cur = $state.snapshot(form.state.milestones) as MilestoneRow[];
    const next = withChecks(cur, start);
    if (JSON.stringify(next) !== JSON.stringify(cur)) form.state.milestones = next;
  });
```

- In `refresh()`, assign the new start data in both branches:

```ts
      const r = await api().refresh(team.team.slug, gameId);
      form.start = r.start;
      if (r.rateLimited) {
```

Replace the milestones `<fieldset>` with:

```svelte
    <fieldset class="card" id="sec-milestones">
      <legend>Milestones</legend>
      {#if rule.kind === 'pairs'}
        <details class="explainer">
          <summary>How are these worked out?</summary>
          <p>
            In pairs cricket, milestones only count a player's fair share: their <strong>first {rule.batBalls} balls</strong>
            batting and <strong>first {rule.bowlOvers} overs</strong> bowling. We fill these in from PlayHQ where we can.
            PlayHQ shows totals, not ball-by-ball, so when a player batted or bowled more than their share we can't tell
            whether the milestone came inside it. Those are marked ⚠ for you to check against the scorebook. Please don't
            remove a milestone we've filled in unless the scorebook shows it's wrong.
          </p>
        </details>
      {/if}
      <MilestoneList {form} type="bat" squad={team.squad} title="Batting milestone" hint={ruleText.bat} valueLabel="Runs (25 or more)" />
      <MilestoneList {form} type="bowl" squad={team.squad} title="Bowling milestone" hint={ruleText.bowl} valueLabel="Wickets (3+)" maxDigits={2} />
      <MilestoneList {form} type="hattrick" squad={team.squad} title="Hat-trick" hint={ruleText.hattrick} />
      {@render refreshButton()}
    </fieldset>
```

- [ ] **Step 4: `MilestoneList` shows the rule line and flags**

In `web/src/lib/form/MilestoneList.svelte`:
- Add `import { checkText } from '$shared/text';`.
- Add a `hint = ''` prop (typed `hint?: string`).
- Give the `add()` row `check: null` (after `touched: true`).
- Render the hint under the heading:

```svelte
<h3>{title}</h3>
{#if hint}<p class="note">{hint}</p>{/if}
```

Inside the row `<div class="milestone">`, after the value input and before the Remove button:

```svelte
      {#if row.check}
        {@const t = checkText(row.type, row.check)}
        <p class="flag">{t.warning}</p>
        <label class="choice"><input type="checkbox" bind:checked={row.check.checked} /> {t.confirm}</label>
      {/if}
```

- [ ] **Step 5: `ReportSummary` shows the flag state**

In `web/src/lib/report/ReportSummary.svelte`, replace the milestone `<li>` with:

```svelte
          <li>
            {MILESTONE_TEXT[m.type]}: {who(m.player)}{m.value !== null ? ` — ${m.value} ${m.type === 'bat' ? 'runs' : 'wickets'}` : ''}
            {#if m.check}<span class="badge badge-check">{m.check.checked ? 'Checked ✓' : '⚠ Not checked'}</span>{/if}
          </li>
```

- [ ] **Step 6: Styles**

Append to `web/src/lib/styles/app.css`:

```css
.flag { background: #fff4d6; color: var(--pcc-navy-900); padding: 4px 8px; border-radius: var(--radius); margin: 6px 0; }
.badge-check { background: #fff4d6; color: var(--pcc-navy-900); margin-left: 6px; }
.explainer { margin: 4px 0 12px; }
.explainer summary { cursor: pointer; font-weight: 600; }
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck`
Expected: PASS (tsc plus `svelte-check`, no new errors or warnings).

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "feat(game-day): milestone explainers, check warnings and Checked tick in the form"
```

---

### Task 7: End-to-end coverage

**Files:**
- Modify: `scripts/playhq-stub.mjs` (e2e-g2 becomes a 16-over pairs game with figures)
- Modify: `web/tests/e2e/game-day.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Make the stub's e2e-g2 a pairs game**

In `scripts/playhq-stub.mjs`, in the `withStats` periods:
- Add `['OVER_LIMIT', 16]` to both BATTING `statistics` arrays: `st([['TOTAL_SCORE', 128], ['TOTAL_OUTS', 4], ['OVER_LIMIT', 16]])` and `st([['TOTAL_SCORE', 145], ['TOTAL_OUTS', 4], ['OVER_LIMIT', 16]])`.
- Change ph-jordan's bowling stats to `st([['WICKETS', 3], ['OVERS', 3]])`.
- Change ph-alex's batting stats to `st([['TOTAL_RUNS', 31], ['BALLS_FACED', 12]])`.

- [ ] **Step 2: Write the e2e test**

Add to `web/tests/e2e/game-day.spec.ts`, after the `'a PlayHQ-scored game is prefilled'` test:

```ts
test('pairs games explain the limits and flag over-share milestones', async ({ page }) => {
  await page.goto('/pumas?game=e2e-g2');
  await expect(page.getByText('How are these worked out?')).toBeVisible();
  await expect(page.getByText("25 or more runs from the batter's first 12 balls.")).toBeVisible();
  await expect(page.getByText('⚠ Bowled 3 overs. Only wickets in the first 2 count. Check the scorebook.')).toBeVisible();
  await expect(page.getByText(/Faced \d+ balls/)).toHaveCount(0); // Alex faced exactly 12
  const tick = page.getByLabel('Checked: 3 wickets by the end of the 2nd over');
  await tick.check();
  await expect(tick).toBeChecked();
});
```

Do not submit e2e-g2. The `'all games'` test expects it to stay Missing.

- [ ] **Step 3: Run the e2e suite**

Run: `npm run e2e`
Expected: PASS (all 7 tests). Playwright starts the stub and `wrangler dev`; `e2e:prepare` applies both migrations locally.

- [ ] **Step 4: Run the full checks**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/playhq-stub.mjs web/tests/e2e/game-day.spec.ts
git commit -m "test(game-day): e2e coverage for pairs milestone flags"
```

---

## After the plan (not part of the tasks)

Deploying needs the user's go-ahead:
- **Production:** `npm run deploy` applies migration 0002 remotely.
- **Demo:** `npx wrangler d1 migrations apply pcc-game-day-demo --remote --env demo && npm run build && npx wrangler deploy --env demo`. Check Rhinos R12 v OBC 34: Frederick R. should get a bowling flag and Kaiser M. a batting flag.
