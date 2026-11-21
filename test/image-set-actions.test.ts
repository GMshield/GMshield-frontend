import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: () => undefined,
  }),
}));
const refresh = vi.fn();
vi.mock('next/cache', () => ({ refresh: () => refresh() }));

const { createImageSetAction, replaceSetImageAction, dropSetImageAction } = await import('@/app/(signed-in)/image-set-actions');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const SET = '0190a0b0-0000-7000-8000-000000000004';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const MATERIAL = '0190a0b0-0000-7000-8000-000000000003';

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  return backend;
}

const problem = (status: number, code: string, params: Record<string, unknown> = {}) => ({
  status,
  body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params, traceId: 't' },
});

const request = {
  name: 'Ficha do herói',
  kind: 'rulebook' as const,
  language: 'detect' as const,
  campaign: CAMPAIGN,
  images: [
    { name: 'foto-2.jpg', length: 3000 },
    { name: 'foto-1.heic', length: 9000 },
  ],
};

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
  refresh.mockClear();
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('the image set actions (Story 1.21)', () => {
  it('creates the set with its name, answers and images in their order, with the session, and answers its uploads', async () => {
    const created = {
      id: SET,
      materialId: MATERIAL,
      expiresAt: '2026-11-17T06:00:00Z',
      images: [
        { position: 1, uploadId: '0190a0b0-0000-7000-8000-000000000011' },
        { position: 2, uploadId: '0190a0b0-0000-7000-8000-000000000012' },
      ],
    };
    const server = await useBackend({ 'POST /api/v1/image-sets': { status: 201, body: created } });

    expect(await createImageSetAction(request)).toEqual({
      ok: true,
      data: { id: SET, materialId: MATERIAL, images: created.images },
    });
    expect(server.calls).toHaveLength(1);
    const call = server.calls[0]!;
    expect(call.headers['x-session-token']).toBe(SESSION);
    expect(call.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
    expect(JSON.parse(call.body)).toEqual(request);
  });

  it('sends several systems in place of a campaign (Story 3.3)', async () => {
    const server = await useBackend({ 'POST /api/v1/image-sets': { status: 201, body: { id: SET, materialId: MATERIAL, expiresAt: 'x', images: [] } } });
    const systems = ['0190a0b0-0000-7000-8000-000000000001', '0190a0b0-0000-7000-8000-000000000030'];

    expect((await createImageSetAction({ ...request, campaign: undefined, systems })).ok).toBe(true);

    const body = JSON.parse(server.calls[0]!.body) as Record<string, unknown>;
    expect(body.systems).toEqual(systems);
    expect(body).not.toHaveProperty('campaign');
  });

  it('sends a new version of a material with the material alone, never a kind, language or place (Story 3.4)', async () => {
    const server = await useBackend({ 'POST /api/v1/image-sets': { status: 201, body: { id: SET, materialId: MATERIAL, expiresAt: 'x', images: [] } } });
    const replacing = { name: 'Livro.pdf', material: MATERIAL, images: request.images };

    expect(await createImageSetAction(replacing)).toEqual({ ok: true, data: { id: SET, materialId: MATERIAL, images: [] } });

    expect(JSON.parse(server.calls[0]!.body)).toEqual(replacing);
    for (const mixed of [
      { ...replacing, kind: 'rulebook' },
      { ...replacing, language: 'detect' },
      { ...replacing, campaign: CAMPAIGN },
      { ...replacing, systems: [CAMPAIGN] },
      { ...replacing, material: '../x' },
      { ...replacing, material: 7 },
    ]) {
      expect(await createImageSetAction(mixed as never), JSON.stringify(mixed).slice(0, 80)).toMatchObject({ ok: false, problem: { code: 'request.invalid' } });
    }
    expect(server.calls).toHaveLength(1);
  });

  it('replaces a failed image at its place and leaves one out, refreshing the tray after a drop', async () => {
    const server = await useBackend({
      [`POST /api/v1/image-sets/${SET}/images/2`]: { status: 201, body: { position: 2, uploadId: '0190a0b0-0000-7000-8000-000000000013', expiresAt: 'x' } },
      [`DELETE /api/v1/image-sets/${SET}/images/3`]: { status: 200, body: { materialId: MATERIAL, versionId: SET, state: 'waiting' } },
    });
    expect(await replaceSetImageAction(SET, 2, { name: 'nova.jpg', length: 10 })).toEqual({
      ok: true,
      data: { position: 2, uploadId: '0190a0b0-0000-7000-8000-000000000013' },
    });
    expect(await dropSetImageAction(SET, 3)).toEqual({ ok: true, data: { state: 'waiting' } });
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([`POST /api/v1/image-sets/${SET}/images/2`, `DELETE /api/v1/image-sets/${SET}/images/3`]);
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ name: 'nova.jpg', length: 10 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("answers the backend's refusal as plain fields the browser turns into text", async () => {
    await useBackend({
      'POST /api/v1/image-sets': problem(413, 'upload.set_too_large', { maxImages: 500, maxBytes: 2147483648, nested: { x: 1 } }),
      [`DELETE /api/v1/image-sets/${SET}/images/1`]: problem(409, 'upload.image_not_failed'),
      [`POST /api/v1/image-sets/${SET}/images/1`]: problem(404, 'request.not_found'),
    });
    expect(await createImageSetAction(request)).toEqual({
      ok: false,
      problem: { status: 413, category: 'upload', code: 'upload.set_too_large', params: { maxImages: 500, maxBytes: 2147483648 } },
    });
    expect(await dropSetImageAction(SET, 1)).toEqual({ ok: false, problem: { status: 409, category: 'upload', code: 'upload.image_not_failed', params: {} } });
    expect(await replaceSetImageAction(SET, 1, { name: 'a.jpg', length: 1 })).toMatchObject({ ok: false, problem: { code: 'request.not_found' } });
  });

  it('never sends a malformed request, nor one without a session', async () => {
    const server = await useBackend({});
    const invalid: unknown[] = [
      null,
      { ...request, name: ' ' },
      { ...request, name: 'x'.repeat(256) },
      { ...request, kind: 'poem' },
      { ...request, language: 'fr' },
      { ...request, campaign: '../x' },
      // Story 3.3: systems with a campaign, none, a malformed one, or more than 100.
      { ...request, systems: [CAMPAIGN] },
      { ...request, campaign: undefined, systems: [] },
      { ...request, campaign: undefined, systems: ['../x'] },
      { ...request, campaign: undefined, systems: Array.from({ length: 101 }, () => CAMPAIGN) },
      { ...request, images: [] },
      { ...request, images: [{ name: 'a.jpg', length: 0 }] },
      { ...request, images: [{ name: 'a.jpg', length: 2 * 1024 ** 3 + 1 }] },
      { ...request, images: [{ name: '', length: 1 }] },
      { ...request, images: Array.from({ length: 501 }, () => ({ name: 'a.jpg', length: 1 })) },
    ];
    for (const body of invalid) {
      expect(await createImageSetAction(body as typeof request), JSON.stringify(body)?.slice(0, 80)).toEqual({
        ok: false,
        problem: { status: 400, category: 'request', code: 'request.invalid', params: {} },
      });
    }
    for (const [id, position] of [['../x', 1], [SET, 0], [SET, 501], [SET, 1.5]] as const) {
      expect((await replaceSetImageAction(id, position, { name: 'a.jpg', length: 1 })).ok).toBe(false);
      expect((await dropSetImageAction(id, position)).ok).toBe(false);
    }
    expect(server.calls).toEqual([]);
    cookieJar = {};
    expect(await createImageSetAction(request)).toMatchObject({ ok: false, problem: { code: 'session.required' } });
    expect(await dropSetImageAction(SET, 1)).toMatchObject({ ok: false, problem: { code: 'session.required' } });
    expect(server.calls).toEqual([]);
  });
});
