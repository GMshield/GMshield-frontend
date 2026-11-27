import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: () => undefined,
  }),
}));
/** What the action did, in order: the toast, the revalidation, the page read again (a redirect is thrown last). */
const steps: string[] = [];
const revalidatePath = vi.fn((...args: unknown[]) => steps.push(`revalidate ${args.join(' ')}`));
vi.mock('next/cache', () => ({ refresh: () => steps.push('refresh'), revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
const flashed = vi.fn((...args: unknown[]) => steps.push(`flash ${args.join(' ')}`));
vi.mock('@/server/flash', () => ({ flash: async (...args: unknown[]) => flashed(...args) }));

const {
  createArtifactAction,
  deleteArtifactAction,
  overrideTargetsAction,
  relateAction,
  relationTargetsAction,
  removeOverrideAction,
  restoreArtifactAction,
  setOverrideAction,
  shareAction,
  unrelateAction,
  updateArtifactAction,
} = await import('@/app/(signed-in)/campaigns/[id]/artifacts/actions');
const { NO_ARTIFACT_EDIT, NO_ARTIFACT_RESTORE } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/form-state');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;
type ArtifactFormState = import('@/app/(signed-in)/campaigns/[id]/artifacts/form-state').ArtifactFormState;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const ARTIFACT = '0190a0b0-0000-7000-8000-000000000900';
const ARTIFACTS = `/api/v1/campaigns/${CAMPAIGN}/artifacts`;
const STORED = {
  id: ARTIFACT,
  campaignId: CAMPAIGN,
  recordType: 'item',
  name: 'Espada de Kael',
  fields: [{ name: 'Dano', value: '1d8 cortante' }],
  content: 'Forjada no norte.',
  version: 1,
  currentVersion: 1,
  createdAt: '2026-11-26T12:00:00Z',
};
const START: ArtifactFormState = { serial: 0, values: { recordType: 'note', name: '', fields: [], content: '' }, error: null, field: null };

let backend: Scripted | undefined;
async function withBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  return backend;
}

/** A post as the form sends it: one name and one value per field, in order. */
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

/** The digest a Next.js redirect throws, or null when the call returned. */
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

const POST = { campaignId: CAMPAIGN, recordType: 'item', name: ' Espada de Kael ', content: 'Forjada\r\nno norte.' };

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
  steps.length = 0;
  revalidatePath.mockClear();
  flashed.mockClear();
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe("a new artifact's Server Action (Story 5.1)", () => {
  it('sends what was typed, then the toast "Artefato salvo.", the layout revalidated, and the artifact\'s page', async () => {
    const server = await withBackend({ [`POST ${ARTIFACTS}`]: { status: 201, body: STORED } });

    const digest = await thrownDigest(() => createArtifactAction(START, form(POST, [['Dano', '1d8\r\ncortante']])));

    expect(digest).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}/artifacts/${ARTIFACT};`));
    expect(server.calls.map((call) => [`${call.method} ${call.url}`, JSON.parse(call.body)])).toEqual([
      [
        `POST ${ARTIFACTS}`,
        { recordType: 'item', name: ' Espada de Kael ', fields: [{ name: 'Dano', value: '1d8\ncortante' }], content: 'Forjada\nno norte.' },
      ],
    ]);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(steps).toEqual(['flash success Artefato salvo.', 'revalidate / layout']);
  });

  it('opened from "Personagens", the saved artifact\'s page leads back there; any other `from` is ignored', async () => {
    await withBackend({ [`POST ${ARTIFACTS}`]: { status: 201, body: STORED } });

    expect(await thrownDigest(() => createArtifactAction(START, form({ ...POST, from: 'characters' })))).toMatch(
      new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}/artifacts/${ARTIFACT}\\?from=characters;`),
    );
    expect(await thrownDigest(() => createArtifactAction(START, form({ ...POST, from: 'https://evil.example' })))).toMatch(
      new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}/artifacts/${ARTIFACT};`),
    );
  });

  it('sends no content when none was written, and the toast in the interface\'s language', async () => {
    const server = await withBackend({ [`POST ${ARTIFACTS}`]: { status: 201, body: STORED } });
    cookieJar['__Host-gmshield-lang'] = 'en';

    await thrownDigest(() => createArtifactAction(START, form({ ...POST, content: '' })));

    expect(JSON.parse(server.calls[0]!.body)).toEqual({ recordType: 'item', name: ' Espada de Kael ', fields: [], content: null });
    expect(flashed).toHaveBeenCalledWith('success', 'Artifact saved.');
  });

  it('a value outside its limits comes back as its text under its part, with what was typed kept', async () => {
    const cases = [
      [{ field: 'name', min: 1, max: 200 }, 'name', 'O nome precisa ter de 1 a 200 caracteres.'],
      [{ field: 'recordType' }, 'recordType', 'Escolha um tipo de registro do sistema desta campanha.'],
      [{ field: 'fields', max: 64 }, 'fields', 'Um artefato pode ter até 64 campos.'],
      [{ field: 'fieldName', index: 1, min: 1, max: 200 }, 'fieldName:1', 'O nome do campo precisa ter de 1 a 200 caracteres.'],
      [{ field: 'fieldValue', index: 0, min: 1, max: 8000 }, 'fieldValue:0', 'O valor do campo precisa ter de 1 a 8000 caracteres.'],
      [{ field: 'content', min: 0, max: 20000 }, 'content', 'O conteúdo pode ter até 20000 caracteres.'],
    ] as const;
    for (const [params, field, text] of cases) {
      await withBackend({ [`POST ${ARTIFACTS}`]: problemOf(400, 'request.invalid', params) });

      const answer = await createArtifactAction({ ...START, serial: 2 }, form(POST, [['Dano', ''], [' ', 'x']]));

      expect(answer).toEqual({
        serial: 3,
        values: { recordType: 'item', name: ' Espada de Kael ', fields: [{ name: 'Dano', value: '' }, { name: ' ', value: 'x' }], content: 'Forjada\nno norte.' },
        error: text,
        field,
      });
      await backend?.close();
      backend = undefined;
    }
    expect(flashed).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a campaign that is gone, or another refusal, is said under the form', async () => {
    await withBackend({ [`POST ${ARTIFACTS}`]: problemOf(404, 'request.not_found') });
    expect(await createArtifactAction(START, form(POST))).toMatchObject({ serial: 1, error: 'Não encontrado.', field: null });
    await backend?.close();

    await withBackend({ [`POST ${ARTIFACTS}`]: problemOf(400, 'request.invalid') });
    expect(await createArtifactAction(START, form(POST))).toMatchObject({ error: 'O pedido não é válido.', field: null });
  });

  it('never reaches the backend with a malformed form', async () => {
    const server = await withBackend({});
    const unpaired = form({ ...POST });
    unpaired.append('fieldName', 'sem valor');
    const nameless = form({ ...POST });
    nameless.delete('name');
    const malformed = [form({ ...POST, campaignId: 'nope' }), unpaired, nameless];
    for (const data of malformed) {
      expect(await createArtifactAction(START, data)).toMatchObject({ error: 'O pedido não é válido.', field: null });
    }
    expect(server.calls).toEqual([]);
  });
});

describe("an artifact's edit and restore Server Actions (Story 5.2)", () => {
  const ONE = `${ARTIFACTS}/${ARTIFACT}`;
  const EDIT = { campaignId: CAMPAIGN, artifactId: ARTIFACT, version: '2', recordType: 'arma', name: ' Espada Rubra ', content: 'Reforjada\r\nno vulcão.' };
  const RESTORE = { campaignId: CAMPAIGN, artifactId: ARTIFACT, number: '1', version: '3', view: 'current' };

  it('an edit sends the draft on the version read, then the toast, the layout revalidated and the page read again', async () => {
    const server = await withBackend({ [`PATCH ${ONE}`]: { status: 200, body: { ...STORED, version: 3, currentVersion: 3 } } });

    const answer = await updateArtifactAction({ ...NO_ARTIFACT_EDIT, serial: 4 }, form(EDIT, [['Dano', '2d6']]));

    expect(answer).toEqual({ serial: 5, saved: true, error: null, field: null, stale: false, currentVersion: 3 });
    expect(server.calls.map((call) => [`${call.method} ${call.url}`, JSON.parse(call.body)])).toEqual([
      [
        `PATCH ${ONE}`,
        { version: 2, recordType: 'arma', name: ' Espada Rubra ', fields: [{ name: 'Dano', value: '2d6' }], content: 'Reforjada\nno vulcão.' },
      ],
    ]);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(steps).toEqual(['flash success Artefato atualizado.', 'revalidate / layout', 'refresh']);
  });

  it('an edit without content sends none; the toast is in the interface\'s language', async () => {
    const server = await withBackend({ [`PATCH ${ONE}`]: { status: 200, body: { ...STORED, version: 3, currentVersion: 3 } } });
    cookieJar['__Host-gmshield-lang'] = 'en';

    await updateArtifactAction(NO_ARTIFACT_EDIT, form({ ...EDIT, content: '   ' }));

    // Sent as typed: the backend trims, and a blank content is none.
    expect(JSON.parse(server.calls[0]!.body).content).toBe('   ');
    await updateArtifactAction(NO_ARTIFACT_EDIT, form({ ...EDIT, content: '' }));
    expect(JSON.parse(server.calls[1]!.body).content).toBeNull();
    expect(flashed).toHaveBeenCalledWith('success', 'Artifact updated.');
  });

  it('a value outside its limits comes back as its text under its part; nothing is announced', async () => {
    await withBackend({ [`PATCH ${ONE}`]: problemOf(400, 'request.invalid', { field: 'fieldValue', index: 0, min: 1, max: 8000 }) });

    const answer = await updateArtifactAction(NO_ARTIFACT_EDIT, form(EDIT, [['Dano', '']]));

    expect(answer).toEqual({
      serial: 1,
      saved: false,
      error: 'O valor do campo precisa ter de 1 a 8000 caracteres.',
      field: 'fieldValue:0',
      stale: false,
      currentVersion: null,
    });
    expect(steps).toEqual([]);
  });

  it('a stale edit reads the artifact again and answers its newest version, so the draft can be kept as a new one', async () => {
    const server = await withBackend({
      [`PATCH ${ONE}`]: problemOf(409, 'request.stale_version'),
      [`GET ${ONE}`]: { status: 200, body: { ...STORED, version: 3, currentVersion: 3 } },
    });

    const answer = await updateArtifactAction(NO_ARTIFACT_EDIT, form(EDIT));

    expect(answer).toEqual({ serial: 1, saved: false, error: null, field: null, stale: true, currentVersion: 3 });
    expect(calls(server)).toEqual([`PATCH ${ONE}`, `GET ${ONE}`]);
    expect(steps).toEqual([]);
    await backend?.close();

    // The artifact is gone meanwhile: said under the form.
    await withBackend({ [`PATCH ${ONE}`]: problemOf(409, 'request.stale_version'), [`GET ${ONE}`]: problemOf(404, 'request.not_found') });
    expect(await updateArtifactAction(NO_ARTIFACT_EDIT, form(EDIT))).toMatchObject({ stale: false, error: 'Não encontrado.', field: null });
  });

  it('never reaches the backend with a malformed edit', async () => {
    const server = await withBackend({});
    const unpaired = form(EDIT);
    unpaired.append('fieldName', 'sem valor');
    const contentless = form(EDIT);
    contentless.delete('content');
    for (const data of [form({ ...EDIT, artifactId: 'nope' }), form({ ...EDIT, version: '0' }), form({ ...EDIT, version: 'x' }), unpaired, contentless]) {
      expect(await updateArtifactAction(NO_ARTIFACT_EDIT, data)).toMatchObject({ error: 'O pedido não é válido.', saved: false });
    }
    expect(server.calls).toEqual([]);
  });

  it('a restore on the newest version read: the toast names the version, the layout is revalidated and the page read again', async () => {
    const server = await withBackend({
      [`POST ${ONE}/versions/1/restore`]: { status: 200, body: { ...STORED, version: 4, currentVersion: 4 } },
    });

    const answer = await restoreArtifactAction(NO_ARTIFACT_RESTORE, form(RESTORE));

    expect(answer).toEqual({ serial: 1, number: 1, saved: true, error: null, stale: false, currentVersion: 4 });
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ version: 3 });
    expect(steps).toEqual(['flash success Versão 1 restaurada.', 'revalidate / layout', 'refresh']);
  });

  it('a restore from an earlier version\'s page moves on to the artifact\'s page, keeping "Personagens"', async () => {
    await withBackend({ [`POST ${ONE}/versions/1/restore`]: { status: 200, body: { ...STORED, version: 4, currentVersion: 4 } } });

    const digest = await thrownDigest(() => restoreArtifactAction(NO_ARTIFACT_RESTORE, form({ ...RESTORE, view: 'older', from: 'characters' })));

    expect(digest).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}/artifacts/${ARTIFACT}\\?from=characters;`));
    expect(steps).toEqual(['flash success Versão 1 restaurada.', 'revalidate / layout']);
  });

  it('a stale restore reads the artifact again; a version whose type is gone, or another refusal, says why', async () => {
    await withBackend({
      [`POST ${ONE}/versions/1/restore`]: problemOf(409, 'request.stale_version'),
      [`GET ${ONE}`]: { status: 200, body: { ...STORED, version: 4, currentVersion: 4 } },
    });
    expect(await restoreArtifactAction(NO_ARTIFACT_RESTORE, form(RESTORE))).toEqual({
      serial: 1,
      number: 1,
      saved: false,
      error: null,
      stale: true,
      currentVersion: 4,
    });
    await backend?.close();

    await withBackend({ [`POST ${ONE}/versions/1/restore`]: problemOf(400, 'request.invalid', { field: 'recordType' }) });
    expect(await restoreArtifactAction(NO_ARTIFACT_RESTORE, form(RESTORE))).toMatchObject({
      saved: false,
      stale: false,
      error: 'O tipo de registro desta versão não existe mais no sistema desta campanha.',
    });
    await backend?.close();

    await withBackend({ [`POST ${ONE}/versions/1/restore`]: problemOf(404, 'request.not_found') });
    expect(await restoreArtifactAction(NO_ARTIFACT_RESTORE, form(RESTORE))).toMatchObject({ error: 'Não encontrado.' });
    expect(steps).toEqual([]);
  });

  it('never reaches the backend with a malformed restore', async () => {
    const server = await withBackend({});
    for (const data of [form({ ...RESTORE, number: '0' }), form({ ...RESTORE, version: '' }), form({ ...RESTORE, campaignId: 'x' })]) {
      expect(await restoreArtifactAction(NO_ARTIFACT_RESTORE, data)).toMatchObject({ error: 'O pedido não é válido.', saved: false });
    }
    expect(server.calls).toEqual([]);
  });
});

const calls = (server: Scripted) => server.calls.map((call) => `${call.method} ${call.url}`);

describe("an artifact's delete Server Action (Story 5.2 part B)", () => {
  const ONE = `${ARTIFACTS}/${ARTIFACT}`;
  const DELETE = { campaignId: CAMPAIGN, artifactId: ARTIFACT, name: 'Espada de Kael' };

  it('deletes it, then the toast naming it, the layout revalidated, and the campaign\'s artifacts tab', async () => {
    const server = await withBackend({ [`DELETE ${ONE}`]: { status: 202 } });

    const digest = await thrownDigest(() => deleteArtifactAction({ error: null }, form(DELETE)));

    expect(digest).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}\\?tab=artifacts;`));
    expect(calls(server)).toEqual([`DELETE ${ONE}`]);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(server.calls[0]!.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
    expect(steps).toEqual(['flash success Artefato «Espada de Kael» excluído.', 'revalidate / layout']);
  });

  it('opened from "Personagens", it lands there; any other `from` is ignored; the toast is in the interface\'s language', async () => {
    await withBackend({ [`DELETE ${ONE}`]: { status: 202 } });
    cookieJar['__Host-gmshield-lang'] = 'en';

    expect(await thrownDigest(() => deleteArtifactAction({ error: null }, form({ ...DELETE, from: 'characters' })))).toMatch(
      /^NEXT_REDIRECT;[a-z]+;\/characters;/,
    );
    expect(flashed).toHaveBeenCalledWith('success', 'Artifact «Espada de Kael» deleted.');
    expect(await thrownDigest(() => deleteArtifactAction({ error: null }, form({ ...DELETE, from: 'https://evil.example' })))).toMatch(
      new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}\\?tab=artifacts;`),
    );
  });

  it('already deleted (another tab): it lands on the tab the same way, without the toast', async () => {
    await withBackend({ [`DELETE ${ONE}`]: problemOf(404, 'request.not_found') });

    expect(await thrownDigest(() => deleteArtifactAction({ error: null }, form({ ...DELETE, from: 'characters' })))).toMatch(
      /^NEXT_REDIRECT;[a-z]+;\/characters;/,
    );
    expect(steps).toEqual(['revalidate / layout']);
    expect(flashed).not.toHaveBeenCalled();
  });

  it('another refusal comes back in words, and nothing else happens', async () => {
    await withBackend({ [`DELETE ${ONE}`]: problemOf(400, 'request.invalid') });

    expect(await deleteArtifactAction({ error: null }, form(DELETE))).toEqual({ error: 'O pedido não é válido.' });
    expect(steps).toEqual([]);
  });

  it('never reaches the backend with a malformed form', async () => {
    const server = await withBackend({});
    for (const fields of [
      { ...DELETE, campaignId: 'x' },
      { ...DELETE, artifactId: '../x' },
      { campaignId: CAMPAIGN, artifactId: ARTIFACT },
      {},
    ] as Record<string, string>[]) {
      expect(await deleteArtifactAction({ error: null }, form(fields))).toEqual({ error: 'O pedido não é válido.' });
    }
    expect(server.calls).toEqual([]);
    expect(steps).toEqual([]);
  });
});


describe("an artifact's override Server Actions (Story 5.5 part A)", () => {
  const OVERRIDE = `${ARTIFACTS}/${ARTIFACT}/override`;
  const RECORD = '0190a0b0-0000-7000-8000-000000000700';
  const MARK = { campaignId: CAMPAIGN, artifactId: ARTIFACT, recordId: RECORD };
  const START_OVERRIDE = { serial: 0, done: false, error: null };
  const MARKED = {
    ...STORED,
    conversationId: null,
    references: [],
    overrides: { recordId: RECORD, name: 'Bola de Fogo', recordType: 'spell', systemId: '0190a0b0-0000-7000-8000-000000000001', removed: false },
  };

  it('a mark sends the record, then the toast that it applies from the next question, the layout and the page', async () => {
    const server = await withBackend({ [`PUT ${OVERRIDE}`]: { status: 200, body: MARKED } });

    expect(await setOverrideAction(START_OVERRIDE, form(MARK))).toEqual({ serial: 1, done: true, error: null });

    expect(calls(server)).toEqual([`PUT ${OVERRIDE}`]);
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ recordId: RECORD });
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(steps).toEqual(['flash success Substituição salva. Vale a partir da próxima pergunta.', 'revalidate / layout', 'refresh']);
  });

  it('a record taken by another artifact, or no target any more, says so in words; nothing is announced', async () => {
    await withBackend({ [`PUT ${OVERRIDE}`]: problemOf(409, 'artifact.override_taken', { artifactId: ARTIFACT }) });
    expect(await setOverrideAction(START_OVERRIDE, form(MARK))).toEqual({
      serial: 1,
      done: false,
      error: 'Outro artefato desta campanha já substitui esse registro.',
    });
    await backend?.close();
    await withBackend({ [`PUT ${OVERRIDE}`]: problemOf(400, 'artifact.override_target') });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect((await setOverrideAction(START_OVERRIDE, form(MARK))).error).toBe('That record cannot be overridden: pick another from the list.');
    expect(steps).toEqual([]);
  });

  it('a removal answers 204, then the toast, the layout and the page; a refusal comes back in words', async () => {
    const server = await withBackend({ [`DELETE ${OVERRIDE}`]: { status: 204 } });

    expect(await removeOverrideAction(START_OVERRIDE, form({ campaignId: CAMPAIGN, artifactId: ARTIFACT }))).toEqual({
      serial: 1,
      done: true,
      error: null,
    });
    expect(calls(server)).toEqual([`DELETE ${OVERRIDE}`]);
    expect(steps).toEqual(['flash success Substituição removida. Vale a partir da próxima pergunta.', 'revalidate / layout', 'refresh']);
    await backend?.close();
    steps.length = 0;
    await withBackend({ [`DELETE ${OVERRIDE}`]: problemOf(404, 'request.not_found') });
    expect((await removeOverrideAction(START_OVERRIDE, form({ campaignId: CAMPAIGN, artifactId: ARTIFACT }))).done).toBe(false);
    expect(steps).toEqual([]);
  });

  it('never reaches the backend with a malformed mark or removal', async () => {
    const server = await withBackend({});
    for (const fields of [{ ...MARK, recordId: 'x' }, { ...MARK, artifactId: '../x' }, { campaignId: CAMPAIGN, artifactId: ARTIFACT }, {}] as Record<string, string>[]) {
      expect((await setOverrideAction(START_OVERRIDE, form(fields))).error).toBe('O pedido não é válido.');
    }
    expect((await removeOverrideAction(START_OVERRIDE, form({ campaignId: 'x', artifactId: ARTIFACT }))).error).toBe('O pedido não é válido.');
    expect(server.calls).toEqual([]);
  });

  it("the picker's page reads the targets by type, trimmed filter and offset, and answers its rows and paging", async () => {
    const targets = `/api/v1/campaigns/${CAMPAIGN}/override-targets`;
    const server = await withBackend({
      [`GET ${targets}?recordType=spell&q=bola&offset=6&limit=6`]: {
        status: 200,
        body: { items: [{ id: RECORD, name: 'Bola de Fogo', recordType: 'spell', materialName: 'Livro' }], total: 9 },
      },
      [`GET ${targets}?recordType=spell&offset=0&limit=6`]: { status: 200, body: { items: [], total: 0 } },
    });

    expect(await overrideTargetsAction(CAMPAIGN, 'spell', '  bola ', 2)).toEqual({
      ok: true,
      rows: [{ id: RECORD, name: 'Bola de Fogo', materialName: 'Livro' }],
      paging: { page: 2, pages: 2, total: 9, from: 7, to: 7 },
    });
    expect(await overrideTargetsAction(CAMPAIGN, 'spell', '', 1)).toEqual({ ok: true, rows: [], paging: { page: 1, pages: 1, total: 0, from: 0, to: 0 } });
    expect(calls(server)).toEqual([`GET ${targets}?recordType=spell&q=bola&offset=6&limit=6`, `GET ${targets}?recordType=spell&offset=0&limit=6`]);
    // A malformed request lists nothing and reaches nothing.
    expect(await overrideTargetsAction('x', 'spell', '', 1)).toEqual({ ok: false, error: 'O pedido não é válido.' });
    expect(await overrideTargetsAction(CAMPAIGN, 'Spell', '', 1)).toEqual({ ok: false, error: 'O pedido não é válido.' });
    expect(server.calls).toHaveLength(2);
  });
});

describe("an artifact's relation Server Actions (Story 5.5 part B)", () => {
  const RELATIONS = `${ARTIFACTS}/${ARTIFACT}/relations`;
  const RECORD = '0190a0b0-0000-7000-8000-000000000700';
  const OTHER = '0190a0b0-0000-7000-8000-000000000901';
  const PICKED = { campaignId: CAMPAIGN, artifactId: ARTIFACT, recordId: RECORD };
  const START_RELATION = { serial: 0, done: false, error: null };
  const RELATED = {
    ...STORED,
    conversationId: null,
    references: [],
    overrides: null,
    related: [{ recordId: RECORD, name: 'Troll', recordType: 'creature', tier: 'system', artifact: false, removed: false }],
  };

  it('a relation sends the record, then the toast (saying nothing of the next question), the layout and the page', async () => {
    const server = await withBackend({ [`POST ${RELATIONS}`]: { status: 200, body: RELATED } });

    expect(await relateAction(START_RELATION, form(PICKED))).toEqual({ serial: 1, done: true, error: null });

    expect(calls(server)).toEqual([`POST ${RELATIONS}`]);
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ recordId: RECORD });
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(steps).toEqual(['flash success Relação salva.', 'revalidate / layout', 'refresh']);
  });

  it('a record that is no target, or a side with 50 relations, says so in words; nothing is announced', async () => {
    await withBackend({ [`POST ${RELATIONS}`]: problemOf(400, 'artifact.relation_target') });
    expect(await relateAction(START_RELATION, form(PICKED))).toEqual({
      serial: 1,
      done: false,
      error: 'Esse registro não pode ser relacionado: escolha outro da lista.',
    });
    await backend?.close();
    await withBackend({ [`POST ${RELATIONS}`]: problemOf(409, 'artifact.relations_full') });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect((await relateAction(START_RELATION, form(PICKED))).error).toBe(
      'This artifact, or the other one, has 50 relations already: remove one first.',
    );
    expect(steps).toEqual([]);
  });

  it('a removal names the record, answers 204, then the toast, the layout and the page; a refusal comes back in words', async () => {
    const server = await withBackend({ [`DELETE ${RELATIONS}/${OTHER}`]: { status: 204 } });

    expect(await unrelateAction(START_RELATION, form({ ...PICKED, recordId: OTHER }))).toEqual({ serial: 1, done: true, error: null });
    expect(calls(server)).toEqual([`DELETE ${RELATIONS}/${OTHER}`]);
    expect(steps).toEqual(['flash success Relação removida.', 'revalidate / layout', 'refresh']);
    await backend?.close();
    steps.length = 0;
    await withBackend({ [`DELETE ${RELATIONS}/${OTHER}`]: problemOf(404, 'request.not_found') });
    expect((await unrelateAction(START_RELATION, form({ ...PICKED, recordId: OTHER }))).done).toBe(false);
    expect(steps).toEqual([]);
  });

  it('never reaches the backend with a malformed relation or removal', async () => {
    const server = await withBackend({});
    for (const fields of [{ ...PICKED, recordId: 'x' }, { ...PICKED, artifactId: '../x' }, { campaignId: CAMPAIGN, artifactId: ARTIFACT }, {}] as Record<string, string>[]) {
      expect((await relateAction(START_RELATION, form(fields))).error).toBe('O pedido não é válido.');
      expect((await unrelateAction(START_RELATION, form(fields))).error).toBe('O pedido não é válido.');
    }
    expect(server.calls).toEqual([]);
  });

  it("the related mode's page reads the targets by artifact, type, trimmed filter and offset, each row with its tier", async () => {
    const targets = `${ARTIFACTS}/${ARTIFACT}/relation-targets`;
    const server = await withBackend({
      [`GET ${targets}?recordType=creature&q=tro&offset=6&limit=6`]: {
        status: 200,
        body: {
          items: [
            { id: OTHER, name: 'Guarda', recordType: 'creature', tier: 'campaign', artifact: true, materialName: null },
            { id: RECORD, name: 'Troll', recordType: 'creature', tier: 'system', artifact: false, materialName: 'Monstros' },
          ],
          total: 8,
        },
      },
    });

    expect(await relationTargetsAction(CAMPAIGN, ARTIFACT, 'creature', '  tro ', 2)).toEqual({
      ok: true,
      rows: [
        { id: OTHER, name: 'Guarda', materialName: 'Artefato desta campanha', tier: 'campaign' },
        { id: RECORD, name: 'Troll', materialName: 'Monstros', tier: 'system' },
      ],
      paging: { page: 2, pages: 2, total: 8, from: 7, to: 8 },
    });
    expect(calls(server)).toEqual([`GET ${targets}?recordType=creature&q=tro&offset=6&limit=6`]);
    // A malformed request lists nothing and reaches nothing.
    expect(await relationTargetsAction(CAMPAIGN, 'x', 'creature', '', 1)).toEqual({ ok: false, error: 'O pedido não é válido.' });
    expect(await relationTargetsAction(CAMPAIGN, ARTIFACT, 'Creature', '', 1)).toEqual({ ok: false, error: 'O pedido não é válido.' });
    expect(server.calls).toHaveLength(1);
  });
});

describe("an artifact's sharing Server Action (Story 5.6 part A)", () => {
  const SHARING = `${ARTIFACTS}/${ARTIFACT}/sharing`;
  const THURSDAY = '0190a0b0-0000-7000-8000-000000000041';
  const SUNDAY = '0190a0b0-0000-7000-8000-000000000042';
  const START_SHARING = { serial: 0, done: false, error: null };
  const SHARED = {
    ...STORED,
    conversationId: null,
    references: [],
    overrides: null,
    related: [],
    sharedWith: [{ campaignId: THURSDAY, name: 'Mesa de quinta', archived: false }],
    sharedFrom: null,
  };
  /** The sharing form: the two ids, then each campaign ticked. */
  const ticked = (...campaigns: string[]) => {
    const data = form({ campaignId: CAMPAIGN, artifactId: ARTIFACT });
    campaigns.forEach((campaign) => data.append('campaignIds', campaign));
    return data;
  };

  it('sends the whole set ticked, then the toast that it applies from the next question, the layout and the page', async () => {
    const server = await withBackend({ [`PUT ${SHARING}`]: { status: 200, body: SHARED } });

    expect(await shareAction(START_SHARING, ticked(THURSDAY, SUNDAY, THURSDAY))).toEqual({ serial: 1, done: true, error: null });

    expect(calls(server)).toEqual([`PUT ${SHARING}`]);
    // Each campaign once, in the order ticked.
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ campaignIds: [THURSDAY, SUNDAY] });
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(steps).toEqual(['flash success Compartilhamento salvo. Vale a partir da próxima pergunta.', 'revalidate / layout', 'refresh']);
  });

  it('nothing ticked unshares it from every campaign; the toast is in the interface\'s language', async () => {
    const server = await withBackend({ [`PUT ${SHARING}`]: { status: 200, body: { ...SHARED, sharedWith: [] } } });
    cookieJar['__Host-gmshield-lang'] = 'en';

    expect(await shareAction(START_SHARING, ticked())).toEqual({ serial: 1, done: true, error: null });

    expect(JSON.parse(server.calls[0]!.body)).toEqual({ campaignIds: [] });
    expect(steps).toEqual(['flash success Sharing saved. It applies from the next question.', 'revalidate / layout', 'refresh']);
  });

  it('a campaign that is no target says so in words; another refusal as every refusal reads; nothing is announced', async () => {
    await withBackend({ [`PUT ${SHARING}`]: problemOf(400, 'artifact.share_target') });
    expect(await shareAction(START_SHARING, ticked(THURSDAY))).toEqual({
      serial: 1,
      done: false,
      error: 'Uma das campanhas marcadas não pode mais receber este artefato. Recarregue a página e tente de novo.',
    });
    await backend?.close();
    await withBackend({ [`PUT ${SHARING}`]: problemOf(404, 'request.not_found') });
    const refused = await shareAction({ serial: 3, done: false, error: null }, ticked(THURSDAY));
    expect(refused.serial).toBe(4);
    expect(refused.done).toBe(false);
    expect(refused.error).not.toContain('request.');
    expect(steps).toEqual([]);
  });

  it('never reaches the backend with a malformed form', async () => {
    const server = await withBackend({});
    const tooMany = ticked(...Array.from({ length: 201 }, () => THURSDAY));
    const malformed = [
      ticked('x'),
      ticked(THURSDAY, '../x'),
      form({ campaignId: CAMPAIGN, artifactId: 'x' }),
      form({ artifactId: ARTIFACT }),
      tooMany,
    ];
    for (const data of malformed) {
      expect((await shareAction(START_SHARING, data)).error).toBe('O pedido não é válido.');
    }
    expect(server.calls).toEqual([]);
    expect(steps).toEqual([]);
  });
});
