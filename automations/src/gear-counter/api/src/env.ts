export interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  WRITE_LIMIT: RateLimit;
}

export interface Deps {
  now: () => Date;
  id: () => string;
  /** true = allowed, false = over the limit */
  limit: (env: Env, key: string) => Promise<boolean>;
}

export const defaultDeps: Deps = {
  now: () => new Date(),
  id: () => crypto.randomUUID().replaceAll('-', ''),
  limit: async (env, key) => (await env.WRITE_LIMIT.limit({ key })).success,
};

export type AppEnv = { Bindings: Env; Variables: { deps: Deps } };
