import { admin, lock } from './admin.svelte';

export type AdminResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** Calls /api/admin/* with the stored passcode; a 401 forgets it (spec §3.4). */
export async function adminCall<T = unknown>(path: string, method = 'GET', json?: unknown): Promise<AdminResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      headers: { 'x-admin-passcode': admin.passcode, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server — check your connection.' };
  }
  if (res.ok) return { ok: true, data: (res.status === 204 ? null : await res.json()) as T };
  if (res.status === 401) lock();
  const body = await res.json().catch(() => null);
  return { ok: false, status: res.status, message: res.status === 401 ? 'Wrong passcode — enter it again on the admin page.' : (body?.message ?? 'Something went wrong.') };
}
