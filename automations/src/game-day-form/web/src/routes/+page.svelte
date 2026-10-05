<script lang="ts">
  import Mascot from '$lib/Mascot.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<section class="hero">
  <h1>Game day reports</h1>
  <p>Choose your team to report on a game.</p>
</section>

<ul class="team-grid">
  {#each data.teams as t (t.slug)}
    <li><a class="team-card" href="/{t.slug}"><Mascot name={t.mascot} size="sm" />{t.name}</a></li>
  {/each}
</ul>
<p><a href="/games">See all games →</a></p>
