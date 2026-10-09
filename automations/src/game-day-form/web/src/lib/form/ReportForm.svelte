<script lang="ts">
  import { api } from '$lib/api';
  import type { TeamPage } from '$shared/api';
  import { merge } from '$shared/merge';
  import { withChecks } from '$shared/milestone-rules';
  import { milestoneRuleText, REASON_TEXT, SCORING_TEXT } from '$shared/text';
  import type { FormState, MilestoneRow } from '$shared/types';
  import FieldError from './FieldError.svelte';
  import type { GameForm } from './game-form.svelte';
  import MilestoneList from './MilestoneList.svelte';
  import NumberInput from './NumberInput.svelte';
  import PhotoPicker from './PhotoPicker.svelte';
  import PlayerPicker from './PlayerPicker.svelte';

  let { form, team, gameId, onnext }: { form: GameForm; team: TeamPage; gameId: string; onnext: () => void } = $props();

  const SCORINGS = ['yes', 'no', 'yes_issues', 'not_played'] as const;
  const REASONS = ['rain', 'cancelled', 'forfeit', 'other'] as const;
  const fromPlayhq = $derived(form.state.scoreSource === 'playhq');
  const opposition = $derived(team.fixture.games.find((g) => g.gameId === gameId)?.opposition ?? 'Opposition');
  let refreshing = $state(false);
  let refreshMsg = $state('');

  const rule = $derived(form.start?.rule ?? { kind: 'open' as const });
  const ruleText = $derived(milestoneRuleText(rule));

  // Keep check flags in step with the rows (added rows, player changes, resumed drafts). Writes only on change.
  $effect(() => {
    const start = form.start;
    if (!start) return;
    const cur = $state.snapshot(form.state.milestones) as MilestoneRow[];
    const next = withChecks(cur, start);
    if (JSON.stringify(next) !== JSON.stringify(cur)) form.state.milestones = next;
  });

  async function refresh() {
    refreshing = true;
    refreshMsg = 'Checking PlayHQ…';
    try {
      const r = await api().refresh(team.team.slug, gameId);
      form.start = r.start;
      if (r.rateLimited) {
        refreshMsg = 'Just refreshed — try again in a minute.';
        return;
      }
      const { next, changes } = merge($state.snapshot(form.state) as FormState, r.start);
      form.state = next;
      refreshMsg = changes.join(' · ');
    } catch {
      refreshMsg = "Couldn't reach PlayHQ — try again later.";
    } finally {
      refreshing = false;
    }
  }
</script>

{#snippet refreshButton()}
  <div class="refresh">
    <button type="button" class="btn-secondary" onclick={refresh} disabled={refreshing}>Refresh from PlayHQ</button>
    {#if refreshMsg}<p class="note" role="status">{refreshMsg}</p>{/if}
  </div>
{/snippet}

<form novalidate onsubmit={(e) => { e.preventDefault(); onnext(); }}>
  <fieldset class="card" id="sec-scoring">
    <legend>Did you score this game electronically on PlayHQ?</legend>
    {#each SCORINGS as v (v)}
      {#if !(v === 'no' && fromPlayhq)}
        <label class="choice"><input type="radio" name="scoring" value={v} bind:group={form.state.scoring} /> {SCORING_TEXT[v]}</label>
      {/if}
    {/each}
    <FieldError msg={form.errors.scoring} />

    {#if form.state.scoring === 'yes_issues'}
      <label class="field" for="issues">What were the issues?</label>
      <textarea id="issues" rows="3" maxlength="2000" bind:value={form.state.issues}></textarea>
      <FieldError msg={form.errors.issues} />
    {/if}

    {#if form.state.scoring === 'not_played'}
      <p class="field">Reason</p>
      {#each REASONS as r (r)}
        <label class="choice"><input type="radio" name="reason" value={r} bind:group={form.state.notPlayedReason} /> {REASON_TEXT[r]}</label>
      {/each}
      <FieldError msg={form.errors.notPlayedReason} />
      {#if form.state.notPlayedReason === 'other'}
        <label class="field" for="not-played-other">Why wasn't it played?</label>
        <input id="not-played-other" type="text" maxlength="200" bind:value={form.state.notPlayedOther} />
        <FieldError msg={form.errors.notPlayedOther} />
      {/if}
    {/if}
  </fieldset>

  {#if form.state.scoring !== 'not_played'}
    <fieldset class="card" id="sec-scores">
      <legend>Scores</legend>
      {#if fromPlayhq}<span class="badge badge-phq">From PlayHQ</span>{/if}
      <h3>{team.team.name} score</h3>
      <NumberInput id="team-wkts" label="Wickets" maxDigits={2} readonly={fromPlayhq} bind:value={form.state.team.wkts} error={form.errors['team.wkts']} />
      <NumberInput id="team-runs" label="Runs" readonly={fromPlayhq} bind:value={form.state.team.runs} error={form.errors['team.runs']} />
      <h3>{opposition} score</h3>
      <NumberInput id="opp-wkts" label="Wickets" maxDigits={2} readonly={fromPlayhq} bind:value={form.state.opp.wkts} error={form.errors['opp.wkts']} />
      <NumberInput id="opp-runs" label="Runs" readonly={fromPlayhq} bind:value={form.state.opp.runs} error={form.errors['opp.runs']} />
      {@render refreshButton()}
    </fieldset>

    <fieldset class="card" id="sec-awards">
      <legend>Awards</legend>
      <PlayerPicker id="potd" label="Player of the day (previous win count)" squad={team.squad} bind:value={form.state.potd} error={form.errors.potd} wins={team.awards.potd} {gameId} award="Player of the day" games={team.fixture.games} />
      <PlayerPicker id="mascot" label="Mascot of the day (previous win count)" squad={team.squad} bind:value={form.state.mascot} error={form.errors.mascot} wins={team.awards.mascot} {gameId} award="Mascot of the day" games={team.fixture.games} />
    </fieldset>

    <fieldset class="card" id="sec-highlights">
      <legend>Highlights</legend>
      <label class="field" for="highlights">Any game highlights, special moments or comments you'd like to add?</label>
      <textarea id="highlights" rows="4" maxlength="5000" bind:value={form.state.highlights}></textarea>
      <PhotoPicker {form} />
    </fieldset>

    <fieldset class="card" id="sec-milestones">
      <legend>Milestones</legend>
      {#if rule.kind === 'pairs'}
        <details class="explainer">
          <summary>How are these worked out?</summary>
          <p>
            In pairs cricket, milestones only count a player's fair share: their <strong>first {rule.batBalls} balls</strong>
            batting and <strong>first {rule.bowlOvers} overs</strong> bowling. We fill these in from PlayHQ where we can.
            PlayHQ shows totals, not ball-by-ball, so when a player batted or bowled more than their share we can't tell
            whether the milestone came inside it. Those are marked ⚠ for you to check against the scorebook. Please don't
            remove a milestone we've filled in unless the scorebook shows it's wrong.
          </p>
        </details>
      {/if}
      <MilestoneList {form} type="bat" squad={team.squad} title="Batting milestone" hint={ruleText.bat} valueLabel="Runs (25 or more)" />
      <MilestoneList {form} type="bowl" squad={team.squad} title="Bowling milestone" hint={ruleText.bowl} valueLabel="Wickets (3+)" maxDigits={2} />
      <MilestoneList {form} type="hattrick" squad={team.squad} title="Hat-trick" hint={ruleText.hattrick} />
      {@render refreshButton()}
    </fieldset>
  {/if}

  <fieldset class="card" id="sec-name">
    <legend>Your name (optional)</legend>
    <input id="updated-by" type="text" maxlength="80" autocomplete="name" bind:value={form.state.updatedBy} />
  </fieldset>

  <button type="submit" class="btn">Next: review</button>
</form>

<style>
  .refresh { margin-top: 24px; }
</style>
