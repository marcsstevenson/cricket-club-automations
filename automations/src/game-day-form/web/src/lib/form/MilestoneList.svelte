<script lang="ts">
  import type { MilestoneType } from '$shared/types';
  import type { GameForm } from './game-form.svelte';
  import NumberInput from './NumberInput.svelte';
  import PlayerPicker from './PlayerPicker.svelte';

  let { form, type, squad, title, valueLabel = '', maxDigits = 3 }: {
    form: GameForm;
    type: MilestoneType;
    squad: { key: string; label: string }[];
    title: string;
    valueLabel?: string;
    maxDigits?: number;
  } = $props();

  function add() {
    form.state.milestones.push({ rowId: crypto.randomUUID(), type, player: null, value: null, source: 'entered', playhqValue: null, touched: true });
  }
  function remove(rowId: string) {
    form.state.milestones = form.state.milestones.filter((m) => m.rowId !== rowId);
  }
</script>

<h3>{title}</h3>
{#each form.state.milestones as row, i (row.rowId)}
  {#if row.type === type}
    <div class="milestone">
      {#if row.source === 'playhq'}<span class="badge badge-phq">From PlayHQ</span>{/if}
      <PlayerPicker bind:value={row.player} {squad} id={`m-${row.rowId}`} label="Player" error={form.errors[`milestones.${i}.player`]} onedit={() => (row.touched = true)} />
      {#if type !== 'hattrick'}
        <NumberInput bind:value={row.value} id={`m-${row.rowId}-value`} label={valueLabel} {maxDigits} error={form.errors[`milestones.${i}.value`]} onedit={() => (row.touched = true)} />
      {/if}
      <button type="button" class="btn-link" onclick={() => remove(row.rowId)}>Remove</button>
    </div>
  {/if}
{/each}
<button type="button" class="btn-secondary" onclick={add}>Add {title.toLowerCase()}</button>

<style>
  .milestone { border-left: 3px solid var(--pcc-teal-400); padding: 4px 0 8px 12px; margin: 12px 0; }
</style>
