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
const flashed = vi.fn();
vi.mock('@/server/flash', () => ({ flash: async (...args: unknown[]) => flashed(...args) }));

const { decideProposalAction } = await import('@/app/(signed-in)/proposal-actions');
const { NO_DECISION } = await import('@/components/ProposalList');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const PROPOSAL = '0190a0b0-0000-7000-8000-000000000800';
const TERM_PROPOSAL = '0190a0b0-0000-7000-8000-000000000801';
const TERM = '0190a0b0-0000-7000-8000-000000000811';
const TALENT = {
  id: PROPOSAL,
  systemId: '0190a0b0-0000-7000-8000-000000000001',
  materialId: '0190a0b0-0000-7000-8000-000000000004',
  materialName: 'Guia do Mestre.pdf',
  kind: 'record_type',
  name: 'Talento',
  definition: null,
  examples: [{ page: 40, quote: 'Talentos são habilidades especiais' }],
  state: 'pending',
  version: 0,
};

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

function problemOf(status: number, code: string) {
  return { status, body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params: {}, traceId: 't' } };
}

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
  refresh.mockClear();
  revalidatePath.mockClear();
  flashed.mockClear();
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('a decision on an ontology proposal (Story 4.4)', () => {
  it('approves, renames, merges and rejects on the version read, with a toast, and reads the pages again', async () => {
    const decided = (state: string, kind = 'record_type', name = 'Talento') => ({
      status: 200,
      body: { proposal: { ...TALENT, kind, name, state, version: 1 }, resultId: state === 'rejected' ? null : TERM },
    });
    const server = await useBackend({
      [`POST /api/v1/proposals/${PROPOSAL}/approval`]: decided('approved'),
      [`POST /api/v1/proposals/${TERM_PROPOSAL}/merge`]: decided('merged', 'term', 'PV'),
      [`POST /api/v1/proposals/${PROPOSAL}/rejection`]: decided('rejected'),
    });

    expect(await decideProposalAction(NO_DECISION, form({ id: PROPOSAL, version: '0', decision: 'approve' }))).toEqual({
      error: null,
      stale: false,
      serial: 1,
    });
    await decideProposalAction(NO_DECISION, form({ id: PROPOSAL, version: '0', decision: 'rename', name: '  Feat ' }));
    await decideProposalAction(NO_DECISION, form({ id: TERM_PROPOSAL, version: '0', decision: 'merge', target: TERM }));
    await decideProposalAction(NO_DECISION, form({ id: PROPOSAL, version: '0', decision: 'reject' }));

    expect(server.calls.map((call) => [`${call.method} ${call.url}`, JSON.parse(call.body)])).toEqual([
      [`POST /api/v1/proposals/${PROPOSAL}/approval`, { version: 0 }],
      [`POST /api/v1/proposals/${PROPOSAL}/approval`, { version: 0, name: '  Feat ' }],
      [`POST /api/v1/proposals/${TERM_PROPOSAL}/merge`, { version: 0, targetId: TERM }],
      [`POST /api/v1/proposals/${PROPOSAL}/rejection`, { version: 0 }],
    ]);
    expect(server.calls.every((call) => call.headers['x-session-token'] === SESSION)).toBe(true);
    expect(flashed.mock.calls).toEqual([
      ['success', 'Tipo de registro «Talento» aprovado.'],
      ['success', 'Tipo de registro «Feat» aprovado.'],
      ['success', '«PV» mesclado.'],
      ['success', '«Talento» rejeitado. Ele não volta a ser proposto por este material.'],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/systems/[id]', 'page');
    expect(revalidatePath).toHaveBeenCalledWith('/files/[id]', 'page');
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('a stale decision says so; a refusal comes back as its text; a malformed form never reaches the backend', async () => {
    const server = await useBackend({
      [`POST /api/v1/proposals/${PROPOSAL}/approval`]: problemOf(409, 'request.stale_version'),
      [`POST /api/v1/proposals/${PROPOSAL}/rejection`]: problemOf(409, 'ontology.name_taken'),
      [`POST /api/v1/proposals/${TERM_PROPOSAL}/merge`]: problemOf(400, 'ontology.merge_target_invalid'),
    });

    expect(await decideProposalAction(NO_DECISION, form({ id: PROPOSAL, version: '0', decision: 'approve' }))).toEqual({
      error: null,
      stale: true,
      serial: 1,
    });
    expect((await decideProposalAction(NO_DECISION, form({ id: PROPOSAL, version: '0', decision: 'reject' }))).error).toBe(
      'Este sistema já tem um tipo de registro, um termo ou um tipo básico com este nome.',
    );
    expect(
      (await decideProposalAction(NO_DECISION, form({ id: TERM_PROPOSAL, version: '0', decision: 'merge', target: TERM }))).error,
    ).toBe('Escolha um item deste sistema do mesmo tipo da proposta.');
    const malformed: readonly Record<string, string>[] = [
      { id: 'x', version: '0', decision: 'approve' },
      { id: PROPOSAL, version: '-1', decision: 'approve' },
      { id: PROPOSAL, version: '0', decision: 'admin' },
      { id: PROPOSAL, version: '0', decision: 'merge', target: 'nada' },
      { id: PROPOSAL, version: '0', decision: 'rename' },
    ];
    for (const bad of malformed) {
      expect((await decideProposalAction(NO_DECISION, form(bad))).error).toBeTruthy();
    }
    expect(server.calls).toHaveLength(3);
    expect(flashed).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
