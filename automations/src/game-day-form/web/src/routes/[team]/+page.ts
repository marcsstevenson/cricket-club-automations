import { error } from '@sveltejs/kit';
import { api, ApiFailure } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  try {
    return { team: await api(fetch).team(params.team.toLowerCase()) };
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) error(404, 'Team not found');
    throw e;
  }
};
