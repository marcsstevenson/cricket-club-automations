<script lang="ts">
  import { checkText } from '$shared/text';
  import type { MilestoneType } from '$shared/types';
  import type { GameForm } from './game-form.svelte';
  import NumberInput from './NumberInput.svelte';
  import PlayerPicker from './PlayerPicker.svelte';

  let { form, type, squad, title, valueLabel = '', maxDigits = 3, hint = '' }: {
    form: GameForm;
    type: MilestoneType;
    squad: { key: string; label: string }[];
    title: string;
    valueLabel?: string;
    maxDigits?: number;
    hint?: string;
  } = $props();

  function add() {
    form.state.milestones.push({ rowId: crypto.randomUUID(), type, player: null, value: null, source: 'entered', playhqValue: null, touched: true, check: null });
  }
  function remove(rowId: string) {
    form.state.milestones = form.state.milestones.filter((m) => m.rowId !== rowId);
  }
</script>

<h3>{title}</h3>
{#if hint}<p class="note">{hint}</p>{/if}
{#each form.state.milestones as row, i (row.rowId)}
  {#if row.type === type}
    <div class="milestone">
      {#if row.source === 'playhq'}<span class="badge badge-phq">From PlayHQ</span>{/if}
      <PlayerPicker bind:value={row.player} {squad} id={`m-${row.rowId}`} label="Player" error={form.errors[`milestones.${i}.player`]} onedit={() => { row.touched = true; row.check = null; }} />
      {#if type !== 'hattrick'}
        <NumberInput bind:value={row.value} id={`m-${row.rowId}-value`} label={valueLabel} {maxDigits} error={form.errors[`milestones.${i}.value`]} onedit={() => (row.touched = true)} />
      {/if}
      {#if row.check}
        {@const t = checkText(row.type, row.check)}
        <p class="flag">{t.warning}</p>
        <label class="choice"><input type="checkbox" bind:checked={row.check.checked} /> {t.confirm}</label>
      {/if}
      <button type="button" class="btn-link" onclick={() => remove(row.rowId)}>Remove</button>
    </div>
  {/if}
{/each}
<button type="button" class="btn-secondary" onclick={add}>Add {title.toLowerCase()}</button>

<style>
  .milestone { border-left: 3px solid var(--pcc-teal-400); padding: 4px 0 8px 12px; margin: 12px 0; }
</style>
