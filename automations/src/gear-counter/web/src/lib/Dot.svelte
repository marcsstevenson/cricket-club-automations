<script lang="ts">
  import { DOT_COLOURS } from '$shared/data';

  let { colour, size = 'sm' }: { colour: string | null; size?: 'sm' | 'lg' } = $props();
  const hex = $derived(colour ? DOT_COLOURS[colour] : undefined);
</script>

<span
  class="dot {size}"
  class:none={!hex}
  style:background={hex}
  role="img"
  aria-label={colour ? `${colour} dot` : 'No dot colour'}
  title={colour ? `${colour} dot` : 'No dot colour yet'}
></span>

<style>
  .dot { display: inline-block; flex: none; border-radius: 50%; border: 1px solid rgb(0 0 0 / 0.2); }
  .sm { width: 0.85rem; height: 0.85rem; }
  .lg { width: 1.2rem; height: 1.2rem; }
  .none { background: transparent; border: 2px dashed var(--pcc-grey-600); }
</style>
