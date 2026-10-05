<script lang="ts">
  let passcode = $state('');
  let ok = $state(false);
  let msg = $state('');
  let busy = $state(false);

  try {
    passcode = sessionStorage.getItem('pcc-admin') ?? '';
  } catch {
    /* storage blocked */
  }

  const headers = () => ({ 'x-admin-passcode': passcode });

  async function check() {
    busy = true;
    msg = '';
    try {
      const res = await fetch('/api/admin/check', { headers: headers() });
      ok = res.ok;
      if (ok) {
        try {
          sessionStorage.setItem('pcc-admin', passcode);
        } catch {
          /* ignore */
        }
      } else if (res.status === 401) msg = 'Wrong passcode.';
      else if (res.status === 429) msg = 'Too many attempts — wait a minute.';
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
        if (res.status === 401) {
          ok = false;
          msg = 'Wrong passcode — enter it again.';
        } else msg = res.status === 429 ? 'Too many requests — wait a minute.' : 'Download failed.';
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
</script>

<svelte:head><title>Admin exports · Parklands Cricket Club</title></svelte:head>

<section class="hero"><h1>Admin exports</h1><p>Exports with full player names. Keep these files private.</p></section>

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
{/if}
{#if msg}<p class="error" role="alert">{msg}</p>{/if}
