<script lang="ts">
  import { admin, lock, unlock } from '$lib/admin.svelte';
  import type { ReminderTeam } from '$shared/api';

  let passcode = $state(admin.passcode);
  let ok = $state(admin.passcode !== '');
  let msg = $state('');
  let busy = $state(false);

  const headers = () => ({ 'x-admin-passcode': passcode });

  /** Shared handling for a failed admin request; returns the message to show. */
  function failure(res: Response, fallback: string): string {
    if (res.status === 401) {
      ok = false;
      lock();
      return 'Wrong passcode — enter it again.';
    }
    return res.status === 429 ? 'Too many requests — wait a minute.' : fallback;
  }

  async function check() {
    busy = true;
    msg = '';
    try {
      const res = await fetch('/api/admin/check', { headers: headers() });
      ok = res.ok;
      if (ok) unlock(passcode);
      else if (res.status === 401) {
        lock();
        msg = 'Wrong passcode.';
      } else if (res.status === 429) msg = 'Too many attempts — wait a minute.';
      else if (res.status === 503) msg = 'Admin exports are not configured.';
      else msg = 'Something went wrong.';
    } catch {
      msg = 'Could not reach the server — check your connection.';
    } finally {
      busy = false;
    }
  }

  async function download(name: 'games' | 'milestones') {
    msg = '';
    try {
      const res = await fetch(`/api/admin/export/${name}.csv`, { headers: headers() });
      if (!res.ok) {
        msg = failure(res, 'Download failed.');
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}-full-names.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      msg = 'Could not reach the server — check your connection.';
    }
  }

  // Reminder emails: each team's To and Cc lists, edited as text (one address per line, or comma-separated).
  type Draft = { slug: string; name: string; to: string; cc: string; error: string; note: string };
  let drafts = $state<Draft[] | null>(null);
  let remindersMsg = $state('');
  let saving = $state(false);

  const toDraft = (t: ReminderTeam): Draft => ({ slug: t.slug, name: t.name, to: t.to.join('\n'), cc: t.cc.join('\n'), error: '', note: '' });
  const split = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

  async function loadReminders() {
    remindersMsg = '';
    try {
      const res = await fetch('/api/admin/reminders', { headers: headers() });
      if (!res.ok) {
        remindersMsg = failure(res, 'Could not load the reminder emails.');
        return;
      }
      drafts = ((await res.json()) as { teams: ReminderTeam[] }).teams.map(toDraft);
    } catch {
      remindersMsg = 'Could not reach the server — check your connection.';
    }
  }

  $effect(() => {
    if (ok && drafts === null) loadReminders();
  });

  async function saveReminders() {
    if (!drafts) return;
    saving = true;
    remindersMsg = '';
    for (const d of drafts) d.error = d.note = '';
    try {
      const teams = Object.fromEntries(drafts.map((d) => [d.slug, { to: split(d.to), cc: split(d.cc) }]));
      const res = await fetch('/api/admin/reminders', {
        method: 'PUT',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ teams }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        drafts = (body as { teams: ReminderTeam[] }).teams.map(toDraft);
        remindersMsg = 'Reminder emails saved.';
      } else if (res.status === 400 && body?.fields) {
        for (const d of drafts) d.error = body.fields[d.slug] ?? '';
        remindersMsg = body.message;
      } else remindersMsg = failure(res, body?.message ?? 'Saving failed.');
    } catch {
      remindersMsg = 'Could not reach the server — check your connection.';
    } finally {
      saving = false;
    }
  }

  async function sendTest(d: Draft) {
    d.note = d.error = '';
    try {
      const res = await fetch(`/api/admin/reminders/${d.slug}/test`, { method: 'POST', headers: headers() });
      const body = await res.json().catch(() => null);
      if (res.ok) d.note = `Test sent to ${(body.sentTo as string[]).join(', ')}.`;
      else d.error = res.status === 401 || res.status === 429 ? failure(res, '') : (body?.message ?? 'The test email failed.');
    } catch {
      d.error = 'Could not reach the server — check your connection.';
    }
  }
</script>

<svelte:head><title>Admin · Parklands Cricket Club</title></svelte:head>

<section class="hero"><h1>Admin</h1><p>Exports with full player names (keep these files private), and reminder emails.</p></section>

{#if !ok}
  <form class="card" onsubmit={(e) => { e.preventDefault(); check(); }}>
    <label class="field" for="passcode">Admin passcode</label>
    <input id="passcode" type="password" autocomplete="current-password" bind:value={passcode} />
    <p><button class="btn" disabled={busy}>Continue</button></p>
  </form>
{:else}
  <div class="card">
    <p><button type="button" class="btn" onclick={() => download('games')}>Download games (full names)</button></p>
    <p><button type="button" class="btn" onclick={() => download('milestones')}>Download milestones (full names)</button></p>
  </div>

  <form class="card reminders" onsubmit={(e) => { e.preventDefault(); saveReminders(); }}>
    <h2>Reminder emails</h2>
    <p class="note">
      At 6 pm on a game day, teams that haven't filled in their report get an email. Put one address per line, or separate
      them with commas. Save before sending a test.
    </p>
    {#if drafts}
      {#each drafts as d (d.slug)}
        <fieldset class="reminder-team" class:has-error={d.error}>
          <legend>{d.name}</legend>
          <div class="lists">
            <label class="field">To<textarea rows="2" bind:value={d.to} spellcheck="false" autocomplete="off"></textarea></label>
            <label class="field">Cc<textarea rows="2" bind:value={d.cc} spellcheck="false" autocomplete="off"></textarea></label>
          </div>
          {#if d.error}<p class="error">{d.error}</p>{/if}
          {#if d.note}<p class="sent" role="status">{d.note}</p>{/if}
          <button type="button" class="btn-secondary" onclick={() => sendTest(d)}>Send test</button>
        </fieldset>
      {/each}
      <p class="save"><button class="btn" disabled={saving}>{saving ? 'Saving…' : 'Save reminder emails'}</button></p>
    {:else if !remindersMsg}
      <p class="note">Loading…</p>
    {/if}
    {#if remindersMsg}<p role="status">{remindersMsg}</p>{/if}
  </form>
{/if}
{#if msg}<p class="error" role="alert">{msg}</p>{/if}

<style>
  .reminders h2 { margin-top: 0; }
  .reminder-team { border: 0; border-top: 1px solid var(--pcc-grey-300); margin: 0; padding: 12px 0; }
  .reminder-team legend { float: left; width: 100%; padding: 0; margin: 0 0 4px; font-weight: 700; }
  .reminder-team.has-error textarea { border-color: var(--pcc-error); }
  .lists { clear: both; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 0 12px; }
  .lists textarea { width: 100%; font: inherit; resize: vertical; }
  .sent { color: var(--pcc-teal-600); }
  .save { margin-bottom: 0; }
</style>
