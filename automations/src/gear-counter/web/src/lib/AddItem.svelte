<script lang="ts">
  import type { Catalogue } from '$shared/types';

  let { catalogue, have, onadd }: { catalogue: Catalogue; have: Set<string>; onadd: (itemId: string) => Promise<boolean> } = $props();

  let dialog = $state<HTMLDialogElement>();
  let search = $state('');
  let busy = $state(false);

  const groups = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const left = catalogue.items.filter((i) => !have.has(i.id) && (!q || `${i.category} ${i.name}`.toLowerCase().includes(q)));
    return catalogue.categories.map((c) => ({ category: c.name, items: left.filter((i) => i.categoryId === c.id) })).filter((g) => g.items.length);
  });

  function show() {
    search = '';
    dialog?.showModal();
  }

  async function pick(id: string) {
    busy = true;
    try {
      if (await onadd(id)) dialog?.close();
    } finally {
      busy = false;
    }
  }
</script>

<button type="button" class="btn add-btn" onclick={show}>+ Add item</button>

<!-- Tapping the backdrop closes it; Esc and the close button work too. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="modal" aria-labelledby="add-item-title" onclick={(e) => e.target === dialog && dialog?.close()}>
  <div class="modal-body">
    <div class="modal-head">
      <h2 id="add-item-title">Add an item</h2>
      <button type="button" class="icon-btn" aria-label="Close" onclick={() => dialog?.close()}>✕</button>
    </div>
    <label class="field" for="add-search">Search</label>
    <input id="add-search" type="search" autocomplete="off" placeholder="e.g. helmet" bind:value={search} />
    {#each groups as g (g.category)}
      <h3>{g.category}</h3>
      <ul class="pick-list">
        {#each g.items as i (i.id)}
          <li><button type="button" class="pick" disabled={busy} onclick={() => pick(i.id)}>{i.name}</button></li>
        {/each}
      </ul>
    {:else}
      <p class="note">{search ? 'No items match.' : 'Every item is already on the list.'}</p>
    {/each}
  </div>
</dialog>
