import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: () => undefined,
  }),
}));
// The pages' client parts ask for the router; outside Next.js there is none.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: SystemsPage } = await import('@/app/(signed-in)/systems/page');
const { default: NewSystemPage } = await import('@/app/(signed-in)/systems/new/page');
const { default: SystemPage } = await import('@/app/(signed-in)/systems/[id]/page');
const { default: EditSystemPage } = await import('@/app/(signed-in)/systems/[id]/edit/page');
const { changeSystemAction, createSystemAction, moreCampaigns, moreMaterials, moreSystems } = await import(
  '@/app/(signed-in)/systems/actions'
);
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const ID = '0190a0b0-0000-7000-8000-000000000030';
const OTHER = '0190a0b0-0000-7000-8000-000000000031';
const STARTER = '0190a0b0-0000-7000-8000-000000000001';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const MATERIAL = '0190a0b0-0000-7000-8000-000000000003';
const DND = { id: ID, name: 'D&D', edition: '5.2.1', description: 'As regras básicas.\nSem suplementos.', version: 3 };
const UNTITLED = { id: STARTER, name: 'Sistema sem nome', edition: null, description: null, version: 0 };
const SYSTEM_MATERIALS = `GET /api/v1/materials?state=uploading&state=waiting&state=processing&state=needs_review&state=ready&state=failed&system=${ID}`;
const EMPTY = { status: 200, body: { items: [] } };

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  return backend;
}

function problem(status: number, code: string, params: Record<string, number> = {}) {
  return { status, body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params, traceId: 't' } };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

/** The digest a `redirect()` or `notFound()` call threw, or null when the call returned. */
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

const params = (id: string) => Promise.resolve({ id });
const query = (tab?: string) => Promise.resolve(tab === undefined ? {} : { tab });
/** The opening tag of the link to `href`, whatever its attributes' order; '' when there is none. */
const linkTo = (html: string, href: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`href="${href}"`)) ?? '';
/** The solid pills of a page: links or buttons whose variant is solid. */
const solids = (html: string) => [...html.matchAll(/<(a|button)[^>]*data-variant="solid"[^>]*>(.*?)<\/\1>/g)].map((match) => match[2]);

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('the systems list (Story 3.1)', () => {
  it('shows the systems with name and edition, each opening its page, under the title and one solid "Novo sistema", in both languages', async () => {
    const server = await useBackend({ 'GET /api/v1/systems': { status: 200, body: { items: [DND, UNTITLED] } } });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await SystemsPage());

      expect(html).toContain(`<h1`);
      expect(html).toContain(messages.shell.entries.systems);
      expect(solids(html)).toEqual([messages.systems.new]);
      expect(linkTo(html, '/systems/new')).toContain('data-variant="solid"');
      expect(html).toContain(`aria-label="${messages.systems.list}"`);
      expect(html).toContain(`href="/systems/${ID}"`);
      expect(html).toContain(`href="/systems/${STARTER}"`);
      expect(html).toContain('D&amp;D');
      expect(html).toContain('5.2.1');
      expect(html.indexOf('D&amp;D')).toBeLessThan(html.indexOf('Sistema sem nome'));
      // A single page: no "Carregar mais".
      expect(html).not.toContain(messages.systems.loadMore);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET /api/v1/systems', 'GET /api/v1/systems']);
    for (const call of server.calls) {
      expect(call.headers['x-session-token']).toBe(SESSION);
      expect(call.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
    }
  });

  it('empty: one sentence says what a system holds, and "Novo sistema" is the only action', async () => {
    await useBackend({ 'GET /api/v1/systems': EMPTY });
    const html = renderToStaticMarkup(await SystemsPage());

    expect(html).toContain('Um sistema reúne as campanhas e os materiais de um jogo.');
    expect(html).not.toContain('<ul');
    expect([...html.matchAll(/<(a|button)\b/g)]).toHaveLength(1);
    expect(solids(html)).toEqual(['Novo sistema']);
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(renderToStaticMarkup(await SystemsPage())).toContain('A system holds the campaigns and materials of one game.');
    for (const messages of [ptBR, en]) {
      expect(JSON.stringify(messages.systems)).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
  });

  it('a first page with more after it offers "Carregar mais" with its cursor; a list that cannot be loaded says why', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/systems': { status: 200, body: { items: [DND], nextCursor: ID } },
    };
    await useBackend(routes);
    let html = renderToStaticMarkup(await SystemsPage());
    expect(html).toContain('Carregar mais');
    expect(html).toContain(`name="cursor" value="${ID}"`);

    routes['GET /api/v1/systems'] = problem(503, 'server.unavailable');
    html = renderToStaticMarkup(await SystemsPage());
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    expect(solids(html)).toEqual(['Novo sistema']);
  });

  it('"Carregar mais" appends the next page to the rows already added, until the last; a refusal keeps them', async () => {
    const server = await useBackend({
      [`GET /api/v1/systems?cursor=${ID}`]: { status: 200, body: { items: [UNTITLED], nextCursor: STARTER } },
      [`GET /api/v1/systems?cursor=${STARTER}`]: { status: 200, body: { items: [{ ...DND, id: OTHER, edition: null }] } },
      [`GET /api/v1/systems?cursor=${OTHER}`]: problem(503, 'server.unavailable'),
    });
    let state = await moreSystems({ rows: [], nextCursor: ID, error: null }, form({ cursor: ID }));
    expect(state).toEqual({
      rows: [{ id: STARTER, label: 'Sistema sem nome', detail: null, href: `/systems/${STARTER}`, state: null }],
      nextCursor: STARTER,
      error: null,
    });
    state = await moreSystems(state, form({ cursor: STARTER }));
    expect(state.rows.map((row) => row.id)).toEqual([STARTER, OTHER]);
    expect(state.nextCursor).toBeNull();
    const refused = await moreSystems(state, form({ cursor: OTHER }));
    expect(refused.rows).toEqual(state.rows);
    expect(refused.error).toBe('O serviço está indisponível agora. Tente de novo em instantes.');
    // A malformed cursor never reaches the backend.
    const calls = server.calls.length;
    expect((await moreSystems(state, form({ cursor: '../me' }))).error).toBe('O pedido não é válido.');
    expect(server.calls).toHaveLength(calls);
  });
});

describe('a new system (Story 3.1)', () => {
  it('is a form page with the name, the edition and the description, one solid pill, and "Cancelar" back to the list', async () => {
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await NewSystemPage());

      expect(html).toContain(messages.systems.form.newTitle);
      for (const label of [messages.systems.form.name, messages.systems.form.edition, messages.systems.form.description]) {
        expect(html).toContain(`>${label}</label>`);
      }
      expect(html).toMatch(/<input[^>]*name="name"[^>]*maxLength="120"|<input[^>]*maxLength="120"[^>]*name="name"/i);
      expect(html).toMatch(/<textarea[^>]*name="description"/);
      expect(solids(html)).toEqual([messages.systems.form.create]);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/systems"[^>]*>${messages.systems.form.cancel}</a>`));
      expect(html).not.toContain('name="version"');
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
  });

  it('sends what was typed and opens the new system\'s page; a refusal comes back under its field with the values kept', async () => {
    const routes: Record<string, { status: number; body: unknown }> = { 'POST /api/v1/systems': { status: 201, body: DND } };
    const server = await useBackend(routes);
    const typed = { name: ' D&D ', edition: '5.2.1', description: '' };
    const initial = { values: { name: '', edition: '', description: '' }, version: null, error: null, field: null, stale: false };

    expect(await thrownDigest(() => createSystemAction(initial, form(typed)))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/systems/${ID};`));
    expect(JSON.parse(server.calls[0]!.body)).toEqual(typed);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);

    // Matrix row "Duplicate".
    routes['POST /api/v1/systems'] = problem(409, 'request.system_name_taken');
    expect(await createSystemAction(initial, form(typed))).toEqual({
      values: typed,
      version: null,
      error: 'Você já tem um sistema com este nome e esta edição.',
      field: 'name',
      stale: false,
    });
    // Matrix row "Invalid": each field's own text, with its limits.
    routes['POST /api/v1/systems'] = problem(400, 'request.system_name_invalid', { min: 1, max: 120 });
    expect(await createSystemAction(initial, form({ ...typed, name: '  ' }))).toMatchObject({
      error: 'O nome precisa ter de 1 a 120 caracteres.',
      field: 'name',
    });
    routes['POST /api/v1/systems'] = problem(400, 'request.system_edition_invalid', { max: 60 });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await createSystemAction(initial, form(typed))).toMatchObject({
      error: 'The edition can have at most 60 characters.',
      field: 'edition',
    });
    routes['POST /api/v1/systems'] = problem(400, 'request.system_description_invalid', { max: 2000 });
    expect(await createSystemAction(initial, form(typed))).toMatchObject({
      error: 'The description can have at most 2000 characters.',
      field: 'description',
    });
    // Anything else is about the whole form.
    routes['POST /api/v1/systems'] = problem(503, 'server.unavailable');
    expect(await createSystemAction(initial, form(typed))).toMatchObject({ field: null, error: 'The service is unavailable right now. Try again in a moment.' });
  });
});

describe('a system page (Story 3.1)', () => {
  const campaigns = { status: 200, body: { items: [{ id: CAMPAIGN, name: 'A Coroa Partida' }] } };
  const materials = { status: 200, body: { items: [{ id: MATERIAL, name: 'SRD 5.2.1.pdf', state: 'ready', actions: [] }] } };

  it('shows the name, edition and description, "Editar", and the campaigns tab by default, in both languages', async () => {
    const server = await useBackend({ [`GET /api/v1/systems/${ID}`]: { status: 200, body: DND }, [`GET /api/v1/campaigns?system=${ID}`]: campaigns });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await SystemPage({ params: params(ID), searchParams: query() }));

      expect(html).toMatch(/<h1[^>]*>D&amp;D<\/h1>/);
      expect(html).toContain(language === 'en' ? 'Edition 5.2.1' : 'Edição 5.2.1');
      expect(html).toContain('As regras básicas.\nSem suplementos.');
      expect(solids(html)).toEqual([messages.systems.page.edit]);
      expect(linkTo(html, `/systems/${ID}/edit`)).toContain('data-variant="solid"');
      expect(html).toContain(`aria-label="${messages.systems.page.sections}"`);
      expect(linkTo(html, `/systems/${ID}?tab=campaigns`)).toContain('aria-current="page"');
      expect(linkTo(html, `/systems/${ID}?tab=materials`)).not.toContain('aria-current');
      expect(html).toContain(`>${messages.systems.page.campaigns}</a>`);
      expect(html).toContain(`>${messages.systems.page.materials}</a>`);
      // Campaign rows open nothing yet (Story 3.2).
      expect(html).toContain('A Coroa Partida');
      expect(html).not.toContain(`href="/campaigns/${CAMPAIGN}"`);
      expect(html).not.toMatch(/<a[^>]*>[^<]*<span[^>]*>A Coroa Partida/);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(server.calls.map((call) => call.url)).toEqual([`/api/v1/systems/${ID}`, `/api/v1/campaigns?system=${ID}`, `/api/v1/systems/${ID}`, `/api/v1/campaigns?system=${ID}`]);
  });

  it('the materials tab lists the system\'s materials with their state, each opening its page', async () => {
    const server = await useBackend({ [`GET /api/v1/systems/${ID}`]: { status: 200, body: DND }, [SYSTEM_MATERIALS]: materials });
    const html = renderToStaticMarkup(await SystemPage({ params: params(ID), searchParams: query('materials') }));

    expect(linkTo(html, `/systems/${ID}?tab=materials`)).toContain('aria-current="page"');
    expect(linkTo(html, `/systems/${ID}?tab=campaigns`)).not.toContain('aria-current');
    expect(html).toContain(`href="/files/${MATERIAL}"`);
    expect(html).toContain('SRD 5.2.1.pdf');
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('pronto');
    expect(html).toContain('aria-label="Materiais deste sistema"');
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toContain(SYSTEM_MATERIALS);
  });

  it('an empty tab says so in one sentence, in both languages; a system with no edition or description shows neither', async () => {
    await useBackend({
      [`GET /api/v1/systems/${STARTER}`]: { status: 200, body: UNTITLED },
      [`GET /api/v1/campaigns?system=${STARTER}`]: EMPTY,
      [SYSTEM_MATERIALS.replace(ID, STARTER)]: EMPTY,
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      let html = renderToStaticMarkup(await SystemPage({ params: params(STARTER), searchParams: query() }));
      expect(html).toContain(messages.systems.page.noCampaigns);
      expect(html).not.toContain('<ul aria-label');
      expect(html).not.toContain(language === 'en' ? 'Edition' : 'Edição');
      html = renderToStaticMarkup(await SystemPage({ params: params(STARTER), searchParams: query('materials') }));
      expect(html).toContain(messages.systems.page.noMaterials);
    }
    expect(ptBR.systems.page.noCampaigns).toBe('Este sistema ainda não tem campanhas.');
  });

  it('another owner\'s system, an unknown one or a malformed id is the single not-found page', async () => {
    await useBackend({ [`GET /api/v1/systems/${OTHER}`]: problem(404, 'request.not_found') });
    for (const id of [OTHER, 'not-a-uuid']) {
      expect(await thrownDigest(() => SystemPage({ params: params(id), searchParams: query() }))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
      expect(await thrownDigest(() => EditSystemPage({ params: params(id) }))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    }
  });

  it('"Carregar mais" under each tab sends the system with the cursor', async () => {
    const server = await useBackend({
      [`GET /api/v1/campaigns?system=${ID}&cursor=${CAMPAIGN}`]: { status: 200, body: { items: [{ id: OTHER, name: 'Segunda' }] } },
      [`${SYSTEM_MATERIALS}&cursor=${MATERIAL}`]: materials,
    });
    const start = { rows: [], nextCursor: CAMPAIGN, error: null };
    expect(await moreCampaigns(start, form({ cursor: CAMPAIGN, system: ID }))).toEqual({
      rows: [{ id: OTHER, label: 'Segunda', detail: null, href: null, state: null }],
      nextCursor: null,
      error: null,
    });
    expect((await moreMaterials(start, form({ cursor: MATERIAL, system: ID }))).rows).toEqual([
      { id: MATERIAL, label: 'SRD 5.2.1.pdf', detail: null, href: `/files/${MATERIAL}`, state: { state: 'ready', word: 'pronto' } },
    ]);
    const calls = server.calls.length;
    expect((await moreCampaigns(start, form({ cursor: CAMPAIGN, system: '../x' }))).error).toBe('O pedido não é válido.');
    expect((await moreMaterials(start, form({ cursor: CAMPAIGN }))).error).toBe('O pedido não é válido.');
    expect(server.calls).toHaveLength(calls);
  });
});

describe('a system\'s edit page (Story 3.1)', () => {
  it('starts from the system\'s values and version, with one solid "Salvar" and "Cancelar" back to its page, in both languages', async () => {
    await useBackend({ [`GET /api/v1/systems/${ID}`]: { status: 200, body: DND } });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await EditSystemPage({ params: params(ID) }));

      expect(html).toContain(messages.systems.form.editTitle);
      expect(html).toMatch(/<input[^>]*value="D&amp;D"/);
      expect(html).toMatch(/<input[^>]*value="5.2.1"/);
      expect(html).toContain('As regras básicas.\nSem suplementos.</textarea>');
      expect(html).toContain(`name="id" value="${ID}"`);
      expect(html).toContain('name="version" value="3"');
      expect(solids(html)).toEqual([messages.systems.form.save]);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/systems/${ID}"[^>]*>${messages.systems.form.cancel}</a>`));
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
  });

  it('sends every field with the version and opens the system\'s page; a stale version brings the current values', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`PATCH /api/v1/systems/${ID}`]: { status: 200, body: { ...DND, name: 'Dungeons & Dragons', version: 4 } },
    };
    const server = await useBackend(routes);
    const previous = { values: { name: 'D&D', edition: '5.2.1', description: '' }, version: 3, error: null, field: null, stale: false };
    const typed = { id: ID, version: '3', name: 'Dungeons & Dragons', edition: '', description: 'Nova.' };

    expect(await thrownDigest(() => changeSystemAction(previous, form(typed)))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/systems/${ID};`));
    // A cleared edition is sent empty, which removes it.
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ version: 3, name: 'Dungeons & Dragons', edition: '', description: 'Nova.' });

    // Matrix row "Stale edit": the page says it changed elsewhere and shows the current values.
    routes[`PATCH /api/v1/systems/${ID}`] = problem(409, 'request.stale_version');
    routes[`GET /api/v1/systems/${ID}`] = { status: 200, body: { ...DND, name: 'D&D (casa)', edition: null, version: 5 } };
    const stale = await changeSystemAction(previous, form(typed));
    expect(stale).toEqual({
      values: { name: 'D&D (casa)', edition: '', description: 'As regras básicas.\nSem suplementos.' },
      version: 5,
      error: ptBR.systems.form.stale,
      field: null,
      stale: true,
    });
    expect(server.calls.map((call) => `${call.method} ${call.url}`).slice(-2)).toEqual([`PATCH /api/v1/systems/${ID}`, `GET /api/v1/systems/${ID}`]);

    routes[`PATCH /api/v1/systems/${ID}`] = problem(409, 'request.system_name_taken');
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await changeSystemAction(previous, form(typed))).toMatchObject({
      values: { name: 'Dungeons & Dragons', edition: '', description: 'Nova.' },
      version: 3,
      error: 'You already have a system with this name and edition.',
      field: 'name',
      stale: false,
    });
    // A malformed id or version never reaches the backend.
    const calls = server.calls.length;
    for (const fields of [{ ...typed, id: '../me' }, { ...typed, version: '-1' }, { ...typed, version: 'x' }]) {
      expect((await changeSystemAction(previous, form(fields))).error).toBe('The request is not valid.');
    }
    expect(server.calls).toHaveLength(calls);
  });
});
