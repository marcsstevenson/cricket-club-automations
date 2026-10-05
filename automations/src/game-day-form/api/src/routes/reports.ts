import type { Hono } from 'hono';
import * as v from 'valibot';
import { ReportInSchema } from '../../../shared/src/types';
import { validateReport } from '../../../shared/src/validation';
import type { AppEnv } from '../env';
import { ApiError, clientIp } from '../errors';
import { startData } from '../playhq/summary';
import { getReport, saveReport, type SaveInput, type StoredMilestone } from '../reports/repo';
import { makeResolver } from '../reports/resolve';
import { toReportOut } from '../reports/serialize';
import { loadGameContext } from './context';

export function registerReports(app: Hono<AppEnv>) {
  app.put('/teams/:slug/games/:gameId/report', async (c) => {
    const deps = c.get('deps');
    if (!(await deps.limit(c.env, 'WRITE_LIMIT', clientIp(c.req.header('cf-connecting-ip'))))) {
      throw new ApiError(429, 'rate_limited', 'Too many saves — wait a minute and try again.');
    }

    const parsed = v.safeParse(ReportInSchema, await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'The report could not be read.');
    const body = parsed.output;

    const ctx = await loadGameContext(c, c.req.param('slug'), c.req.param('gameId'));
    if (!ctx.game.selectable) throw new ApiError(400, 'game_not_selectable', "This game hasn't been played yet.");

    const ruleErrors = validateReport(body);
    if (Object.keys(ruleErrors).length) {
      throw new ApiError(422, 'validation_failed', 'Please fix the highlighted answers.', { fields: ruleErrors });
    }

    const seasonId = ctx.squad.season.playhqSeasonId;
    const existing = await getReport(c.env.DB, seasonId, ctx.team.slug, ctx.game.gameId);
    if ((existing?.version ?? 0) !== body.baseVersion) {
      throw new ApiError(409, 'version_conflict', 'This report was updated by someone else — review their version first.', {
        latest: existing ? toReportOut(existing, ctx.labels) : null,
      });
    }

    const played = body.scoring !== 'not_played';
    const summary = played ? await ctx.summary() : null;
    const r = makeResolver({ team: ctx.team, existing, summary, newId: deps.id });

    const potd = played ? r.resolve('potd', body.potd) : { key: null, namedId: null };
    const mascot = played ? r.resolve('mascot', body.mascot) : { key: null, namedId: null };
    const milestones: StoredMilestone[] = played
      ? body.milestones.map((m, i) => {
          const p = r.resolve(`milestones.${i}.player`, m.player);
          return {
            id: deps.id(),
            type: m.type,
            playerKey: p.key,
            namedId: p.namedId,
            value: m.type === 'hattrick' ? null : m.value,
            source: m.source,
            playhqValue: m.playhqValue,
            touched: m.touched,
          };
        })
      : [];

    const photoIds = played ? body.photoIds : [];
    for (const pid of photoIds) {
      const row = await c.env.DB.prepare('SELECT report_id FROM photos WHERE id = ?').bind(pid).first<{ report_id: string | null }>();
      if (!row || (row.report_id && row.report_id !== existing?.id)) {
        r.fields.photoIds = 'A photo could not be found — remove it and add it again.';
      }
    }

    if (Object.keys(r.fields).length) {
      throw new ApiError(422, 'validation_failed', 'Please fix the highlighted answers.', { fields: r.fields });
    }

    const result = summary ? startData(summary, ctx.team, ctx.labels).result : null;
    const scores = !played
      ? { teamRuns: null, teamWkts: null, oppRuns: null, oppWkts: null, scoreSource: null }
      : result
        ? { teamRuns: result.team.runs, teamWkts: result.team.wkts, oppRuns: result.opp.runs, oppWkts: result.opp.wkts, scoreSource: 'playhq' as const }
        : { teamRuns: body.team.runs, teamWkts: body.team.wkts, oppRuns: body.opp.runs, oppWkts: body.opp.wkts, scoreSource: 'entered' as const };

    const input: SaveInput = {
      reportId: existing?.id ?? deps.id(),
      version: body.baseVersion + 1,
      row: {
        seasonId,
        teamSlug: ctx.team.slug,
        gameId: ctx.game.gameId,
        gameDate: ctx.game.date!,
        scoring: played && result && body.scoring === 'no' ? 'yes' : body.scoring!,
        issues: body.scoring === 'yes_issues' ? body.issues.trim() : null,
        notPlayedReason: played ? null : body.notPlayedReason,
        notPlayedOther: !played && body.notPlayedReason === 'other' ? body.notPlayedOther.trim() : null,
        ...scores,
        potdKey: potd.key,
        potdNamedId: potd.namedId,
        mascotKey: mascot.key,
        mascotNamedId: mascot.namedId,
        highlights: played ? body.highlights.trim() || null : null,
        updatedAt: deps.now().toISOString(),
        updatedBy: body.updatedBy.trim() || null,
      },
      newNamed: r.newNamed,
      milestones,
      photoIds,
      snapshot: '',
    };
    input.snapshot = JSON.stringify({ ...input, snapshot: undefined });

    try {
      await saveReport(c.env.DB, input);
    } catch (err) {
      // Two first-time saves at once: the UNIQUE(season, team, game) constraint rolls the second back.
      if (String(err).includes('UNIQUE')) {
        const latest = await getReport(c.env.DB, seasonId, ctx.team.slug, ctx.game.gameId);
        throw new ApiError(409, 'version_conflict', 'This report was updated by someone else — review their version first.', {
          latest: latest ? toReportOut(latest, ctx.labels) : null,
        });
      }
      throw err;
    }

    const saved = (await getReport(c.env.DB, seasonId, ctx.team.slug, ctx.game.gameId))!;
    console.log(JSON.stringify({ msg: 'report_saved', team: ctx.team.slug, gameId: ctx.game.gameId, version: saved.version }));
    return c.json(toReportOut(saved, ctx.labels));
  });
}
