import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureOutput } from './support/capture';
import { startScripted, type Scripted } from './support/servers';

const { NextRequest } = await import('next/server');
const route = await import('@/app/api/v1/materials/[id]/pages/[page]/picture/route');

const CREDENTIAL = 'configured-service-credential-0123456789';
const SESSION = 'sessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SITE = 'http://localhost:3000';
const ID = '0190a0b0-0000-7000-8000-000000000003';

/** The picture route handler itself (Story 1.19), as Next.js calls it. */
describe('picture route', () => {
  let backend: Scripted | undefined;
  beforeEach(() => {
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  });
  afterEach(async () => {
    await backend?.close();
    backend = undefined;
    vi.unstubAllEnvs();
  });

  it('runs on the Node runtime and is never cached', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
  });

  it('relays the ground and the session cookie as X-Session-Token to the backend', async () => {
    backend = await startScripted({
      [`GET /api/v1/materials/${ID}/pages/13/picture?ground=review`]: { status: 200, body: 'webp', contentType: 'image/webp' },
    });
    vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
    captureOutput();
    const answer = await route.GET(
      new NextRequest(`${SITE}/api/v1/materials/${ID}/pages/13/picture?ground=review`, {
        headers: { cookie: `__Host-gmshield-session=${SESSION}.4102444800` },
      }),
      { params: Promise.resolve({ id: ID, page: '13' }) },
    );
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('image/webp');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(backend.calls[0]!.url).toBe(`/api/v1/materials/${ID}/pages/13/picture?ground=review`);
    expect(backend.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(backend.calls[0]!.headers.cookie).toBeUndefined();
    expect(backend.calls[0]!.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
  });
});
