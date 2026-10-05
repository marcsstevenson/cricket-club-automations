<script lang="ts">
  import type { GameOption } from '$shared/api';
  import { STATUS_TEXT } from '$shared/text';

  let { games, selected, onselect }: { games: GameOption[]; selected: string | null; onselect: (id: string) => void } = $props();
</script>

<label class="field card">
  Game
  <select id="game" value={selected ?? ''} onchange={(e) => onselect(e.currentTarget.value)}>
    {#each games as g (g.gameId)}
      <option value={g.gameId} disabled={!g.selectable}>
        {g.dateLabel} · {g.round} · v {g.opposition} · {g.venue} — {STATUS_TEXT[g.reportStatus]}
      </option>
    {/each}
  </select>
</label>
