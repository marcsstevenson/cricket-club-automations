interface Entry<T> {
  fetchedAt: number;
  data: T;
}

export interface SwrOptions<T> {
  kv: KVNamespace;
  key: string;
  now: number;
  freshFor: (data: T) => number;
  load: () => Promise<T>;
  force?: boolean;
  waitUntil: (p: Promise<unknown>) => void;
}

const THIRTY_DAYS_S = 30 * 24 * 3600;

async function refresh<T>(o: SwrOptions<T>): Promise<T> {
  const data = await o.load();
  await o.kv.put(o.key, JSON.stringify({ fetchedAt: o.now, data } satisfies Entry<T>), { expirationTtl: THIRTY_DAYS_S });
  return data;
}

export async function swr<T>(o: SwrOptions<T>): Promise<{ data: T; stale: boolean }> {
  if (!o.force) {
    const hit = await o.kv.get<Entry<T>>(o.key, 'json');
    if (hit) {
      if (o.now - hit.fetchedAt < o.freshFor(hit.data)) return { data: hit.data, stale: false };
      o.waitUntil(
        refresh(o).catch((err) => console.warn(JSON.stringify({ msg: 'playhq_background_refresh_failed', key: o.key, error: String(err) }))),
      );
      return { data: hit.data, stale: true };
    }
  }
  return { data: await refresh(o), stale: false };
}
