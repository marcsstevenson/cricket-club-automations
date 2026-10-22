<script lang="ts">
  import { page } from '$app/state';
  import { admin, adminError, adminFetch } from '$lib/admin.svelte';
  import type { AdminTeamDetail, ReminderLists } from '$shared/api';

  const slug = $derived(page.params.slug ?? '');
  const ok = $derived(admin.passcode !== '');

  let team = $state<AdminTeamDetail | null>(null);
  let loadMsg = $state('');

  // Reminder lists as typed: one address per line, or comma-separated.
  let to = $state('');
  let cc = $state('');
  let saved = $state({ to: '', cc: '' });
  let error = $state('');
  let note = $state('');
  let busy = $state(false);

  const lines = (l: string[]) => l.join('\n');
  const split = (text: string) => text.split(/[\s,;]+/).filter(Boolean);
  const dirty = $derived(to !== saved.to || cc !== saved.cc);

  function show(r: ReminderLists) {
    to = lines(r.to);
    cc = lines(r.cc);
    saved = { to, cc };
  }

  async function load(s: string) {
    loadMsg = '';
    team = null;
    try {
      const res = await adminFetch(`/teams/${encodeURIComponent(s)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        loadMsg = res.status === 404 ? 'Team not found.' : adminError(res, body, 'Could not load the team.');
        return;
      }
      team = body;
      show(body.reminders);
    } catch {
      loadMsg = 'Could not reach the server — check your connection.';
    }
  }

  $effect(() => {
    if (ok) load(slug);
  });

  /** Saves the lists; true when they're saved. */
  async function save(): Promise<boolean> {
    error = note = '';
    const res = await adminFetch(`/teams/${encodeURIComponent(slug)}/reminders`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: split(to), cc: split(cc) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      error = adminError(res, body, 'Saving failed.');
      return false;
    }
    show(body);
    return true;
  }

  async function run(action: () => Promise<void>) {
    busy = true;
    try {
      await action();
    } catch {
      error = 'Could not reach the server — check your connection.';
    } finally {
      busy = false;
    }
  }

  const onSave = () =>
    run(async () => {
      if (await save()) note = 'Reminders saved.';
    });

  const onTest = () =>
    run(async () => {
      if (dirty && !(await save())) return;
      error = note = '';
      const res = await adminFetch(`/teams/${encodeURIComponent(slug)}/test`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (res.ok) note = `Test sent to ${(body.sentTo as string[]).join(', ')}.`;
      else error = adminError(res, body, 'The test email failed.');
    });
</script>

<svelte:head><title>{team?.name ?? 'Team'} · Admin · Parklands Cricket Club</title></svelte:head>

<p class="back"><a href="/admin">← All teams</a></p>

{#if !ok}
  <div class="card"><p><a href="/admin">Enter the admin passcode</a> to see this team.</p></div>
{:else if team}
  <section class="hero"><h1>{team.name}</h1><p>{team.gradeName || 'No grade yet'}</p></section>

  <form class="card" onsubmit={(e) => { e.preventDefault(); onSave(); }}>
    <h2>Reminder emails</h2>
    <p class="note">At 6 pm on a game day, if this team hasn't filled in its report, these addresses get an email. Put one address per line, or separate them with commas.</p>
    <div class="lists">
      <label class="field">To<textarea rows="3" bind:value={to} spellcheck="false" autocomplete="off" class:invalid={error}></textarea></label>
      <label class="field">Cc<textarea rows="3" bind:value={cc} spellcheck="false" autocomplete="off" class:invalid={error}></textarea></label>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if note}<p class="sent" role="status">{note}</p>{/if}
    <p class="actions">
      <button class="btn" disabled={busy || !dirty}>Save reminders</button>
      <button type="button" class="btn-secondary" disabled={busy} onclick={onTest}>Send test</button>
    </p>
  </form>

  <section class="card">
    <h2>Team details</h2>
    <p class="note">From the club's Team Formation sheet and PlayHQ. Changes come through the squad refresh.</p>
    <dl class="details">
      <div><dt>Grade</dt><dd>{team.gradeName || '—'}</dd></div>
      <div><dt>PlayHQ grade ID</dt><dd>{team.playhqGradeId || 'Not allocated yet'}</dd></div>
      <div><dt>PlayHQ team ID</dt><dd>{team.playhqTeamId}</dd></div>
      <div><dt>Web address</dt><dd><a href="/{team.slug}">/{team.slug}</a></dd></div>
    </dl>
  </section>

  <section class="card">
    <h2>Players ({team.players.length})</h2>
    <p class="note">Full names — admin only. The form shows the label.</p>
    {#if team.players.length}
      <table class="players">
        <thead><tr><th>First name</th><th>Last name</th><th>Shown as</th><th>PlayHQ</th></tr></thead>
        <tbody>
          {#each team.players as p (p.key)}
            <tr><td>{p.firstName}</td><td>{p.lastName}</td><td>{p.label}</td><td class:none={!p.playhqId}>{p.playhqId ? 'Linked' : 'Not linked'}</td></tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p>No players yet.</p>
    {/if}
  </section>
{:else if loadMsg}
  <p class="error" role="alert">{loadMsg}</p>
{:else}
  <p class="note">Loading…</p>
{/if}

<style>
  .back { margin: 0 0 12px; }
  h2 { margin-top: 0; }
  .lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 0 12px; }
  .lists textarea { width: 100%; font: inherit; resize: vertical; }
  textarea.invalid { border-color: var(--pcc-error); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 0; }
  .sent { color: var(--pcc-teal-600); }
  .details { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; margin: 0; }
  dt { font-size: 0.75rem; text-transform: uppercase; color: var(--pcc-grey-600); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .players { width: 100%; border-collapse: collapse; }
  .players th { text-align: left; font-size: 0.75rem; text-transform: uppercase; color: var(--pcc-grey-600); }
  .players th, .players td { padding: 6px 8px 6px 0; border-bottom: 1px solid var(--pcc-grey-300); }
  .players td.none { color: var(--pcc-grey-600); }
</style>
