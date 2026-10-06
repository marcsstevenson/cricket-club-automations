<script lang="ts">
  import type { TeamPage } from '$shared/api';
  import { MILESTONE_TEXT, REASON_TEXT, SCORING_TEXT } from '$shared/text';
  import type { FormState, PlayerChoice, Score } from '$shared/types';

  let { report, team, gameId, onedit }: { report: FormState; team: TeamPage; gameId: string; onedit?: (sectionId: string) => void } = $props();

  const opposition = $derived(team.fixture.games.find((g) => g.gameId === gameId)?.opposition ?? 'Opposition');
  const who = (p: PlayerChoice | null) => (!p ? '—' : p.kind === 'other' ? p.fullName : (p.label ?? '—'));
  const score = (s: Score) => (s.runs === null || s.wkts === null ? '—' : `${s.runs}/${s.wkts}`);
  const played = $derived(report.scoring !== 'not_played');
</script>

{#snippet head(title: string, section: string)}
  <header class="row">
    <h3>{title}</h3>
    {#if onedit}<button type="button" class="btn-link" onclick={() => onedit(section)}>Edit</button>{/if}
  </header>
{/snippet}

<section class="card">
  {@render head('PlayHQ scoring', 'sec-scoring')}
  <p>{report.scoring ? SCORING_TEXT[report.scoring] : '—'}</p>
  {#if report.scoring === 'yes_issues'}<p><strong>Issues:</strong> {report.issues}</p>{/if}
  {#if report.scoring === 'not_played' && report.notPlayedReason}
    <p><strong>Reason:</strong> {report.notPlayedReason === 'other' ? report.notPlayedOther : REASON_TEXT[report.notPlayedReason]}</p>
  {/if}
</section>

{#if played}
  <section class="card">
    {@render head('Scores', 'sec-scores')}
    <p>{team.team.name}: <strong>{score(report.team)}</strong></p>
    <p>{opposition}: <strong>{score(report.opp)}</strong></p>
    {#if report.scoreSource === 'playhq'}<span class="badge badge-phq">From PlayHQ</span>{/if}
  </section>

  <section class="card">
    {@render head('Awards', 'sec-awards')}
    <p>Player of the day: <strong>{who(report.potd)}</strong></p>
    <p>Mascot of the day: <strong>{who(report.mascot)}</strong></p>
  </section>

  <section class="card">
    {@render head('Highlights', 'sec-highlights')}
    <p class="pre">{report.highlights || 'None'}</p>
    <div class="thumbs">
      {#each report.photoIds as id (id)}<img src="/api/photos/{id}" alt="Highlight from the game" loading="lazy" />{/each}
    </div>
  </section>

  <section class="card">
    {@render head('Milestones', 'sec-milestones')}
    {#if report.milestones.length}
      <ul>
        {#each report.milestones as m (m.rowId)}
          <li>
            {MILESTONE_TEXT[m.type]}: {who(m.player)}{m.value !== null ? ` — ${m.value} ${m.type === 'bat' ? 'runs' : 'wickets'}` : ''}
            {#if m.check}<span class="badge badge-check">{m.check.checked ? 'Checked ✓' : '⚠ Not checked'}</span>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p>None</p>
    {/if}
  </section>
{/if}

<section class="card">
  {@render head('Your name', 'sec-name')}
  <p>{report.updatedBy || '—'}</p>
</section>

<style>
  .row { display: flex; justify-content: space-between; align-items: baseline; }
  .pre { white-space: pre-wrap; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
  .thumbs img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--radius); }
</style>
