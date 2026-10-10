<script lang="ts">
  import { dateLabel } from '$shared/dates';
  import { DOT_COLOURS, MASCOTS, specColumns } from '$shared/data';
  import type { AdminTeam, NewTeam, TeamKind } from '$shared/types';
  import { admin, lock, unlock } from '$lib/admin.svelte';
  import Dot from '$lib/Dot.svelte';

  let passcode = $state(admin.passcode);
  let ok = $state(false);
  let teams = $state<AdminTeam[]>([]);
  let msg = $state('');
  let notice = $state('');
  let busy = $state(false);

  // Add forms: the web address follows the name until it is edited by hand.
  const blank = (kind: TeamKind) => ({ kind, name: '', slug: '', slugEdited: false, spec: '', grade: '', dot: '', mascot: '' });
  let team = $state(blank('team'));
  let pool = $state(blank('pool'));
  const slugify = (name: string) =>
    name.toLowerCase().replace(/^parklands\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

  async function call(path: string, init: RequestInit = {}): Promise<Response | null> {
    msg = '';
    let res: Response;
    try {
      res = await fetch(`/api/admin${path}`, { ...init, headers: { ...init.headers, 'x-admin-passcode': passcode } });
    } catch {
      msg = 'Could not reach the server — check your connection.';
      return null;
    }
    if (res.ok) return res;
    if (res.status === 401) {
      ok = false;
      lock();
      msg = 'Wrong passcode — enter it again.';
    } else {
      const body = await res.json().catch(() => null);
      msg = body?.message ?? 'Something went wrong.';
    }
    return null;
  }

  async function load() {
    const res = await call('/teams');
    if (res) teams = await res.json();
  }

  async function enter() {
    busy = true;
    try {
      if (await call('/check')) {
        unlock(passcode);
        ok = true;
        await load();
      }
    } finally {
      busy = false;
    }
  }

  // Already unlocked in this tab: go straight in.
  $effect(() => {
    if (admin.passcode && !ok) void enter();
  });

  async function download(path: string) {
    const res = await call(path);
    if (!res) return;
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export.csv';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function setHidden(t: AdminTeam, hidden: boolean) {
    const res = await call(`/teams/${t.slug}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hidden }) });
    if (res) {
      const updated: AdminTeam = await res.json();
      teams = teams.map((x) => (x.slug === updated.slug ? updated : x));
      notice = `${t.name} is ${hidden ? 'hidden' : 'visible again'}.`;
    }
  }

  async function add(form: typeof team) {
    notice = '';
    const body: NewTeam =
      form.kind === 'pool'
        ? { kind: 'pool', name: form.name, slug: form.slug }
        : { kind: 'team', name: form.name, slug: form.slug, spec: form.spec, grade: form.grade || null, dot: form.dot || null, mascot: form.mascot };
    busy = true;
    try {
      const res = await call('/teams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res) return;
      const created: AdminTeam = await res.json();
      await load();
      notice = `Added ${created.name} at /${created.slug}.`;
      if (form.kind === 'pool') pool = blank('pool');
      else team = blank('team');
    } finally {
      busy = false;
    }
  }

  const kindText = (t: AdminTeam) => (t.kind === 'pool' ? 'Pool' : t.grade === t.spec ? t.grade : `${t.grade} (${t.spec})`);
</script>

<svelte:head><title>Admin · Gear counter</title><meta name="robots" content="noindex" /></svelte:head>

<section class="hero"><h1>Gear admin</h1><p>Add teams and pools, hide them, and download counts.</p></section>

{#if !ok}
  <form class="card" onsubmit={(e) => { e.preventDefault(); void enter(); }}>
    <label class="field" for="passcode">Admin passcode</label>
    <input id="passcode" type="password" autocomplete="current-password" bind:value={passcode} />
    <p><button class="btn" disabled={busy || !passcode}>Continue</button></p>
  </form>
{:else}
  <div class="card">
    <h2>Downloads</h2>
    <p class="note">Each team's latest stocktake.</p>
    <button type="button" class="btn" onclick={() => download('/export/club.csv')}>Club inventory (CSV)</button>
  </div>

  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if msg}<p class="error" role="alert">{msg}</p>{/if}

  <h2>Teams and pools</h2>
  <ul class="lines admin-list">
    {#each teams as t (t.slug)}
      <li class="line" class:hidden-row={t.hidden} data-team={t.slug}>
        <div class="line-text">
          <span class="line-name">{t.name}</span>
          {#if t.hidden}<span class="tag">Hidden</span>{/if}
          <span class="team-meta">
            {#if t.kind === 'team'}<Dot colour={t.dot} />{/if}{kindText(t)} · /{t.slug} · {t.latest ? `Latest ${dateLabel(t.latest)}` : 'No stocktake'}
          </span>
        </div>
        <div class="row-actions">
          <button type="button" class="small" disabled={!t.latest} aria-label="Download {t.name} CSV" onclick={() => download(`/export/teams/${t.slug}.csv`)}>CSV</button>
          <button type="button" class="small" onclick={() => setHidden(t, !t.hidden)}>{t.hidden ? 'Unhide' : 'Hide'}</button>
        </div>
      </li>
    {/each}
  </ul>

  <form class="card add-form" aria-labelledby="add-team" onsubmit={(e) => { e.preventDefault(); void add(team); }}>
    <h2 id="add-team">Add a team</h2>
    <label class="field" for="team-name">Name</label>
    <input id="team-name" type="text" maxlength="60" required bind:value={team.name} oninput={() => { if (!team.slugEdited) team.slug = slugify(team.name); }} />
    <label class="field" for="team-slug">Web address</label>
    <input id="team-slug" type="text" maxlength="30" required bind:value={team.slug} oninput={() => (team.slugEdited = true)} />
    <label class="field" for="team-spec">Kit Spec</label>
    <select id="team-spec" required bind:value={team.spec}>
      <option value="" disabled>Choose…</option>
      {#each specColumns as s (s)}<option value={s}>{s}</option>{/each}
    </select>
    <label class="field" for="team-grade">Grade shown on the site</label>
    <input id="team-grade" type="text" maxlength="40" placeholder={team.spec || 'Same as the Kit Spec'} bind:value={team.grade} />
    <label class="field" for="team-dot">Dot colour</label>
    <select id="team-dot" bind:value={team.dot}>
      <option value="">None</option>
      {#each Object.keys(DOT_COLOURS) as d (d)}<option value={d}>{d}</option>{/each}
    </select>
    <label class="field" for="team-mascot">Mascot</label>
    <select id="team-mascot" bind:value={team.mascot}>
      <option value="">Ball</option>
      {#each MASCOTS as m (m)}<option value={m}>{m}</option>{/each}
    </select>
    <p><button class="btn" disabled={busy}>Add team</button></p>
  </form>

  <form class="card add-form" aria-labelledby="add-pool" onsubmit={(e) => { e.preventDefault(); void add(pool); }}>
    <h2 id="add-pool">Add a pool</h2>
    <p class="note">A pool starts with every catalogue item at 0.</p>
    <label class="field" for="pool-name">Name</label>
    <input id="pool-name" type="text" maxlength="60" required bind:value={pool.name} oninput={() => { if (!pool.slugEdited) pool.slug = slugify(pool.name); }} />
    <label class="field" for="pool-slug">Web address</label>
    <input id="pool-slug" type="text" maxlength="30" required bind:value={pool.slug} oninput={() => (pool.slugEdited = true)} />
    <p><button class="btn" disabled={busy}>Add pool</button></p>
  </form>
{/if}
{#if !ok && msg}<p class="error" role="alert">{msg}</p>{/if}
<p><a href="/">← All teams</a></p>
