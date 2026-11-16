import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, relative } from 'node:path';
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

  // Runs on the build of the test above.
  it('serves each theme from its cookie, with no style attribute and same-origin fonts and images', async () => {
    // The project's lockfile sits above the scratch copy, so Next.js nests the app in the output.
    const standalone = join(SCRATCH, '.next/standalone', relative(ROOT, SCRATCH));
    cpSync(join(SCRATCH, '.next/static'), join(standalone, '.next/static'), { recursive: true });
    const port = await freePort();
    const server = spawn(process.execPath, [join(standalone, 'server.js')], {
      cwd: standalone,
      env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', GMSHIELD_BACKEND_URL: 'http://backend.invalid:8080' },
      stdio: 'ignore',
    });
    const origin = `http://127.0.0.1:${port}`;
    try {
      await waitUntilServing(origin);
      for (const theme of ['illustrated', 'dark', 'light']) {
        const html = await (await fetch(`${origin}/`, { headers: { cookie: `__Host-gmshield-theme=${theme}; __Host-gmshield-lang=en` } })).text();
        expect(html).toMatch(new RegExp(`<html lang="en" data-theme="${theme}"`));
        expect(html, theme).not.toMatch(/<[^>]+\sstyle=/);
        expectSameOriginStatic(html, origin);
      }
      const first = await fetch(`${origin}/`, { headers: { 'accept-language': 'en-US' } });
      expect(await first.text()).toContain('<html lang="en" data-theme="illustrated"');

      const html = await (await fetch(`${origin}/`)).text();
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
      const stylesheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1] ?? '');
      expect(stylesheets.length).toBeGreaterThan(0);
      let fonts = 0;
      let images = 0;
      for (const href of stylesheets) {
        const css = await (await fetch(new URL(href, origin))).text();
        for (const [, url = ''] of css.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
          if (!url.startsWith('data:')) {
            expect(new URL(url, new URL(href, origin)).origin, url).toBe(origin);
          }
          fonts += url.endsWith('.woff2') ? 1 : 0;
          images += url.endsWith('.webp') ? 1 : 0;
        }
      }
      expect(fonts, 'DM Sans is bundled').toBeGreaterThan(0);
      expect(images, 'the backdrop is bundled').toBeGreaterThan(0);

      const missing = await fetch(`${origin}/nope`, { headers: { 'accept-language': 'en' } });
      expect(missing.status).toBe(404);
      expect(await missing.text()).toContain('Not found.');
      const ausente = await fetch(`${origin}/nope`);
      expect(ausente.status).toBe(404);
      expect(await ausente.text()).toContain('Não encontrado.');
    } finally {
      server.kill();
    }
  }, 60_000);

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

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

async function waitUntilServing(origin: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${origin}/api/health`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`${origin} did not start`);
}

/** Every script, stylesheet, font and image the page names is on the page's own origin. */
function expectSameOriginStatic(html: string, origin: string): void {
  const urls = [...html.matchAll(/\s(?:src|href|srcset)="([^"]+)"/g)].map((match) => match[1] ?? '');
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(new URL(url, origin).origin, url).toBe(origin);
  }
}
