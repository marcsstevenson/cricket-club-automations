import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getReport, loadReports, saveReport, type SaveInput } from '../src/reports/repo';
import { toReportOut } from '../src/reports/serialize';

const labels = new Map([['p001', 'Alex T.']]);

function input(over: Partial<SaveInput> = {}): SaveInput {
  return {
    reportId: 'r1',
    version: 1,
    row: {
      seasonId: 's', teamSlug: 'pumas', gameId: 'g1', gameDate: '2026-01-24', scoring: 'yes', issues: null,
      notPlayedReason: null, notPlayedOther: null, teamRuns: 145, teamWkts: 4, oppRuns: 128, oppWkts: 4,
      scoreSource: 'playhq', potdKey: 'p001', potdNamedId: null, mascotKey: null, mascotNamedId: 'n1',
      highlights: 'Great game', updatedAt: '2026-01-25T00:00:00Z', updatedBy: 'Sarah',
    },
    newNamed: [{ id: 'n1', fullName: 'Chris Pratt', playhqId: null }, { id: 'n2', fullName: 'Kim Walker', playhqId: 'ph-fill' }],
    milestones: [
      { id: 'm1', type: 'bat', playerKey: 'p001', namedId: null, value: 31, source: 'playhq', playhqValue: 31, touched: false, check: null },
      { id: 'm2', type: 'bat', playerKey: null, namedId: 'n2', value: 27, source: 'playhq', playhqValue: 27, touched: true, check: null },
    ],
    photoIds: [],
    snapshot: '{}',
    ...over,
  };
}

describe('saveReport / getReport', () => {
  it('round-trips a report with milestones and named players', async () => {
    await saveReport(env.DB, input());
    const r = await getReport(env.DB, 's', 'pumas', 'g1');
    expect(r).toMatchObject({ id: 'r1', version: 1, teamRuns: 145, potdKey: 'p001', mascotNamedId: 'n1', updatedBy: 'Sarah' });
    expect(r!.milestones.map((m) => [m.id, m.value, m.touched])).toEqual([['m1', 31, false], ['m2', 27, true]]);
    expect(r!.named.get('n1')).toEqual({ id: 'n1', fullName: 'Chris Pratt', playhqId: null });
    const versions = await env.DB.prepare('SELECT version, saved_by FROM report_versions').all();
    expect(versions.results).toEqual([{ version: 1, saved_by: 'Sarah' }]);
  });

  it('replaces milestones and moves photos on update', async () => {
    await env.DB.batch(['pA', 'pB'].map((id) =>
      env.DB.prepare("INSERT INTO photos (id, report_id, r2_key, bytes, created_at) VALUES (?, NULL, ?, 1, '2026-01-25T00:00:00Z')").bind(id, `photos/${id}.jpg`),
    ));
    await saveReport(env.DB, input({ photoIds: ['pA'] }));
    await saveReport(env.DB, input({ version: 2, newNamed: [], milestones: [], photoIds: ['pB'], row: { ...input().row, mascotNamedId: 'n1' } }));
    const r = await getReport(env.DB, 's', 'pumas', 'g1');
    expect(r!.version).toBe(2);
    expect(r!.milestones).toEqual([]);
    expect(r!.photoIds).toEqual(['pB']);
    const detached = await env.DB.prepare("SELECT report_id FROM photos WHERE id = 'pA'").first();
    expect(detached).toEqual({ report_id: null });
  });

  it('returns null when there is no report', async () => {
    expect(await getReport(env.DB, 's', 'pumas', 'nope')).toBeNull();
  });

  it('loads every report in a season', async () => {
    await saveReport(env.DB, input());
    // The second report reuses named player n1, which the first save created.
    await saveReport(env.DB, input({ reportId: 'r2', row: { ...input().row, gameId: 'g2' }, newNamed: [], milestones: [] }));
    expect((await loadReports(env.DB, 's')).map((r) => r.gameId).sort()).toEqual(['g1', 'g2']);
  });
});

describe('toReportOut', () => {
  it('returns labels, never full names', async () => {
    await saveReport(env.DB, input());
    const out = toReportOut((await getReport(env.DB, 's', 'pumas', 'g1'))!, labels);
    expect(out.potd).toEqual({ kind: 'squad', key: 'p001', label: 'Alex T.' });
    expect(out.mascot).toEqual({ kind: 'named', id: 'n1', label: 'Chris P.' });
    expect(out.milestones[1].player).toEqual({ kind: 'named', id: 'n2', playhqId: 'ph-fill', label: 'Kim W. (not in squad)' });
    expect(JSON.stringify(out)).not.toMatch(/Pratt|Walker/);
  });

  it('shows Unknown player when a squad key was removed from the JSON', async () => {
    await saveReport(env.DB, input());
    const out = toReportOut((await getReport(env.DB, 's', 'pumas', 'g1'))!, new Map());
    expect(out.potd).toEqual({ kind: 'squad', key: 'p001', label: 'Unknown player' });
  });
});
