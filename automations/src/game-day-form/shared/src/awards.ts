/** Times a squad player has won an award this season, not counting the game being reported. */
export function priorWins(games: Record<string, string[]>, key: string, gameId: string): number {
  return (games[key] ?? []).filter((g) => g !== gameId).length;
}

export const withWins = (label: string, wins: number) => `${label} (${wins})`;
