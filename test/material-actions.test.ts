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
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ refresh: () => refresh(), revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const { changePlaceAction, deleteMaterialAction, materialAction, removeVersionAction } = await import('@/app/(signed-in)/files/[id]/actions');
const { NO_PLACE_ANSWER } = await import('@/components/MaterialPlace');
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
  revalidatePath.mockClear();
});

/** The digest a `redirect()` call threw, or null. */
async function thrownDigest(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest ?? '');
    if (digest === '') {
      throw error;
    }
    return digest;
  }
}

function problemOf(status: number, code: string) {
  return { status, body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params: {}, traceId: 't' } };
}

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

  it('a reprocess of a ready material that another version got to first says so in words (Story 3.4)', async () => {
    await useBackend({
      [`POST /api/v1/materials/${ID}/reprocess`]: {
        status: 409,
        body: { type: 'urn:gmshield:problem:material.version_in_progress', title: 'x', status: 409, category: 'material', code: 'material.version_in_progress', params: {}, traceId: 't' },
      },
    });
    expect(await materialAction({ error: null }, form({ id: ID, action: 'reprocess' }))).toEqual({
      error: 'Este material já tem uma versão a caminho. Espere ela terminar, ou aceite, tente de novo ou descarte essa versão, antes de começar outra.',
    });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await materialAction({ error: null }, form({ id: ID, action: 'reprocess' }))).toEqual({
      error: 'This material already has a version on its way. Wait for it to finish, or accept, retry or discard it, before starting another one.',
    });
    expect(refresh).toHaveBeenCalledTimes(2);
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

describe('the change of where a material belongs (Story 3.3)', () => {
  const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
  const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
  const OTHER_SYSTEM = '0190a0b0-0000-7000-8000-000000000030';
  const material = (version: number, belonging: unknown) => ({ id: ID, name: 'Livro.pdf', state: 'ready', actions: [], version, belonging });
  const inSystems = { campaign: null, systems: [{ id: SYSTEM, name: 'D&D' }, { id: OTHER_SYSTEM, name: 'Pathfinder' }] };
  const problem = (status: number, code: string) => ({
    status,
    body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params: {}, traceId: 't' },
  });
  const several = () => {
    const data = form({ id: ID, version: '2', belonging: 'systems', campaign: CAMPAIGN, system: SYSTEM });
    data.append('systems', SYSTEM);
    data.append('systems', OTHER_SYSTEM);
    return data;
  };

  it('sends the chosen place on the version, with the session, refreshes the page and says it was saved', async () => {
    const server = await useBackend({ [`PATCH /api/v1/materials/${ID}`]: { status: 200, body: material(3, inSystems) } });

    const answer = await changePlaceAction(NO_PLACE_ANSWER, several());

    expect(answer).toEqual({
      version: 3,
      place: { choice: 'systems', systems: [SYSTEM, OTHER_SYSTEM] },
      error: null,
      stale: false,
      saved: true,
      serial: 1,
      reset: 1,
    });
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ version: 2, belonging: { systems: [SYSTEM, OTHER_SYSTEM] } });
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(refresh).toHaveBeenCalledTimes(1);
    // One campaign, and one system (sent as a list of one).
    await changePlaceAction(answer, form({ id: ID, version: '3', belonging: 'campaign', campaign: CAMPAIGN, system: SYSTEM }));
    await changePlaceAction(answer, form({ id: ID, version: '4', belonging: 'system', campaign: CAMPAIGN, system: SYSTEM }));
    expect(server.calls.slice(1).map((call) => JSON.parse(call.body))).toEqual([
      { version: 3, belonging: { campaign: CAMPAIGN } },
      { version: 4, belonging: { systems: [SYSTEM] } },
    ]);
  });

  it('a stale version brings the current place and version, with the stale line, and starts the pickers again', async () => {
    await useBackend({
      [`PATCH /api/v1/materials/${ID}`]: problem(409, 'request.stale_version'),
      [`GET /api/v1/materials/${ID}`]: { status: 200, body: material(5, { campaign: { id: CAMPAIGN, name: 'Mesa', system: { id: SYSTEM, name: 'D&D' } }, systems: [] }) },
    });

    const answer = await changePlaceAction(NO_PLACE_ANSWER, several());

    expect(answer).toEqual({
      version: 5,
      place: { choice: 'campaign', campaign: CAMPAIGN },
      error: 'Este arquivo foi alterado em outro lugar. A escolha agora mostra onde ele fica: faça sua alteração de novo e salve.',
      stale: true,
      saved: false,
      serial: 1,
      reset: 1,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('any other refusal comes back as text, the choice kept; a form without a place never reaches the backend', async () => {
    const server = await useBackend({ [`PATCH /api/v1/materials/${ID}`]: problem(400, 'material.belonging_invalid') });

    const refused = await changePlaceAction(NO_PLACE_ANSWER, several());

    expect(refused).toMatchObject({ error: 'Escolha uma campanha ou pelo menos um sistema que você tenha.', saved: false, stale: false, reset: 0 });
    const calls = server.calls.length;
    const malformed: Record<string, string>[] = [
      { id: ID, version: '1', belonging: 'none' },
      { id: ID, version: '1', belonging: 'systems' },
      { id: ID, version: '1', belonging: 'campaign', campaign: '../x' },
      { id: '../x', version: '1', belonging: 'campaign', campaign: CAMPAIGN },
      { id: ID, version: '-1', belonging: 'campaign', campaign: CAMPAIGN },
      { id: ID, belonging: 'system', system: SYSTEM },
    ];
    for (const fields of malformed) {
      expect((await changePlaceAction(NO_PLACE_ANSWER, form(fields))).error, JSON.stringify(fields)).toBe('O pedido não é válido.');
    }
    expect(server.calls).toHaveLength(calls);
  });
});

describe('deleting a material and removing a previous version (Story 3.4 part B)', () => {
  const VERSION = '0190a0b0-0000-7000-8000-00000000000a';

  it('"Excluir arquivo" reads the material, deletes it, revalidates the layout and opens Meus Arquivos', async () => {
    const routes: Record<string, { status: number; body?: unknown }> = {
      [`GET /api/v1/materials/${ID}`]: { status: 200, body: { id: ID, name: 'Livro.pdf', state: 'ready', actions: ['reprocess'] } },
      [`DELETE /api/v1/materials/${ID}`]: { status: 202 },
    };
    const server = await useBackend(routes);

    expect(await thrownDigest(() => deleteMaterialAction({ error: null }, form({ id: ID })))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/files;/);
    // The shared layout (the tray, the bell) is rendered again without it.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([`GET /api/v1/materials/${ID}`, `DELETE /api/v1/materials/${ID}`]);
    for (const call of server.calls) {
      expect(call.headers['x-session-token']).toBe(SESSION);
      expect(call.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
    }
    revalidatePath.mockClear();

    // Another owner's or an unknown material: not found, in words, and nothing else happens.
    routes[`GET /api/v1/materials/${ID}`] = problemOf(404, 'request.not_found');
    expect(await deleteMaterialAction({ error: null }, form({ id: ID }))).toEqual({ error: 'Não encontrado.' });
    routes[`GET /api/v1/materials/${ID}`] = { status: 200, body: { id: ID, name: 'Livro.pdf', state: 'ready', actions: [] } };
    routes[`DELETE /api/v1/materials/${ID}`] = problemOf(404, 'request.not_found');
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await deleteMaterialAction({ error: null }, form({ id: ID }))).toEqual({ error: 'Not found.' });
    expect(revalidatePath).not.toHaveBeenCalled();
    const count = server.calls.length;
    for (const fields of [{ id: '../x' }, {}] as Record<string, string>[]) {
      expect(await deleteMaterialAction({ error: null }, form(fields))).toEqual({ error: 'The request is not valid.' });
    }
    expect(server.calls).toHaveLength(count);
  });

  it('"Remover versão" removes that version and refreshes the page; a refusal comes back in words', async () => {
    const routes: Record<string, { status: number; body?: unknown }> = {
      [`DELETE /api/v1/materials/${ID}/versions/${VERSION}`]: { status: 202 },
    };
    const server = await useBackend(routes);

    expect(await removeVersionAction({ error: null }, form({ id: ID, versionId: VERSION }))).toEqual({ error: null });
    expect(server.calls[0]!.method).toBe('DELETE');
    expect(server.calls[0]!.url).toBe(`/api/v1/materials/${ID}/versions/${VERSION}`);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(refresh).toHaveBeenCalledTimes(1);

    // A version that is not superseded (ready, in progress or discarded): said in words, and the page refreshed.
    routes[`DELETE /api/v1/materials/${ID}/versions/${VERSION}`] = problemOf(409, 'material.version_not_removable');
    expect(await removeVersionAction({ error: null }, form({ id: ID, versionId: VERSION }))).toEqual({
      error: 'Só uma versão anterior pode ser removida. A página foi atualizada.',
    });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await removeVersionAction({ error: null }, form({ id: ID, versionId: VERSION }))).toEqual({
      error: 'Only a previous version can be removed. The page has been updated.',
    });
    routes[`DELETE /api/v1/materials/${ID}/versions/${VERSION}`] = problemOf(404, 'request.not_found');
    expect(await removeVersionAction({ error: null }, form({ id: ID, versionId: VERSION }))).toEqual({ error: 'Not found.' });
    expect(refresh).toHaveBeenCalledTimes(4);
    const count = server.calls.length;
    for (const fields of [{ id: ID, versionId: '../x' }, { id: '../x', versionId: VERSION }, { id: ID }, { versionId: VERSION }] as Record<string, string>[]) {
      expect(await removeVersionAction({ error: null }, form(fields))).toEqual({ error: 'The request is not valid.' });
    }
    expect(server.calls).toHaveLength(count);
    expect(refresh).toHaveBeenCalledTimes(4);
  });
});
