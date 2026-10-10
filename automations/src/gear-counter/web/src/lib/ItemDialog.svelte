<script lang="ts">
  import type { LevelLine, TeamSummary } from '$shared/types';
  import { api } from './api';
  import { me } from './who.svelte';

  let {
    team,
    teams,
    line,
    onclose,
    ondone,
  }: { team: TeamSummary; teams: TeamSummary[]; line: LevelLine; onclose: () => void; ondone: (message: string) => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let mode = $state<'menu' | 'move' | 'count'>('menu');
  let to = $state('');
  let qty = $state(1);
  let level = $state(0);
  let note = $state('');
  let error = $state('');
  let busy = $state(false);
  const others = $derived(teams.filter((t) => t.slug !== team.slug));

  $effect(() => {
    level = line.level;
    dialog?.showModal();
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      if (mode === 'move') {
        const dest = others.find((t) => t.slug === to);
        await api().move({ from: team.slug, to, item: line.itemId, qty, who: me.name, note });
        ondone(`Moved ${qty} ${line.name} to ${dest?.name ?? to}.`);
      } else {
        await api().count(team.slug, line.itemId, level, me.name, note);
        ondone(`${line.name} set to ${level}.`);
      }
      dialog?.close();
    } catch (err) {
      error = err instanceof Error ? err.message : 'That did not save.';
    } finally {
      busy = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="modal" aria-labelledby="item-title" onclose={onclose} onclick={(e) => e.target === dialog && dialog?.close()}>
  <form class="modal-body" onsubmit={submit}>
    <div class="modal-head">
      <h2 id="item-title">{line.name}</h2>
      <button type="button" class="icon-btn" aria-label="Close" onclick={() => dialog?.close()}>✕</button>
    </div>
    <p class="note">{line.level} in {team.name}</p>
    {#if mode === 'menu'}
      <p><button type="button" class="btn wide" disabled={line.level === 0} onclick={() => (mode = 'move')}>Move…</button></p>
      <p><button type="button" class="btn wide" onclick={() => (mode = 'count')}>Set count…</button></p>
    {:else}
      {#if mode === 'move'}
        <label class="field" for="move-to">Move to</label>
        <select id="move-to" required bind:value={to}>
          <option value="" disabled>Choose…</option>
          {#each others as t (t.slug)}<option value={t.slug}>{t.name}</option>{/each}
        </select>
        <label class="field" for="move-qty">How many</label>
        <input id="move-qty" type="number" inputmode="numeric" min="1" max={line.level} required bind:value={qty} />
      {:else}
        <label class="field" for="count-level">Count</label>
        <input id="count-level" type="number" inputmode="numeric" min="0" max="999" required bind:value={level} />
      {/if}
      <label class="field" for="item-note">Note (optional)</label>
      <input id="item-note" type="text" maxlength="200" bind:value={note} />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <p><button class="btn" disabled={busy}>{mode === 'move' ? 'Move' : 'Save'}</button></p>
    {/if}
  </form>
</dialog>
