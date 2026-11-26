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

const { correctRecordAction } = await import('@/app/(signed-in)/records/actions');
const { NO_CORRECTION } = await import('@/components/RecordCorrection');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const RECORD = '0190a0b0-0000-7000-8000-000000000700';
const SYSTEM_RECORD = `/api/v1/systems/${SYSTEM}/records/${RECORD}`;
const CAMPAIGN_RECORD = `/api/v1/campaigns/${CAMPAIGN}/records/${RECORD}`;
const STORED = {
  id: RECORD,
  name: 'Fire Bolt',
  recordType: { id: '0190a0b0-0000-7000-8000-000000000601', core: 'spell', key: 'spell', name: 'spell' },
  fields: [{ name: 'Alcance', value: '36 m' }],
  references: [],
  version: 4,
};

let backend: Scripted | undefined;
async function withBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  return backend;
}

/** A post as the correction's form sends it: one name and one value per field, in order. */
function form(fields: Record<string, string>, rows: readonly (readonly [string, string])[] = []): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  for (const [name, value] of rows) {
    data.append('fieldName', name);
    data.append('fieldValue', value);
  }
  return data;
}

function problemOf(status: number, code: string, params: Record<string, unknown> = {}) {
  return { status, body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params, traceId: 't' } };
}

const SYSTEM_POST = { ground: 'system', owner: SYSTEM, recordId: RECORD, version: '3', name: '  Fire Bolt ', recordType: 'spell' };

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

describe("a record's correction (Story 4.5)", () => {
  it('sends the name, type and fields on the version read, on the system or the campaign, with a toast, and reads the pages again', async () => {
    const server = await withBackend({
      [`PATCH ${SYSTEM_RECORD}`]: { status: 200, body: STORED },
      [`PATCH ${CAMPAIGN_RECORD}`]: { status: 200, body: STORED },
    });

    expect(await correctRecordAction(NO_CORRECTION, form(SYSTEM_POST, [['Alcance', '36 m\r\nou mais']]))).toEqual({
      serial: 1,
      saved: true,
      error: null,
      field: null,
      stale: false,
      currentVersion: 4,
    });
    await correctRecordAction(NO_CORRECTION, form({ ...SYSTEM_POST, ground: 'campaign', owner: CAMPAIGN, version: '0' }));

    expect(server.calls.map((call) => [`${call.method} ${call.url}`, JSON.parse(call.body)])).toEqual([
      [`PATCH ${SYSTEM_RECORD}`, { version: 3, name: '  Fire Bolt ', recordType: 'spell', fields: [{ name: 'Alcance', value: '36 m\nou mais' }] }],
      [`PATCH ${CAMPAIGN_RECORD}`, { version: 0, name: '  Fire Bolt ', recordType: 'spell', fields: [] }],
    ]);
    expect(server.calls.every((call) => call.headers['x-session-token'] === SESSION)).toBe(true);
    expect(flashed.mock.calls).toEqual([
      ['success', 'Registro corrigido.'],
      ['success', 'Registro corrigido.'],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/systems/[id]', 'layout');
    expect(revalidatePath).toHaveBeenCalledWith('/search', 'layout');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a stale save reads the record again and answers its current version with the edits sent', async () => {
    const server = await withBackend({
      [`PATCH ${SYSTEM_RECORD}`]: problemOf(409, 'request.stale_version'),
      [`GET ${SYSTEM_RECORD}`]: { status: 200, body: STORED },
      [`PATCH ${CAMPAIGN_RECORD}`]: problemOf(409, 'request.stale_version'),
      [`GET ${CAMPAIGN_RECORD}`]: problemOf(404, 'request.not_found'),
    });

    expect(await correctRecordAction({ ...NO_CORRECTION, serial: 4 }, form(SYSTEM_POST, [['Nível', '1']]))).toEqual({
      serial: 5,
      saved: false,
      error: null,
      field: null,
      stale: true,
      currentVersion: 4,
    });
    // The record gone meanwhile: its refusal's text.
    const gone = await correctRecordAction(NO_CORRECTION, form({ ...SYSTEM_POST, ground: 'campaign', owner: CAMPAIGN }));
    expect(gone).toMatchObject({ stale: false, error: 'Não encontrado.', field: null });
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `PATCH ${SYSTEM_RECORD}`,
      `GET ${SYSTEM_RECORD}`,
      `PATCH ${CAMPAIGN_RECORD}`,
      `GET ${CAMPAIGN_RECORD}`,
    ]);
    expect(flashed).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a refusal comes back as its text under the part it is about; a malformed form never reaches the backend', async () => {
    const answers = [
      problemOf(400, 'record.name_invalid', { min: 1, max: 200 }),
      problemOf(400, 'record.type_invalid'),
      problemOf(400, 'record.fields_invalid', { max: 64 }),
      problemOf(400, 'record.field_name_invalid', { min: 1, max: 200, index: 1 }),
      problemOf(400, 'record.field_value_invalid', { min: 1, max: 8000, index: 0 }),
      problemOf(404, 'request.not_found'),
    ];
    const expected = [
      ['name', 'O nome precisa ter de 1 a 200 caracteres.'],
      ['recordType', 'Escolha um tipo de registro deste sistema.'],
      ['fields', 'Um registro pode ter até 64 campos.'],
      ['fieldName:1', 'O nome do campo precisa ter de 1 a 200 caracteres.'],
      ['fieldValue:0', 'O valor do campo precisa ter de 1 a 8000 caracteres.'],
      [null, 'Não encontrado.'],
    ];
    for (const [index, answer] of answers.entries()) {
      await withBackend({ [`PATCH ${SYSTEM_RECORD}`]: answer });
      const state = await correctRecordAction(NO_CORRECTION, form(SYSTEM_POST, [['Nível', '1']]));
      expect([state.field, state.error]).toEqual(expected[index]);
      await backend?.close();
      backend = undefined;
    }

    const server = await withBackend({});
    const malformed: readonly FormData[] = [
      form({ ...SYSTEM_POST, ground: 'other' }),
      form({ ...SYSTEM_POST, owner: 'x' }),
      form({ ...SYSTEM_POST, recordId: '../x' }),
      form({ ...SYSTEM_POST, version: '-1' }),
      form({ ground: 'system', owner: SYSTEM, recordId: RECORD, version: '0', recordType: 'spell' }),
      (() => {
        const data = form(SYSTEM_POST, [['Nível', '1']]);
        data.append('fieldName', 'sem valor');
        return data;
      })(),
    ];
    for (const bad of malformed) {
      expect((await correctRecordAction(NO_CORRECTION, bad)).error).toBe('O pedido não é válido.');
    }
    expect(server.calls).toHaveLength(0);
    expect(flashed).not.toHaveBeenCalled();
  });
});
