import { api, isTransient } from './api';

const KEY = 'pcc-gear-pending-v1';
const RETRY_MS = 4000;
const MAX_STEP = 20; // the API's largest single change

const keyOf = (stocktakeId: string, itemId: string) => `${stocktakeId}|${itemId}`;

/** Id of a team's unsaved stocktake for today; it is created on the server when its first tap is sent. */
export const draftId = (teamSlug: string) => `draft:${teamSlug}`;
export const isDraft = (stocktakeId: string) => stocktakeId.startsWith('draft:');

function load(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Taps not yet confirmed by the server, as a net change per line. Kept in localStorage so a reload
 * or lost signal loses nothing; sent one line at a time and retried until they land.
 */
class SyncQueue {
  pending = $state<Record<string, number>>({});
  offline = $state(false);
  error = $state('');
  /** Called with the server's count after each change lands. */
  onCount: ((stocktakeId: string, itemId: string, count: number) => void) | null = null;
  /** Called when a draft's first tap has created the real stocktake. */
  onSaved: ((draft: string, stocktakeId: string) => void) | null = null;
  #running = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    if (typeof window === 'undefined') return;
    this.pending = load();
    addEventListener('online', () => void this.flush());
    queueMicrotask(() => void this.flush());
  }

  pendingFor(stocktakeId: string, itemId: string) {
    return this.pending[keyOf(stocktakeId, itemId)] ?? 0;
  }

  hasPending(stocktakeId: string) {
    return Object.keys(this.pending).some((k) => k.startsWith(`${stocktakeId}|`));
  }

  add(stocktakeId: string, itemId: string, delta: number) {
    this.error = '';
    this.#change(keyOf(stocktakeId, itemId), delta);
    void this.flush();
  }

  #change(key: string, delta: number) {
    const next = (this.pending[key] ?? 0) + delta;
    if (next) this.pending[key] = next;
    else delete this.pending[key];
    try {
      localStorage.setItem(KEY, JSON.stringify(this.pending));
    } catch {
      // Private mode or storage full: the queue still works for this page.
    }
  }

  /** Moves taps queued against a draft onto the stocktake the server created for it. */
  adopt(draft: string, stocktakeId: string) {
    for (const key of Object.keys(this.pending).filter((k) => k.startsWith(`${draft}|`))) {
      const total = this.pending[key];
      this.#change(key, -total);
      this.#change(keyOf(stocktakeId, key.slice(draft.length + 1)), total);
    }
  }

  async flush() {
    if (this.#running) return;
    this.#running = true;
    clearTimeout(this.#timer);
    try {
      for (let key = Object.keys(this.pending)[0]; key; key = Object.keys(this.pending)[0]) {
        const [stocktakeId, itemId] = key.split('|');
        const total = this.pending[key];
        const delta = Math.max(-MAX_STEP, Math.min(MAX_STEP, total));
        try {
          if (isDraft(stocktakeId)) {
            // First real tap on a new stocktake: create (or reopen) today's, then send the taps there.
            const saved = await api().open(stocktakeId.slice('draft:'.length));
            this.adopt(stocktakeId, saved.id);
            this.offline = false;
            this.onSaved?.(stocktakeId, saved.id);
            continue;
          }
          const { count } = await api().adjust(stocktakeId, itemId, delta);
          this.#change(key, -delta);
          this.offline = false;
          this.onCount?.(stocktakeId, itemId, count);
        } catch (e) {
          if (isTransient(e)) {
            this.offline = true;
            this.#timer = setTimeout(() => void this.flush(), RETRY_MS);
            return;
          }
          // The line or stocktake is gone: these taps can never land.
          this.#change(key, -total);
          this.error = e instanceof Error ? e.message : 'A change could not be saved.';
        }
      }
    } finally {
      this.#running = false;
    }
  }
}

export const queue = new SyncQueue();
