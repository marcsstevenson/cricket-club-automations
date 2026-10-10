<script lang="ts">
  import type { AdminCatalogue } from '$shared/types';
  import { admin } from '$lib/admin.svelte';
  import { adminCall } from '$lib/adminApi';

  type Item = AdminCatalogue['items'][number];

  let cat = $state<AdminCatalogue | null>(null);
  let msg = $state('');
  let notice = $state('');
  let busy = $state(false);

  // Inline edits: one thing at a time.
  let editingCategory = $state<number | null>(null);
  let categoryName = $state('');
  let editingItem = $state<string | null>(null);
  let itemName = $state('');
  let itemCategory = $state(0);
  let editingSpec = $state<number | null>(null);
  let specName = $state('');

  let newCategory = $state('');
  let newItem = $state('');
  let newItemCategory = $state(0);
  let newSpec = $state('');

  // Kit Spec grid for the chosen grade.
  let specId = $state(0);
  let qty = $state<Record<string, number | null>>({});

  const spec = $derived(cat?.specs.find((s) => s.id === specId));
  const live = $derived(cat?.items.filter((i) => !i.retired) ?? []);

  async function load() {
    const r = await adminCall<AdminCatalogue>('/catalogue');
    if (!r.ok) {
      msg = r.message;
      return;
    }
    cat = r.data;
    if (!cat.specs.some((s) => s.id === specId)) specId = cat.specs[0]?.id ?? 0;
    if (!newItemCategory) newItemCategory = cat.categories[0]?.id ?? 0;
    resetGrid();
  }

  function resetGrid() {
    const column = cat?.specs.find((s) => s.id === specId)?.qty ?? {};
    qty = Object.fromEntries(live.map((i) => [i.id, column[i.id] ?? null]));
  }

  $effect(() => {
    if (admin.passcode) void load();
  });

  /** Runs a change, shows its result, and reloads the catalogue. */
  async function run(method: string, path: string, json: unknown, done: string): Promise<boolean> {
    msg = '';
    notice = '';
    busy = true;
    try {
      const r = await adminCall(path, method, json);
      if (!r.ok) {
        msg = r.message;
        return false;
      }
      notice = done;
      await load();
      return true;
    } finally {
      busy = false;
    }
  }

  const held = (i: Item) => (i.holders ? `${i.holders} team${i.holders === 1 ? '' : 's'} · ${i.total} in the club` : 'Not held');
  const itemsIn = (categoryId: number) => cat?.items.filter((i) => i.categoryId === categoryId) ?? [];

  async function saveGrid() {
    const body = Object.fromEntries(Object.entries(qty).map(([id, n]) => [id, n ?? 0]));
    await run('PUT', `/kit-specs/${specId}/items`, body, `Saved the ${spec?.name} Kit Spec.`);
  }
</script>

<svelte:head><title>Items · Gear admin</title><meta name="robots" content="noindex" /></svelte:head>

<section class="hero"><h1>Items</h1><p>Categories, items and the Kit Spec for each grade.</p></section>

<p><a href="/admin">← Gear admin</a></p>

{#if !admin.passcode}
  <p class="card">Enter the admin passcode on the <a href="/admin">admin page</a> first.</p>
{:else if cat}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if msg}<p class="error" role="alert">{msg}</p>{/if}

  <section aria-labelledby="cats-title">
    <h2 id="cats-title">Categories</h2>
    <ul class="lines admin-list">
      {#each cat.categories as c, n (c.id)}
        <li class="line" data-category={c.name}>
          {#if editingCategory === c.id}
            <form class="inline-edit" onsubmit={async (e) => { e.preventDefault(); if (await run('PATCH', `/categories/${c.id}`, { name: categoryName }, `Renamed to ${categoryName.trim()}.`)) editingCategory = null; }}>
              <label class="visually-hidden" for="cat-{c.id}">Category name</label>
              <input id="cat-{c.id}" type="text" maxlength="60" required bind:value={categoryName} />
              <button class="small" disabled={busy}>Save</button>
              <button type="button" class="small" onclick={() => (editingCategory = null)}>Cancel</button>
            </form>
          {:else}
            <div class="line-text"><span class="line-name">{c.name}</span><span class="team-meta">{c.items} item{c.items === 1 ? '' : 's'}</span></div>
            <div class="row-actions">
              <button type="button" class="small" aria-label="Move {c.name} up" disabled={busy || n === 0} onclick={() => run('POST', `/categories/${c.id}/move`, { direction: 'up' }, `Moved ${c.name} up.`)}>↑</button>
              <button type="button" class="small" aria-label="Move {c.name} down" disabled={busy || n === cat.categories.length - 1} onclick={() => run('POST', `/categories/${c.id}/move`, { direction: 'down' }, `Moved ${c.name} down.`)}>↓</button>
              <button type="button" class="small" aria-label="Rename {c.name}" onclick={() => { editingCategory = c.id; categoryName = c.name; }}>Rename</button>
              <button type="button" class="small" aria-label="Delete {c.name}" disabled={busy || c.items > 0} onclick={() => run('DELETE', `/categories/${c.id}`, undefined, `Deleted ${c.name}.`)}>Delete</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    <form class="card add-form" aria-label="Add a category" onsubmit={async (e) => { e.preventDefault(); if (await run('POST', '/categories', { name: newCategory }, `Added ${newCategory.trim()}.`)) newCategory = ''; }}>
      <label class="field" for="new-category">Add a category</label>
      <input id="new-category" type="text" maxlength="60" required bind:value={newCategory} />
      <p><button class="btn" disabled={busy}>Add category</button></p>
    </form>
  </section>

  <section aria-labelledby="items-title">
    <h2 id="items-title">Items</h2>
    {#each cat.categories as c (c.id)}
      <h3>{c.name}</h3>
      <ul class="lines admin-list">
        {#each itemsIn(c.id) as i, n (i.id)}
          <li class="line" class:hidden-row={i.retired} data-item={i.name}>
            {#if editingItem === i.id}
              <form class="inline-edit" onsubmit={async (e) => { e.preventDefault(); if (await run('PATCH', `/items/${i.id}`, { name: itemName, categoryId: itemCategory }, `Saved ${itemName.trim()}.`)) editingItem = null; }}>
                <label class="visually-hidden" for="item-{i.id}">Item name</label>
                <input id="item-{i.id}" type="text" maxlength="60" required bind:value={itemName} />
                <label class="visually-hidden" for="item-cat-{i.id}">Category</label>
                <select id="item-cat-{i.id}" bind:value={itemCategory}>
                  {#each cat.categories as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
                </select>
                <button class="small" disabled={busy}>Save</button>
                <button type="button" class="small" onclick={() => (editingItem = null)}>Cancel</button>
              </form>
            {:else}
              <div class="line-text">
                <span class="line-name">{i.name}</span>
                {#if i.retired}<span class="tag retired">Retired</span>{/if}
                <span class="team-meta">{held(i)}</span>
              </div>
              <div class="row-actions">
                <button type="button" class="small" aria-label="Move {i.name} up" disabled={busy || n === 0} onclick={() => run('POST', `/items/${i.id}/move`, { direction: 'up' }, `Moved ${i.name} up.`)}>↑</button>
                <button type="button" class="small" aria-label="Move {i.name} down" disabled={busy || n === itemsIn(c.id).length - 1} onclick={() => run('POST', `/items/${i.id}/move`, { direction: 'down' }, `Moved ${i.name} down.`)}>↓</button>
                <button type="button" class="small" aria-label="Edit {i.name}" onclick={() => { editingItem = i.id; itemName = i.name; itemCategory = i.categoryId; }}>Edit</button>
                <button type="button" class="small" aria-label="{i.retired ? 'Unretire' : 'Retire'} {i.name}" disabled={busy} onclick={() => run('PATCH', `/items/${i.id}`, { retired: !i.retired }, `${i.name} ${i.retired ? 'is back in use' : 'is retired'}.`)}>{i.retired ? 'Unretire' : 'Retire'}</button>
              </div>
            {/if}
          </li>
        {:else}
          <li class="line"><span class="note">No items.</span></li>
        {/each}
      </ul>
    {/each}
    <form class="card add-form" aria-label="Add an item" onsubmit={async (e) => { e.preventDefault(); if (await run('POST', '/items', { name: newItem, categoryId: newItemCategory }, `Added ${newItem.trim()}.`)) newItem = ''; }}>
      <h3>Add an item</h3>
      <label class="field" for="new-item">Name</label>
      <input id="new-item" type="text" maxlength="60" required bind:value={newItem} />
      <label class="field" for="new-item-category">Category</label>
      <select id="new-item-category" bind:value={newItemCategory}>
        {#each cat.categories as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
      </select>
      <p><button class="btn" disabled={busy}>Add item</button></p>
    </form>
  </section>

  <section aria-labelledby="spec-title">
    <h2 id="spec-title">Kit Spec</h2>
    <div class="card">
      <label class="field" for="spec-pick">Grade</label>
      <select id="spec-pick" bind:value={specId} onchange={resetGrid}>
        {#each cat.specs as s (s.id)}<option value={s.id}>{s.name} ({s.teams} team{s.teams === 1 ? '' : 's'})</option>{/each}
      </select>
      {#if spec}
        {#if editingSpec === spec.id}
          <form class="inline-edit" onsubmit={async (e) => { e.preventDefault(); if (await run('PATCH', `/kit-specs/${spec.id}`, { name: specName }, `Renamed to ${specName.trim()}.`)) editingSpec = null; }}>
            <label class="visually-hidden" for="spec-name">Grade name</label>
            <input id="spec-name" type="text" maxlength="60" required bind:value={specName} />
            <button class="small" disabled={busy}>Save</button>
            <button type="button" class="small" onclick={() => (editingSpec = null)}>Cancel</button>
          </form>
        {:else}
          <p class="row-actions">
            <button type="button" class="small" onclick={() => { editingSpec = spec.id; specName = spec.name; }}>Rename grade</button>
            <button type="button" class="small" disabled={busy || spec.teams > 0} onclick={() => run('DELETE', `/kit-specs/${spec.id}`, undefined, `Deleted ${spec.name}.`)}>Delete grade</button>
          </p>
        {/if}
      {/if}
    </div>

    {#if spec}
      <form aria-label="Kit Spec quantities" onsubmit={(e) => { e.preventDefault(); void saveGrid(); }}>
        {#each cat.categories as c (c.id)}
          {@const rows = live.filter((i) => i.categoryId === c.id)}
          {#if rows.length}
            <h3>{c.name}</h3>
            <ul class="lines">
              {#each rows as i (i.id)}
                <li class="line">
                  <label class="line-name" for="qty-{i.id}">{i.name}</label>
                  <input id="qty-{i.id}" class="qty-input" type="number" inputmode="numeric" min="0" max="99" placeholder="0" bind:value={qty[i.id]} />
                </li>
              {/each}
            </ul>
          {/if}
        {/each}
        <p class="add-row"><button class="btn" disabled={busy}>Save {spec.name}</button></p>
      </form>
    {/if}

    <form class="card add-form" aria-label="Add a grade" onsubmit={async (e) => { e.preventDefault(); if (await run('POST', '/kit-specs', { name: newSpec }, `Added ${newSpec.trim()}.`)) newSpec = ''; }}>
      <label class="field" for="new-spec">Add a grade</label>
      <input id="new-spec" type="text" maxlength="60" required bind:value={newSpec} />
      <p><button class="btn" disabled={busy}>Add grade</button></p>
    </form>
  </section>
{:else if msg}
  <p class="error" role="alert">{msg}</p>
{:else}
  <p class="note">Loading…</p>
{/if}
