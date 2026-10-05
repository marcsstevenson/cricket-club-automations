import type { FormState } from '$shared/types';

export interface Draft {
  state: FormState;
  baseVersion: number;
  savedAt: string;
}

export function loadDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, d: Draft) {
  try {
    localStorage.setItem(key, JSON.stringify(d));
  } catch {
    /* storage full or blocked — drafts are a convenience only */
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
