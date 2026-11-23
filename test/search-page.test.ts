import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: () => undefined,
  }),
}));
// The page's body runs in the browser; here it shows only what the page hands it.
vi.mock('@/components/search/SearchPage', () => ({
  SearchPage: (props: Record<string, unknown>) => {
    const { language, campaignId, query, searchId, tier, materialId, page, scope } = props;
    return JSON.stringify({ language, campaignId, query, searchId, tier, materialId, page, scope: scope === null ? null : 'read' });
  },
}));

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: Search } = await import('@/app/(signed-in)/search/page');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

/** Story 3.9: the search page's reading of its address, its campaign and its scope settings. */
const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const SEARCH = '0190a0b0-0000-7000-8000-000000000072';
const MATERIAL = '0190a0b0-0000-7000-8000-000000000060';
const CURRENT = {
  id: CAMPAIGN,
  name: 'A Coroa Partida',
  system: { id: '0190a0b0-0000-7000-8000-000000000001', name: 'D&D', edition: null, description: null, version: 0 },
  archived: false,
  version: 0,
};
const SCOPE = { version: 0, campaignTier: true, systemTier: true, otherTier: false, modelKnowledge: false, materials: [] };
const problem = (status: number, code: string) => ({
  status,
  body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params: {}, traceId: 't' },
});

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', 'configured-service-credential-0123456789');
  return backend;
}

/** What the page handed its body, from the rendered page. */
async function handed(query: Record<string, string | string[]>): Promise<Record<string, unknown>> {
  const html = renderToStaticMarkup(await Search({ searchParams: Promise.resolve(query) }));
  const json = /\{&quot;language.*?\}(?=<|$)/.exec(html)?.[0] ?? '';
  return JSON.parse(json.replaceAll('&quot;', '"')) as Record<string, unknown>;
}

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('the search page (Story 3.9)', () => {
  it('hands its body the query, the stored search, the filters and the page from the address', async () => {
    const server = await useBackend({
      'GET /api/v1/campaigns/current': { status: 200, body: CURRENT },
      [`GET /api/v1/campaigns/${CAMPAIGN}/scope`]: { status: 200, body: SCOPE },
    });

    expect(await handed({ q: 'Fire Bolt', s: SEARCH, tier: 'system', material: MATERIAL, page: '2' })).toEqual({
      language: 'pt-BR',
      campaignId: CAMPAIGN,
      query: 'Fire Bolt',
      searchId: SEARCH,
      tier: 'system',
      materialId: MATERIAL,
      page: 2,
      scope: 'read',
    });
    // Only ids pass as a stored search or a material, only a tier of the scope as a tier, and a repeated field once.
    expect(await handed({ q: ['x', 'y'], s: 'nope', tier: 'model', material: '../x', page: '0' })).toMatchObject({
      query: 'x',
      searchId: null,
      tier: null,
      materialId: null,
      page: 1,
    });
    expect(await handed({})).toMatchObject({ query: '', searchId: null, tier: null, materialId: null, page: 1 });
    for (const call of server.calls) {
      expect(call.headers['x-session-token']).toBe(SESSION);
    }
  });

  it('still renders when the scope settings cannot be read, with none for the filters', async () => {
    await useBackend({
      'GET /api/v1/campaigns/current': { status: 200, body: CURRENT },
      [`GET /api/v1/campaigns/${CAMPAIGN}/scope`]: problem(503, 'server.unavailable'),
    });

    const html = renderToStaticMarkup(await Search({ searchParams: Promise.resolve({ q: 'Fire Bolt' }) }));

    expect(html).toContain(`<h1`);
    expect(html).toContain(ptBR.search.title);
    expect(await handed({ q: 'Fire Bolt' })).toMatchObject({ campaignId: CAMPAIGN, query: 'Fire Bolt', scope: null });
  });

  it('with no campaign, says so in one sentence with the way to make one, and searches nothing', async () => {
    const server = await useBackend({ 'GET /api/v1/campaigns/current': problem(404, 'request.not_found') });

    const html = renderToStaticMarkup(await Search({ searchParams: Promise.resolve({ q: 'Fire Bolt' }) }));

    expect(html).toContain(ptBR.search.noCampaign);
    expect(html).toMatch(/<a\b[^>]*href="\/campaigns\/new"[^>]*>[^<]*Nova campanha/);
    expect(html).not.toContain('&quot;language');
    expect(server.calls.map((call) => call.url)).toEqual(['/api/v1/campaigns/current']);
  });
});
