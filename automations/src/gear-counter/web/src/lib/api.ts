import type { ApiErrorBody, LevelLine, TeamPage, TeamSummary } from '$shared/types';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public body: ApiErrorBody | null) {
    super(message);
  }
}

/** Worth retrying later: no connection, rate limited or a server fault. */
export const isTransient = (e: unknown) => !(e instanceof ApiFailure) || e.status === 0 || e.status === 429 || e.status >= 500;

export function api(f: typeof fetch = fetch) {
  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await f(`/api${path}`, init);
    } catch {
      throw new ApiFailure(0, 'network', 'Could not reach the server — check your connection and try again.', null);
    }
    const body = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
    if (!res.ok) throw new ApiFailure(res.status, body?.error ?? 'error', body?.message ?? 'Something went wrong.', body);
    return body as T;
  }
  const item = (team: string, id: string) => `/teams/${encodeURIComponent(team)}/items/${encodeURIComponent(id)}`;
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return {
    teams: () => req<TeamSummary[]>('/teams'),
    team: (slug: string) => req<TeamPage>(`/teams/${encodeURIComponent(slug)}`),
    adjust: (team: string, id: string, delta: number, who: string) => req<{ level: number }>(`${item(team, id)}/adjust`, json('POST', { delta, who })),
    list: (team: string, id: string, who: string) => req<LevelLine>(item(team, id), json('PUT', { who })),
    unlist: (team: string, id: string) => req<null>(item(team, id), { method: 'DELETE' }),
    count: (team: string, id: string, level: number, who: string, note: string) =>
      req<{ level: number }>(`${item(team, id)}/count`, json('POST', { level, who, note })),
    move: (b: { from: string; to: string; item: string; qty: number; who: string; note: string }) =>
      req<{ fromLevel: number; toLevel: number }>('/moves', json('POST', b)),
  };
}
