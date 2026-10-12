<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Mascot from '$lib/Mascot.svelte';
  import GamePicker from '$lib/game/GamePicker.svelte';
  import GameView from '$lib/game/GameView.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const team = $derived(data.team);
  const gameId = $derived(page.url.searchParams.get('game') || team.defaultGameId);
  const chosen = $derived(team.fixture.games.find((g) => g.gameId === gameId));

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
  <p class="card note">No games in the fixture yet.</p>
{:else}
  <GamePicker games={team.fixture.games} selected={gameId} onselect={select} />
  {#if !chosen}
    <p class="card note">This game isn't in the fixture.</p>
  {:else}
    {#key gameId}<GameView {team} game={chosen} />{/key}
  {/if}
{/if}
