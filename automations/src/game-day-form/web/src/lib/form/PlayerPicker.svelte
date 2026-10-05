<script lang="ts">
  import { untrack } from 'svelte';
  import type { PlayerChoice } from '$shared/types';
  import FieldError from './FieldError.svelte';

  let {
    value = $bindable(),
    squad,
    id,
    label,
    error,
    onedit,
  }: { value: PlayerChoice | null; squad: { key: string; label: string }[]; id: string; label: string; error?: string; onedit?: () => void } = $props();

  // A saved or PlayHQ person who isn't in the squad stays selectable even after switching away.
  const original = untrack(() => (value && (value.kind === 'named' || value.kind === 'playhq') ? $state.snapshot(value) : null));

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

<label class="field" for={id}>{label}</label>
<select {id} value={selected} onchange={(e) => choose(e.currentTarget.value)} aria-invalid={!!error}>
  <option value="">Choose a player…</option>
  {#each squad as p (p.key)}<option value={`s:${p.key}`}>{p.label}</option>{/each}
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
