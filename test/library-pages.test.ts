import { afterEach, describe, expect, it, vi } from 'vitest';

// The backend calls read the request's trace from its headers; outside Next.js there is none.
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const { listAllCampaigns, listAllSystems } = await import('@/server/library');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CURSOR = '0190a0b0-0000-7000-8000-000000000041';
const system = (id: string, name: string) => ({ id, name, edition: null, description: null, version: 0 });
const campaign = (id: string, name: string) => ({ id, name, system: { id: '0190a0b0-0000-7000-8000-000000000001', name: 'D&D', edition: null }, archived: false });

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', 'configured-service-credential-0123456789');
  return backend;
}

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('every page of the campaigns and the systems (Story 3.3)', () => {
  it('reads the next page until there is no cursor, and puts both pages\' items together', async () => {
    const server = await useBackend({
      'GET /api/v1/systems?limit=50': { status: 200, body: { items: [system('0190a0b0-0000-7000-8000-000000000031', 'A')], nextCursor: CURSOR } },
      [`GET /api/v1/systems?limit=50&cursor=${CURSOR}`]: { status: 200, body: { items: [system('0190a0b0-0000-7000-8000-000000000032', 'B')] } },
      'GET /api/v1/campaigns?limit=50': { status: 200, body: { items: [campaign('0190a0b0-0000-7000-8000-000000000033', 'Mesa 1')], nextCursor: CURSOR } },
      [`GET /api/v1/campaigns?limit=50&cursor=${CURSOR}`]: { status: 200, body: { items: [campaign('0190a0b0-0000-7000-8000-000000000034', 'Mesa 2')] } },
    });

    const systems = await listAllSystems(SESSION);
    const campaigns = await listAllCampaigns(SESSION);

    expect(systems.ok && systems.data.map((item) => item.name)).toEqual(['A', 'B']);
    expect(campaigns.ok && campaigns.data.map((item) => item.name)).toEqual(['Mesa 1', 'Mesa 2']);
    // Two pages each, and no third read once a page has no cursor.
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/v1/systems?limit=50',
      `GET /api/v1/systems?limit=50&cursor=${CURSOR}`,
      'GET /api/v1/campaigns?limit=50',
      `GET /api/v1/campaigns?limit=50&cursor=${CURSOR}`,
    ]);
    for (const call of server.calls) {
      expect(call.headers['x-session-token']).toBe(SESSION);
    }
  });

  it('a page that fails, the second included, is the answer', async () => {
    const failed = { status: 503, body: { type: 'urn:gmshield:problem:server.unavailable', title: 'x', status: 503, category: 'server', code: 'server.unavailable', params: {}, traceId: 't' } };
    await useBackend({
      'GET /api/v1/systems?limit=50': { status: 200, body: { items: [system('0190a0b0-0000-7000-8000-000000000031', 'A')], nextCursor: CURSOR } },
      [`GET /api/v1/systems?limit=50&cursor=${CURSOR}`]: failed,
      'GET /api/v1/campaigns?limit=50': failed,
    });

    const systems = await listAllSystems(SESSION);
    const campaigns = await listAllCampaigns(SESSION);

    expect(systems).toMatchObject({ ok: false, status: 503, problem: { code: 'server.unavailable' } });
    expect(campaigns).toMatchObject({ ok: false, status: 503, problem: { code: 'server.unavailable' } });
  });
});
