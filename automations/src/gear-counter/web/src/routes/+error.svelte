<script lang="ts">
  import { page } from '$app/state';
</script>

<section class="card">
  <h1>{page.status === 404 ? 'Team not found' : 'Something went wrong'}</h1>
  {#if page.status !== 404}<p>{page.error?.message}</p>{/if}
  <p><a href="/">See all teams</a></p>
</section>
