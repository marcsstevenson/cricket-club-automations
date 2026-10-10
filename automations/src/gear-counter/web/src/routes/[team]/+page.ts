import { error } from '@sveltejs/kit';
import { api, ApiFailure } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const a = api(fetch);
  try {
    const [page, teams, catalogue] = await Promise.all([a.team(params.team), a.teams(), a.catalogue()]);
    return { page, teams, catalogue };
  } catch (e) {
    if (e instanceof ApiFailure) error(e.status === 404 ? 404 : e.status || 503, e.message);
    throw e;
  }
};
