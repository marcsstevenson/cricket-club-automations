<script lang="ts">
  import { api } from '$lib/api';
  import { PhotoReadError, resizePhoto } from '$lib/photos/resize';
  import type { GameForm } from './game-form.svelte';
  import FieldError from './FieldError.svelte';

  let { form }: { form: GameForm } = $props();
  let busy = $state(false);
  let msg = $state('');

  async function pick(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = '';
    msg = '';
    for (const file of files) {
      if (form.state.photoIds.length >= 5) {
        msg = 'You can add up to 5 photos.';
        break;
      }
      busy = true;
      try {
        const { id } = await api().uploadPhoto(await resizePhoto(file));
        form.state.photoIds.push(id);
      } catch (e) {
        msg = e instanceof PhotoReadError ? "Couldn't read this photo — try a JPEG or PNG." : 'Upload failed — try again.';
      } finally {
        busy = false;
      }
    }
  }
</script>

<div class="thumbs">
  {#each form.state.photoIds as id (id)}
    <figure>
      <img src="/api/photos/{id}" alt="Attached to this report" loading="lazy" />
      <button type="button" class="btn-link" onclick={() => (form.state.photoIds = form.state.photoIds.filter((p) => p !== id))}>Remove</button>
    </figure>
  {/each}
</div>
{#if form.state.photoIds.length < 5}
  <label class="btn-secondary pick">
    {busy ? 'Uploading…' : 'Add photos'}
    <input type="file" accept="image/*" multiple class="sr-only" disabled={busy} onchange={(e) => pick(e.currentTarget)} />
  </label>
{/if}
<FieldError msg={msg || form.errors.photoIds} />

<style>
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .pick { position: relative; display: inline-block; cursor: pointer; }
  .pick:focus-within { outline: 3px solid var(--pcc-teal-600); outline-offset: 2px; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
  figure { margin: 0; width: 96px; }
  img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--radius); display: block; }
</style>
