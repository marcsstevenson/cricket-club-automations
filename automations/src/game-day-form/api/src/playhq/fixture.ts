import type { V1Game } from './types';

export interface FixtureGame {
  gameId: string;
  date: string | null;
  round: string;
  opposition: string;
  venue: string;
  status: string;
}

export function teamFixture(games: V1Game[], teamId: string): FixtureGame[] {
  return games
    .filter((g) => g.competitors.some((c) => c.id === teamId))
    .map((g) => ({
      gameId: g.id,
      date: g.schedule?.date ?? null,
      round: g.round?.abbreviatedName ?? '',
      opposition: g.competitors.find((c) => c.id !== teamId)?.name ?? 'TBC',
      venue: g.venue?.name ?? 'TBC',
      status: g.status,
    }))
    .sort((a, b) => (a.date ?? '9999-99-99').localeCompare(b.date ?? '9999-99-99'));
}
