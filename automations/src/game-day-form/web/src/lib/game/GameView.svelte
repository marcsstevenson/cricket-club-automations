<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { api, ApiFailure } from '$lib/api';
  import Mascot from '$lib/Mascot.svelte';
  import { clearDraft, loadDraft, saveDraft } from '$lib/form/drafts';
  import { GameForm } from '$lib/form/game-form.svelte';
  import ReportForm from '$lib/form/ReportForm.svelte';
  import ReportSummary from '$lib/report/ReportSummary.svelte';
  import type { ReportOut, TeamPage } from '$shared/api';
  import { reportToForm, startForm } from '$shared/merge';
  import type { FormState } from '$shared/types';
  import { validateReport } from '$shared/validation';

  let { team, gameId }: { team: TeamPage; gameId: string } = $props();

  type Mode = 'loading' | 'error' | 'readonly' | 'form' | 'review' | 'done' | 'conflict';
  let mode = $state<Mode>('loading');
  let message = $state('');
  let report = $state<ReportOut | null>(null);
  let latest = $state<ReportOut | null>(null);
  let saving = $state(false);
  let draftOffer = $state(false);
  // svelte-ignore state_referenced_locally
  const form = new GameForm(`draft:${team.team.slug}:${gameId}`);

  const stamp = (iso: string) =>
    new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  onMount(async () => {
    try {
      const page = await api().game(team.team.slug, gameId);
      if (page.report) {
        report = page.report;
        mode = 'readonly';
      } else {
        form.reset(startForm(page.start!), 0);
        offerDraft();
        mode = 'form';
      }
    } catch (e) {
      message = e instanceof ApiFailure ? e.message : 'Could not load this game.';
      mode = 'error';
    }
  });

  // Keep an on-device draft while the coach is editing (functional spec §7.4).
  $effect(() => {
    if (mode !== 'form' && mode !== 'review') return;
    if (draftOffer) return; // keep the stored draft until the coach resumes or discards it
    const snap = JSON.stringify(form.state);
    if (snap === form.initialJson) return;
    const baseVersion = form.baseVersion;
    const t = setTimeout(() => saveDraft(form.draftKey, { state: JSON.parse(snap), baseVersion, savedAt: new Date().toISOString() }), 500);
    return () => clearTimeout(t);
  });

  function offerDraft() {
    const d = loadDraft(form.draftKey);
    draftOffer = !!d && d.baseVersion === form.baseVersion && JSON.stringify(d.state) !== form.initialJson;
  }
  function resumeDraft() {
    const d = loadDraft(form.draftKey);
    if (d) form.state = d.state;
    draftOffer = false;
  }
  function discardDraft() {
    clearDraft(form.draftKey);
    draftOffer = false;
  }

  function edit(from: ReportOut) {
    form.reset(reportToForm(from), from.version);
    offerDraft();
    message = '';
    mode = 'form';
  }

  async function next() {
    form.errors = validateReport($state.snapshot(form.state) as FormState);
    if (Object.keys(form.errors).length === 0) {
      mode = 'review';
      await tick();
      window.scrollTo({ top: 0 });
    } else {
      await tick();
      document.querySelector('.error')?.scrollIntoView({ block: 'center' });
    }
  }

  async function toSection(id: string) {
    mode = 'form';
    await tick();
    document.getElementById(id)?.scrollIntoView();
  }

  async function submit() {
    if (saving) return;
    saving = true;
    message = '';
    try {
      report = await api().save(team.team.slug, gameId, { ...($state.snapshot(form.state) as FormState), baseVersion: form.baseVersion });
      clearDraft(form.draftKey);
      mode = 'done';
      await invalidateAll(); // refresh the dropdown status
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 409) {
        latest = e.body?.latest ?? null;
        mode = 'conflict';
      } else if (e instanceof ApiFailure && e.status === 422) {
        form.errors = e.body?.fields ?? {};
        mode = 'form';
      } else {
        message = e instanceof ApiFailure ? e.message : 'Could not save — check your connection and try again.';
      }
    } finally {
      saving = false;
    }
  }
</script>

{#if mode === 'loading'}
  <p class="note">Loading…</p>
{:else if mode === 'error'}
  <p class="error" role="alert">{message}</p>
{:else if mode === 'readonly' && report}
  <div class="card">
    <p class="note">Last updated {stamp(report.updatedAt)} by {report.updatedBy || 'unknown'}</p>
    <button type="button" class="btn" onclick={() => edit(report!)}>Edit</button>
  </div>
  <ReportSummary {report} {team} {gameId} />
{:else if mode === 'form'}
  {#if draftOffer}
    <div class="banner" role="status">
      Resume your unsaved report?
      <button type="button" class="btn" onclick={resumeDraft}>Resume</button>
      <button type="button" class="btn-secondary" onclick={discardDraft}>Discard</button>
    </div>
  {/if}
  <ReportForm {form} {team} {gameId} onnext={next} />
{:else if mode === 'review'}
  <h2>Check your report</h2>
  <ReportSummary report={form.state} {team} {gameId} onedit={toSection} />
  {#if message}<p class="error" role="alert">{message}</p>{/if}
  <button type="button" class="btn" onclick={submit} disabled={saving}>{saving ? 'Saving…' : 'Submit'}</button>
{:else if mode === 'done' && report}
  <div class="card done">
    <Mascot name={team.team.mascot} />
    <h2>Thanks — report saved.</h2>
  </div>
  <ReportSummary {report} {team} {gameId} />
  <button type="button" class="btn-secondary" onclick={() => (mode = 'readonly')}>Back to the report</button>
{:else if mode === 'conflict'}
  <p class="error" role="alert">This report was updated by someone else — review their version first.</p>
  {#if latest}
    <h2>Their version</h2>
    <ReportSummary report={latest} {team} {gameId} />
  {/if}
  <h2>Your unsaved changes</h2>
  <ReportSummary report={form.state} {team} {gameId} />
  {#if latest}<button type="button" class="btn" onclick={() => edit(latest!)}>Edit their version</button>{/if}
{/if}

<style>
  .done { display: flex; align-items: center; gap: 16px; }
</style>
