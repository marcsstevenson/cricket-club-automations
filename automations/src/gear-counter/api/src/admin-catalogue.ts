import type { Context, Hono } from 'hono';
import type { AdminCatalogue, CatalogueItem } from '../../shared/src/types';
import { loadCatalogue } from './catalogue';
import type { AppEnv } from './env';
import { ApiError } from './errors';

type Ctx = Context<AppEnv>;

const body = async (c: Ctx) => {
  const b = await c.req.json().catch(() => null);
  return (b && typeof b === 'object' && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
};

function parseName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 60) throw new ApiError(400, 'invalid_name', 'Enter a name of up to 60 characters.');
  return s;
}

function intId(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found.');
  return n;
}

function direction(v: unknown): 'up' | 'down' {
  if (v !== 'up' && v !== 'down') throw new ApiError(400, 'invalid_body', 'direction must be "up" or "down".');
  return v;
}

const taken = (what: string) => new ApiError(409, 'name_taken', `There is already ${what} with that name.`);

/** Swaps a row's sort with its neighbour in the given direction (within `scope`); a no-op at either end. */
async function swap(db: D1Database, table: 'categories' | 'items', id: number | string, dir: 'up' | 'down', scope = '1 = 1') {
  const row = await db.prepare(`SELECT sort, ${table === 'items' ? 'category_id' : '0 AS category_id'} FROM ${table} WHERE id = ?`).bind(id).first<{ sort: number; category_id: number }>();
  if (!row) throw new ApiError(404, 'not_found', 'Not found.');
  const scoped = scope.replace('?cat', String(row.category_id));
  const other = await db
    .prepare(`SELECT id, sort FROM ${table} WHERE ${scoped} AND sort ${dir === 'up' ? '<' : '>'} ? ORDER BY sort ${dir === 'up' ? 'DESC' : 'ASC'} LIMIT 1`)
    .bind(row.sort)
    .first<{ id: number | string; sort: number }>();
  if (!other) return;
  await db.batch([
    db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`).bind(other.sort, id),
    db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`).bind(row.sort, other.id),
  ]);
}

export async function adminCatalogue(db: D1Database): Promise<AdminCatalogue> {
  const cat = await loadCatalogue(db);
  const [cats, held, specs, qty] = await db.batch([
    db.prepare('SELECT c.id, c.name, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS items FROM categories c ORDER BY c.sort, c.id'),
    db.prepare('SELECT item_id, SUM(level > 0) AS holders, SUM(level) AS total FROM levels GROUP BY item_id'),
    db.prepare('SELECT k.id, k.name, (SELECT COUNT(*) FROM teams t WHERE t.spec = k.name COLLATE NOCASE) AS teams FROM kit_specs k ORDER BY k.sort, k.id'),
    db.prepare('SELECT spec_id, item_id, qty FROM kit_spec_items'),
  ]);
  const holding = new Map((held.results as { item_id: string; holders: number; total: number }[]).map((r) => [r.item_id, r]));
  const columns = new Map<number, Record<string, number>>();
  for (const r of qty.results as { spec_id: number; item_id: string; qty: number }[]) {
    if (!columns.has(r.spec_id)) columns.set(r.spec_id, {});
    columns.get(r.spec_id)![r.item_id] = r.qty;
  }
  return {
    categories: cats.results as AdminCatalogue['categories'],
    items: cat.items.map((it) => ({ ...it, holders: holding.get(it.id)?.holders ?? 0, total: holding.get(it.id)?.total ?? 0 })),
    specs: (specs.results as { id: number; name: string; teams: number }[]).map((s) => ({ ...s, qty: columns.get(s.id) ?? {} })),
  };
}

async function itemById(db: D1Database, id: string): Promise<CatalogueItem> {
  const it = (await loadCatalogue(db)).item(id);
  if (!it) throw new ApiError(404, 'not_found', 'Unknown item.');
  return it;
}

export function registerCatalogueAdmin(app: Hono<AppEnv>, requireAdmin: (c: Ctx) => Promise<void>) {
  app.get('/admin/catalogue', async (c) => {
    await requireAdmin(c);
    return c.json(await adminCatalogue(c.env.DB));
  });

  // Categories
  app.post('/admin/categories', async (c) => {
    await requireAdmin(c);
    const name = parseName((await body(c)).name);
    const db = c.env.DB;
    if (await db.prepare('SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE').bind(name).first()) throw taken('a category');
    const row = await db
      .prepare('INSERT INTO categories (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 10 FROM categories)) RETURNING id, name')
      .bind(name)
      .first();
    return c.json(row, 201);
  });

  app.patch('/admin/categories/:id', async (c) => {
    await requireAdmin(c);
    const id = intId(c.req.param('id'));
    const name = parseName((await body(c)).name);
    const db = c.env.DB;
    if (await db.prepare('SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?').bind(name, id).first()) throw taken('a category');
    const row = await db.prepare('UPDATE categories SET name = ? WHERE id = ? RETURNING id, name').bind(name, id).first();
    if (!row) throw new ApiError(404, 'not_found', 'Not found.');
    return c.json(row);
  });

  app.delete('/admin/categories/:id', async (c) => {
    await requireAdmin(c);
    const id = intId(c.req.param('id'));
    const db = c.env.DB;
    if (await db.prepare('SELECT 1 FROM items WHERE category_id = ?').bind(id).first()) {
      throw new ApiError(409, 'not_empty', 'Move or retire its items first — only empty categories can be deleted.');
    }
    const r = await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
    if (!r.meta.changes) throw new ApiError(404, 'not_found', 'Not found.');
    return c.body(null, 204);
  });

  app.post('/admin/categories/:id/move', async (c) => {
    await requireAdmin(c);
    await swap(c.env.DB, 'categories', intId(c.req.param('id')), direction((await body(c)).direction));
    return c.json({ ok: true });
  });

  // Items
  app.post('/admin/items', async (c) => {
    await requireAdmin(c);
    const b = await body(c);
    const name = parseName(b.name);
    const db = c.env.DB;
    const categoryId = Number(b.categoryId);
    if (!Number.isInteger(categoryId) || !(await db.prepare('SELECT 1 FROM categories WHERE id = ?').bind(categoryId).first())) {
      throw new ApiError(400, 'invalid_category', 'Choose a category.');
    }
    if (await db.prepare('SELECT 1 FROM items WHERE category_id = ? AND name = ? COLLATE NOCASE').bind(categoryId, name).first()) {
      throw taken('an item in that category');
    }
    const id = `X-${[...crypto.getRandomValues(new Uint8Array(3))].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    await db
      .prepare(
        `INSERT INTO items (id, category_id, name, sort, retired, created_at)
         VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort), 0) + 10 FROM items WHERE category_id = ?2), 0, ?4)`,
      )
      .bind(id, categoryId, name, c.get('deps').now().toISOString())
      .run();
    return c.json(await itemById(db, id), 201);
  });

  app.patch('/admin/items/:id', async (c) => {
    await requireAdmin(c);
    const db = c.env.DB;
    const current = await itemById(db, c.req.param('id'));
    const b = await body(c);
    const name = b.name === undefined ? current.name : parseName(b.name);
    let categoryId = current.categoryId;
    if (b.categoryId !== undefined) {
      categoryId = Number(b.categoryId);
      if (!Number.isInteger(categoryId) || !(await db.prepare('SELECT 1 FROM categories WHERE id = ?').bind(categoryId).first())) {
        throw new ApiError(400, 'invalid_category', 'Choose a category.');
      }
    }
    if (b.retired !== undefined && typeof b.retired !== 'boolean') throw new ApiError(400, 'invalid_body', 'retired must be true or false.');
    if (b.name === undefined && b.categoryId === undefined && b.retired === undefined) throw new ApiError(400, 'invalid_body', 'Nothing to change.');
    if (await db.prepare('SELECT 1 FROM items WHERE category_id = ? AND name = ? COLLATE NOCASE AND id <> ?').bind(categoryId, name, current.id).first()) {
      throw taken('an item in that category');
    }
    const moved = categoryId !== current.categoryId;
    await db
      .prepare(
        `UPDATE items SET name = ?1, category_id = ?2, retired = ?3,
           sort = CASE WHEN ?4 THEN (SELECT COALESCE(MAX(sort), 0) + 10 FROM items WHERE category_id = ?2) ELSE sort END
         WHERE id = ?5`,
      )
      .bind(name, categoryId, (b.retired ?? current.retired) ? 1 : 0, moved ? 1 : 0, current.id)
      .run();
    return c.json(await itemById(db, current.id));
  });

  app.post('/admin/items/:id/move', async (c) => {
    await requireAdmin(c);
    const dir = direction((await body(c)).direction);
    await swap(c.env.DB, 'items', c.req.param('id'), dir, 'category_id = ?cat');
    return c.json({ ok: true });
  });

  // Kit Spec columns
  app.post('/admin/kit-specs', async (c) => {
    await requireAdmin(c);
    const name = parseName((await body(c)).name);
    const db = c.env.DB;
    if (await db.prepare('SELECT 1 FROM kit_specs WHERE name = ? COLLATE NOCASE').bind(name).first()) throw taken('a grade');
    const row = await db
      .prepare('INSERT INTO kit_specs (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 10 FROM kit_specs)) RETURNING id, name')
      .bind(name)
      .first();
    return c.json(row, 201);
  });

  app.patch('/admin/kit-specs/:id', async (c) => {
    await requireAdmin(c);
    const id = intId(c.req.param('id'));
    const name = parseName((await body(c)).name);
    const db = c.env.DB;
    const old = await db.prepare('SELECT name FROM kit_specs WHERE id = ?').bind(id).first<{ name: string }>();
    if (!old) throw new ApiError(404, 'not_found', 'Not found.');
    if (await db.prepare('SELECT 1 FROM kit_specs WHERE name = ? COLLATE NOCASE AND id <> ?').bind(name, id).first()) throw taken('a grade');
    // Teams store the column name, so they follow the rename in the same transaction.
    await db.batch([
      db.prepare('UPDATE teams SET spec = ? WHERE spec = ? COLLATE NOCASE').bind(name, old.name),
      db.prepare('UPDATE kit_specs SET name = ? WHERE id = ?').bind(name, id),
    ]);
    return c.json({ id, name });
  });

  app.delete('/admin/kit-specs/:id', async (c) => {
    await requireAdmin(c);
    const id = intId(c.req.param('id'));
    const db = c.env.DB;
    const row = await db
      .prepare('SELECT k.name, (SELECT COUNT(*) FROM teams t WHERE t.spec = k.name COLLATE NOCASE) AS teams FROM kit_specs k WHERE k.id = ?')
      .bind(id)
      .first<{ name: string; teams: number }>();
    if (!row) throw new ApiError(404, 'not_found', 'Not found.');
    if (row.teams) throw new ApiError(409, 'in_use', `${row.teams} team${row.teams === 1 ? ' uses' : 's use'} this grade — change them first.`);
    await db.batch([db.prepare('DELETE FROM kit_spec_items WHERE spec_id = ?').bind(id), db.prepare('DELETE FROM kit_specs WHERE id = ?').bind(id)]);
    return c.body(null, 204);
  });

  app.put('/admin/kit-specs/:id/items', async (c) => {
    await requireAdmin(c);
    const id = intId(c.req.param('id'));
    const db = c.env.DB;
    if (!(await db.prepare('SELECT 1 FROM kit_specs WHERE id = ?').bind(id).first())) throw new ApiError(404, 'not_found', 'Not found.');
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'invalid_body', 'Send { "itemId": quantity, … }.');
    const cat = await loadCatalogue(db);
    const rows: [string, number][] = [];
    for (const [itemId, q] of Object.entries(raw as Record<string, unknown>)) {
      const it = cat.item(itemId);
      if (!it) throw new ApiError(400, 'invalid_body', `Unknown item ${itemId}.`);
      if (typeof q !== 'number' || !Number.isInteger(q) || q < 0 || q > 99) throw new ApiError(400, 'invalid_qty', 'Quantities must be whole numbers from 0 to 99.');
      if (q > 0 && it.retired) throw new ApiError(409, 'item_retired', `${it.name} has been retired.`);
      if (q > 0) rows.push([itemId, q]);
    }
    await db.batch([
      // Retired items aren't in the grid, so their quantities are kept for if they're unretired.
      db.prepare('DELETE FROM kit_spec_items WHERE spec_id = ? AND item_id NOT IN (SELECT id FROM items WHERE retired = 1)').bind(id),
      ...rows.map(([itemId, q]) => db.prepare('INSERT INTO kit_spec_items (spec_id, item_id, qty) VALUES (?, ?, ?)').bind(id, itemId, q)),
    ]);
    return c.json({ qty: Object.fromEntries(rows) });
  });
}
