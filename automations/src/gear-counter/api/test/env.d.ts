import type { Env as AppBindings } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends AppBindings {
      TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[];
    }
  }
}
