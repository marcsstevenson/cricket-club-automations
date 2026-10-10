const KEY = 'pcc-gear-name';

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** The name recorded against this browser's changes (spec §3.1). Empty until asked. */
export const me = $state({ name: read() });

export function setName(name: string) {
  me.name = name.trim().slice(0, 40);
  try {
    localStorage.setItem(KEY, me.name);
  } catch {
    // Storage blocked: the name lasts for this page only.
  }
}
