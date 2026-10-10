const KEY = 'pcc-gear-admin';

function stored(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return ''; // storage blocked
  }
}

/** Admin passcode, kept in this browser (localStorage) once /api/admin/check accepts it; cleared on a 401. */
export const admin = $state({ passcode: stored() });

export function unlock(passcode: string) {
  admin.passcode = passcode;
  try {
    localStorage.setItem(KEY, passcode);
  } catch {
    /* ignore */
  }
}

export function lock() {
  admin.passcode = '';
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
