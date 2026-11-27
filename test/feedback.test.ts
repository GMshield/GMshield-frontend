import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The usability pass (2026-11-21): what a Server Action says once it has succeeded (the flash cookie), how each list is
 * shown (the view cookie), and the state filters of "Meus Arquivos".
 */
type SetCall = { name: string; value: string; options: Record<string, unknown> };
let cookieJar: Record<string, string> = {};
let setCalls: SetCall[] = [];
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => setCalls.push({ name, value, options }),
  }),
}));
vi.mock('next/cache', () => ({ refresh: () => undefined, revalidatePath: () => undefined }));
// "Adicionar Arquivo" opens the guided upload, which lives in the shell: outside it, a plain button stands in.
vi.mock('@/components/AddFileButton', async () => {
  const { createElement } = await import('react');
  return { AddFileButton: ({ label }: { readonly label: string }) => createElement('button', { type: 'button' }, label) };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { renderToStaticMarkup } = await import('react-dom/server');
const { FLASH_COOKIE, FLASH_MAX_LENGTH, flashClearLine, flashFrom, flashIn, flashValue } = await import('@/flash-cookie');
const { DEFAULT_VIEW, DEFAULT_VIEWS, VIEW_COOKIE, viewCookieLine, viewsFrom, viewsIn, viewsValue } = await import('@/view-cookie');
const { FILE_FILTERS, filterOf, statesOf } = await import('@/app/(signed-in)/files/filters');
const { default: FilesPage } = await import('@/app/(signed-in)/files/page');
const { previewPageAction } = await import('@/app/(signed-in)/files/actions');
const { deleteMaterialAction, materialAction, removeVersionAction } = await import('@/app/(signed-in)/files/[id]/actions');
const { createSystemAction, deleteSystemAction } = await import('@/app/(signed-in)/systems/actions');
const { archiveCampaignAction, chooseCampaignAction, openSavedAnswerAction } = await import('@/app/(signed-in)/campaigns/actions');
const { fileRow, previewOf } = await import('@/app/(signed-in)/files/rows');
const { translator } = await import('@/messages');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ID = '0190a0b0-0000-7000-8000-000000000030';
const MATERIAL = '0190a0b0-0000-7000-8000-000000000003';
const NOWHERE = { campaign: null, systems: [] };

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', 'configured-service-credential-0123456789');
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999`, '__Host-gmshield-lang': 'pt-BR' };
  return backend;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

/** The flash the last action left, as the browser would read it. */
function flashed() {
  const call = setCalls.findLast((set) => set.name === FLASH_COOKIE);
  return call === undefined ? null : { flash: flashFrom(call.value), options: call.options };
}

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  setCalls = [];
  cookieJar = {};
  vi.unstubAllEnvs();
});

describe('the flash cookie', () => {
  it('carries a status and a text, read once from document.cookie as the server wrote it', () => {
    const value = flashValue({ status: 'success', message: 'Sistema «D&D» criado.' });
    expect(flashFrom(value)).toEqual({ status: 'success', message: 'Sistema «D&D» criado.' });
    // The server's cookie writer percent-encodes the value; the browser's side decodes it once.
    const line = `__Host-gmshield-sidebar=open; ${FLASH_COOKIE}=${encodeURIComponent(value)}; other=1`;
    expect(flashIn(line)).toEqual({ status: 'success', message: 'Sistema «D&D» criado.' });
    expect(flashIn('__Host-gmshield-sidebar=open')).toBeNull();
    expect(flashClearLine()).toBe(`${FLASH_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`);
  });

  it('is nothing for an unknown status, no text or a value that cannot be decoded, and never longer than its limit', () => {
    expect(flashFrom(undefined)).toBeNull();
    expect(flashFrom('loud.Texto')).toBeNull();
    expect(flashFrom('success')).toBeNull();
    expect(flashFrom('success.   ')).toBeNull();
    expect(flashIn(`${FLASH_COOKIE}=success.%E0%A4%A`)).toBeNull();
    expect(flashFrom(flashValue({ status: 'danger', message: 'x'.repeat(FLASH_MAX_LENGTH + 50) }))?.message).toHaveLength(FLASH_MAX_LENGTH);
  });
});

describe('what an action says once it has succeeded', () => {
  it('creating a system leaves "Sistema «D&D» criado." for the page it redirects to, readable by the page for 30 seconds', async () => {
    await useBackend({ 'POST /api/v1/systems': { status: 201, body: { id: ID, name: 'D&D', edition: null, description: null, version: 0 } } });
    const start = { values: { name: '', edition: '', description: '' }, version: null, error: null, field: null, stale: false };
    await expect(createSystemAction(start, form({ name: 'D&D' }))).rejects.toMatchObject({ digest: expect.stringContaining(`/systems/${ID}`) });
    expect(flashed()).toEqual({
      flash: { status: 'success', message: 'Sistema «D&D» criado.' },
      options: { secure: true, httpOnly: false, sameSite: 'lax', path: '/', maxAge: 30 },
    });
  });

  it('a refusal leaves nothing: the form says it', async () => {
    await useBackend({
      'POST /api/v1/systems': {
        status: 409,
        body: { type: 'urn:gmshield:problem:request.system_name_taken', title: 'x', status: 409, category: 'request', code: 'request.system_name_taken', params: {}, traceId: 't' },
      },
      [`DELETE /api/v1/systems/${ID}`]: { status: 503, body: { type: 'x', title: 'x', status: 503, category: 'server', code: 'server.unavailable', params: {}, traceId: 't' } },
    });
    const start = { values: { name: '', edition: '', description: '' }, version: null, error: null, field: null, stale: false };
    expect((await createSystemAction(start, form({ name: 'D&D' }))).field).toBe('name');
    expect((await deleteSystemAction({ error: null }, form({ id: ID }))).error).not.toBeNull();
    expect(flashed()).toBeNull();
  });

  it('deleting a system, archiving, restoring and choosing a campaign each say what happened, in the interface language', async () => {
    const campaign = { id: ID, name: 'Mesa de sexta', system: { id: ID, name: 'D&D', edition: null, description: null, version: 0 }, archived: true, version: 2 };
    await useBackend({
      [`DELETE /api/v1/systems/${ID}`]: { status: 204, body: null },
      [`PATCH /api/v1/campaigns/${ID}`]: { status: 200, body: campaign },
      'PUT /api/v1/campaigns/current': { status: 200, body: { ...campaign, archived: false } },
    });
    await expect(deleteSystemAction({ error: null }, form({ id: ID }))).rejects.toMatchObject({ digest: expect.stringContaining('/systems') });
    expect(flashed()?.flash).toEqual({ status: 'success', message: 'Sistema excluído.' });
    await archiveCampaignAction({ error: null, done: 0 }, form({ id: ID, version: '1', archived: 'true' }));
    expect(flashed()?.flash?.message).toBe('Campanha «Mesa de sexta» arquivada.');
    await archiveCampaignAction({ error: null, done: 0 }, form({ id: ID, version: '2', archived: 'false' }));
    expect(flashed()?.flash?.message).toBe('Campanha «Mesa de sexta» restaurada.');
    cookieJar['__Host-gmshield-lang'] = 'en';
    await chooseCampaignAction({ error: null, done: 0 }, form({ id: ID }));
    expect(flashed()?.flash?.message).toBe('«Mesa de sexta» is the current campaign.');
  });

  it('Story 3.12: "Ir" on a saved answer of another campaign names the campaign it switched to, in both languages', async () => {
    const campaign = { id: ID, name: 'A Coroa Partida', system: { id: ID, name: 'D&D', edition: null, description: null, version: 0 }, archived: false, version: 0 };
    await useBackend({ 'PUT /api/v1/campaigns/current': { status: 200, body: campaign } });
    const fields = { id: ID, conversationId: MATERIAL, area: 'questions', turnId: MATERIAL };
    await expect(openSavedAnswerAction({ error: null, done: 0 }, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining('/questions/') });
    expect(flashed()?.flash).toEqual({ status: 'success', message: 'Campanha trocada para «A Coroa Partida».' });
    cookieJar['__Host-gmshield-lang'] = 'en';
    await expect(openSavedAnswerAction({ error: null, done: 0 }, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining('?turn=') });
    expect(flashed()?.flash?.message).toBe('Switched to the campaign «A Coroa Partida».');
  });

  it("accepting, reprocessing, retrying and discarding a material each name it; a refused one says nothing", async () => {
    const material = { id: MATERIAL, name: 'Bestiário.pdf', state: 'ready', actions: [], version: 0, belonging: NOWHERE };
    await useBackend({
      [`POST /api/v1/materials/${MATERIAL}/accept`]: { status: 200, body: material },
      [`POST /api/v1/materials/${MATERIAL}/reprocess`]: { status: 200, body: material },
      [`POST /api/v1/materials/${MATERIAL}/retry`]: { status: 200, body: material },
      [`POST /api/v1/materials/${MATERIAL}/discard`]: { status: 409, body: { type: 'x', title: 'x', status: 409, category: 'request', code: 'request.conflict', params: {}, traceId: 't' } },
    });
    const t = translator('pt-BR');
    for (const action of ['accept', 'reprocess', 'retry'] as const) {
      expect((await materialAction({ error: null }, form({ id: MATERIAL, action }))).error).toBeNull();
      expect(flashed()?.flash).toEqual({ status: 'success', message: t(`feedback.material.${action}`, { name: 'Bestiário.pdf' }) });
    }
    setCalls = [];
    expect((await materialAction({ error: null }, form({ id: MATERIAL, action: 'discard' }))).error).not.toBeNull();
    expect(flashed()).toBeNull();
  });

  it('deleting a material names it, and removing a previous version says so; a refused removal says nothing (Story 3.4 part B)', async () => {
    const version = '0190a0b0-0000-7000-8000-00000000000a';
    const other = '0190a0b0-0000-7000-8000-00000000000b';
    await useBackend({
      [`GET /api/v1/materials/${MATERIAL}`]: { status: 200, body: { id: MATERIAL, name: 'Bestiário.pdf', state: 'ready', actions: [] } },
      [`DELETE /api/v1/materials/${MATERIAL}`]: { status: 202, body: null },
      [`DELETE /api/v1/materials/${MATERIAL}/versions/${version}`]: { status: 202, body: null },
      [`DELETE /api/v1/materials/${MATERIAL}/versions/${other}`]: {
        status: 409,
        body: { type: 'x', title: 'x', status: 409, category: 'material', code: 'material.version_not_removable', params: {}, traceId: 't' },
      },
    });
    await expect(deleteMaterialAction({ error: null }, form({ id: MATERIAL }))).rejects.toMatchObject({ digest: expect.stringContaining('/files') });
    expect(flashed()?.flash).toEqual({ status: 'success', message: 'Arquivo «Bestiário.pdf» excluído.' });
    setCalls = [];
    expect((await removeVersionAction({ error: null }, form({ id: MATERIAL, versionId: version }))).error).toBeNull();
    expect(flashed()?.flash).toEqual({ status: 'success', message: 'Versão anterior removida.' });
    setCalls = [];
    expect((await removeVersionAction({ error: null }, form({ id: MATERIAL, versionId: other }))).error).not.toBeNull();
    expect(flashed()).toBeNull();
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect((await removeVersionAction({ error: null }, form({ id: MATERIAL, versionId: version }))).error).toBeNull();
    expect(flashed()?.flash?.message).toBe('Previous version removed.');
  });
});

describe('the view cookie', () => {
  it('holds a layout, a spacing, the thumbnails and the rows a page of each list, and anything else is the default', () => {
    expect(viewsFrom(undefined)).toEqual(DEFAULT_VIEWS);
    expect(DEFAULT_VIEW).toEqual({ layout: 'list', density: 'comfortable', previews: true, size: 10 });
    const views = viewsFrom('files:grid:compact:0:50|systems:list:compact:1|campaigns:mosaic:compact:1|admin:grid:compact:1|junk');
    expect(views.files).toEqual({ layout: 'grid', density: 'compact', previews: false, size: 50 });
    // A value written before pages had a size, and a size off the allowlist: ten rows a page.
    expect(views.systems).toEqual({ layout: 'list', density: 'compact', previews: true, size: 10 });
    expect(viewsFrom('files:list:compact:1:7').files.size).toBe(10);
    expect(viewsFrom('files:list:compact:1:20').files.size).toBe(20);
    // A layout off the allowlist, and a list that does not exist: the default stays.
    expect(views.campaigns).toEqual(DEFAULT_VIEW);
    expect(Object.keys(views).sort()).toEqual(['artifacts', 'campaigns', 'conversations', 'files', 'notes', 'recordTypes', 'records', 'shields', 'systems', 'terms']);
    expect(viewsFrom(viewsValue(views))).toEqual(views);
  });

  it('is written for a year with the __Host- attributes, and read back from document.cookie', () => {
    const views = { ...DEFAULT_VIEWS, files: { layout: 'grid', density: 'comfortable', previews: true, size: 20 } } as const;
    const line = viewCookieLine(views);
    expect(line).toBe(`${VIEW_COOKIE}=files:grid:comfortable:1:20|campaigns:list:comfortable:1:10|systems:list:comfortable:1:10|conversations:list:comfortable:1:10|recordTypes:list:comfortable:1:10|records:list:comfortable:1:10|terms:list:comfortable:1:10|artifacts:list:comfortable:1:10|shields:list:comfortable:1:10|notes:list:comfortable:1:10; Path=/; Max-Age=31536000; Secure; SameSite=Lax`);
    expect(viewsIn(`a=b; ${line.split(';')[0]}`)).toEqual(views);
    expect(viewsIn('a=b')).toEqual(DEFAULT_VIEWS);
  });
});

describe('the state filters of "Meus Arquivos"', () => {
  const FILES = (states: readonly string[]) => `GET /api/v1/materials?${states.map((state) => `state=${state}`).join('&')}&limit=10`;
  const ready = { id: MATERIAL, name: 'Livro.pdf', state: 'ready', actions: [], version: 0, size: 1200000, pages: { done: 320, total: 320 }, belonging: NOWHERE };

  it('names five filters, each with the states it asks the backend for; anything else is every state', () => {
    expect(FILE_FILTERS).toEqual(['all', 'ready', 'review', 'progress', 'failed']);
    expect(statesOf('ready')).toEqual(['ready']);
    expect(statesOf('review')).toEqual(['needs_review']);
    expect(statesOf('progress')).toEqual(['uploading', 'waiting', 'processing']);
    expect(statesOf('failed')).toEqual(['failed']);
    expect(filterOf(['ready'])).toBe('all');
    expect(statesOf('discarded')).not.toContain('discarded');
    expect(statesOf(undefined)).toContain('superseded');
  });

  it('?state=ready asks for the ready ones alone, marks the filter current, and the pages stay within it', async () => {
    const many = Array.from({ length: 11 }, (_, index) => ({ ...ready, id: `0190a0b0-0000-7000-8000-0000000007${String(index).padStart(2, '0')}`, name: `Livro ${index + 1}.pdf` }));
    const server = await useBackend({
      [FILES(['ready'])]: { status: 200, body: { items: many.slice(0, 10), nextCursor: many[9]!.id, total: 11 } },
      [`${FILES(['ready'])}&offset=10`]: { status: 200, body: { items: many.slice(10), total: 11 } },
    });
    let html = renderToStaticMarkup(await FilesPage({ searchParams: Promise.resolve({ state: 'ready' }) }));
    expect(html).toMatch(/<nav[^>]*aria-label="Filtrar por estado"/);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/files\?state=ready"[^>]*>Prontos<\/a>|<a[^>]*href="\/files\?state=ready"[^>]*aria-current="page"[^>]*>Prontos<\/a>/);
    expect(html).toContain('href="/files"');
    // The pager's links keep the filter.
    expect(html).toContain('1–10 de 11');
    expect(html).toContain('href="/files?state=ready&amp;page=2"');
    // The display options are there, as the cookie (none here) says: a comfortable list.
    expect(html).toMatch(/<ul[^>]*data-layout="list"[^>]*data-density="comfortable"|<ul[^>]*data-density="comfortable"[^>]*data-layout="list"/);
    expect(html).toContain('>Exibição');
    html = renderToStaticMarkup(await FilesPage({ searchParams: Promise.resolve({ state: 'ready', page: '2' }) }));
    expect(html).toContain('11–11 de 11');
    expect(html).toContain('Livro 11.pdf');
    // The backend filters, counts and skips: one call a page, within the filter.
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([FILES(['ready']), `${FILES(['ready'])}&offset=10`]);
  });

  it('the view cookie decides how the server renders the list', async () => {
    await useBackend({ [FILES(statesOf('all'))]: { status: 200, body: { items: [ready], total: 1 } } });
    cookieJar[VIEW_COOKIE] = 'files:grid:compact:1';
    const html = renderToStaticMarkup(await FilesPage());
    expect(html).toMatch(/<ul[^>]*data-layout="grid"/);
    expect(html).toMatch(/<ul[^>]*data-density="compact"/);
    // The rows a page holds are one of the display options.
    expect(html).toContain('>Por página</legend>');
  });

  it('a filter with nothing in it says so and leads back to every file; the list with nothing at all keeps its own sentence', async () => {
    await useBackend({
      [FILES(['failed'])]: { status: 200, body: { items: [], total: 0 } },
      [FILES(statesOf('all'))]: { status: 200, body: { items: [], total: 0 } },
    });
    let html = renderToStaticMarkup(await FilesPage({ searchParams: Promise.resolve({ state: 'failed' }) }));
    expect(html).toContain('Nenhum arquivo neste estado.');
    expect(html).toMatch(/<a[^>]*href="\/files"[^>]*>Ver todos<\/a>/);
    expect(html).toContain('aria-label="Filtrar por estado"');
    html = renderToStaticMarkup(await FilesPage());
    expect(html).toContain('Os arquivos que você enviar aparecem aqui, com o estado de cada um.');
    expect(html).not.toContain('aria-label="Filtrar por estado"');
  });
});

describe('thumbnails and previews', () => {
  const t = translator('pt-BR');
  const material = (state: string, pages?: { done: number; total: number }) =>
    ({ id: MATERIAL, name: 'Livro.pdf', state, actions: [], version: 0, belonging: NOWHERE, serving: null, superseded: [], ...(pages === undefined ? {} : { pages }) }) as Parameters<typeof previewOf>[0];

  it('a material shows its first page once it needs review or is ready and has pages, never before', () => {
    const picture = `/api/v1/materials/${MATERIAL}/pages/1/picture?ground=review`;
    expect(previewOf(material('ready', { done: 320, total: 320 }))).toEqual({ thumbnail: picture, pages: 320 });
    expect(previewOf(material('needs_review', { done: 2, total: 2 }))).toEqual({ thumbnail: picture, pages: 2 });
    expect(previewOf(material('processing', { done: 40, total: 320 }))).toEqual({ thumbnail: null, pages: null });
    expect(previewOf(material('ready'))).toEqual({ thumbnail: null, pages: null });
    expect(previewOf(material('failed', { done: 0, total: 0 }))).toEqual({ thumbnail: null, pages: null });
    expect(fileRow(material('ready', { done: 3, total: 3 }), t, 'pt-BR')).toMatchObject({ thumbnail: picture, pages: 3 });
  });

  it('the preview reads one page with the session, and never asks the backend for an id or a number that cannot be one', async () => {
    const page = { page: 2, pageTotal: 3, picture: null, lines: [], text: 'Texto.', passages: [], outcome: 'read_directly' };
    const server = await useBackend({
      [`GET /api/v1/materials/${MATERIAL}/pages/2?ground=review`]: { status: 200, body: page },
      [`GET /api/v1/materials/${MATERIAL}/pages/9?ground=review`]: { status: 404, body: { type: 'x', title: 'x', status: 404, category: 'request', code: 'request.not_found', params: {}, traceId: 't' } },
    });
    expect(await previewPageAction(MATERIAL, 2)).toEqual(page);
    expect(server.calls[0]?.headers['x-session-token']).toBe(SESSION);
    expect(await previewPageAction(MATERIAL, 9)).toBeNull();
    const calls = server.calls.length;
    for (const [id, number] of [['../x', 1], [MATERIAL, 0], [MATERIAL, 1.5], [MATERIAL, 10_000_000], [MATERIAL, Number.NaN]] as const) {
      expect(await previewPageAction(id, number)).toBeNull();
    }
    expect(server.calls).toHaveLength(calls);
  });
});

describe('page titles', () => {
  it('a section\'s pages are titled after its sidebar entry, in the interface language', async () => {
    const { sectionMetadata } = await import('@/app/(signed-in)/section-metadata');
    const { generateMetadata: filesMetadata } = await import('@/app/(signed-in)/files/layout');
    const { generateMetadata: questionsMetadata } = await import('@/app/(signed-in)/questions/page');
    cookieJar = { '__Host-gmshield-lang': 'pt-BR' };
    expect(await sectionMetadata('campaigns')).toEqual({ title: 'Minhas Mesas' });
    expect(await filesMetadata()).toEqual({ title: 'Meus Arquivos' });
    expect(await questionsMetadata()).toEqual({ title: 'Consultas' });
    cookieJar = { '__Host-gmshield-lang': 'en' };
    expect(await sectionMetadata('systems')).toEqual({ title: 'Systems' });
  });
});
