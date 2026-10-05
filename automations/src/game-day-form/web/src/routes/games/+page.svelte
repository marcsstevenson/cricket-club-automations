<script lang="ts">
  import { api } from '$lib/api';
  import type { GamesList, ListStatus } from '$shared/api';
  import { REASON_TEXT, SCORING_TEXT, STATUS_TEXT } from '$shared/text';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const STATUSES: ListStatus[] = ['missing', 'reported', 'not_played', 'upcoming'];

  let team = $state('');
  let statuses = $state<ListStatus[]>([]);
  let followUp = $state(false);
  let list = $state<GamesList | null>(null);
  let error = $state('');
  let seq = 0;

  const qs = $derived(
    new URLSearchParams({
      ...(team ? { team } : {}),
      ...(statuses.length ? { status: statuses.join(',') } : {}),
      ...(followUp ? { followUp: '1' } : {}),
    }).toString(),
  );

  $effect(() => {
    const q = qs;
    const mine = ++seq;
    api()
      .games(q)
      .then((r) => {
        if (mine === seq) {
          list = r;
          error = '';
        }
      })
      .catch(() => {
        if (mine === seq) error = 'Could not load games.';
      });
  });
</script>

<svelte:head><title>All games · Parklands Cricket Club</title></svelte:head>

<section class="hero"><h1>All games</h1><p>Current season, every team.</p></section>

<form class="card filters" onsubmit={(e) => e.preventDefault()}>
  <label class="field">Team
    <select bind:value={team}>
      <option value="">All teams</option>
      {#each data.teams as t (t.slug)}<option value={t.slug}>{t.name}</option>{/each}
    </select>
  </label>
  <fieldset>
    <legend>Status</legend>
    {#each STATUSES as s (s)}
      <label class="choice"><input type="checkbox" value={s} bind:group={statuses} /> {STATUS_TEXT[s]}</label>
    {/each}
  </fieldset>
  <label class="choice"><input type="checkbox" bind:checked={followUp} /> Needs follow-up</label>
  <p>
    <a class="btn-secondary" href="/api/export/games.csv{qs ? `?${qs}` : ''}" download>Export games</a>
    <a class="btn-secondary" href="/api/export/milestones.csv{qs ? `?${qs}` : ''}" download>Export milestones</a>
  </p>
</form>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if list}
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Date</th><th>Team</th><th>Game</th><th>Status</th><th>PlayHQ scoring</th><th>Score</th><th>Player</th><th>Mascot</th><th>Milestones</th></tr>
      </thead>
      <tbody>
        {#each list.rows as r (r.teamSlug + r.gameId)}
          <tr class:missing={r.status === 'missing'}>
            <td>{r.dateLabel}</td>
            <td>{r.teamName}</td>
            <td><a href="/{r.teamSlug}?game={r.gameId}">{r.round} v {r.opposition}</a><br /><small>{r.venue}</small></td>
            <td><span class="badge badge-{r.status}">{STATUS_TEXT[r.status]}</span></td>
            <td>
              {r.scoring ? SCORING_TEXT[r.scoring] : ''}
              {#if r.issues}<br /><small>{r.issues}</small>{/if}
              {#if r.notPlayedReason}<br /><small>{r.notPlayedReason === 'other' ? r.notPlayedOther : REASON_TEXT[r.notPlayedReason]}</small>{/if}
            </td>
            <td>{r.score ?? ''}</td>
            <td>{r.potd ?? ''}</td>
            <td>{r.mascot ?? ''}</td>
            <td>{r.milestoneCount || ''}</td>
          </tr>
        {:else}
          <tr><td colspan="9">No games match these filters.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .filters fieldset { border: 0; padding: 0; margin: 8px 0; }
  .filters legend { float: none; font-size: 1rem; }
  .table-wrap { overflow-x: auto; background: var(--pcc-surface); border: 1px solid var(--pcc-grey-300); }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--pcc-grey-300); vertical-align: top; }
  th { font-family: var(--font-head); text-transform: uppercase; color: var(--pcc-navy-700); }
  tr.missing { background: #fbe4e2; }
</style>
