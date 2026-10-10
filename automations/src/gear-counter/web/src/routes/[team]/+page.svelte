<script lang="ts">
  import { goto } from '$app/navigation';
  import { items } from '$shared/data';
  import { progressText } from '$shared/lines';
  import type { Line, Stocktake } from '$shared/types';
  import AddItem from '$lib/AddItem.svelte';
  import { api } from '$lib/api';
  import Dot from '$lib/Dot.svelte';
  import Mascot from '$lib/Mascot.svelte';
  import { isDraft, queue } from '$lib/sync.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const ORDER = new Map(items.map((i, n) => [i.id, n]));

  const team = $derived(data.page.team);
  let stocktake = $derived<Stocktake>(data.stocktake);
  let message = $state('');
  let switching = $state(false);

  const shown = (l: Line) => Math.max(0, l.count + queue.pendingFor(stocktake.id, l.itemId));
  const counted = $derived(stocktake.lines.map((l) => ({ ...l, count: shown(l) })));
  const groups = $derived(
    counted.reduce<{ category: string; lines: Line[] }[]>((gs, l) => {
      const last = gs.at(-1);
      if (last?.category === l.category) last.lines.push(l);
      else gs.push({ category: l.category, lines: [l] });
      return gs;
    }, []),
  );
  const have = $derived(new Set(stocktake.lines.map((l) => l.itemId)));
  const saving = $derived(queue.hasPending(stocktake.id));
  const draft = $derived(isDraft(stocktake.id));

  const setLine = (itemId: string, patch: Partial<Line>) => {
    stocktake = { ...stocktake, lines: stocktake.lines.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)) };
  };

  $effect(() => {
    const id = stocktake.id;
    queue.onCount = (stId, itemId, count) => {
      if (stId === id) setLine(itemId, { count });
    };
    queue.onSaved = (d, savedId) => {
      if (d === id) void show(savedId);
    };
    return () => {
      queue.onCount = null;
      queue.onSaved = null;
    };
  });

  const show = (id: string) => goto(`?s=${id}`, { replaceState: true, invalidateAll: true, noScroll: true });

  // Pick up other people's counts when the page comes back into view.
  $effect(() => {
    const id = stocktake.id;
    const onShow = async () => {
      if (document.visibilityState !== 'visible' || isDraft(id) || queue.hasPending(id)) return;
      try {
        const fresh = await api().stocktake(id);
        if (fresh.id === stocktake.id && !queue.hasPending(id)) stocktake = fresh;
      } catch {
        // Offline: keep what is on screen.
      }
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  });

  function tap(l: Line, delta: 1 | -1) {
    if (delta < 0 && shown(l) === 0) return;
    queue.add(stocktake.id, l.itemId, delta);
  }

  async function choose(value: string) {
    message = '';
    switching = true;
    try {
      // New only shows a draft (or today's, if it exists); nothing is saved until a count is entered.
      await show(value);
    } catch (e) {
      message = e instanceof Error ? e.message : 'Could not open that stocktake.';
    } finally {
      switching = false;
    }
  }

  async function add(itemId: string) {
    message = '';
    try {
      if (draft) {
        // Adding a line saves the draft first.
        const saved = await api().open(team.slug);
        queue.adopt(stocktake.id, saved.id);
        await api().addLine(saved.id, itemId);
        await show(saved.id);
        return true;
      }
      const line = await api().addLine(stocktake.id, itemId);
      const lines = [...stocktake.lines.filter((l) => l.itemId !== itemId), line];
      lines.sort((a, b) => (ORDER.get(a.itemId) ?? Infinity) - (ORDER.get(b.itemId) ?? Infinity));
      stocktake = { ...stocktake, lines };
      return true;
    } catch (e) {
      message = e instanceof Error ? e.message : 'Could not add that item.';
      return false;
    }
  }

  async function remove(l: Line) {
    message = '';
    try {
      await api().removeLine(stocktake.id, l.itemId);
      stocktake = { ...stocktake, lines: stocktake.lines.filter((x) => x.itemId !== l.itemId) };
    } catch (e) {
      message = e instanceof Error ? e.message : 'Could not remove that line.';
    }
  }
</script>

<svelte:head><title>{team.name} · Gear counter</title></svelte:head>

<section class="team-band">
  <Mascot name={team.mascot} />
  <div>
    <h1>{team.name}</h1>
    <p class="team-meta">{#if team.grade}<Dot colour={team.dot} size="lg" />{team.grade}{:else}Spare gear in storage{/if}</p>
  </div>
</section>

<div class="card toolbar">
  <label class="field" for="stocktake">Stocktake</label>
  <select id="stocktake" value={draft ? 'new' : stocktake.id} disabled={switching} onchange={(e) => choose(e.currentTarget.value)}>
    {#each data.page.stocktakes as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
    <option value="new">{draft ? 'New (today) — not saved yet' : 'New (today)'}</option>
  </select>
  <p class="progress" aria-live="polite">{progressText(counted)}</p>
  <p class="sync" class:offline={queue.offline && saving} role="status">
    {queue.offline && saving ? 'Offline — will sync' : saving ? 'Saving…' : 'All changes saved'}
  </p>
  {#if queue.error}<p class="error" role="alert">{queue.error}</p>{/if}
  {#if message}<p class="error" role="alert">{message}</p>{/if}
</div>

{#each groups as g (g.category)}
  <section class="category">
    <h2>{g.category}</h2>
    <ul class="lines">
      {#each g.lines as l (l.itemId)}
        <li class="line" data-item={l.itemId}>
          <div class="line-text">
            <span class="line-name">{l.name}</span>
            {#if l.added}<span class="tag">Added</span>{/if}
          </div>
          <div class="stepper">
            {#if l.added && l.count === 0 && !queue.pendingFor(stocktake.id, l.itemId)}
              <button type="button" class="step remove" aria-label="Remove {l.name}" onclick={() => remove(l)}>✕</button>
            {:else}
              <button type="button" class="step" aria-label="One less {l.name}" disabled={l.count === 0} onclick={() => tap(l, -1)}>−</button>
            {/if}
            <span class="qty"><strong>{l.count}</strong></span>
            <button type="button" class="step" aria-label="One more {l.name}" onclick={() => tap(l, 1)}>+</button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/each}

<div class="add-row"><AddItem {have} onadd={add} /></div>
<p><a href="/">← All teams</a></p>
