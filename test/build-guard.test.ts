import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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

function nextBuild(): { status: number | null; signal: NodeJS.Signals | null; error: Error | undefined; output: string } {
  const result = spawnSync(process.execPath, [join(ROOT, 'node_modules/next/dist/bin/next'), 'build'], {
    cwd: SCRATCH,
    encoding: 'utf8',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', GMSHIELD_BACKEND_URL: 'http://backend.invalid:8080' },
    timeout: 240_000,
  });
  return { status: result.status, signal: result.signal, error: result.error, output: `${result.stdout}\n${result.stderr}` };
}

describe('build guard', () => {
  afterAll(() => {
    rmSync(join(ROOT, '.build-guard'), { recursive: true, force: true });
  });

  it('builds the unmodified app, and renders / per request', () => {
    copyApp();
    const { status, signal, error, output } = nextBuild();
    expect(error, output).toBeUndefined();
    expect(signal, output).toBeNull();
    expect(status, output).toBe(0);
    // The CSP nonce needs every page rendered per request: none may be prerendered.
    const manifest = JSON.parse(readFileSync(join(SCRATCH, '.next/prerender-manifest.json'), 'utf8')) as { routes: Record<string, unknown> };
    expect(Object.keys(manifest.routes)).not.toContain('/');
  }, 300_000);

  it('fails `next build` when a client component imports a module under src/server', () => {
    copyApp();
    mkdirSync(join(SCRATCH, 'src/app/build-guard'), { recursive: true });
    cpSync(join(ROOT, 'test/fixtures/build-guard/page.tsx'), join(SCRATCH, 'src/app/build-guard/page.tsx'));
    const { status, signal, error, output } = nextBuild();
    expect(error, output).toBeUndefined();
    expect(signal, output).toBeNull();
    expect(status, output).toBe(1);
    expect(output).toContain('cannot be imported from a Client Component module');
  }, 300_000);
});
