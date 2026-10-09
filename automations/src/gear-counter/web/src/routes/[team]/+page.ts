import { error } from '@sveltejs/kit';
import { api, ApiFailure } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, fetch }) => {
  const a = api(fetch);
  try {
    const page = await a.team(params.team);
    const wanted = page.stocktakes.find((s) => s.id === url.searchParams.get('s')) ?? page.stocktakes[0];
    if (wanted) return { page, stocktake: await a.stocktake(wanted.id) };
    // First visit: start today's stocktake so there is something to count.
    const stocktake = await a.open(params.team);
    return { page: { ...page, stocktakes: [stocktake] }, stocktake };
  } catch (e) {
    if (e instanceof ApiFailure) error(e.status === 404 ? 404 : e.status || 503, e.message);
    throw e;
  }
};
