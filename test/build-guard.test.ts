import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
// Inside the project, so that the copy resolves the project's node_modules; ignored by git,
// TypeScript, ESLint and Vitest.
const SCRATCH = join(ROOT, '.build-guard', `run-${process.pid}`);

function copyApp(): void {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  for (const entry of ['src', 'contracts', 'next.config.ts', 'tsconfig.json', 'package.json']) {
    cpSync(join(ROOT, entry), join(SCRATCH, entry), { recursive: true });
  }
}

function nextBuild(): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [join(ROOT, 'node_modules/next/dist/bin/next'), 'build'], {
    cwd: SCRATCH,
    encoding: 'utf8',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', GMSHIELD_BACKEND_URL: 'http://backend.invalid:8080' },
    timeout: 240_000,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe('build guard', () => {
  afterAll(() => {
    rmSync(join(ROOT, '.build-guard'), { recursive: true, force: true });
  });

  it('fails `next build` when a client component imports a module under src/server', () => {
    copyApp();
    cpSync(join(ROOT, 'test/fixtures/build-guard/page.tsx'), join(SCRATCH, 'src/app/build-guard/page.tsx'));
    const { status, output } = nextBuild();
    expect(status, output).not.toBe(0);
    expect(output).toMatch(/server-only/);
  }, 300_000);
});
