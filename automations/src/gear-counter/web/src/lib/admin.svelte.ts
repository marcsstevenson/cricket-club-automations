const KEY = 'pcc-gear-admin';

function stored(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return ''; // storage blocked
  }
}

/** Admin passcode for this tab, kept once /api/admin/check accepts it.  */
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
