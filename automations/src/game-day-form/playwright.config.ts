import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'web/tests/e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787' },
  webServer: [
    { command: 'node scripts/playhq-stub.mjs', url: 'http://127.0.0.1:8790/v1/grades/grade-y6/games', reuseExistingServer: false },
    {
      command: 'npm run e2e:prepare && npx wrangler dev --port 8787 --var PLAYHQ_BASE_URL:http://127.0.0.1:8790 --var ADMIN_PASSCODE:e2e-pass',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
