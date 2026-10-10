import { findTeam, specLines } from '$shared/data';
import { dateLabel } from '$shared/dates';
import type { Stocktake } from '$shared/types';
import { draftId } from './sync.svelte';

/** Today's stocktake as it would start, shown before anything is saved. */
export function draftStocktake(teamSlug: string, today: string): Stocktake {
  const team = findTeam(teamSlug);
  return {
    id: draftId(teamSlug),
    date: today,
    label: dateLabel(today),
    teamSlug,
    lines: team
      ? specLines(team).map(({ item, expected }) => ({ itemId: item.id, name: item.name, category: item.category, expected, count: 0, added: false }))
      : [],
  };
}
