import { emptyForm, type FormState, type ReportIn } from '../../shared/src/types';
import type { createApp } from '../src/app';
import { fakeFetch, GRADE, summary, v1Game, v1Page } from './fixtures/playhq';
import { call } from './helpers';

export function form(over: Partial<ReportIn> = {}): ReportIn {
  const base: FormState = {
    ...emptyForm(),
    scoring: 'no',
    team: { runs: 100, wkts: 5 },
    opp: { runs: 90, wkts: 7 },
    potd: { kind: 'squad', key: 'p001' },
    mascot: { kind: 'squad', key: 'p002' },
  };
  return { ...base, baseVersion: 0, ...over };
}

/** g1 = played, not e-scored. g2 = played, final on PlayHQ. g3 = future. */
export const pumasRoutes = (over: Record<string, unknown> = {}) =>
  fakeFetch({
    [`/v1/grades/${GRADE}/games`]: v1Page([
      v1Game({ id: 'g1', date: '2026-01-24', round: 3, opp: 'Hornby Hawks' }),
      v1Game({ id: 'g2', date: '2026-01-31', round: 4 }),
      v1Game({ id: 'g3', date: '2026-02-07', status: 'PENDING', round: 5 }),
    ]),
    '/v2/games/g1/summary': { data: summary({ id: 'g1' }) },
    '/v2/games/g2/summary': {
      data: summary({
        id: 'g2',
        team: { runs: 145, wkts: 4 },
        opp: { runs: 128, wkts: 4 },
        batting: [{ id: 'ph-alex', runs: 31 }, { id: 'ph-fill', runs: 27 }],
        appearances: [{ id: 'ph-fill', firstName: 'Kim', lastName: 'Walker' }],
      }),
    },
    '/v2/games/g3/summary': { data: summary({ id: 'g3', status: 'PENDING' }) },
    ...over,
  });

export const put = (app: ReturnType<typeof createApp>, gameId: string, body: unknown) =>
  call(app, `/api/teams/pumas/games/${gameId}/report`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
