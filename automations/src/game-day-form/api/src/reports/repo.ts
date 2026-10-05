export async function reportStatuses(db: D1Database, seasonId: string, teamSlug: string) {
  const { results } = await db
    .prepare('SELECT game_id, scoring FROM reports WHERE season_id = ? AND team_slug = ?')
    .bind(seasonId, teamSlug)
    .all<{ game_id: string; scoring: string }>();
  return new Map(results.map((r) => [r.game_id, r.scoring === 'not_played' ? ('not_played' as const) : ('reported' as const)]));
}
