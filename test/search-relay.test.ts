import { afterEach, describe, expect, it, vi } from 'vitest';

import { startScripted, type Scripted } from './support/servers';

/** Story 3.9: the search's relays, the browser's calls and the picture path of a page of the current scope. */
const CREDENTIAL = 'configured-service-credential-0123456789';
const SESSION = 'sessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const COOKIE = `__Host-gmshield-session=${SESSION}.4102444800`;
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const SEARCH = '0190a0b0-0000-7000-8000-000000000072';
const VERSION = '0190a0b0-0000-7000-8000-000000000071';
const NOTES = '0190a0b0-0000-7000-8000-000000000060';

type Search = import('@/client/search').Search;
type SearchResult = import('@/client/search').SearchResult;

function result(index: number): SearchResult {
  return {
    passageId: `0190a0b0-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`,
    versionId: VERSION,
    materialName: 'Livro do Jogador.pdf',
    sectionPath: ['Magias', 'Fire Bolt'],
    page: 10 + index,
    firstWords: `Trecho ${index} sobre Fire Bolt`,
    tier: 'system',
  };
}

function search(overrides: Partial<Search> = {}): Search {
  return { id: SEARCH, campaignId: CAMPAIGN, query: 'Fire Bolt', tier: null, materialId: null, state: 'done', results: [result(1)], ...overrides };
}

const PAGE = {
  page: 11,
  pageTotal: 40,
  picture: null,
  lines: [],
  text: '# Magias\n\nFire Bolt causa 1d10.',
  passages: [{ id: result(1).passageId, range: [10, 31] as [number, number] }],
  outcome: 'read_directly',
};

describe('the search relays (Story 3.9)', () => {
  let scripted: Scripted | undefined;
  afterEach(async () => {
    await scripted?.close();
    scripted = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function useBackend(routes: Parameters<typeof startScripted>[0]) {
    return startScripted(routes).then((running) => {
      scripted = running;
      vi.stubEnv('GMSHIELD_MODE', '');
      vi.stubEnv('GMSHIELD_BACKEND_URL', running.url);
      vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
      return running;
    });
  }

  async function create(headers: Record<string, string>, body: string, id = CAMPAIGN): Promise<Response> {
    const { NextRequest } = await import('next/server');
    const { POST } = await import('@/app/api/v1/campaigns/[id]/searches/route');
    const request = new NextRequest(`http://gm.test/api/v1/campaigns/${id}/searches`, {
      method: 'POST',
      headers: { host: 'gm.test', 'content-type': 'application/json', ...headers },
      body,
    });
    return POST(request, { params: Promise.resolve({ id }) });
  }

  async function read(headers: Record<string, string>, id = SEARCH): Promise<Response> {
    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/v1/searches/[id]/route');
    return GET(new NextRequest(`http://gm.test/api/v1/searches/${id}`, { headers: { host: 'gm.test', ...headers } }), { params: Promise.resolve({ id }) });
  }

  async function sourcePage(headers: Record<string, string>, id = CAMPAIGN, versionId = VERSION, number = '11'): Promise<Response> {
    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/v1/campaigns/[id]/sources/[versionId]/pages/[page]/route');
    const request = new NextRequest(`http://gm.test/api/v1/campaigns/${id}/sources/${versionId}/pages/${number}`, { headers: { host: 'gm.test', ...headers } });
    return GET(request, { params: Promise.resolve({ id, versionId, page: number }) });
  }

  it('starts a search through the typed client with the session, its filters only when given, and answers its id', async () => {
    const backend = await useBackend({ [`POST /api/v1/campaigns/${CAMPAIGN}/searches`]: { status: 202, body: { id: SEARCH } } });

    const answered = await create({ origin: 'http://gm.test', cookie: COOKIE }, JSON.stringify({ query: 'Fire Bolt', tier: 'system', materialId: null }));

    expect(answered.status).toBe(202);
    expect(await answered.json()).toEqual({ id: SEARCH });
    expect(answered.headers.get('cache-control')).toBe('no-store');
    expect(backend.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(JSON.parse(backend.calls[0]!.body)).toEqual({ query: 'Fire Bolt', tier: 'system' });
  });

  it('refuses another origin, a malformed body and no session without reaching the backend, and passes a refusal on', async () => {
    const backend = await useBackend({
      [`POST /api/v1/campaigns/${CAMPAIGN}/searches`]: { status: 400, body: { status: 400, category: 'request', code: 'request.invalid', params: {} } },
    });
    expect((await create({ origin: 'http://evil.test', cookie: COOKIE }, '{"query":"x"}')).status).toBe(403);
    for (const body of ['{nope', '{"query":7}', '[]', '{"query":"x","tier":3}', '{"query":"x","materialId":{}}']) {
      expect((await create({ origin: 'http://gm.test', cookie: COOKIE }, body)).status, body).toBe(400);
    }
    expect((await create({ origin: 'http://gm.test' }, '{"query":"x"}')).status).toBe(401);
    expect((await create({ origin: 'http://gm.test', cookie: COOKIE }, '{"query":"x"}', 'nope')).status).toBe(404);
    expect(backend.calls).toEqual([]);
    const refused = await create({ origin: 'http://gm.test', cookie: COOKIE }, '{"query":" "}');
    expect(refused.status).toBe(400);
    expect(refused.headers.get('content-type')).toBe('application/problem+json');
  });

  it('reads a search and a page of the current scope through the typed client, and drops a malformed id without reaching the backend', async () => {
    const backend = await useBackend({
      [`GET /api/v1/searches/${SEARCH}`]: { status: 200, body: search() },
      [`GET /api/v1/campaigns/${CAMPAIGN}/sources/${VERSION}/pages/11`]: { status: 200, body: PAGE },
    });

    const found = await read({ 'sec-fetch-site': 'same-origin', cookie: COOKIE });
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(search());
    const shown = await sourcePage({ 'sec-fetch-site': 'same-origin', cookie: COOKIE });
    expect(shown.status).toBe(200);
    expect(await shown.json()).toEqual(PAGE);
    expect(backend.calls.map((call) => call.url)).toEqual([`/api/v1/searches/${SEARCH}`, `/api/v1/campaigns/${CAMPAIGN}/sources/${VERSION}/pages/11`]);

    expect((await read({ origin: 'http://evil.test', cookie: COOKIE })).status).toBe(403);
    expect((await read({ origin: 'http://gm.test', cookie: COOKIE }, 'nope')).status).toBe(404);
    expect((await read({ origin: 'http://gm.test' })).status).toBe(401);
    for (const [id, versionId, number] of [
      ['nope', VERSION, '1'],
      [CAMPAIGN, 'nope', '1'],
      [CAMPAIGN, VERSION, '0'],
      [CAMPAIGN, VERSION, '01'],
    ] as const) {
      expect((await sourcePage({ origin: 'http://gm.test', cookie: COOKIE }, id, versionId, number)).status).toBe(404);
    }
    expect(backend.calls).toHaveLength(2);
  });

  it('the browser calls reach this site only, and read nothing that is not a search or a page', async () => {
    const { startSearch, readSearch, fetchScopePage, scopePictureUrl } = await import('@/client/search');
    const send = vi.fn(async () => Response.json({ id: SEARCH }, { status: 202 }));
    vi.stubGlobal('fetch', send);
    expect(await startSearch(CAMPAIGN, 'x', { tier: null, materialId: NOTES })).toEqual({ ok: true, id: SEARCH });
    expect(send).toHaveBeenCalledWith(`/api/v1/campaigns/${CAMPAIGN}/searches`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ query: 'x', tier: null, materialId: NOTES }) }));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'request.invalid' }, { status: 400 })));
    expect(await startSearch(CAMPAIGN, '', { tier: null, materialId: null })).toMatchObject({ ok: false, status: 400 });

    vi.stubGlobal('fetch', vi.fn(async () => Response.json(search())));
    expect(await readSearch(SEARCH)).toEqual({ ok: true, search: search() });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(search({ results: [{ ...result(1), page: 0 }] }))));
    expect(await readSearch(SEARCH)).toMatchObject({ ok: false, status: 503 });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'request.not_found' }, { status: 404 })));
    expect(await readSearch(SEARCH)).toMatchObject({ ok: false, status: 404 });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await readSearch(SEARCH)).toMatchObject({ ok: false, status: 503 });

    vi.stubGlobal('fetch', vi.fn(async () => Response.json(PAGE)));
    expect(await fetchScopePage(CAMPAIGN, VERSION, 11)).toEqual(PAGE);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...PAGE, lines: [{ text: 1 }] })));
    expect(await fetchScopePage(CAMPAIGN, VERSION, 11)).toBeNull();
    expect(scopePictureUrl(CAMPAIGN, VERSION, 7)).toBe(`/api/v1/campaigns/${CAMPAIGN}/sources/${VERSION}/pages/7/picture`);
  });

  it('relays a page of the current scope\'s picture only for ids and a page that can be ones', async () => {
    const { scopePicturePath } = await import('@/server/backend/picture-relay');
    expect(scopePicturePath(CAMPAIGN, VERSION, '3')).toBe(`/api/v1/campaigns/${CAMPAIGN}/sources/${VERSION}/pages/3/picture`);
    expect(scopePicturePath('nope', VERSION, '3')).toBeNull();
    expect(scopePicturePath(CAMPAIGN, '../x', '3')).toBeNull();
    expect(scopePicturePath(CAMPAIGN, VERSION, '0')).toBeNull();
  });
});
