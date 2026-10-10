import type { Catalogue, CatalogueItem, Category, TeamKind } from '../../shared/src/types';

type TeamLike = { kind: TeamKind; spec: string | null };

/** The catalogue as loaded for one request (spec §2): categories, items in order, Kit Spec quantities. */
export interface Cat {
  categories: Category[];
  /** Catalogue order (category sort, then item sort); retired included. */
  items: CatalogueItem[];
  specNames: string[];
  item(id: string): CatalogueItem | undefined;
  /** Position in catalogue order (unknown ids sort last). */
  sortOf(id: string): number;
  qty(spec: string | null, itemId: string): number;
  /** Items always listed for a team (its Kit Spec, not retired) or a pool (everything not retired). */
  pinnedIds(team: TeamLike): string[];
  isPinned(team: TeamLike, itemId: string): boolean;
}

export async function loadCatalogue(db: D1Database): Promise<Cat> {
  const [c, i, k, q] = await db.batch([
    db.prepare('SELECT id, name FROM categories ORDER BY sort, id'),
    db.prepare(
      `SELECT i.id, i.name, i.category_id, c.name AS category, i.retired
       FROM items i JOIN categories c ON c.id = i.category_id ORDER BY c.sort, c.id, i.sort, i.id`,
    ),
    db.prepare('SELECT name FROM kit_specs ORDER BY sort, id'),
    db.prepare('SELECT k.name AS spec, s.item_id, s.qty FROM kit_spec_items s JOIN kit_specs k ON k.id = s.spec_id'),
  ]);
  const categories = (c.results as Category[]).map((r) => ({ id: r.id, name: r.name }));
  const items = (i.results as { id: string; name: string; category_id: number; category: string; retired: number }[]).map(
    (r): CatalogueItem => ({ id: r.id, name: r.name, categoryId: r.category_id, category: r.category, retired: r.retired === 1 }),
  );
  const specNames = (k.results as { name: string }[]).map((r) => r.name);
  const specs = new Map<string, Map<string, number>>();
  for (const r of q.results as { spec: string; item_id: string; qty: number }[]) {
    if (!specs.has(r.spec.toLowerCase())) specs.set(r.spec.toLowerCase(), new Map());
    specs.get(r.spec.toLowerCase())!.set(r.item_id, r.qty);
  }
  const byId = new Map(items.map((it, n) => [it.id, { it, n }]));
  const qty = (spec: string | null, itemId: string) => (spec === null ? 0 : (specs.get(spec.toLowerCase())?.get(itemId) ?? 0));
  const isPinned = (team: TeamLike, itemId: string) => {
    const it = byId.get(itemId)?.it;
    return !!it && !it.retired && (team.kind === 'pool' || qty(team.spec, itemId) > 0);
  };
  return {
    categories,
    items,
    specNames,
    item: (id) => byId.get(id)?.it,
    sortOf: (id) => byId.get(id)?.n ?? Number.MAX_SAFE_INTEGER,
    qty,
    pinnedIds: (team) => items.filter((it) => isPinned(team, it.id)).map((it) => it.id),
    isPinned,
  };
}

/** What phones need: categories and the items that can still be added, in order, plus Kit Spec column names. */
export const publicCatalogue = (c: Cat): Catalogue => ({
  categories: c.categories,
  items: c.items.filter((it) => !it.retired),
  specs: c.specNames,
});
