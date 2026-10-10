import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/gear-data-2026-10.json';

type Row = Record<string, unknown>;
const all = async (sql: string) => (await env.DB.prepare(sql).all<Row>()).results;

describe('0004_catalogue', () => {
  it('seeds categories, items and Kit Spec exactly as gear-data.json had them', async () => {
    expect((await all('SELECT name FROM categories ORDER BY sort')).map((r) => r.name)).toEqual(fixture.categories);
    const items = await all('SELECT i.id, i.name, c.name AS category, i.retired FROM items i JOIN categories c ON c.id = i.category_id ORDER BY c.sort, i.sort');
    expect(items.map(({ id, name, category }) => ({ id, category, name }))).toEqual(fixture.items);
    expect(items.every((r) => r.retired === 0)).toBe(true);
    expect((await all('SELECT name FROM kit_specs ORDER BY sort')).map((r) => r.name)).toEqual(Object.keys(fixture.specs));
    const rows = await all('SELECT k.name AS spec, s.item_id, s.qty FROM kit_spec_items s JOIN kit_specs k ON k.id = s.spec_id');
    const specs: Record<string, Record<string, number>> = {};
    for (const r of rows) (specs[r.spec as string] ??= {})[r.item_id as string] = r.qty as number;
    expect(specs).toEqual(fixture.specs);
  });
});
