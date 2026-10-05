import type { V1Game, V2Summary } from '../../src/playhq/types';

export const PUMAS = 'team-pumas';
export const OPP = 'team-opp';
export const GRADE = 'grade-y6';

export function v1Game(o: { id: string; date: string | null; opp?: string; status?: string; round?: number; teamId?: string }): V1Game {
  return {
    id: o.id,
    status: o.status ?? 'FINAL',
    round: { name: `Round ${o.round ?? 1}`, abbreviatedName: `R${o.round ?? 1}` },
    schedule: o.date ? { date: o.date, time: '09:00:00', timezone: 'Pacific/Auckland' } : null,
    venue: { name: 'Parklands Reserve' },
    competitors: [
      { id: o.teamId ?? PUMAS, name: 'Parklands Pumas' },
      { id: OPP, name: o.opp ?? 'Syd Martin Scorchers' },
    ],
  };
}

export const v1Page = (games: V1Game[], nextCursor: string | null = null) => ({
  data: games,
  metadata: { hasMore: nextCursor !== null, nextCursor },
});

type Totals = { runs: number; wkts: number };
const st = (pairs: [string, number][]) => pairs.map(([type, value]) => ({ type, value }));
const totals = (t?: Totals | null) => (t ? st([['TOTAL_SCORE', t.runs], ['TOTAL_OUTS', t.wkts]]) : []);

export function summary(o: {
  id: string;
  status?: string;
  team?: Totals | null;
  opp?: Totals | null;
  batting?: { id: string; runs: number }[];
  bowling?: { id: string; wkts: number }[];
  appearances?: { id: string; firstName: string | null; lastName: string | null }[];
}): V2Summary {
  return {
    id: o.id,
    status: o.status ?? 'FINAL',
    teams: [
      { id: PUMAS, name: 'Parklands Pumas' },
      { id: OPP, name: 'Syd Martin Scorchers' },
    ],
    appearances: (o.appearances ?? []).map((a) => ({ ...a, teamId: PUMAS })),
    periods: [
      {
        name: 'FIRST_INNINGS',
        sequenceNo: 1,
        teams: [
          { id: OPP, discipline: 'BATTING', statistics: totals(o.opp), appearances: [] },
          {
            id: PUMAS,
            discipline: 'BOWLING',
            statistics: [],
            appearances: (o.bowling ?? []).map((b) => ({ id: b.id, statistics: st([['WICKETS', b.wkts]]) })),
          },
        ],
      },
      {
        name: 'FIRST_INNINGS',
        sequenceNo: 2,
        teams: [
          {
            id: PUMAS,
            discipline: 'BATTING',
            statistics: totals(o.team),
            appearances: (o.batting ?? []).map((b) => ({ id: b.id, statistics: st([['TOTAL_RUNS', b.runs]]) })),
          },
          { id: OPP, discipline: 'BOWLING', statistics: [], appearances: [] },
        ],
      },
    ],
  };
}

type Route = unknown | ((url: URL) => Response | unknown);

/** Fake fetch keyed by URL path. Functions receive the URL; other values are returned as JSON. */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const headers: Headers[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname + url.search);
    headers.push(new Headers(init?.headers));
    const hit = routes[url.pathname];
    if (hit === undefined) return new Response('not found', { status: 404 });
    const value = typeof hit === 'function' ? (hit as (u: URL) => unknown)(url) : hit;
    return value instanceof Response ? value : Response.json(value);
  }) as typeof fetch;
  return { fetch: fn, calls, headers };
}

export const fail = () => new Response('boom', { status: 500 });
