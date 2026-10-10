import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { AdminCatalogue, ApiErrorBody, Catalogue, CatalogueItem, TeamPage } from '../../shared/src/types';
import { client, type Client } from './helpers';

const PASS = { 'x-admin-passcode': 'test-passcode' };
const admin = (api: Client, path: string, method = 'GET', json?: unknown) =>
  api(`/admin${path}`, {
    method,
    headers: { ...PASS, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
const cat = async (api: Client) => (await (await admin(api, '/catalogue')).json()) as AdminCatalogue;
const err = async (res: Response) => (await res.json()) as ApiErrorBody;
const catId = async (api: Client, name: string) => (await cat(api)).categories.find((c) => c.name === name)!.id;
const specId = async (api: Client, name: string) => (await cat(api)).specs.find((s) => s.name === name)!.id;
const adjust = (api: Client, slug: string, item: string, delta: number) =>
  api(`/teams/${slug}/items/${item}/adjust`, { method: 'POST', json: { delta, who: 'Sam' } });

describe('admin catalogue', () => {
  it('needs the passcode on every route', async () => {
    const api = client();
    for (const [path, method] of [
      ['/admin/catalogue', 'GET'], ['/admin/categories', 'POST'], ['/admin/categories/1', 'PATCH'], ['/admin/categories/1', 'DELETE'],
      ['/admin/categories/1/move', 'POST'], ['/admin/items', 'POST'], ['/admin/items/STU-01', 'PATCH'], ['/admin/items/STU-01/move', 'POST'],
      ['/admin/kit-specs', 'POST'], ['/admin/kit-specs/1', 'PATCH'], ['/admin/kit-specs/1', 'DELETE'], ['/admin/kit-specs/1/items', 'PUT'],
    ]) {
      expect((await api(path, method === 'GET' ? { method } : { method, json: {} })).status, `${method} ${path}`).toBe(401);
    }
  });

  it('shows everything with holders, totals and Kit Spec usage', async () => {
    const api = client();
    await adjust(api, 'lions', 'STU-03', 2);
    await adjust(api, 'pool', 'STU-03', 3);
    const c = await cat(api);
    expect(c.categories).toHaveLength(11);
    expect(c.categories[0]).toMatchObject({ name: 'Stumps & Wickets', items: c.items.filter((i) => i.category === 'Stumps & Wickets').length });
    expect(c.categories[0].items).toBeGreaterThan(0);
    expect(c.items).toHaveLength(62);
    expect(c.items.find((i) => i.id === 'STU-03')).toMatchObject({ holders: 2, total: 5, retired: false });
    const kiwi = c.specs.find((s) => s.name === 'Kiwi Y1')!;
    expect(kiwi.qty['STU-03']).toBe(1);
    expect(kiwi.teams).toBeGreaterThan(0);
  });
});

describe('categories', () => {
  it('adds one last, renames it and refuses clashes ignoring case and spaces', async () => {
    const api = client();
    const res = await admin(api, '/categories', 'POST', { name: '  Training ' });
    expect(res.status).toBe(201);
    const added = (await res.json()) as { id: number; name: string };
    expect(added).toMatchObject({ name: 'Training' });
    expect((await cat(api)).categories.at(-1)?.name).toBe('Training');
    expect((await admin(api, '/categories', 'POST', { name: 'training' })).status).toBe(409);
    expect((await admin(api, `/categories/${added.id}`, 'PATCH', { name: 'BATS' })).status).toBe(409);
    expect((await admin(api, `/categories/${added.id}`, 'PATCH', { name: 'Training aids' })).status).toBe(200);
    for (const name of ['', '   ', 'x'.repeat(61), 7]) expect((await admin(api, '/categories', 'POST', { name })).status).toBe(400);
  });

  it('moves up and down, and does nothing at the ends', async () => {
    const api = client();
    const bats = await catId(api, 'Bats');
    await admin(api, `/categories/${bats}/move`, 'POST', { direction: 'up' });
    expect((await cat(api)).categories.slice(0, 2).map((c) => c.name)).toEqual(['Bats', 'Stumps & Wickets']);
    expect((await admin(api, `/categories/${bats}/move`, 'POST', { direction: 'up' })).status).toBe(200);
    expect((await cat(api)).categories[0].name).toBe('Bats');
    await admin(api, `/categories/${bats}/move`, 'POST', { direction: 'down' });
    expect((await cat(api)).categories.slice(0, 2).map((c) => c.name)).toEqual(['Stumps & Wickets', 'Bats']);
    expect((await admin(api, `/categories/${bats}/move`, 'POST', { direction: 'sideways' })).status).toBe(400);
    // Phones see the new order too.
    await admin(api, `/categories/${bats}/move`, 'POST', { direction: 'up' });
    expect(((await (await api('/catalogue')).json()) as Catalogue).items[0].category).toBe('Bats');
  });

  it('deletes only an empty category', async () => {
    const api = client();
    expect((await admin(api, `/categories/${await catId(api, 'Bats')}`, 'DELETE')).status).toBe(409);
    const { id } = (await (await admin(api, '/categories', 'POST', { name: 'Spare' })).json()) as { id: number };
    expect((await admin(api, `/categories/${id}`, 'DELETE')).status).toBe(204);
    expect((await admin(api, `/categories/${id}`, 'DELETE')).status).toBe(404);
  });
});

describe('items', () => {
  it('adds an item last in its category with a generated id; pools list it', async () => {
    const api = client();
    const res = await admin(api, '/items', 'POST', { name: 'Rebound net', categoryId: await catId(api, 'Fielding') });
    expect(res.status).toBe(201);
    const item = (await res.json()) as CatalogueItem;
    expect(item.id).toMatch(/^X-[0-9A-F]{6}$/);
    const fielding = (await cat(api)).items.filter((i) => i.category === 'Fielding');
    expect(fielding.at(-1)?.name).toBe('Rebound net');
    const pool = (await (await api('/teams/pool')).json()) as TeamPage;
    expect(pool.levels.find((l) => l.itemId === item.id)).toMatchObject({ level: 0, pinned: true });
  });

  it('refuses a clash within the category but allows the same name elsewhere', async () => {
    const api = client();
    const helmets = await catId(api, 'Helmets');
    expect((await admin(api, '/items', 'POST', { name: 'tall CONES', categoryId: await catId(api, 'Fielding') })).status).toBe(409);
    expect((await admin(api, '/items', 'POST', { name: 'Tall cones', categoryId: helmets })).status).toBe(201);
    expect((await admin(api, '/items', 'POST', { name: 'X', categoryId: 999 })).status).toBe(400);
  });

  it('renames, moves to another category (last there) and within it', async () => {
    const api = client();
    const fielding = await catId(api, 'Fielding');
    expect((await admin(api, '/items/STU-03', 'PATCH', { name: 'Rubber bases (black)' })).status).toBe(200);
    expect((await admin(api, '/items/STU-03', 'PATCH', { categoryId: fielding })).status).toBe(200);
    let items = (await cat(api)).items.filter((i) => i.category === 'Fielding');
    expect(items.at(-1)).toMatchObject({ id: 'STU-03', name: 'Rubber bases (black)' });
    await admin(api, '/items/STU-03/move', 'POST', { direction: 'up' });
    items = (await cat(api)).items.filter((i) => i.category === 'Fielding');
    expect(items.at(-2)?.id).toBe('STU-03');
    const first = items[0].id;
    expect((await admin(api, `/items/${first}/move`, 'POST', { direction: 'up' })).status).toBe(200);
    expect((await cat(api)).items.filter((i) => i.category === 'Fielding')[0].id).toBe(first);
    expect((await admin(api, '/items/NOPE/move', 'POST', { direction: 'up' })).status).toBe(404);
  });

  it('retires and unretires; a held item stays where it is held', async () => {
    const api = client();
    await adjust(api, 'lions', 'STU-03', 2);
    const res = await admin(api, '/items/STU-03', 'PATCH', { retired: true });
    expect(await res.json()).toMatchObject({ id: 'STU-03', retired: true });
    expect(((await (await api('/teams/lions')).json()) as TeamPage).levels.find((l) => l.itemId === 'STU-03')).toMatchObject({ level: 2, retired: true });
    await admin(api, '/items/STU-03', 'PATCH', { retired: false });
    expect(((await (await api('/catalogue')).json()) as Catalogue).items.some((i) => i.id === 'STU-03')).toBe(true);
  });

  it('validates edits', async () => {
    const api = client();
    expect((await admin(api, '/items/STU-03', 'PATCH', { name: '' })).status).toBe(400);
    expect((await admin(api, '/items/STU-03', 'PATCH', { retired: 'yes' })).status).toBe(400);
    expect((await admin(api, '/items/STU-03', 'PATCH', { name: 'Bails (pair)' })).status).toBe(409);
    expect((await admin(api, '/items/NOPE', 'PATCH', { name: 'X' })).status).toBe(404);
  });
});

describe('kit specs', () => {
  it('adds, renames (teams follow) and deletes only when unused', async () => {
    const api = client();
    const res = await admin(api, '/kit-specs', 'POST', { name: 'Div 1' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    expect((await admin(api, '/kit-specs', 'POST', { name: 'div 1' })).status).toBe(409);
    expect((await admin(api, `/kit-specs/${id}`, 'DELETE')).status).toBe(204);

    const kiwi = await specId(api, 'Kiwi Y1');
    expect((await admin(api, `/kit-specs/${kiwi}`, 'DELETE')).status).toBe(409);
    expect((await admin(api, `/kit-specs/${kiwi}`, 'PATCH', { name: 'Kiwi Year 1' })).status).toBe(200);
    const page = (await (await api('/teams/penguins')).json()) as TeamPage;
    expect(page.spec).toBe('Kiwi Year 1');
    expect(page.levels.find((l) => l.itemId === 'STU-03')).toMatchObject({ kitSpec: 1, pinned: true });
    expect((await admin(api, `/kit-specs/${kiwi}`, 'PATCH', { name: 'year 5' })).status).toBe(409);
  });

  it('replaces a column’s quantities; teams pick them up', async () => {
    const api = client();
    const kiwi = await specId(api, 'Kiwi Y1');
    const before = (await cat(api)).specs.find((s) => s.id === kiwi)!.qty;
    const res = await admin(api, `/kit-specs/${kiwi}/items`, 'PUT', { ...before, 'STU-03': 0, 'BAT-W2': 3, 'BAL-TEE': 7 });
    expect(res.status).toBe(200);
    const after = (await cat(api)).specs.find((s) => s.id === kiwi)!.qty;
    expect(after['STU-03']).toBeUndefined();
    expect(after['BAT-W2']).toBe(3);
    expect(after['BAL-TEE']).toBe(7);
    const levels = ((await (await api('/teams/penguins')).json()) as TeamPage).levels;
    expect(levels.find((l) => l.itemId === 'BAT-W2')).toMatchObject({ kitSpec: 3, pinned: true });
    expect(levels.find((l) => l.itemId === 'STU-03')).toMatchObject({ kitSpec: 0, pinned: false }); // held rows stay listed
  });

  it.each([
    [{ 'STU-03': 100 }], [{ 'STU-03': -1 }], [{ 'STU-03': 1.5 }], [{ NOPE: 1 }], [[1, 2]], ['x'],
  ])('refuses %j without saving anything', async (body) => {
    const api = client();
    const kiwi = await specId(api, 'Kiwi Y1');
    const before = (await cat(api)).specs.find((s) => s.id === kiwi)!.qty;
    expect((await admin(api, `/kit-specs/${kiwi}/items`, 'PUT', body)).status).toBe(400);
    expect((await cat(api)).specs.find((s) => s.id === kiwi)!.qty).toEqual(before);
  });

  it('refuses retired items in a column', async () => {
    const api = client();
    await env.DB.prepare("UPDATE items SET retired = 1 WHERE id = 'BAT-W2'").run();
    const res = await admin(api, `/kit-specs/${await specId(api, 'Kiwi Y1')}/items`, 'PUT', { 'BAT-W2': 1 });
    expect(res.status).toBe(409);
    expect((await err(res)).error).toBe('item_retired');
  });
});
