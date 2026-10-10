# Editable Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen: Native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move categories, items and Kit Spec quantities from the bundled `gear-data.json` into D1, and add an admin Items page to edit them (categories, items incl. retire, Kit Spec columns and quantities).

**Architecture:** Migration `0004_catalogue.sql` creates `categories`, `items`, `kit_specs`, `kit_spec_items` seeded from `gear-data.json`. A server module `api/src/catalogue.ts` loads the catalogue per request (one D1 batch) and replaces every use of `shared/src/data` catalogue helpers. Phones get the catalogue from `GET /api/catalogue`. Admin catalogue routes live in `api/src/admin-catalogue.ts`; the UI is a new route `/admin/items`.

**Tech Stack:** as before (Workers + Hono + D1, SvelteKit 5, Vitest pool-workers, Playwright).

**Spec:** `docs/spec.md` (§2 Catalogue, §3.3, §3.7, §4.4, §5, §6). Read it first.

## Global Constraints
- Working dir `automations/src/gear-counter`. Item ids unchanged; new ids `X-` + 6 uppercase hex (matches `/^[A-Z0-9-]{1,20}$/`).
- Names 1–60 chars trimmed, unique ignoring case: categories and kit specs globally, items within their category. Kit Spec qty integer 0–99 (0 = remove row).
- Always listed (`pinned`): team → item in its Kit Spec with qty > 0 and not retired; pool → item not retired.
- Unlist allowed only at level 0 and when not pinned. Retired items can't be added (409); they can still be moved/adjusted where listed.
- Catalogue order: `categories.sort`, then `items.sort`. Sorts are spaced by 10 on insert; moves swap with the neighbour.
- Catalogue edits are not written to the gear log. Admin routes keep passcode + `ADMIN_LIMIT` + `no-store`.
- `gear-data.json`, `import_gear.py`, `levels_migration.py` are deleted; a copy of `gear-data.json` lives at `api/test/fixtures/gear-data-2026-10.json` for the seed test. `shared/src/data.ts` keeps only `DOT_COLOURS` and `MASCOTS`.

## Review Focus
1. Retiring or dropping from a Kit Spec an item a team holds — it must stay listed (unpinned) until 0, then be removable; nothing disappears.
2. Renaming a Kit Spec column — every team using it must follow; deleting one used by a team must be refused.
3. Moving an item to another category — it must land last there and keep catalogue order valid; move up/down at the ends is a no-op, not an error.
4. Name clashes differing only by case or surrounding spaces — must be refused across all three kinds.
5. Kit Spec save with unknown or retired item ids or out-of-range quantities — must be refused as a whole (no partial save).

---

### Task 1: Catalogue migration 0004 and its seed test
**Files:** Create `scripts/catalogue_migration.py`, `migrations/0004_catalogue.sql` (generated), `api/test/fixtures/gear-data-2026-10.json` (copy), `api/test/catalogue-migration.test.ts`.

SQL created by the script:
```sql
CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER NOT NULL);
CREATE UNIQUE INDEX categories_name ON categories (name COLLATE NOCASE);
CREATE TABLE items (
  id TEXT PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id), name TEXT NOT NULL,
  sort INTEGER NOT NULL, retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1)), created_at TEXT NOT NULL);
CREATE UNIQUE INDEX items_name ON items (name COLLATE NOCASE);
CREATE TABLE kit_specs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER NOT NULL);
CREATE UNIQUE INDEX kit_specs_name ON kit_specs (name COLLATE NOCASE);
CREATE TABLE kit_spec_items (
  spec_id INTEGER NOT NULL REFERENCES kit_specs(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99), PRIMARY KEY (spec_id, item_id));
-- seed: categories in gear-data order (sort 10, 20…), items in catalogue order (sort 10, 20… within category),
-- kit_specs in gear-data order, kit_spec_items from specs.
```
- [ ] Test (`catalogue-migration.test.ts`): reading the test `DB` (all migrations applied), categories in order equal the fixture's `categories`; items in catalogue order equal the fixture's `items` (`id`, `name`, `category`), none retired; kit spec names equal the fixture's spec keys in order; for every column the `{item: qty}` map equals the fixture's. Run → FAIL (no tables).
- [ ] Write script + generate migration. Run → PASS. Commit.

### Task 2: Server catalogue module, public `/catalogue`, pinned/retired levels
**Files:** Create `api/src/catalogue.ts`; modify `api/src/levels.ts`, `api/src/teams.ts`, `api/src/exports.ts`, `api/src/app.ts`, `shared/src/types.ts`, `shared/src/data.ts`; delete `shared/src/gear-data.json`, `scripts/import_gear.py`, `scripts/levels_migration.py`, `shared/test/data.test.ts` (catalogue parts); update `shared/test/levels.test.ts` (drop `kitSpecQty`), `api/test/levels.test.ts`, `api/test/migration.test.ts` (literal counts 14 / 27 / 62).

**Interfaces (produces):**
```ts
// shared/src/types.ts
export interface Category { id: number; name: string }
export interface CatalogueItem { id: string; name: string; categoryId: number; category: string; retired: boolean }
export interface Catalogue { categories: Category[]; items: CatalogueItem[]; specs: string[] }
// LevelLine gains: retired: boolean; pinned: boolean

// api/src/catalogue.ts
export interface Cat {
  categories: Category[]; items: CatalogueItem[] /* catalogue order, retired included */; specNames: string[];
  item(id: string): CatalogueItem | undefined; sortOf(id: string): number;
  qty(spec: string | null, itemId: string): number;
  pinnedIds(team: { kind: TeamKind; spec: string | null }): string[]; // not retired; spec qty>0 or every item for a pool
  isPinned(team, itemId): boolean;
}
export async function loadCatalogue(db: D1Database): Promise<Cat>;
export const publicCatalogue = (c: Cat): Catalogue => …; // items not retired
```
- [ ] Tests first (add to `api/test/levels.test.ts`): `GET /catalogue` returns 11 categories, 62 items, specs incl. 'Year 5'; a retired item (set via SQL) can't be added (409), stays listed with `retired: true, pinned: false` where held, disappears from a pool at level 0 on the next page load only after unlisting (pool shows ✕ for it), and is removable at 0; an item whose Kit Spec qty is set to 0 (SQL) stays listed unpinned where held and can be unlisted at 0; a new item inserted by SQL appears in a pool on its next page load at 0; levels lines carry `pinned`. Run → FAIL.
- [ ] Implement; replace every `findItem`/`specLines`/`kitSpecQty`/`items`/`specColumns` use. `ensureListed` uses `cat.pinnedIds(team)`; `listItem` 409 `item_retired` for retired; `unlistItem` uses `!cat.isPinned`; `teamLevels` sorts by `cat.sortOf`, sets `retired`, `pinned`; club CSV rows = non-retired items + retired items held anywhere (name suffixed " (retired)"); `parseNewTeam` checks `cat.specNames`; `addTeam` lists `cat.pinnedIds`. Run all API tests → PASS. Commit.

### Task 3: Admin catalogue API
**Files:** Create `api/src/admin-catalogue.ts` (registered from `admin.ts`), `api/test/admin-catalogue.test.ts`; types `AdminCatalogue`.
```ts
export interface AdminCatalogue {
  categories: (Category & { items: number })[];
  items: (CatalogueItem & { holders: number; total: number })[]; // catalogue order, retired included
  specs: { id: number; name: string; teams: number; qty: Record<string, number> }[];
}
```
Routes per spec §5. Errors: 400 `invalid_name` / `invalid_qty` / `invalid_body`, 404 not found, 409 `name_taken` / `not_empty` / `in_use` / `item_retired`.
- [ ] Tests first: add/rename/delete category (delete 409 when it has items; name clash case-insensitive incl. trimmed); category move up/down swaps order, no-op at the ends; add item (lands last in category, id `X-…`), rename, move to another category (lands last), move up/down within category, retire/unretire (holders/total shown); add/rename/delete kit spec (rename updates `teams.spec`; delete 409 when a team uses it); PUT quantities replaces the column, 0 removes rows, rejects unknown/retired ids, qty 100/−1/1.5 and non-objects with no partial save; all routes 401 without the passcode. Run → FAIL.
- [ ] Implement with D1 batches (moves = two UPDATEs; column save = DELETE + INSERTs in one batch after validation). Run → PASS. Commit.

### Task 4: Web — catalogue client, team page, admin Items page
**Files:** `web/src/lib/api.ts` (`catalogue()`), `web/src/routes/[team]/+page.ts` (load catalogue), `web/src/lib/AddItem.svelte` (props `catalogue`, `have`), `web/src/routes/[team]/+page.svelte` (✕ when `!pinned`, "Retired" tag, sort new lines by catalogue order), `web/src/routes/admin/+page.svelte` (Kit Spec select from `/admin/catalogue` specs; link "Edit items"), new `web/src/lib/adminApi.ts` (shared passcode fetch), new `web/src/routes/admin/items/+page.svelte`.
- [ ] Implement; `npm run typecheck` clean. Commit.

### Task 5: End-to-end
- [ ] Add a Playwright test: admin → Edit items → add category "Training", add item "Rebound net" in it, Kit Spec "Year 3": set it to 1 and save → `/tigers` lists "Rebound net" at 0 → + once → admin retire it → `/tigers` still lists it tagged "Retired" with level 1 → − to 0 → ✕ removes it → club CSV has no "Rebound net" row. Existing tests updated for the API changes. Run `npm test`, `npm run e2e` → all pass. Commit.

### Task 6: Release (gated on the user's go-ahead)
- [ ] Backup to Downloads; rehearse 0004 locally on the backup (catalogue counts 11/62/17; every `levels.item_id` exists in `items`); `npm run deploy`; verify `/api/catalogue` and a team page; push.
