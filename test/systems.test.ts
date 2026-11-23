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
const { changeSystemAction, createSystemAction, deleteSystemAction } = await import(
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
const SYSTEM_MATERIALS = `GET /api/v1/materials?state=uploading&state=waiting&state=processing&state=needs_review&state=ready&state=failed&system=${ID}&limit=10`;
const EMPTY = { status: 200, body: { items: [], total: 0 } };
/** A list page is one call: its size as `limit`, its start as `offset`, and the list's `total` in the answer. */
const SYSTEMS = 'GET /api/v1/systems?limit=10';
const many = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => ({ id: `0190a0b0-0000-7000-8000-0000000002${String(from + index).padStart(2, '0')}`, name: `Sistema ${from + index + 1}`, edition: null, description: null, version: 0 }));

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
    const server = await useBackend({ [SYSTEMS]: { status: 200, body: { items: [DND, UNTITLED], total: 2 } } });
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
      // A single page: how many there are, and no pager.
      expect(html).toContain(language === 'en' ? '2 items' : '2 itens');
      expect(html).not.toContain(`aria-label="${messages.paging.label}"`);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([SYSTEMS, SYSTEMS]);
    for (const call of server.calls) {
      expect(call.headers['x-session-token']).toBe(SESSION);
      expect(call.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
    }
  });

  it('empty: one sentence says what a system holds, and "Novo sistema" is the only action', async () => {
    await useBackend({ [SYSTEMS]: EMPTY });
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

  it('a long list is paged: ten rows, the rows shown of the total, and links to every page; a list that cannot be loaded says why', async () => {
    const all = many(23);
    const routes: Record<string, { status: number; body: unknown }> = {
      // One call a page: the backend skips `offset` rows and names the list's total.
      [SYSTEMS]: { status: 200, body: { items: all.slice(0, 10), nextCursor: all[9]!.id, total: 23 } },
      [`${SYSTEMS}&offset=20`]: { status: 200, body: { items: all.slice(20), total: 23 } },
      [`${SYSTEMS}&offset=980`]: { status: 200, body: { items: [], total: 23 } },
    };
    const server = await useBackend(routes);
    const rows = (html: string) => [...html.matchAll(/href="\/systems\/(0190a0b0[^"]+)"/g)].map((match) => match[1]);
    const page = async (number?: string) => renderToStaticMarkup(await SystemsPage({ searchParams: Promise.resolve(number === undefined ? {} : { page: number }) }));

    let html = await page();
    expect(rows(html)).toEqual(all.slice(0, 10).map((system) => system.id));
    expect(html).toContain('1–10 de 23');
    expect(html).toContain('aria-label="Paginação"');
    // The current page says so, the others are links, and "Anterior" leads nowhere on the first page.
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>1<\/a>/);
    expect(linkTo(html, '/systems?page=2')).toContain('rel="next"');
    expect(linkTo(html, '/systems?page=3')).toContain('aria-label="Página 3"');
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*>.*?Anterior/s);
    expect(html).not.toContain('Carregar mais');
    // The first page sends no offset, and one call is the whole read.
    expect(server.calls.map((call) => call.url)).toEqual(['/api/v1/systems?limit=10']);

    html = await page('3');
    expect(rows(html)).toEqual(all.slice(20).map((system) => system.id));
    expect(html).toContain('21–23 de 23');
    expect(linkTo(html, '/systems?page=2')).toContain('rel="prev"');
    // The first page has no `page` field, so it has one address.
    expect(linkTo(html, '/systems')).toContain('aria-label="Página 1"');
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*>.*?Próxima/s);
    expect(server.calls.at(-1)!.url).toBe('/api/v1/systems?limit=10&offset=20');
    // A page past the end (rows were deleted since the link was made) is asked again as the last one.
    const before = server.calls.length;
    expect(rows(await page('99'))).toEqual(all.slice(20).map((system) => system.id));
    expect(server.calls.slice(before).map((call) => call.url)).toEqual(['/api/v1/systems?limit=10&offset=980', '/api/v1/systems?limit=10&offset=20']);
    // Anything that is not a page number is the first page.
    for (const junk of ['0', '-1', '2.5', 'x', '02']) {
      expect(rows(await page(junk)), junk).toEqual(all.slice(0, 10).map((system) => system.id));
    }

    routes[SYSTEMS] = problem(503, 'server.unavailable');
    html = await page();
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    expect(solids(html)).toEqual(['Novo sistema']);
  });

  it('the view decides how many rows a page holds, and the pager is in English too', async () => {
    const all = many(23);
    const server = await useBackend({ 'GET /api/v1/systems?limit=20': { status: 200, body: { items: all.slice(0, 20), total: 23 } } });
    cookieJar['__Host-gmshield-view'] = 'systems:list:comfortable:1:20';
    cookieJar['__Host-gmshield-lang'] = 'en';
    const html = renderToStaticMarkup(await SystemsPage());
    expect([...html.matchAll(/href="\/systems\/0190a0b0/g)]).toHaveLength(20);
    expect(html).toContain('1–20 of 23');
    expect(html).toContain('aria-label="Pagination"');
    expect(html).toContain('aria-label="Page 2"');
    expect(html).not.toContain('aria-label="Page 3"');
    // The rows a page holds are what the backend is asked for.
    expect(server.calls.map((call) => call.url)).toEqual(['/api/v1/systems?limit=20']);
    for (const messages of [ptBR, en]) {
      expect(JSON.stringify(messages.paging)).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
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
      expect([...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes('name="name"'))).toContain(
        'aria-required="true"',
      );
      expect(html).not.toMatch(/maxlength/i);
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
  const campaigns = { status: 200, body: { items: [{ id: CAMPAIGN, name: 'A Coroa Partida' }], total: 1 } };
  // Story 3.3: each material says where it belongs: this system alone, one of its campaigns, or several systems.
  const material = { id: MATERIAL, name: 'SRD 5.2.1.pdf', state: 'ready', actions: [], version: 0, belonging: { campaign: null, systems: [{ id: ID, name: 'D&D' }] } };
  const materials = {
    status: 200,
    body: {
      items: [
        material,
        {
          ...material,
          id: OTHER,
          name: 'Notas.md',
          belonging: { campaign: { id: CAMPAIGN, name: 'A Coroa Partida', system: { id: ID, name: 'D&D' } }, systems: [] },
        },
        {
          ...material,
          id: STARTER,
          name: 'Bestiário.pdf',
          belonging: { campaign: null, systems: [{ id: ID, name: 'D&D' }, { id: STARTER, name: 'Pathfinder' }] },
        },
      ],
      total: 3,
    },
  };

  it('shows the name, edition and description, "Editar", and the campaigns tab by default, in both languages', async () => {
    const server = await useBackend({ [`GET /api/v1/systems/${ID}`]: { status: 200, body: DND }, [`GET /api/v1/campaigns?system=${ID}&limit=10`]: campaigns });
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
      // Story 3.2: a campaign row opens the campaign's page.
      expect(html).toContain('A Coroa Partida');
      expect(html).toContain(`href="/campaigns/${CAMPAIGN}"`);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    // The counts of the delete's dialog are read with the tab's list; here the backend has none, so they are left out.
    expect(server.calls.map((call) => call.url).sort()).toEqual(
      [`/api/v1/systems/${ID}`, `/api/v1/campaigns?system=${ID}&limit=10`, `/api/v1/systems/${ID}/deletion`].flatMap((url) => [url, url]).sort(),
    );
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
    // Story 3.3: each row names its place.
    expect(html).toMatch(/SRD 5\.2\.1\.pdf<\/span>.*?<span[^>]*>Sistema<\/span>/s);
    expect(html).toContain('>Campanha A Coroa Partida</span>');
    expect(html).toContain('>D&amp;D e Pathfinder</span>');
  });

  it('an empty tab says so in one sentence, in both languages; a system with no edition or description shows neither', async () => {
    await useBackend({
      [`GET /api/v1/systems/${STARTER}`]: { status: 200, body: UNTITLED },
      [`GET /api/v1/campaigns?system=${STARTER}&limit=10`]: EMPTY,
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

  it('each tab is paged on its own, and its page links keep the tab', async () => {
    const twelve = Array.from({ length: 12 }, (_, index) => ({ id: `0190a0b0-0000-7000-8000-0000000003${String(index).padStart(2, '0')}`, name: `Mesa ${index + 1}` }));
    const CAMPAIGNS = `GET /api/v1/campaigns?system=${ID}&limit=10`;
    const server = await useBackend({
      [`GET /api/v1/systems/${ID}`]: { status: 200, body: DND },
      [CAMPAIGNS]: { status: 200, body: { items: twelve.slice(0, 10), nextCursor: twelve[9]!.id, total: 12 } },
      [`${CAMPAIGNS}&offset=10`]: { status: 200, body: { items: twelve.slice(10), total: 12 } },
      [SYSTEM_MATERIALS]: materials,
      [`${SYSTEM_MATERIALS}&offset=10`]: { status: 200, body: { items: [], total: 3 } },
    });
    const paged = (tab: string, page?: string) => Promise.resolve(page === undefined ? { tab } : { tab, page });
    let html = renderToStaticMarkup(await SystemPage({ params: params(ID), searchParams: paged('campaigns') }));
    expect(html).toContain('1–10 de 12');
    expect(html).toContain('Mesa 10');
    expect(html).not.toContain('Mesa 11');
    expect(linkTo(html, `/systems/${ID}?tab=campaigns&amp;page=2`)).toContain('rel="next"');
    html = renderToStaticMarkup(await SystemPage({ params: params(ID), searchParams: paged('campaigns', '2') }));
    expect(html).toContain('11–12 de 12');
    expect(html).toContain('Mesa 12');
    expect(html).not.toContain('Mesa 10<');
    expect(linkTo(html, `/systems/${ID}?tab=campaigns`)).toBeTruthy();
    // The system goes with the page's size and start.
    expect(server.calls.map((call) => call.url)).toContain(`/api/v1/campaigns?system=${ID}&limit=10&offset=10`);
    // The materials tab starts from its own first page: three materials are one page, with their count and no pager.
    html = renderToStaticMarkup(await SystemPage({ params: params(ID), searchParams: paged('materials', '2') }));
    expect(html).toContain('3 itens');
    expect(html).toContain('SRD 5.2.1.pdf');
    expect(html).not.toContain('aria-label="Paginação"');
  });
});

describe('deleting a system (Story 3.1 part B)', () => {
  const counts = { status: 200, body: { campaigns: 2, conversations: 3, materials: 1 } };

  it('"Excluir" is a danger pill next to "Editar", and its closed confirmation names the counts, in both languages', async () => {
    await useBackend({
      [`GET /api/v1/systems/${ID}`]: { status: 200, body: DND },
      [`GET /api/v1/campaigns?system=${ID}&limit=10`]: EMPTY,
      [`GET /api/v1/systems/${ID}/deletion`]: counts,
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await SystemPage({ params: params(ID), searchParams: query() }));

      expect(solids(html)).toEqual([messages.systems.page.edit]);
      expect(html).toMatch(new RegExp(`<button[^>]*data-variant="danger"[^>]*>${messages.systems.page.delete}</button>`));
      expect(html.indexOf(messages.systems.page.edit)).toBeLessThan(html.indexOf(`>${messages.systems.page.delete}<`));
      expect(html).toContain(messages.systems.delete.title);
      expect(html).toContain(
        language === 'en'
          ? 'Going with it: 2 campaigns, 3 conversations and 1 material linked only to it. This cannot be undone.'
          : 'Vão junto: 2 campanhas, 3 conversas e 1 material ligado só a ele. Isso não pode ser desfeito.',
      );
      expect(html).toContain(`>${messages.systems.delete.confirm}</button>`);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(ptBR.systems.delete.consequence).toBe('Vão junto: {campaigns}, {conversations} e {materials}. Isso não pode ser desfeito.');
    for (const messages of [ptBR, en]) {
      expect(JSON.stringify(messages.systems.delete)).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
  });

  it('without the counts the confirmation names what goes in words', async () => {
    await useBackend({
      [`GET /api/v1/systems/${ID}`]: { status: 200, body: DND },
      [`GET /api/v1/campaigns?system=${ID}&limit=10`]: EMPTY,
      [`GET /api/v1/systems/${ID}/deletion`]: problem(503, 'service.unavailable'),
    });
    const html = renderToStaticMarkup(await SystemPage({ params: params(ID), searchParams: query() }));
    expect(html).toContain(ptBR.systems.delete.unknown);
    expect(html).toContain(`>${ptBR.systems.page.delete}</button>`);
  });

  it('"Excluir sistema" deletes and opens the list of systems; a refusal comes back as its text; a bad id is never sent', async () => {
    const routes: Record<string, { status: number; body?: unknown }> = {
      [`DELETE /api/v1/systems/${ID}`]: { status: 202 },
    };
    const server = await useBackend(routes);

    expect(await thrownDigest(() => deleteSystemAction({ error: null }, form({ id: ID })))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/systems;/);
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([`DELETE /api/v1/systems/${ID}`]);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);

    // Twice, or another owner's: not found, said in words.
    routes[`DELETE /api/v1/systems/${ID}`] = problem(404, 'request.not_found');
    expect(await deleteSystemAction({ error: null }, form({ id: ID }))).toEqual({ error: 'Não encontrado.' });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await deleteSystemAction({ error: null }, form({ id: ID }))).toEqual({ error: 'Not found.' });

    const calls = server.calls.length;
    for (const fields of [{ id: '../me' }, {}] as Record<string, string>[]) {
      expect(await deleteSystemAction({ error: null }, form(fields))).toEqual({ error: 'The request is not valid.' });
    }
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
    // A textarea's CRLF line breaks go as LF.
    routes[`PATCH /api/v1/systems/${ID}`] = { status: 200, body: DND };
    await thrownDigest(() => changeSystemAction(previous, form({ ...typed, description: 'Uma.\r\nDuas.\r\n' })));
    expect(JSON.parse(server.calls.at(-1)!.body).description).toBe('Uma.\nDuas.\n');
    // A malformed id or version (past 15 digits, no longer a safe integer) never reaches the backend.
    const calls = server.calls.length;
    for (const fields of [{ ...typed, id: '../me' }, { ...typed, version: '-1' }, { ...typed, version: 'x' }, { ...typed, version: '9'.repeat(16) }]) {
      expect((await changeSystemAction(previous, form(fields))).error).toBe('The request is not valid.');
    }
    expect(server.calls).toHaveLength(calls);
  });
});
