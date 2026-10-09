<script lang="ts">
  import { untrack } from 'svelte';
  import { priorWins, withWins } from '$shared/awards';
  import type { GameOption } from '$shared/api';
  import type { PlayerChoice } from '$shared/types';
  import AwardWinners from './AwardWinners.svelte';
  import FieldError from './FieldError.svelte';

  let {
    value = $bindable(),
    squad,
    id,
    label,
    error,
    onedit,
    wins,
    gameId,
    award,
    games,
  }: {
    value: PlayerChoice | null;
    squad: { key: string; label: string }[];
    id: string;
    label: string;
    error?: string;
    onedit?: () => void;
    /** Game IDs each squad player has won this award in; shown as a count after their name. */
    wins?: Record<string, string[]>;
    gameId?: string;
    /** Award name for the winners popup, e.g. "Player of the day". */
    award?: string;
    games?: GameOption[];
  } = $props();

  const optionLabel = (p: { key: string; label: string }) => (wins && gameId ? withWins(p.label, priorWins(wins, p.key, gameId)) : p.label);

  // A saved or PlayHQ person who isn't in the squad stays selectable even after switching away.
  type Kept = Extract<PlayerChoice, { kind: 'named' | 'playhq' }>;
  const isKept = (v: PlayerChoice | null | undefined): v is Kept => !!v && (v.kind === 'named' || v.kind === 'playhq');
  let original = $state<Kept | null>(untrack(() => (isKept(value) ? $state.snapshot(value) as Kept : null)));
  $effect(() => {
    if (isKept(value)) original = $state.snapshot(value) as Kept;
  });

  const selected = $derived(
    !value ? '' : value.kind === 'squad' ? `s:${value.key}` : value.kind === 'other' ? 'other' : 'current',
  );

  function choose(v: string) {
    if (v === '') value = null;
    else if (v === 'other') value = { kind: 'other', fullName: '' };
    else if (v === 'current') value = original;
    else {
      const key = v.slice(2);
      value = { kind: 'squad', key, label: squad.find((p) => p.key === key)?.label };
    }
    onedit?.();
  }
</script>

{#if award && wins && games && gameId}
  <div class="label-row">
    <label class="field" for={id}>{label}</label>
    <AwardWinners {award} {wins} {squad} {games} {gameId} />
  </div>
{:else}
  <label class="field" for={id}>{label}</label>
{/if}
<select {id} value={selected} onchange={(e) => choose(e.currentTarget.value)} aria-invalid={!!error}>
  <option value="">Choose a player…</option>
  {#each squad as p (p.key)}<option value={`s:${p.key}`}>{optionLabel(p)}</option>{/each}
  {#if original}<option value="current">{original.label}</option>{/if}
  <option value="other">Other…</option>
</select>
{#if value?.kind === 'other'}
  <label class="field" for={`${id}-other`}>Full name</label>
  <input
    id={`${id}-other`}
    type="text"
    maxlength="120"
    autocomplete="off"
    value={value.fullName}
    oninput={(e) => {
      value = { kind: 'other', fullName: e.currentTarget.value };
      onedit?.();
    }}
  />
{/if}
{#if value?.kind === 'playhq'}<p class="note">Couldn't match to squad — please check.</p>{/if}
<FieldError msg={error} />
