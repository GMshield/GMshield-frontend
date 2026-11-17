import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureOutput } from './support/capture';
import { startScripted, type Scripted } from './support/servers';

const { NextRequest } = await import('next/server');
const route = await import('@/app/api/v1/uploads/[[...path]]/route');

const CREDENTIAL = 'configured-service-credential-0123456789';
const SESSION = 'sessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SITE = 'http://localhost:3000';

function context(path?: string[]) {
  return { params: Promise.resolve(path === undefined ? {} : { path }) };
}

function request(method: string, path: string, headers: Record<string, string>, body?: string) {
  return new NextRequest(`${SITE}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
}

/** The upload route handler itself (Story 1.13), as Next.js calls it. */
describe('upload route', () => {
  let backend: Scripted | undefined;
  beforeEach(() => {
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  });
  afterEach(async () => {
    await backend?.close();
    backend = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function backendAnswering(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
    backend = await startScripted(routes);
    vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
    return backend;
  }

  it('runs on the Node runtime and is never cached', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
  });

  it('refuses a PATCH from another origin without reaching the backend', async () => {
    const scripted = await backendAnswering({ 'PATCH /api/v1/uploads/abc': { status: 204 } });
    captureOutput();
    const answer = await route.PATCH(
      request('PATCH', '/api/v1/uploads/abc', { origin: 'https://evil.example', 'tus-resumable': '1.0.0', 'content-type': 'application/offset+octet-stream' }, 'part'),
      context(['abc']),
    );
    expect(answer.status).toBe(403);
    expect((await answer.json()).code).toBe('request.cross_origin');
    expect(scripted.calls).toHaveLength(0);
  });

  it('sends the session cookie as X-Session-Token on a same-origin creation', async () => {
    const scripted = await backendAnswering({ 'POST /api/v1/uploads': { status: 201 } });
    captureOutput();
    const answer = await route.POST(
      request('POST', '/api/v1/uploads', {
        origin: SITE,
        cookie: `__Host-gmshield-session=${SESSION}.4102444800`,
        'tus-resumable': '1.0.0',
        'upload-length': '10',
        'upload-metadata': 'filename YS5wZGY=',
      }),
      context(),
    );
    expect(answer.status).toBe(201);
    expect(scripted.calls[0]!.url).toBe('/api/v1/uploads');
    expect(scripted.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(scripted.calls[0]!.headers.cookie).toBeUndefined();
    expect(scripted.calls[0]!.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
  });

  it("relays [id, 'completion'] to the backend's completion, and a HEAD without Origin", async () => {
    const scripted = await backendAnswering({
      'POST /api/v1/uploads/abc/completion': { status: 201, body: { materialId: 'm', versionId: 'v', state: 'waiting' } },
      'HEAD /api/v1/uploads/abc': { status: 200 },
    });
    captureOutput();
    const completed = await route.POST(
      request('POST', '/api/v1/uploads/abc/completion', { origin: SITE, 'tus-resumable': '1.0.0', 'content-type': 'application/json' }, '{"sha256":"00"}'),
      context(['abc', 'completion']),
    );
    expect(completed.status).toBe(201);
    expect(await completed.json()).toEqual({ materialId: 'm', versionId: 'v', state: 'waiting' });
    expect(scripted.calls[0]!.url).toBe('/api/v1/uploads/abc/completion');
    expect(scripted.calls[0]!.body).toBe('{"sha256":"00"}');

    const head = await route.HEAD(request('HEAD', '/api/v1/uploads/abc', { 'tus-resumable': '1.0.0' }), context(['abc']));
    expect(head.status).toBe(200);
    expect(scripted.calls[1]!.method).toBe('HEAD');
  });
});
