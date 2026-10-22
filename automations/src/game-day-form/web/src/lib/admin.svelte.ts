const KEY = 'pcc-admin';

function stored(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return ''; // storage blocked
  }
}

/** Admin passcode for this tab, kept once /api/admin/check accepts it. Non-empty means the admin menu shows. */
export const admin = $state({ passcode: stored() });

export function unlock(passcode: string) {
  admin.passcode = passcode;
  try {
    sessionStorage.setItem(KEY, passcode);
  } catch {
    /* ignore */
  }
}

export function lock() {
  admin.passcode = '';
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** A request to an admin endpoint with this tab's passcode. A 401 locks the tab again. */
export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`/api/admin${path}`, { ...init, headers: { ...init.headers, 'x-admin-passcode': admin.passcode } });
  if (res.status === 401) lock();
  return res;
}

/** The message for a failed admin request. */
export function adminError(res: Response, body: { message?: string } | null, fallback: string): string {
  if (res.status === 401) return 'Wrong passcode — enter it again.';
  if (res.status === 429) return 'Too many requests — wait a minute.';
  return body?.message ?? fallback;
}
