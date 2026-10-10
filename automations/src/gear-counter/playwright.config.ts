import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'web/tests/e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8788' },
  webServer: {
    command: 'npm run e2e:prepare && npx wrangler dev --port 8788 --var ADMIN_PASSCODE:e2e-passcode',
    url: 'http://127.0.0.1:8788/api/health',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
