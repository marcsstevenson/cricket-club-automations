import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, PLAYHQ_API_KEY: 'test-key', ADMIN_PASSCODE: 'letmein' },
        },
      }),
    ],
    test: {
      include: ['shared/test/**/*.test.ts', 'api/test/**/*.test.ts'],
      setupFiles: ['./api/test/setup.ts'],
    },
  };
});
