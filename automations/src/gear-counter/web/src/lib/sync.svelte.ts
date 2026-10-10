import { api, isTransient } from './api';
import { me } from './who.svelte';

const KEY = 'pcc-gear-pending-v2';
const OLD_KEY = 'pcc-gear-pending-v1';
const RETRY_MS = 4000;
const MAX_STEP = 20; // the API's largest single change

// team|item|who — the name is part of the key so taps keep the name they were made under.
const keyOf = (team: string, item: string, who: string) => `${team}|${item}|${who}`;

function load(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Taps not yet confirmed by the server, as a net change per team, item and name. Kept in localStorage so a
 * reload or lost signal loses nothing; sent one at a time and retried until they land.
 */
class SyncQueue {
  pending = $state<Record<string, number>>({});
  offline = $state(false);
  error = $state('');
  /** Called with the server's level after each change lands. */
  onLevel: ((team: string, item: string, level: number) => void) | null = null;
  /** Called when a team has nothing left to send. */
  onIdle: ((team: string) => void) | null = null;
  #running = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    if (typeof window === 'undefined') return;
    this.pending = load();
    try {
      // Taps queued by the old stocktake version can't be sent any more (spec §7).
      const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? '{}');
      if (old && Object.keys(old).length) this.error = 'Some changes made before the last update could not be saved — please check those levels.';
      localStorage.removeItem(OLD_KEY);
    } catch {
      // ignore
    }
    addEventListener('online', () => void this.flush());
    queueMicrotask(() => void this.flush());
  }

  pendingFor(team: string, item: string) {
    const prefix = `${team}|${item}|`;
    return Object.entries(this.pending).reduce((n, [k, v]) => (k.startsWith(prefix) ? n + v : n), 0);
  }

  hasPending(team: string) {
    return Object.keys(this.pending).some((k) => k.startsWith(`${team}|`));
  }

  add(team: string, item: string, delta: number) {
    this.error = '';
    this.#change(keyOf(team, item, me.name), delta);
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

  async flush() {
    if (this.#running) return;
    this.#running = true;
    clearTimeout(this.#timer);
    try {
      for (let key = Object.keys(this.pending)[0]; key; key = Object.keys(this.pending)[0]) {
        const [team, item, who] = key.split('|');
        const total = this.pending[key];
        const delta = Math.max(-MAX_STEP, Math.min(MAX_STEP, total));
        try {
          const { level } = await api().adjust(team, item, delta, who);
          this.#change(key, -delta);
          this.offline = false;
          this.onLevel?.(team, item, level);
        } catch (e) {
          if (isTransient(e)) {
            this.offline = true;
            this.#timer = setTimeout(() => void this.flush(), RETRY_MS);
            return;
          }
          // The item or team is gone, or the name was refused: these taps can never land.
          this.#change(key, -total);
          this.error = e instanceof Error ? e.message : 'A change could not be saved.';
        }
        if (!this.hasPending(team)) this.onIdle?.(team);
      }
    } finally {
      this.#running = false;
    }
  }
}

export const queue = new SyncQueue();
