import { error } from '@sveltejs/kit';
import { api, ApiFailure } from '$lib/api';
import { draftStocktake } from '$lib/draft';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, fetch }) => {
  const a = api(fetch);
  try {
    const page = await a.team(params.team);
    const s = url.searchParams.get('s');
    const wanted =
      s === 'new' ? page.stocktakes.find((t) => t.date === page.today) : (page.stocktakes.find((t) => t.id === s) ?? page.stocktakes[0]);
    if (wanted) return { page, stocktake: await a.stocktake(wanted.id) };
    // Nothing for today yet: show an unsaved draft, saved by its first tap.
    return { page, stocktake: draftStocktake(page) };
  } catch (e) {
    if (e instanceof ApiFailure) error(e.status === 404 ? 404 : e.status || 503, e.message);
    throw e;
  }
};
