<script lang="ts">
  import '@fontsource/outfit/latin-700.css';
  import '@fontsource/outfit/latin-800.css';
  import '@fontsource/lexend/latin-400.css';
  import '@fontsource/lexend/latin-600.css';
  import '$lib/styles/tokens.css';
  import '$lib/styles/app.css';

  let { children } = $props();
</script>

<header class="site-header">
  <a href="/"><img src="/brand/pcc-logo-horizontal.svg" alt="Parklands Cricket Club" width="172" height="40" /></a>
  <nav><a href="/games">All games</a></nav>
</header>
<main>{@render children()}</main>
