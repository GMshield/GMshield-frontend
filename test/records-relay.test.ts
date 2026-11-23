import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureOutput } from './support/capture';
import { startScripted, type Scripted } from './support/servers';

/** Story 4.3: the relays of a record's version's pages, the browser's calls and the picture path. */
const CREDENTIAL = 'configured-service-credential-0123456789';
const SESSION = 'sessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const COOKIE = `__Host-gmshield-session=${SESSION}.4102444800`;
const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const RECORD = '0190a0b0-0000-7000-8000-000000000700';

const PAGE = {
  page: 241,
  pageTotal: 300,
  picture: null,
  lines: [],
  text: '# Magias\n\nBola de Fogo.',
  passages: [],
  outcome: 'read_directly',
};

describe("the relays of a record's pages (Story 4.3)", () => {
  let scripted: Scripted | undefined;
  afterEach(async () => {
    await scripted?.close();
    scripted = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function useBackend(routes: Parameters<typeof startScripted>[0]) {
    scripted = await startScripted(routes);
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_BACKEND_URL', scripted.url);
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
    return scripted;
  }

  async function page(headers: Record<string, string>, id = SYSTEM, recordId = RECORD, number = '241'): Promise<Response> {
    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/v1/systems/[id]/records/[recordId]/pages/[page]/route');
    const request = new NextRequest(`http://gm.test/api/v1/systems/${id}/records/${recordId}/pages/${number}`, { headers: { host: 'gm.test', ...headers } });
    return GET(request, { params: Promise.resolve({ id, recordId, page: number }) });
  }

  it('reads a page through the typed client with the session, and passes a refusal on as a problem', async () => {
    const backend = await useBackend({
      [`GET /api/v1/systems/${SYSTEM}/records/${RECORD}/pages/241`]: { status: 200, body: PAGE },
      [`GET /api/v1/systems/${SYSTEM}/records/${RECORD}/pages/301`]: {
        status: 404,
        body: { status: 404, category: 'request', code: 'request.not_found', params: {} },
      },
    });
    const shown = await page({ 'sec-fetch-site': 'same-origin', cookie: COOKIE });
    expect(shown.status).toBe(200);
    expect(await shown.json()).toEqual(PAGE);
    expect(shown.headers.get('cache-control')).toBe('no-store');
    expect(backend.calls[0]!.url).toBe(`/api/v1/systems/${SYSTEM}/records/${RECORD}/pages/241`);
    expect(backend.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(backend.calls[0]!.headers.cookie).toBeUndefined();
    const refused = await page({ 'sec-fetch-site': 'same-origin', cookie: COOKIE }, SYSTEM, RECORD, '301');
    expect(refused.status).toBe(404);
    expect(refused.headers.get('content-type')).toBe('application/problem+json');
  });

  it('refuses another origin, no session, and ids or a page that cannot be ones without reaching the backend', async () => {
    const backend = await useBackend({});
    expect((await page({ origin: 'http://evil.test', cookie: COOKIE })).status).toBe(403);
    expect((await page({ origin: 'http://gm.test' })).status).toBe(401);
    for (const [id, recordId, number] of [
      ['nope', RECORD, '1'],
      [SYSTEM, 'nope', '1'],
      [SYSTEM, RECORD, '0'],
      [SYSTEM, RECORD, '01'],
    ] as const) {
      expect((await page({ origin: 'http://gm.test', cookie: COOKIE }, id, recordId, number)).status).toBe(404);
    }
    expect(backend.calls).toEqual([]);
  });

  it('relays the picture: system then record in the path, the session as X-Session-Token', async () => {
    const route = await import('@/app/api/v1/systems/[id]/records/[recordId]/pages/[page]/picture/route');
    const { NextRequest } = await import('next/server');
    const backend = await useBackend({
      [`GET /api/v1/systems/${SYSTEM}/records/${RECORD}/pages/13/picture`]: { status: 200, body: 'webp', contentType: 'image/webp' },
    });
    captureOutput();
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    const answer = await route.GET(
      new NextRequest(`http://gm.test/api/v1/systems/${SYSTEM}/records/${RECORD}/pages/13/picture`, { headers: { cookie: COOKIE } }),
      { params: Promise.resolve({ id: SYSTEM, recordId: RECORD, page: '13' }) },
    );
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('image/webp');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(backend.calls[0]!.url).toBe(`/api/v1/systems/${SYSTEM}/records/${RECORD}/pages/13/picture`);
    expect(backend.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(backend.calls[0]!.headers.cookie).toBeUndefined();
    const { recordPicturePath } = await import('@/server/backend/picture-relay');
    expect(recordPicturePath(SYSTEM, RECORD, '3')).toBe(`/api/v1/systems/${SYSTEM}/records/${RECORD}/pages/3/picture`);
    expect(recordPicturePath('nope', RECORD, '3')).toBeNull();
    expect(recordPicturePath(SYSTEM, '../x', '3')).toBeNull();
    expect(recordPicturePath(SYSTEM, RECORD, '0')).toBeNull();
  });

  it('the browser reads a page from this site only, and nothing that is not a page', async () => {
    const { fetchRecordPage, recordPictureUrl } = await import('@/client/records');
    const send = vi.fn(async () => Response.json(PAGE));
    vi.stubGlobal('fetch', send);
    expect(await fetchRecordPage(SYSTEM, RECORD, 241)).toEqual(PAGE);
    expect(send).toHaveBeenCalledWith(`/api/v1/systems/${SYSTEM}/records/${RECORD}/pages/241`, expect.objectContaining({ credentials: 'same-origin' }));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...PAGE, lines: [{ text: 1 }] })));
    expect(await fetchRecordPage(SYSTEM, RECORD, 241)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'request.not_found' }, { status: 404 })));
    expect(await fetchRecordPage(SYSTEM, RECORD, 241)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await fetchRecordPage(SYSTEM, RECORD, 241)).toBeNull();
    expect(recordPictureUrl(SYSTEM, RECORD, 7)).toBe(`/api/v1/systems/${SYSTEM}/records/${RECORD}/pages/7/picture`);
  });
});
