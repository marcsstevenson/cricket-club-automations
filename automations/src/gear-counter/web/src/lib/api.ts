import type { ApiErrorBody, Line, Stocktake, TeamPage, TeamSummary } from '$shared/types';

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
  const line = (id: string, item: string) => `/stocktakes/${id}/lines/${encodeURIComponent(item)}`;
  return {
    teams: () => req<TeamSummary[]>('/teams'),
    team: (slug: string) => req<TeamPage>(`/teams/${encodeURIComponent(slug)}`),
    open: (slug: string) => req<Stocktake>(`/teams/${encodeURIComponent(slug)}/stocktakes`, { method: 'POST' }),
    stocktake: (id: string) => req<Stocktake>(`/stocktakes/${id}`),
    adjust: (id: string, item: string, delta: number) =>
      req<{ count: number }>(`${line(id, item)}/adjust`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delta }),
      }),
    addLine: (id: string, item: string) => req<Line>(line(id, item), { method: 'PUT' }),
    removeLine: (id: string, item: string) => req<null>(line(id, item), { method: 'DELETE' }),
  };
}
