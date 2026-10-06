import type { MilestoneCheck, MilestoneType, NotPlayedReason, Scoring, Source } from '../../../shared/src/types';

export async function reportStatuses(db: D1Database, seasonId: string, teamSlug: string) {
  const { results } = await db
    .prepare('SELECT game_id, scoring FROM reports WHERE season_id = ? AND team_slug = ?')
    .bind(seasonId, teamSlug)
    .all<{ game_id: string; scoring: string }>();
  return new Map(results.map((r) => [r.game_id, r.scoring === 'not_played' ? ('not_played' as const) : ('reported' as const)]));
}

export interface NamedPlayer {
  id: string;
  fullName: string;
  playhqId: string | null;
}

export interface StoredMilestone {
  id: string;
  type: MilestoneType;
  playerKey: string | null;
  namedId: string | null;
  value: number | null;
  source: Source;
  playhqValue: number | null;
  touched: boolean;
  check: MilestoneCheck | null;
}

export interface ReportRow {
  seasonId: string;
  teamSlug: string;
  gameId: string;
  gameDate: string;
  scoring: Scoring;
  issues: string | null;
  notPlayedReason: NotPlayedReason | null;
  notPlayedOther: string | null;
  teamRuns: number | null;
  teamWkts: number | null;
  oppRuns: number | null;
  oppWkts: number | null;
  scoreSource: Source | null;
  potdKey: string | null;
  potdNamedId: string | null;
  mascotKey: string | null;
  mascotNamedId: string | null;
  highlights: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export type StoredReport = ReportRow & {
  id: string;
  version: number;
  milestones: StoredMilestone[];
  photoIds: string[];
  named: Map<string, NamedPlayer>;
};

export interface SaveInput {
  reportId: string;
  version: number;
  row: ReportRow;
  newNamed: NamedPlayer[];
  milestones: StoredMilestone[];
  photoIds: string[];
  snapshot: string;
}

type Db = Record<string, unknown>;
const WHERE = 'r.season_id = ?1 AND (?2 IS NULL OR r.team_slug = ?2) AND (?3 IS NULL OR r.game_id = ?3)';

export async function loadReports(db: D1Database, seasonId: string, filter?: { teamSlug: string; gameId: string }) {
  const binds = [seasonId, filter?.teamSlug ?? null, filter?.gameId ?? null];
  const [reports, milestones, photos, named] = await db.batch<Db>([
    db.prepare(`SELECT r.* FROM reports r WHERE ${WHERE}`).bind(...binds),
    db.prepare(`SELECT m.* FROM milestones m JOIN reports r ON r.id = m.report_id WHERE ${WHERE} ORDER BY m.position`).bind(...binds),
    db.prepare(`SELECT p.id, p.report_id FROM photos p JOIN reports r ON r.id = p.report_id WHERE ${WHERE} ORDER BY p.created_at, p.id`).bind(...binds),
    db.prepare(
      `SELECT n.* FROM named_players n WHERE n.id IN (
         SELECT r.potd_named_id FROM reports r WHERE ${WHERE}
         UNION SELECT r.mascot_named_id FROM reports r WHERE ${WHERE}
         UNION SELECT m.named_id FROM milestones m JOIN reports r ON r.id = m.report_id WHERE ${WHERE})`,
    ).bind(...binds),
  ]);

  const namedById = new Map(
    named.results.map((n) => [n.id as string, { id: n.id as string, fullName: n.full_name as string, playhqId: (n.playhq_id as string) ?? null }]),
  );

  return reports.results.map((r): StoredReport => {
    const id = r.id as string;
    const ms = milestones.results.filter((m) => m.report_id === id);
    const own = new Map<string, NamedPlayer>();
    for (const nid of [r.potd_named_id, r.mascot_named_id, ...ms.map((m) => m.named_id)]) {
      if (typeof nid === 'string' && namedById.has(nid)) own.set(nid, namedById.get(nid)!);
    }
    return {
      id,
      version: r.version as number,
      seasonId: r.season_id as string,
      teamSlug: r.team_slug as string,
      gameId: r.game_id as string,
      gameDate: r.game_date as string,
      scoring: r.scoring as Scoring,
      issues: r.issues as string | null,
      notPlayedReason: r.not_played_reason as NotPlayedReason | null,
      notPlayedOther: r.not_played_other as string | null,
      teamRuns: r.team_runs as number | null,
      teamWkts: r.team_wkts as number | null,
      oppRuns: r.opp_runs as number | null,
      oppWkts: r.opp_wkts as number | null,
      scoreSource: r.score_source as Source | null,
      potdKey: r.potd_key as string | null,
      potdNamedId: r.potd_named_id as string | null,
      mascotKey: r.mascot_key as string | null,
      mascotNamedId: r.mascot_named_id as string | null,
      highlights: r.highlights as string | null,
      updatedAt: r.updated_at as string,
      updatedBy: r.updated_by as string | null,
      milestones: ms.map((m) => ({
        id: m.id as string,
        type: m.type as MilestoneType,
        playerKey: m.player_key as string | null,
        namedId: m.named_id as string | null,
        value: m.value as number | null,
        source: m.source as Source,
        playhqValue: m.playhq_value as number | null,
        touched: m.touched === 1,
        check: m.check_actual === null || m.check_actual === undefined
          ? null
          : { actual: m.check_actual as number, share: m.check_share as number, checked: m.checked === 1 },
      })),
      photoIds: photos.results.filter((p) => p.report_id === id).map((p) => p.id as string),
      named: own,
    };
  });
}

export async function getReport(db: D1Database, seasonId: string, teamSlug: string, gameId: string) {
  return (await loadReports(db, seasonId, { teamSlug, gameId }))[0] ?? null;
}

export async function saveReport(db: D1Database, s: SaveInput): Promise<void> {
  const r = s.row;
  const stmts: D1PreparedStatement[] = [];

  for (const n of s.newNamed) {
    stmts.push(
      db.prepare('INSERT INTO named_players (id, full_name, playhq_id, created_at) VALUES (?, ?, ?, ?)').bind(n.id, n.fullName, n.playhqId, r.updatedAt),
    );
  }

  stmts.push(
    db.prepare(
      `INSERT INTO reports (id, season_id, team_slug, game_id, game_date, scoring, issues, not_played_reason, not_played_other,
         team_runs, team_wkts, opp_runs, opp_wkts, score_source, potd_key, potd_named_id, mascot_key, mascot_named_id,
         highlights, version, updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
       ON CONFLICT(id) DO UPDATE SET
         game_date = excluded.game_date, scoring = excluded.scoring, issues = excluded.issues,
         not_played_reason = excluded.not_played_reason, not_played_other = excluded.not_played_other,
         team_runs = excluded.team_runs, team_wkts = excluded.team_wkts, opp_runs = excluded.opp_runs, opp_wkts = excluded.opp_wkts,
         score_source = excluded.score_source, potd_key = excluded.potd_key, potd_named_id = excluded.potd_named_id,
         mascot_key = excluded.mascot_key, mascot_named_id = excluded.mascot_named_id, highlights = excluded.highlights,
         version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(
      s.reportId, r.seasonId, r.teamSlug, r.gameId, r.gameDate, r.scoring, r.issues, r.notPlayedReason, r.notPlayedOther,
      r.teamRuns, r.teamWkts, r.oppRuns, r.oppWkts, r.scoreSource, r.potdKey, r.potdNamedId, r.mascotKey, r.mascotNamedId,
      r.highlights, s.version, r.updatedAt, r.updatedBy,
    ),
  );

  stmts.push(db.prepare('DELETE FROM milestones WHERE report_id = ?').bind(s.reportId));
  s.milestones.forEach((m, i) =>
    stmts.push(
      db.prepare(
        `INSERT INTO milestones (id, report_id, type, player_key, named_id, value, source, playhq_value, touched, position,
           check_actual, check_share, checked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        m.id, s.reportId, m.type, m.playerKey, m.namedId, m.value, m.source, m.playhqValue, m.touched ? 1 : 0, i,
        m.check?.actual ?? null, m.check?.share ?? null, m.check?.checked ? 1 : 0,
      ),
    ),
  );

  stmts.push(db.prepare('UPDATE photos SET report_id = NULL WHERE report_id = ?').bind(s.reportId));
  for (const pid of s.photoIds) stmts.push(db.prepare('UPDATE photos SET report_id = ? WHERE id = ?').bind(s.reportId, pid));

  stmts.push(
    db.prepare('INSERT INTO report_versions (report_id, version, snapshot, saved_at, saved_by) VALUES (?, ?, ?, ?, ?)').bind(
      s.reportId, s.version, s.snapshot, r.updatedAt, r.updatedBy,
    ),
  );

  await db.batch(stmts); // one transaction
}
