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

  // Day filter (null until the first list arrives): a YYYY-MM-DD, 'tbc' for games with no date yet, or '' for all days.
  let day = $state<string | null>(null);
  let loading = $state(true);

  const days = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const r of list?.rows ?? []) seen.set(r.date ?? 'tbc', r.date ? r.dateLabel : 'Date TBC');
    return [...seen].sort(([a], [b]) => (a === 'tbc' ? 1 : b === 'tbc' ? -1 : a.localeCompare(b)));
  });
  const shown = $derived((list?.rows ?? []).filter((r) => !day || (r.date ?? 'tbc') === day));
  const exportQs = $derived(new URLSearchParams([...new URLSearchParams(qs), ...(day ? [['date', day]] : [])]).toString());

  /** The last game day on or before today; before the season starts, the next game day. */
  function lastGameDay(r: GamesList): string {
    const dates = [...new Set(r.rows.flatMap((g) => (g.date ? [g.date] : [])))].sort();
    return dates.filter((d) => d <= r.today).at(-1) ?? dates[0] ?? (r.rows.length ? 'tbc' : '');
  }

  $effect(() => {
    const q = qs;
    const mine = ++seq;
    loading = true;
    api()
      .games(q)
      .then((r) => {
        if (mine !== seq) return;
        list = r;
        error = '';
        const kept = day === '' || r.rows.some((g) => (g.date ?? 'tbc') === day);
        if (day === null || !kept) day = lastGameDay(r);
      })
      .catch(() => {
        if (mine === seq) error = 'Could not load games.';
      })
      .finally(() => {
        if (mine === seq) loading = false;
      });
  });
</script>

<svelte:head><title>All games · Parklands Cricket Club</title></svelte:head>

<section class="hero"><h1>All games</h1><p>Current season, every team.</p></section>

<form class="card filters" onsubmit={(e) => e.preventDefault()}>
  <div class="pickers">
    <label class="field">Day
      <select bind:value={day} disabled={!list}>
        <option value="">All days</option>
        {#each days as [value, label] (value)}<option {value}>{label}</option>{/each}
      </select>
    </label>
    <label class="field">Team
      <select bind:value={team}>
        <option value="">All teams</option>
        {#each data.teams as t (t.slug)}<option value={t.slug}>{t.name}</option>{/each}
      </select>
    </label>
  </div>
  <fieldset>
    <legend>Status</legend>
    <div class="choices">
      {#each STATUSES as s (s)}
        <label class="choice"><input type="checkbox" value={s} bind:group={statuses} /> {STATUS_TEXT[s]}</label>
      {/each}
      <label class="choice"><input type="checkbox" bind:checked={followUp} /> Needs follow-up</label>
    </div>
  </fieldset>
  <p class="exports">
    <a class="btn-secondary" href="/api/export/games.csv{exportQs ? `?${exportQs}` : ''}" download>Export games</a>
    <a class="btn-secondary" href="/api/export/milestones.csv{exportQs ? `?${exportQs}` : ''}" download>Export milestones</a>
  </p>
</form>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if loading}
  <p class="loading" role="status"><span class="spinner" aria-hidden="true"></span> Loading games…</p>
{/if}

{#if list}
  <ul class="games" class:stale={loading}>
    {#each shown as r (r.teamSlug + r.gameId)}
      <li class="card game-card" class:missing={r.status === 'missing'}>
        <div class="game-head">
          <strong>{r.teamName}</strong>
          <span class="badge badge-{r.status}">{STATUS_TEXT[r.status]}</span>
        </div>
        <a href="/{r.teamSlug}?game={r.gameId}">{r.round} v {r.opposition}</a>
        <small class="note">{day ? '' : `${r.dateLabel} · `}{r.venue}</small>
        <dl>
          {#if r.scoring}
            <div class="wide"><dt>PlayHQ scoring</dt><dd>{SCORING_TEXT[r.scoring]}{#if r.issues}<small>{r.issues}</small>{/if}</dd></div>
          {/if}
          {#if r.notPlayedReason}
            <div class="wide"><dt>Reason</dt><dd>{r.notPlayedReason === 'other' ? r.notPlayedOther : REASON_TEXT[r.notPlayedReason]}</dd></div>
          {/if}
          {#if r.score}<div><dt>Score</dt><dd>{r.score}</dd></div>{/if}
          {#if r.potd}<div><dt>Player</dt><dd>{r.potd}</dd></div>{/if}
          {#if r.mascot}<div><dt>Mascot</dt><dd>{r.mascot}</dd></div>{/if}
          {#if r.milestoneCount}
            <div><dt>Milestones</dt><dd>{r.milestoneCount}{r.uncheckedCount ? ` (${r.uncheckedCount} to check)` : ''}</dd></div>
          {/if}
        </dl>
      </li>
    {:else}
      <li class="card">No games match these filters.</li>
    {/each}
  </ul>
{/if}

<style>
  .filters { padding-top: 4px; }
  .pickers { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 0 12px; }
  .filters fieldset { border: 0; padding: 0; margin: 12px 0 0; }
  .filters legend { float: none; margin: 0; font-size: 1rem; }
  .choices { display: flex; flex-wrap: wrap; gap: 0 20px; }
  .choices .choice { padding: 6px 0; }
  .exports { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; }
  .loading { display: flex; align-items: center; gap: 10px; color: var(--pcc-grey-600); }
  .spinner {
    width: 22px; height: 22px; flex: none; border-radius: 50%;
    border: 3px solid var(--pcc-grey-300); border-top-color: var(--pcc-teal-600);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
  .games { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; transition: opacity 0.2s; }
  .games.stale { opacity: 0.5; }
  .game-card { margin: 0; display: flex; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
  .game-card.missing { background: #fbe4e2; border-left: 4px solid var(--pcc-error); }
  .game-card.missing .badge { background: var(--pcc-surface); border-color: var(--pcc-error); }
  .game-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .game-head .badge { flex: none; }
  dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; margin: 8px 0 0; }
  dl:empty { display: none; }
  dl .wide { grid-column: 1 / -1; }
  dt { font-size: 0.75rem; text-transform: uppercase; color: var(--pcc-grey-600); }
  dd { margin: 0; }
  dd small { display: block; color: var(--pcc-grey-600); }
</style>
