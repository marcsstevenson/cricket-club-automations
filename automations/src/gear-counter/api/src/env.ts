export interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  WRITE_LIMIT: RateLimit;
  ADMIN_LIMIT: RateLimit;
  /** Worker secret for /api/admin/*; admin is off when unset. */
  ADMIN_PASSCODE?: string;
}

export type LimitName = 'WRITE_LIMIT' | 'ADMIN_LIMIT';

export interface Deps {
  now: () => Date;
  id: () => string;
  /** true = allowed, false = over the limit */
  limit: (env: Env, name: LimitName, key: string) => Promise<boolean>;
}

export const defaultDeps: Deps = {
  now: () => new Date(),
  id: () => crypto.randomUUID().replaceAll('-', ''),
  limit: async (env, name, key) => (await env[name].limit({ key })).success,
};

export type AppEnv = { Bindings: Env; Variables: { deps: Deps } };
