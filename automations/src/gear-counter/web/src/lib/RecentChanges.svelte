<script lang="ts">
  import { whenLabel } from '$shared/dates';
  import type { LogEntry } from '$shared/types';

  let { entries }: { entries: LogEntry[] } = $props();

  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  function what(e: LogEntry) {
    switch (e.kind) {
      case 'opening':
        return `Opening level ${e.itemName} ${e.levelAfter}`;
      case 'adjust':
        return `${e.itemName} ${signed(e.change)}`;
      case 'count':
        return `Set ${e.itemName} ${e.levelAfter - e.change} → ${e.levelAfter}`;
      case 'move':
        return e.change < 0 ? `Moved ${-e.change} ${e.itemName} to ${e.to?.name ?? '?'}` : `Received ${e.change} ${e.itemName} from ${e.from?.name ?? '?'}`;
    }
  }
</script>

<section class="recent" aria-labelledby="recent-title">
  <h2 id="recent-title">Recent changes</h2>
  {#if entries.length}
    <ul class="log">
      {#each entries as e (e.id)}
        <li>
          <strong>{e.who}</strong> · <time datetime={e.at}>{whenLabel(e.at)}</time> · {what(e)}{#if e.note}<span class="log-note">{` · “${e.note}”`}</span>{/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="note">No changes yet.</p>
  {/if}
</section>
