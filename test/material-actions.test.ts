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

const { materialAction } = await import('@/app/(signed-in)/files/[id]/actions');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const ID = '0190a0b0-0000-7000-8000-000000000003';

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  return backend;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
  refresh.mockClear();
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('the material actions (Story 1.20)', () => {
  it('posts each action to its route with the session and no body, then refreshes the page', async () => {
    const material = { id: ID, name: 'Livro.pdf', state: 'processing', actions: [] };
    const server = await useBackend(
      Object.fromEntries(['accept', 'reprocess', 'retry', 'discard'].map((action) => [`POST /api/v1/materials/${ID}/${action}`, { status: 200, body: material }])),
    );
    for (const action of ['accept', 'reprocess', 'retry', 'discard']) {
      expect(await materialAction({ error: null }, form({ id: ID, action }))).toEqual({ error: null });
    }
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST /api/v1/materials/${ID}/accept`,
      `POST /api/v1/materials/${ID}/reprocess`,
      `POST /api/v1/materials/${ID}/retry`,
      `POST /api/v1/materials/${ID}/discard`,
    ]);
    for (const call of server.calls) {
      expect(call.headers['x-session-token']).toBe(SESSION);
      expect(call.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
      expect(call.body).toBe('');
    }
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('a refusal comes back as text, never a code, and the page is refreshed to the state that refused it', async () => {
    const problem = (status: number, code: string) => ({
      status,
      body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params: {}, traceId: 't' },
    });
    await useBackend({
      [`POST /api/v1/materials/${ID}/accept`]: problem(409, 'material.action_unavailable'),
      [`POST /api/v1/materials/${ID}/reprocess`]: problem(409, 'ingestion.too_many_steps'),
      [`POST /api/v1/materials/${ID}/discard`]: problem(404, 'request.not_found'),
    });
    expect(await materialAction({ error: null }, form({ id: ID, action: 'accept' }))).toEqual({
      error: 'Esta ação não está disponível no estado atual do material. A página foi atualizada.',
    });
    expect(await materialAction({ error: null }, form({ id: ID, action: 'reprocess' }))).toEqual({
      error: 'O processamento deste arquivo precisa de mais etapas do que suas páginas permitem.',
    });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await materialAction({ error: null }, form({ id: ID, action: 'discard' }))).toEqual({ error: 'Not found.' });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('an unknown action or a malformed id never reaches the backend', async () => {
    const server = await useBackend({});
    const refused: Record<string, string>[] = [{ id: ID, action: 'delete' }, { id: '../me', action: 'accept' }, { id: ID }, { action: 'accept' }];
    for (const fields of refused) {
      expect(await materialAction({ error: null }, form(fields))).toEqual({ error: 'O pedido não é válido.' });
    }
    expect(server.calls).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});
