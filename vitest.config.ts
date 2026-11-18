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
    exclude: ['**/node_modules/**', '.build-guard/**'],
    testTimeout: 10_000,
    // Plain tests run in Node; component tests (*.test.tsx) in jsdom.
    projects: [
      { extends: true, test: { name: 'node', environment: 'node', include: ['test/**/*.test.ts'] } },
      { extends: true, test: { name: 'dom', environment: 'jsdom', include: ['test/**/*.test.tsx'] } },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'reports/coverage',
      include: ['src/**/*.{ts,tsx}', 'stand-in-backend/**/*.mjs'],
      exclude: ['src/server/backend/generated/**'],
    },
  },
});
