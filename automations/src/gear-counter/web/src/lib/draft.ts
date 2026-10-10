import { specLines } from '$shared/data';
import { dateLabel } from '$shared/dates';
import type { Stocktake, TeamPage } from '$shared/types';
import { draftId } from './sync.svelte';

/** Today's stocktake as it would start, shown before anything is saved. */
export function draftStocktake(page: TeamPage): Stocktake {
  return {
    id: draftId(page.team.slug),
    date: page.today,
    label: dateLabel(page.today),
    teamSlug: page.team.slug,
    lines: specLines(page.spec).map(({ item, expected }) => ({ itemId: item.id, name: item.name, category: item.category, expected, count: 0, added: false })),
  };
}
