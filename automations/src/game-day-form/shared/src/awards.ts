/** Times a squad player has won an award this season, not counting the game being reported. */
export function priorWins(games: Record<string, string[]>, key: string, gameId: string): number {
  return (games[key] ?? []).filter((g) => g !== gameId).length;
}

export const withWins = (label: string, wins: number) => `${label} (${wins})`;

/**
 * Earlier winners of an award, newest first. `order` is the team's game IDs oldest first (the fixture);
 * games missing from it sort as oldest.
 */
export function previousWinners(games: Record<string, string[]>, gameId: string, order: string[]): { gameId: string; key: string }[] {
  const rank = new Map(order.map((g, i) => [g, i]));
  return Object.entries(games)
    .flatMap(([key, ids]) => ids.filter((g) => g !== gameId).map((g) => ({ gameId: g, key })))
    .sort((a, b) => (rank.get(b.gameId) ?? -1) - (rank.get(a.gameId) ?? -1));
}

/** Every squad player's earlier wins, fewest first, then by name. */
export function winCounts(games: Record<string, string[]>, squad: { key: string; label: string }[], gameId: string) {
  return squad
    .map((p) => ({ key: p.key, label: p.label, wins: priorWins(games, p.key, gameId) }))
    .sort((a, b) => a.wins - b.wins || a.label.localeCompare(b.label));
}
