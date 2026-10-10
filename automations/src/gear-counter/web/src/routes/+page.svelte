<script lang="ts">
  import Dot from '$lib/Dot.svelte';
  import Mascot from '$lib/Mascot.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<section class="hero">
  <h1>Gear counter</h1>
  <p>Choose a team or pool to see and update its gear.</p>
</section>

<ul class="team-grid">
  {#each data.teams as t (t.slug)}
    <li>
      <a class="team-card" href="/{t.slug}">
        <Mascot name={t.mascot} size="sm" />
        <span class="team-name">{t.name}</span>
        <span class="team-meta">{#if t.grade}<Dot colour={t.dot} />{t.grade}{:else}{t.description ?? 'Spare gear in storage'}{/if}</span>
      </a>
    </li>
  {/each}
</ul>
