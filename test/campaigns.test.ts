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
const refresh = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ refresh: () => refresh(), revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: CampaignsPage } = await import('@/app/(signed-in)/campaigns/page');
const { default: NewCampaignPage } = await import('@/app/(signed-in)/campaigns/new/page');
const { default: CampaignPage } = await import('@/app/(signed-in)/campaigns/[id]/page');
const { default: RenameCampaignPage } = await import('@/app/(signed-in)/campaigns/[id]/edit/page');
const { archiveCampaignAction, chooseCampaignAction, createCampaignAction, moreCampaignsAction, openConversationAction, renameCampaignAction } =
  await import('@/app/(signed-in)/campaigns/actions');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const STARTER_SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const STARTER = '0190a0b0-0000-7000-8000-000000000002';
const DND_ID = '0190a0b0-0000-7000-8000-000000000030';
const ID = '0190a0b0-0000-7000-8000-000000000040';
const OTHER = '0190a0b0-0000-7000-8000-000000000041';
const CONVERSATION = '0190a0b0-0000-7000-8000-000000000020';
const UNTITLED = { id: STARTER_SYSTEM, name: 'Sistema sem nome', edition: null, description: null, version: 0 };
const DND = { id: DND_ID, name: 'D&D', edition: '5.2.1', description: null, version: 0 };
const THURSDAY = { id: ID, name: 'Mesa de quinta', system: DND, archived: false, version: 2 };
const FIRST = { id: STARTER, name: 'Primeira campanha', system: UNTITLED, archived: false, version: 0 };
const ROW = { id: ID, name: 'Mesa de quinta', system: { id: DND_ID, name: 'D&D', edition: '5.2.1' }, archived: false };
const STARTER_ROW = { id: STARTER, name: 'Primeira campanha', system: { id: STARTER_SYSTEM, name: 'Sistema sem nome', edition: null }, archived: false };
const EMPTY = { status: 200, body: { items: [] } };
const START = { error: null, done: 0 };

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
const query = (values: Record<string, string> = {}) => Promise.resolve(values);
/** The opening tag of the link to `href`, whatever its attributes' order; '' when there is none. */
const linkTo = (html: string, href: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`href="${href}"`)) ?? '';
/** The solid pills of a page: links or buttons whose variant is solid. */
const solids = (html: string) => [...html.matchAll(/<(a|button)[^>]*data-variant="solid"[^>]*>(.*?)<\/\1>/g)].map((match) => match[2]);
const calls = (server: Scripted) => server.calls.map((call) => `${call.method} ${call.url}`);

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
  refresh.mockClear();
  revalidatePath.mockClear();
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('Minhas Mesas (Story 3.2)', () => {
  it('lists the campaigns in use with their system, each opening its page, under one solid "Nova campanha", in both languages', async () => {
    const server = await useBackend({ 'GET /api/v1/campaigns?archived=false': { status: 200, body: { items: [ROW, STARTER_ROW] } } });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignsPage({ searchParams: query() }));

      expect(html).toMatch(new RegExp(`<h1[^>]*>${messages.shell.entries.campaigns}</h1>`));
      expect(solids(html)).toEqual([messages.campaigns.new]);
      expect(linkTo(html, '/campaigns/new')).toContain('data-variant="solid"');
      // The filter: in use (current here) and archived.
      expect(html).toContain(`aria-label="${messages.campaigns.filters}"`);
      expect(linkTo(html, '/campaigns')).toContain('aria-current="page"');
      expect(linkTo(html, '/campaigns?archived=true')).not.toContain('aria-current');
      expect(html).toContain(`>${messages.campaigns.archived}</a>`);
      expect(html).toContain(`aria-label="${messages.campaigns.list}"`);
      expect(html).toContain(`href="/campaigns/${ID}"`);
      expect(html).toContain(`href="/campaigns/${STARTER}"`);
      expect(html).toContain('Mesa de quinta');
      expect(html).toContain('D&amp;D 5.2.1');
      expect(html).toContain('Sistema sem nome');
      expect(html.indexOf('Mesa de quinta')).toBeLessThan(html.indexOf('Primeira campanha'));
      expect(html).not.toContain(messages.campaigns.loadMore);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server)).toEqual(['GET /api/v1/campaigns?archived=false', 'GET /api/v1/campaigns?archived=false']);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    for (const messages of [ptBR, en]) {
      expect(JSON.stringify(messages.campaigns)).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
  });

  it('"Arquivadas" lists the archived campaigns; each filter has its own empty sentence', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/campaigns?archived=true': { status: 200, body: { items: [{ ...ROW, archived: true }] } },
      'GET /api/v1/campaigns?archived=false': EMPTY,
    };
    await useBackend(routes);
    let html = renderToStaticMarkup(await CampaignsPage({ searchParams: query({ archived: 'true' }) }));
    expect(linkTo(html, '/campaigns?archived=true')).toContain('aria-current="page"');
    expect(linkTo(html, '/campaigns')).not.toContain('aria-current');
    expect(html).toContain('aria-label="Campanhas arquivadas"');
    expect(html).toContain(`href="/campaigns/${ID}"`);

    html = renderToStaticMarkup(await CampaignsPage({ searchParams: query() }));
    expect(html).toContain(ptBR.campaigns.empty);
    expect(html).not.toContain('<ul aria-label');
    expect(solids(html)).toEqual(['Nova campanha']);
    routes['GET /api/v1/campaigns?archived=true'] = EMPTY;
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = renderToStaticMarkup(await CampaignsPage({ searchParams: query({ archived: 'true' }) }));
    expect(html).toContain('No archived campaign.');
    expect(ptBR.campaigns.empty).toBe('Uma campanha reúne as conversas e os materiais de uma mesa de jogo.');
  });

  it('"Carregar mais" posts the cursor and the filter, and appends the next page; a refusal keeps the rows', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/campaigns?archived=false': { status: 200, body: { items: [ROW], nextCursor: ID } },
      [`GET /api/v1/campaigns?archived=false&cursor=${ID}`]: { status: 200, body: { items: [STARTER_ROW] } },
      [`GET /api/v1/campaigns?archived=true&cursor=${ID}`]: problem(503, 'server.unavailable'),
    };
    const server = await useBackend(routes);
    const html = renderToStaticMarkup(await CampaignsPage({ searchParams: query() }));
    expect(html).toContain('Carregar mais');
    expect(html).toContain(`name="cursor" value="${ID}"`);
    expect(html).toContain('name="archived" value="false"');

    const start = { rows: [], nextCursor: ID, error: null, added: 0 };
    const state = await moreCampaignsAction(start, form({ cursor: ID, archived: 'false' }));
    expect(state).toEqual({
      rows: [{ id: STARTER, label: 'Primeira campanha', detail: 'Sistema sem nome', href: `/campaigns/${STARTER}`, state: null }],
      nextCursor: null,
      error: null,
      added: 1,
    });
    const refused = await moreCampaignsAction(state, form({ cursor: ID, archived: 'true' }));
    expect(refused.rows).toEqual(state.rows);
    expect(refused.error).toBe('O serviço está indisponível agora. Tente de novo em instantes.');
    const count = server.calls.length;
    for (const fields of [{ cursor: '../me', archived: 'false' }, { cursor: ID, archived: 'yes' }, { cursor: ID }]) {
      expect((await moreCampaignsAction(state, form(fields as Record<string, string>))).error).toBe('O pedido não é válido.');
    }
    expect(server.calls).toHaveLength(count);
  });
});

describe('a new campaign (Story 3.2)', () => {
  it('is a form page with the name and the system, the newest first unless ?system= chooses one, in both languages', async () => {
    const server = await useBackend({ 'GET /api/v1/systems?limit=50': { status: 200, body: { items: [DND, UNTITLED] } } });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await NewCampaignPage({ searchParams: query() }));

      expect(html).toContain(messages.campaigns.form.newTitle);
      expect(html).toContain(`>${messages.campaigns.form.name}</label>`);
      expect(html).toContain(`>${messages.campaigns.form.system}</label>`);
      expect(html).toMatch(/<input[^>]*name="name"[^>]*aria-required="true"|<input[^>]*aria-required="true"[^>]*name="name"/);
      expect(html).toMatch(/<select[^>]*name="systemId"/);
      expect(html).toMatch(new RegExp(`<option value="${DND_ID}" selected="">D&amp;D 5.2.1</option>`));
      expect(html).toContain(`<option value="${STARTER_SYSTEM}">Sistema sem nome</option>`);
      expect(solids(html)).toEqual([messages.campaigns.form.create]);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/campaigns"[^>]*>${messages.campaigns.form.cancel}</a>`));
      expect(html).not.toMatch(/maxlength/i);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    // The system page's "?system=" chooses it; an id that is not one of them is ignored.
    let html = renderToStaticMarkup(await NewCampaignPage({ searchParams: query({ system: STARTER_SYSTEM }) }));
    expect(html).toContain(`<option value="${STARTER_SYSTEM}" selected="">Sistema sem nome</option>`);
    html = renderToStaticMarkup(await NewCampaignPage({ searchParams: query({ system: OTHER }) }));
    expect(html).toContain(`<option value="${DND_ID}" selected="">`);
    expect(calls(server).every((call) => call === 'GET /api/v1/systems?limit=50')).toBe(true);
  });

  it('with no system, one sentence and a link to a new system, in both languages', async () => {
    await useBackend({ 'GET /api/v1/systems?limit=50': EMPTY });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await NewCampaignPage({ searchParams: query() }));
      expect(html).toContain(messages.campaigns.form.noSystem);
      expect(linkTo(html, '/systems/new')).toBeTruthy();
      expect(html).toContain(`>${messages.campaigns.form.createSystem}</a>`);
      expect(html).not.toContain('<form');
    }
  });

  it('sends the name and the system and opens the new campaign\'s page; a refusal comes back under its field', async () => {
    const routes: Record<string, { status: number; body: unknown }> = { 'POST /api/v1/campaigns': { status: 201, body: THURSDAY } };
    const server = await useBackend(routes);
    const typed = { name: ' Mesa de quinta ', systemId: DND_ID };
    const initial = { values: { name: '', systemId: DND_ID }, version: null, error: null, field: null, stale: false };

    expect(await thrownDigest(() => createCampaignAction(initial, form(typed)))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${ID};`));
    // The shared layout (switcher, context bar) is rendered again with the new current campaign or name.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    revalidatePath.mockClear();
    expect(JSON.parse(server.calls[0]!.body)).toEqual(typed);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);

    // Matrix row "Duplicate name".
    routes['POST /api/v1/campaigns'] = problem(409, 'request.campaign_name_taken');
    expect(await createCampaignAction(initial, form(typed))).toEqual({
      values: typed,
      version: null,
      error: 'Este sistema já tem uma campanha com este nome, talvez arquivada.',
      field: 'name',
      stale: false,
    });
    // Matrix row "Invalid name": its limits, under the name.
    routes['POST /api/v1/campaigns'] = problem(400, 'request.campaign_name_invalid', { min: 1, max: 120 });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await createCampaignAction(initial, form({ ...typed, name: '  ' }))).toMatchObject({
      error: 'The name needs 1 to 120 characters.',
      field: 'name',
    });
    // A system gone meanwhile is said under its choice.
    routes['POST /api/v1/campaigns'] = problem(404, 'request.not_found');
    expect(await createCampaignAction(initial, form(typed))).toMatchObject({ error: 'Not found.', field: 'systemId' });
    routes['POST /api/v1/campaigns'] = problem(503, 'server.unavailable');
    expect(await createCampaignAction(initial, form(typed))).toMatchObject({ field: null });
    // A malformed system never reaches the backend.
    const count = server.calls.length;
    expect(await createCampaignAction(initial, form({ ...typed, systemId: '../x' }))).toMatchObject({
      error: 'The request is not valid.',
      field: 'systemId',
    });
    expect(server.calls).toHaveLength(count);
  });
});

describe('a campaign page (Story 3.2)', () => {
  const current = (campaign: unknown) => ({ status: 200, body: campaign });

  it('shows the name, "Usar esta campanha", "Renomear", "Arquivar" and the overview tab by default, in both languages', async () => {
    const server = await useBackend({ [`GET /api/v1/campaigns/${ID}`]: current(THURSDAY), 'GET /api/v1/campaigns/current': current(FIRST) });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query() }));

      expect(html).toMatch(/<h1[^>]*>Mesa de quinta<\/h1>/);
      expect(solids(html)).toEqual([messages.campaigns.page.use]);
      expect(html).toContain(`name="id" value="${ID}"`);
      expect(linkTo(html, `/campaigns/${ID}/edit`)).toContain('data-variant="default"');
      expect(html).toContain(`>${messages.campaigns.page.rename}</a>`);
      expect(html).toMatch(new RegExp(`<button[^>]*>${messages.campaigns.page.archive}</button>`));
      expect(html).toContain('name="version" value="2"');
      expect(html).toContain('name="archived" value="true"');
      // The tabs, overview current; its name and its system, which links to the system's page.
      expect(html).toContain(`aria-label="${messages.campaigns.page.sections}"`);
      expect(linkTo(html, `/campaigns/${ID}?tab=overview`)).toContain('aria-current="page"');
      expect(linkTo(html, `/campaigns/${ID}?tab=scope`)).not.toContain('aria-current');
      expect(linkTo(html, `/campaigns/${ID}?tab=conversations`)).not.toContain('aria-current');
      expect(html).toMatch(new RegExp(`<a[^>]*href="/systems/${DND_ID}"[^>]*>D&amp;D 5.2.1</a>`));
      expect(html).not.toContain(messages.campaigns.page.archived);
      expect(html).not.toContain(messages.campaigns.page.isCurrent);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server).sort()).toEqual(
      [`GET /api/v1/campaigns/${ID}`, 'GET /api/v1/campaigns/current'].flatMap((call) => [call, call]).sort(),
    );
  });

  it('the current campaign says so and offers no "Usar"; an archived one says "Arquivada" and offers "Restaurar"', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`GET /api/v1/campaigns/${ID}`]: current(THURSDAY),
      'GET /api/v1/campaigns/current': current(THURSDAY),
    };
    await useBackend(routes);
    let html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query() }));
    expect(html).toContain(ptBR.campaigns.page.isCurrent);
    expect(html).not.toContain(ptBR.campaigns.page.use);
    expect(solids(html)).toEqual([]);

    routes[`GET /api/v1/campaigns/${ID}`] = current({ ...THURSDAY, archived: true, version: 3 });
    routes['GET /api/v1/campaigns/current'] = current(FIRST);
    html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query() }));
    expect(html).toContain('Arquivada');
    expect(html).toMatch(/<button[^>]*>Restaurar<\/button>/);
    expect(html).toContain('name="archived" value="false"');
    expect(html).toContain('name="version" value="3"');
    expect(html).not.toContain(ptBR.campaigns.page.use);
    // With no current campaign at all, the page still opens.
    routes['GET /api/v1/campaigns/current'] = problem(404, 'request.not_found');
    expect(renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query() }))).toContain('Mesa de quinta');
  });

  it('the scope tab says the four settings in words, read-only, in both languages', async () => {
    await useBackend({ [`GET /api/v1/campaigns/${ID}`]: current(THURSDAY), 'GET /api/v1/campaigns/current': current(FIRST) });
    let html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'scope' }) }));
    expect(linkTo(html, `/campaigns/${ID}?tab=scope`)).toContain('aria-current="page"');
    expect(html).toContain('Campanha: ligada · Sistema: ligado · Outros: desligado · Conhecimento do modelo: desligado');
    expect(html).not.toMatch(/<(input|select)\b(?![^>]*type="hidden")/);
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'scope' }) }));
    expect(html).toContain('Campaign: on · System: on · Others: off · Model knowledge: off');
  });

  it('the conversations tab shows its conversation\'s questions and "Abrir", or one sentence when there is none', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`GET /api/v1/campaigns/${ID}`]: current(THURSDAY),
      'GET /api/v1/campaigns/current': current(FIRST),
      [`GET /api/v1/campaigns/${ID}/conversation`]: { status: 200, body: { id: CONVERSATION, questions: 3 } },
    };
    const server = await useBackend(routes);
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'conversations' }) }));
      expect(linkTo(html, `/campaigns/${ID}?tab=conversations`)).toContain('aria-current="page"');
      expect(html).toContain(`aria-label="${messages.campaigns.page.conversationList}"`);
      expect(html).toContain(messages.shell.entries.questions);
      expect(html).toContain(language === 'en' ? '3 questions' : '3 perguntas');
      expect(html).toMatch(new RegExp(`<button[^>]*>${messages.campaigns.page.open}</button>`));
    }
    expect(calls(server)).toContain(`GET /api/v1/campaigns/${ID}/conversation`);
    routes[`GET /api/v1/campaigns/${ID}/conversation`] = { status: 200, body: { id: CONVERSATION, questions: 1 } };
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    expect(renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'conversations' }) }))).toContain('1 pergunta<');
    // An archived campaign's conversation shows, with no "Abrir" (it cannot become current) but a sentence in its place.
    routes[`GET /api/v1/campaigns/${ID}`] = current({ ...THURSDAY, archived: true });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const archived = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'conversations' }) }));
      expect(archived).not.toContain(`>${messages.campaigns.page.open}</button>`);
      expect(archived).toContain(messages.campaigns.page.restoreToOpen);
    }
    expect(ptBR.campaigns.page.restoreToOpen).toBe('Restaure a campanha para abrir a conversa.');
    expect(en.campaigns.page.restoreToOpen).toBe('Restore the campaign to open the conversation.');
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    routes[`GET /api/v1/campaigns/${ID}/conversation`] = problem(404, 'request.not_found');
    const html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'conversations' }) }));
    expect(html).toContain('Esta campanha ainda não tem conversas.');
  });

  it('another owner\'s campaign, an unknown one or a malformed id is the single not-found page', async () => {
    await useBackend({ [`GET /api/v1/campaigns/${OTHER}`]: problem(404, 'request.not_found') });
    for (const id of [OTHER, 'not-a-uuid']) {
      expect(await thrownDigest(() => CampaignPage({ params: params(id), searchParams: query() }))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
      expect(await thrownDigest(() => RenameCampaignPage({ params: params(id) }))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    }
  });
});

describe('a campaign\'s actions (Story 3.2)', () => {
  it('"Usar esta campanha" makes it current and refreshes; an archived one is refused in words', async () => {
    const routes: Record<string, { status: number; body: unknown }> = { 'PUT /api/v1/campaigns/current': { status: 200, body: THURSDAY } };
    const server = await useBackend(routes);

    expect(await chooseCampaignAction(START, form({ id: ID }))).toEqual({ error: null, done: 1 });
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ campaignId: ID });
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Matrix row "Switch to archived".
    routes['PUT /api/v1/campaigns/current'] = problem(404, 'request.not_found');
    expect(await chooseCampaignAction({ error: null, done: 1 }, form({ id: ID }))).toEqual({ error: 'Não encontrado.', done: 1 });
    const count = server.calls.length;
    expect((await chooseCampaignAction(START, form({ id: '../x' }))).error).toBe('O pedido não é válido.');
    expect(server.calls).toHaveLength(count);
  });

  it('"Arquivar" and "Restaurar" send the version and refresh; a stale one says it changed elsewhere', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`PATCH /api/v1/campaigns/${ID}`]: { status: 200, body: { ...THURSDAY, archived: true, version: 3 } },
    };
    const server = await useBackend(routes);

    expect(await archiveCampaignAction(START, form({ id: ID, version: '2', archived: 'true' }))).toEqual({ error: null, done: 1 });
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ version: 2, archived: true });
    await archiveCampaignAction(START, form({ id: ID, version: '3', archived: 'false' }));
    expect(JSON.parse(server.calls[1]!.body)).toEqual({ version: 3, archived: false });
    expect(refresh).toHaveBeenCalledTimes(2);

    routes[`PATCH /api/v1/campaigns/${ID}`] = problem(409, 'request.stale_version');
    expect((await archiveCampaignAction(START, form({ id: ID, version: '2', archived: 'true' }))).error).toBe(
      'Isto foi alterado em outro lugar. Recarregue a página para ver a versão atual.',
    );
    expect(refresh).toHaveBeenCalledTimes(3);
    const count = server.calls.length;
    for (const fields of [{ id: ID, version: 'x', archived: 'true' }, { id: ID, version: '2', archived: 'maybe' }, { id: '../x', version: '2', archived: 'true' }]) {
      expect((await archiveCampaignAction(START, form(fields))).error).toBe('O pedido não é válido.');
    }
    expect(server.calls).toHaveLength(count);
  });

  it('"Abrir" makes the campaign current and opens Consultas', async () => {
    const routes: Record<string, { status: number; body: unknown }> = { 'PUT /api/v1/campaigns/current': { status: 200, body: THURSDAY } };
    const server = await useBackend(routes);
    expect(await thrownDigest(() => openConversationAction(START, form({ id: ID })))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/questions;/);
    // The shared layout (switcher, context bar) is rendered again with the new current campaign or name.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    revalidatePath.mockClear();
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ campaignId: ID });
    routes['PUT /api/v1/campaigns/current'] = problem(404, 'request.not_found');
    expect(await openConversationAction(START, form({ id: ID }))).toEqual({ error: 'Não encontrado.', done: 0 });
  });
});

describe('a campaign\'s rename page (Story 3.2)', () => {
  it('starts from the campaign\'s name and version, with one solid "Salvar" and no system choice, in both languages', async () => {
    await useBackend({ [`GET /api/v1/campaigns/${ID}`]: { status: 200, body: THURSDAY } });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await RenameCampaignPage({ params: params(ID) }));

      expect(html).toContain(messages.campaigns.form.renameTitle);
      expect(html).toMatch(/<input[^>]*value="Mesa de quinta"/);
      expect(html).toContain(`name="id" value="${ID}"`);
      expect(html).toContain('name="version" value="2"');
      expect(html).not.toContain('<select');
      expect(solids(html)).toEqual([messages.campaigns.form.save]);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/campaigns/${ID}"[^>]*>${messages.campaigns.form.cancel}</a>`));
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
  });

  it('sends the name with the version and opens the campaign\'s page; a stale version brings the current name', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`PATCH /api/v1/campaigns/${ID}`]: { status: 200, body: { ...THURSDAY, name: 'Mesa de sexta', version: 3 } },
    };
    const server = await useBackend(routes);
    const previous = { values: { name: 'Mesa de quinta', systemId: '' }, version: 2, error: null, field: null, stale: false };
    const typed = { id: ID, version: '2', name: 'Mesa de sexta' };

    expect(await thrownDigest(() => renameCampaignAction(previous, form(typed)))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${ID};`));
    // The shared layout (switcher, context bar) is rendered again with the new current campaign or name.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    revalidatePath.mockClear();
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ version: 2, name: 'Mesa de sexta' });

    // Matrix row "Stale rename": the page says it changed elsewhere and shows the current name.
    routes[`PATCH /api/v1/campaigns/${ID}`] = problem(409, 'request.stale_version');
    routes[`GET /api/v1/campaigns/${ID}`] = { status: 200, body: { ...THURSDAY, name: 'Mesa de domingo', version: 5 } };
    expect(await renameCampaignAction(previous, form(typed))).toEqual({
      values: { name: 'Mesa de domingo', systemId: '' },
      version: 5,
      error: ptBR.campaigns.form.stale,
      field: null,
      stale: true,
    });
    routes[`PATCH /api/v1/campaigns/${ID}`] = problem(409, 'request.campaign_name_taken');
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await renameCampaignAction(previous, form(typed))).toMatchObject({
      error: 'This system already has a campaign with this name, perhaps an archived one.',
      field: 'name',
      version: 2,
    });
    const count = server.calls.length;
    for (const fields of [{ ...typed, id: '../me' }, { ...typed, version: '-1' }, { ...typed, version: '9'.repeat(16) }]) {
      expect((await renameCampaignAction(previous, form(fields))).error).toBe('The request is not valid.');
    }
    expect(server.calls).toHaveLength(count);
  });
});
