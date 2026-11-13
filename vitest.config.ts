import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': here('./src'),
      // `server-only` throws outside the React server bundles; in a test, its guard is
      // test/build-guard.test.ts, which runs a real `next build`.
      'server-only': here('./test/support/empty.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '.build-guard/**'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'reports/coverage',
      include: ['src/**/*.{ts,tsx}', 'stand-in-backend/**/*.mjs'],
      exclude: ['src/server/backend/generated/**'],
    },
  },
});
