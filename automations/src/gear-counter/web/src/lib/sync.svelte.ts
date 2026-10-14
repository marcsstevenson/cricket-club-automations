import { fromV2, parseTapKey, tapKey } from '$shared/queue';
import { api, isTransient } from './api';
import { me } from './who.svelte';

const KEY = 'pcc-gear-pending-v3';
const V2_KEY = 'pcc-gear-pending-v2';
const OLD_KEY = 'pcc-gear-pending-v1';
const RETRY_MS = 4000;
const MAX_STEP = 20; // the API's largest single change

// Keys are team|item|mode|who (see $shared/queue) — the name is part of the key so taps keep the name they were made under,
// and the mode keeps plain and Club pool taps from netting against each other.

function read(key: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function load(): Record<string, number> {
  const result = read(KEY);
  const v2 = read(V2_KEY);
  if (Object.keys(v2).length) {
    // Taps queued before Club pool taps were all plain taps.
    for (const [k, n] of Object.entries(fromV2(v2))) result[k] = (result[k] ?? 0) + n;
    try {
      localStorage.setItem(KEY, JSON.stringify(result));
      localStorage.removeItem(V2_KEY);
    } catch {
      // Storage unavailable: the migrated taps still work for this page.
    }
  }
  return result;
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
  /** Called with the Club pool's level after a pool tap lands. */
  onPool: ((item: string, level: number) => void) | null = null;
  /** Called when a pool + applied less than was sent (spec §4.5). */
  onShort: ((team: string, item: string, applied: number, short: number) => void) | null = null;
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
    return Object.entries(this.pending).reduce((n, [k, v]) => {
      const t = parseTapKey(k);
      return t.team === team && t.item === item ? n + v : n;
    }, 0);
  }

  /** This phone's queued Club pool taps for an item, all teams: the Club pool is that much lower than the server says. */
  pendingPool(item: string) {
    return Object.entries(this.pending).reduce((n, [k, v]) => {
      const t = parseTapKey(k);
      return t.mode === 'pool' && t.item === item ? n + v : n;
    }, 0);
  }

  hasPending(team: string) {
    return Object.keys(this.pending).some((k) => k.startsWith(`${team}|`));
  }

  add(team: string, item: string, delta: number, pool: boolean) {
    this.error = '';
    this.#change(tapKey({ team, item, mode: pool ? 'pool' : 'plain', who: me.name }), delta);
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
        const { team, item, mode, who } = parseTapKey(key);
        const total = this.pending[key];
        const delta = Math.max(-MAX_STEP, Math.min(MAX_STEP, total));
        try {
          const r = await api().adjust(team, item, delta, who, mode === 'pool');
          this.#change(key, -delta);
          this.offline = false;
          this.onLevel?.(team, item, r.level);
          if (r.poolLevel !== undefined) this.onPool?.(item, r.poolLevel);
          if (mode === 'pool' && delta > 0 && r.applied < delta) this.onShort?.(team, item, r.applied, delta - r.applied);
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
