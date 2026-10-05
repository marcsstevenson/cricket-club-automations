<script lang="ts">
  let { msg }: { msg?: string } = $props();
</script>

{#if msg}<p class="error" role="alert">{msg}</p>{/if}
