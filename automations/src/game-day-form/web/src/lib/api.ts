import type { ApiErrorBody, GamePage, GamesList, RefreshResult, ReportOut, TeamPage, TeamSummary } from '$shared/api';
import type { ReportIn } from '$shared/types';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public body: ApiErrorBody | null) {
    super(message);
  }
}

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
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    teams: () => req<TeamSummary[]>('/teams'),
    team: (slug: string) => req<TeamPage>(`/teams/${encodeURIComponent(slug)}`),
    game: (slug: string, gameId: string) => req<GamePage>(`/teams/${slug}/games/${encodeURIComponent(gameId)}`),
    refresh: (slug: string, gameId: string) => req<RefreshResult>(`/teams/${slug}/games/${encodeURIComponent(gameId)}/refresh`, { method: 'POST' }),
    save: (slug: string, gameId: string, body: ReportIn) => req<ReportOut>(`/teams/${slug}/games/${encodeURIComponent(gameId)}/report`, json('PUT', body)),
    uploadPhoto: (blob: Blob) => req<{ id: string }>('/photos', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob }),
    games: (qs: string) => req<GamesList>(`/games${qs ? `?${qs}` : ''}`),
  };
}
