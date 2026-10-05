export interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  CONFIG: KVNamespace;
  WRITE_LIMIT: RateLimit;
  REFRESH_LIMIT: RateLimit;
  ADMIN_LIMIT: RateLimit;
  PLAYHQ_API_KEY: string;
  PLAYHQ_TENANT: string;
  PLAYHQ_ORG_ID: string;
  PLAYHQ_BASE_URL: string;
  ADMIN_PASSCODE: string;
}

export type LimitName = 'WRITE_LIMIT' | 'REFRESH_LIMIT' | 'ADMIN_LIMIT';

export interface Deps {
  fetch: typeof fetch;
  now: () => Date;
  id: () => string;
  /** true = allowed, false = over the limit */
  limit: (env: Env, name: LimitName, key: string) => Promise<boolean>;
}

export const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  id: () => crypto.randomUUID().replaceAll('-', ''),
  limit: async (env, name, key) => (await env[name].limit({ key })).success,
};

export type AppEnv = { Bindings: Env; Variables: { deps: Deps } };
