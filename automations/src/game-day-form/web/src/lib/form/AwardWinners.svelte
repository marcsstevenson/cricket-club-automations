<script lang="ts">
  import { previousWinners, winCounts } from '$shared/awards';
  import type { GameOption } from '$shared/api';

  let {
    award,
    wins,
    squad,
    games,
    gameId,
  }: { award: string; wins: Record<string, string[]>; squad: { key: string; label: string }[]; games: GameOption[]; gameId: string } = $props();

  let dialog = $state<HTMLDialogElement>();
  const id = $derived(`${award.toLowerCase().replace(/\W+/g, '-')}-winners`);
  const byId = $derived(new Map(games.map((g) => [g.gameId, g])));
  const labels = $derived(new Map(squad.map((p) => [p.key, p.label])));
  const winners = $derived(previousWinners(wins, gameId, games.map((g) => g.gameId)));
  const counts = $derived(winCounts(wins, squad, gameId));
  const gameText = (gid: string) => {
    const g = byId.get(gid);
    return g ? `${g.dateLabel} · ${g.round} v ${g.opposition}` : 'Earlier game';
  };
</script>

<button type="button" class="icon-btn" aria-label={`${award} winners`} title={`${award} winners`} onclick={() => dialog?.showModal()}>🏆</button>

<!-- Tapping the backdrop closes it; Esc and the close button work too. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="modal" aria-labelledby={id} onclick={(e) => e.target === dialog && dialog?.close()}>
  <div class="modal-body">
    <div class="modal-head">
      <h2 id={id}>{award} — this season</h2>
      <button type="button" class="icon-btn" aria-label="Close" onclick={() => dialog?.close()}>✕</button>
    </div>

    <h3>Previous winners</h3>
    {#if winners.length}
      <ol class="winners">
        {#each winners as w (w.gameId + w.key)}
          <li><span>{gameText(w.gameId)}</span><strong>{labels.get(w.key) ?? 'Former player'}</strong></li>
        {/each}
      </ol>
    {:else}
      <p class="note">No winners yet this season.</p>
    {/if}

    <h3>Win counts</h3>
    <table class="win-counts">
      <thead><tr><th scope="col">Player</th><th scope="col">Wins</th></tr></thead>
      <tbody>
        {#each counts as c (c.key)}<tr><td>{c.label}</td><td>{c.wins}</td></tr>{/each}
      </tbody>
    </table>
  </div>
</dialog>
