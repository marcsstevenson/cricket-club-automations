<script lang="ts">
  let { name, size = 'lg', alt = '' }: { name: string; size?: 'lg' | 'sm'; alt?: string } = $props();
  let failed = $state(false);
  const src = $derived(failed ? '/brand/pcc-ball-teal.png' : `/mascots/${name}${size === 'sm' ? '-sm' : ''}.webp`);
</script>

<span class="mascot {size}"><img {src} {alt} onerror={() => (failed = true)} /></span>

<style>
  .mascot { display: inline-grid; place-items: center; background: #fff; border-radius: 12px; overflow: hidden; flex: none; }
  .lg { width: 112px; height: 112px; }
  .sm { width: 72px; height: 72px; }
  img { width: 100%; height: 100%; object-fit: contain; }
</style>
