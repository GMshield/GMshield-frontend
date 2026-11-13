import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

// Run through `npm run lint`: the TypeScript parser needs the compiler API, which TypeScript 7
// does not have, so the script loads the TypeScript 6 companion (scripts/use-typescript6.mjs).
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // The browser never reaches the backend: only src/server may use the typed client.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'openapi-fetch', message: 'Only src/server calls the backend.' }] },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'reports/**', 'coverage/**', '.build-guard/**', '.gmshield-reports/**', 'next-env.d.ts', 'src/server/backend/generated/**']),
]);
