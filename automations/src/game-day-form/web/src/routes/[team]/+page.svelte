<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Mascot from '$lib/Mascot.svelte';
  import GamePicker from '$lib/game/GamePicker.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const team = $derived(data.team);
  const gameId = $derived(page.url.searchParams.get('game') ?? team.defaultGameId);

  function select(id: string) {
    goto(`?game=${encodeURIComponent(id)}`, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head><title>{team.team.name} · Game day report</title></svelte:head>

<section class="team-band">
  <Mascot name={team.team.mascot} alt="" />
  <div>
    <h1>{team.team.name}</h1>
    <p>{[team.team.grade, team.season].filter(Boolean).join(' · ')}</p>
  </div>
</section>

{#if !team.fixture.available}
  <p class="card note">Fixture not available from PlayHQ yet.</p>
{:else if !gameId}
  <GamePicker games={team.fixture.games} selected={null} onselect={select} />
  <p class="card note">No games played yet this season.</p>
{:else}
  <GamePicker games={team.fixture.games} selected={gameId} onselect={select} />
  <!-- GameView is added in Task 17 -->
{/if}
