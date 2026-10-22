<script lang="ts">
  import { admin, adminError, adminFetch, lock, unlock } from '$lib/admin.svelte';
  import type { AdminTeamSummary } from '$shared/api';

  let passcode = $state(admin.passcode);
  const ok = $derived(admin.passcode !== '');
  let msg = $state('');
  let busy = $state(false);

  async function check() {
    busy = true;
    msg = '';
    try {
      const res = await fetch('/api/admin/check', { headers: { 'x-admin-passcode': passcode } });
      if (res.ok) unlock(passcode);
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
      const res = await adminFetch(`/export/${name}.csv`);
      if (!res.ok) {
        msg = adminError(res, null, 'Download failed.');
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

  let teams = $state<AdminTeamSummary[] | null>(null);
  let teamsMsg = $state('');

  async function loadTeams() {
    teamsMsg = '';
    try {
      const res = await adminFetch('/teams');
      const body = await res.json().catch(() => null);
      if (res.ok) teams = body.teams;
      else teamsMsg = adminError(res, body, 'Could not load the teams.');
    } catch {
      teamsMsg = 'Could not reach the server — check your connection.';
    }
  }

  $effect(() => {
    if (ok && teams === null) loadTeams();
  });

  const reminders = (t: AdminTeamSummary) => (t.toCount ? `${t.toCount} To${t.ccCount ? `, ${t.ccCount} Cc` : ''}` : 'No reminders');
</script>

<svelte:head><title>Admin · Parklands Cricket Club</title></svelte:head>

<section class="hero"><h1>Admin</h1><p>Exports with full player names (keep these files private), and each team's reminder emails.</p></section>

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

  <section class="card">
    <h2>Teams</h2>
    <p class="note">At 6 pm on a game day, teams that haven't filled in their report get an email. Open a team to set who gets it.</p>
    {#if teams}
      <table class="admin-teams">
        <thead><tr><th>Team</th><th>Grade</th><th>Players</th><th>Reminders</th></tr></thead>
        <tbody>
          {#each teams as t (t.slug)}
            <tr>
              <td><a href="/admin/teams/{t.slug}">{t.name}</a></td>
              <td>{t.gradeName || '—'}</td>
              <td>{t.playerCount}</td>
              <td class:none={!t.toCount}>{reminders(t)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if teamsMsg}
      <p class="error" role="alert">{teamsMsg}</p>
    {:else}
      <p class="note">Loading…</p>
    {/if}
  </section>
{/if}
{#if msg}<p class="error" role="alert">{msg}</p>{/if}

<style>
  h2 { margin-top: 0; }
  .admin-teams { width: 100%; border-collapse: collapse; }
  .admin-teams th { text-align: left; font-size: 0.75rem; text-transform: uppercase; color: var(--pcc-grey-600); }
  .admin-teams th, .admin-teams td { padding: 8px 8px 8px 0; border-bottom: 1px solid var(--pcc-grey-300); vertical-align: top; }
  .admin-teams td.none { color: var(--pcc-grey-600); }
  @media (max-width: 560px) {
    .admin-teams th:nth-child(2), .admin-teams td:nth-child(2) { display: none; }
  }
</style>
