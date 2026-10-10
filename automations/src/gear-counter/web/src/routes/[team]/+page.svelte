<script lang="ts">
  import { levelsText } from '$shared/levels';
  import type { LevelLine } from '$shared/types';
  import AddItem from '$lib/AddItem.svelte';
  import { api } from '$lib/api';
  import Dot from '$lib/Dot.svelte';
  import ItemDialog from '$lib/ItemDialog.svelte';
  import Mascot from '$lib/Mascot.svelte';
  import NameModal from '$lib/NameModal.svelte';
  import RecentChanges from '$lib/RecentChanges.svelte';
  import { queue } from '$lib/sync.svelte';
  import { me } from '$lib/who.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const ORDER = $derived(new Map(data.catalogue.items.map((i, n) => [i.id, n])));
  const team = $derived(data.page.team);
  let levels = $derived<LevelLine[]>(data.page.levels);
  let recent = $derived(data.page.recent);
  let message = $state('');
  let notice = $state('');
  let renaming = $state(false);
  let active = $state<LevelLine | null>(null);

  const shown = (l: LevelLine) => Math.max(0, l.level + queue.pendingFor(team.slug, l.itemId));
  const lines = $derived(levels.map((l) => ({ ...l, level: shown(l) })));
  const groups = $derived(
    lines.reduce<{ category: string; lines: LevelLine[] }[]>((gs, l) => {
      const last = gs.at(-1);
      if (last?.category === l.category) last.lines.push(l);
      else gs.push({ category: l.category, lines: [l] });
      return gs;
    }, []),
  );
  const total = $derived(lines.reduce((n, l) => n + l.level, 0));
  const have = $derived(new Set(levels.map((l) => l.itemId)));
  const saving = $derived(queue.hasPending(team.slug));

  // Re-read levels and recent changes in the background. Offline (or any failure): keep what is on screen.
  async function refresh() {
    try {
      const fresh = await api().team(team.slug);
      if (fresh.team.slug !== team.slug || queue.hasPending(team.slug)) return;
      levels = fresh.levels;
      recent = fresh.recent;
    } catch {
      // keep the counter usable
    }
  }

  $effect(() => {
    const slug = team.slug;
    queue.onLevel = (t, item, level) => {
      if (t === slug) levels = levels.map((l) => (l.itemId === item ? { ...l, level } : l));
    };
    queue.onIdle = (t) => {
      if (t === slug) void refresh(); // pick up the grouped log entry
    };
    return () => {
      queue.onLevel = null;
      queue.onIdle = null;
    };
  });

  // Pick up other people's changes when the page comes back into view.
  $effect(() => {
    const slug = team.slug;
    const onShow = () => {
      if (document.visibilityState === 'visible' && !queue.hasPending(slug)) void refresh();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  });

  function tap(l: LevelLine, delta: 1 | -1) {
    if (!me.name) return; // the name modal is open
    if (delta < 0 && shown(l) === 0) return;
    notice = '';
    queue.add(team.slug, l.itemId, delta);
  }

  async function add(itemId: string) {
    message = '';
    try {
      const line = await api().list(team.slug, itemId, me.name);
      levels = [...levels.filter((l) => l.itemId !== itemId), line].sort((a, b) => (ORDER.get(a.itemId) ?? Infinity) - (ORDER.get(b.itemId) ?? Infinity));
      return true;
    } catch (e) {
      message = e instanceof Error ? e.message : 'Could not add that item.';
      return false;
    }
  }

  async function unlist(l: LevelLine) {
    message = '';
    try {
      await api().unlist(team.slug, l.itemId);
      levels = levels.filter((x) => x.itemId !== l.itemId);
    } catch (e) {
      message = e instanceof Error ? e.message : 'Could not remove that item.';
    }
  }

  async function done(text: string) {
    notice = text;
    await refresh();
  }
</script>

<svelte:head><title>{team.name} · Gear counter</title></svelte:head>

<NameModal bind:open={renaming} />

<section class="team-band">
  <Mascot name={team.mascot} />
  <div>
    <h1>{team.name}</h1>
    <p class="team-meta">{#if team.grade}<Dot colour={team.dot} size="lg" />{team.grade}{:else}Spare gear in storage{/if}</p>
    {#if me.name}<p class="who-line">Counting as {me.name} · <button type="button" onclick={() => (renaming = true)}>change</button></p>{/if}
  </div>
</section>

<div class="card toolbar">
  <p class="progress" aria-live="polite">{levelsText(total, team.kind)}</p>
  <p class="sync" class:offline={queue.offline && saving} role="status">
    {queue.offline && saving ? 'Offline — will sync' : saving ? 'Saving…' : 'All changes saved'}
  </p>
  {#if notice}<p class="notice">{notice}</p>{/if}
  {#if queue.error}<p class="error" role="alert">{queue.error}</p>{/if}
  {#if message}<p class="error" role="alert">{message}</p>{/if}
</div>

{#each groups as g (g.category)}
  <section class="category">
    <h2>{g.category}</h2>
    <ul class="lines">
      {#each g.lines as l (l.itemId)}
        {@const pending = queue.pendingFor(team.slug, l.itemId) !== 0}
        <li class="line" data-item={l.itemId}>
          <div class="line-text">
            <span class="line-name">{l.name}</span>
            {#if l.retired}<span class="tag retired">Retired</span>{:else if l.added}<span class="tag">Added</span>{/if}
          </div>
          <div class="stepper">
            {#if !l.pinned && l.level === 0 && !pending}
              <button type="button" class="step remove" aria-label="Remove {l.name}" onclick={() => unlist(l)}>✕</button>
            {:else}
              <button type="button" class="step" aria-label="One less {l.name}" disabled={l.level === 0} onclick={() => tap(l, -1)}>−</button>
            {/if}
            <span class="qty"><strong>{l.level}</strong></span>
            <button type="button" class="step" aria-label="One more {l.name}" onclick={() => tap(l, 1)}>+</button>
            <button type="button" class="step more" aria-label="More for {l.name}" disabled={pending} onclick={() => (active = l)}>⋯</button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/each}

<div class="add-row"><AddItem catalogue={data.catalogue} {have} onadd={add} /></div>

<RecentChanges entries={recent} />

{#if active}
  <ItemDialog {team} teams={data.teams} line={active} onclose={() => (active = null)} ondone={done} />
{/if}

<p><a href="/">← All teams</a></p>
