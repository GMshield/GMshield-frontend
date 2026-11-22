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
const {
  archiveCampaignAction,
  changeScopeAction,
  chooseCampaignAction,
  createCampaignAction,
  deleteCampaignAction,
  openConversationAction,
  renameCampaignAction,
} = await import('@/app/(signed-in)/campaigns/actions');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;
const { startScripted } = await import('./support/servers');
type ScopeFormState = import('@/components/ScopeControls').ScopeFormState;
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
const EMPTY = { status: 200, body: { items: [], total: 0 } };
/** Story 3.6: a campaign's scope as the backend answers it, with one material of its own, two of its system, one other. */
const NOTES = '0190a0b0-0000-7000-8000-000000000052';
const BOOK = '0190a0b0-0000-7000-8000-000000000003';
const BESTIARY = '0190a0b0-0000-7000-8000-000000000051';
const ATLAS = '0190a0b0-0000-7000-8000-000000000057';
const SCOPE = {
  version: 4,
  campaignTier: true,
  systemTier: true,
  otherTier: false,
  modelKnowledge: false,
  materials: [
    { id: NOTES, name: 'Notas da sessão 12.md', tier: 'campaign' as const, on: true },
    { id: BOOK, name: 'Livro do Jogador.pdf', tier: 'system' as const, on: true },
    { id: BESTIARY, name: 'Bestiário.pdf', tier: 'system' as const, on: false },
    { id: ATLAS, name: 'Atlas de outra mesa.pdf', tier: 'other' as const, on: true },
  ],
};
const NO_SCOPE_ANSWER: ScopeFormState = { scope: null, error: null, saved: false };
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
/** Every switch of a page, in order: its name and `aria-checked`. */
const switchesOf = (html: string) =>
  [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((match) => [
    /aria-label="([^"]*)"/.exec(match[0])?.[1] ?? '',
    /aria-checked="([^"]*)"/.exec(match[0])?.[1] ?? '',
  ]);

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
    const server = await useBackend({ 'GET /api/v1/campaigns?archived=false&limit=10': { status: 200, body: { items: [ROW, STARTER_ROW], total: 2 } } });
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
      // One page: how many there are, and no pager.
      expect(html).toContain(language === 'en' ? '2 items' : '2 itens');
      expect(html).not.toContain(`aria-label="${messages.paging.label}"`);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server)).toEqual(['GET /api/v1/campaigns?archived=false&limit=10', 'GET /api/v1/campaigns?archived=false&limit=10']);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    for (const messages of [ptBR, en]) {
      expect(JSON.stringify(messages.campaigns)).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
  });

  it('"Arquivadas" lists the archived campaigns; each filter has its own empty sentence', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/campaigns?archived=true&limit=10': { status: 200, body: { items: [{ ...ROW, archived: true }], total: 1 } },
      'GET /api/v1/campaigns?archived=false&limit=10': EMPTY,
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
    routes['GET /api/v1/campaigns?archived=true&limit=10'] = EMPTY;
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = renderToStaticMarkup(await CampaignsPage({ searchParams: query({ archived: 'true' }) }));
    expect(html).toContain('No archived campaign.');
    expect(ptBR.campaigns.empty).toBe('Uma campanha reúne as conversas e os materiais de uma mesa de jogo.');
  });

  it('a long list is paged within its filter: the page links keep "Arquivadas", and each page is one call', async () => {
    const row = (index: number) => ({ ...ROW, id: `0190a0b0-0000-7000-8000-0000000005${String(index).padStart(2, '0')}`, name: `Mesa ${index + 1}`, archived: true });
    const all = Array.from({ length: 53 }, (_, index) => row(index));
    const ARCHIVED = 'GET /api/v1/campaigns?archived=true&limit=10';
    const server = await useBackend({
      [ARCHIVED]: { status: 200, body: { items: all.slice(0, 10), nextCursor: all[9]!.id, total: 53 } },
      [`${ARCHIVED}&offset=50`]: { status: 200, body: { items: all.slice(50), total: 53 } },
    });
    let html = renderToStaticMarkup(await CampaignsPage({ searchParams: query({ archived: 'true' }) }));
    expect(html).toContain('1–10 de 53');
    expect(html).toContain('>Mesa 10<');
    expect(html).not.toContain('>Mesa 11<');
    expect(linkTo(html, '/campaigns?archived=true&amp;page=2')).toContain('rel="next"');
    // Six pages: every number shows; the last is a link.
    expect(linkTo(html, '/campaigns?archived=true&amp;page=6')).toContain('aria-label="Página 6"');
    expect(html).not.toContain('Carregar mais');

    html = renderToStaticMarkup(await CampaignsPage({ searchParams: query({ archived: 'true', page: '6' }) }));
    expect(html).toContain('51–53 de 53');
    expect(html).toContain('>Mesa 53<');
    expect(linkTo(html, '/campaigns?archived=true&amp;page=5')).toContain('rel="prev"');
    // The first page has no `page` field: the same address as the filter itself.
    const first = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes('href="/campaigns?archived=true"'));
    expect(first.some((tag) => tag.includes('aria-label="Página 1"'))).toBe(true);
    // The filter goes with the page's size and start: the backend counts and skips within it.
    expect(calls(server)).toEqual([ARCHIVED, `${ARCHIVED}&offset=50`]);
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
      [`GET /api/v1/campaigns/${ID}`, 'GET /api/v1/campaigns/current', `GET /api/v1/campaigns/${ID}/deletion`]
        .flatMap((call) => [call, call])
        .sort(),
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

  it('the scope tab shows the scope controls inline: tier switches, the materials of each tier that is on, model knowledge disabled', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`GET /api/v1/campaigns/${ID}`]: current(THURSDAY),
      'GET /api/v1/campaigns/current': current(FIRST),
      [`GET /api/v1/campaigns/${ID}/scope`]: { status: 200, body: SCOPE },
    };
    const server = await useBackend(routes);
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'scope' }) }));
      expect(linkTo(html, `/campaigns/${ID}?tab=scope`)).toContain('aria-current="page"');
      expect(html).toContain(messages.campaigns.scope.intro.replace("'", '&#x27;'));
      // Matrix row "Default": campaign and system on, other off, model knowledge off (enabled from Story 3.8).
      expect(switchesOf(html)).toEqual([
        [messages.campaigns.scope.campaign, 'true'],
        ['Notas da sessão 12.md', 'true'],
        [messages.campaigns.scope.system, 'true'],
        ['Livro do Jogador.pdf', 'true'],
        ['Bestiário.pdf', 'false'],
        [messages.campaigns.scope.other, 'false'],
        [messages.campaigns.scope.modelKnowledge, 'false'],
      ]);
      expect(html).not.toContain('Atlas de outra mesa.pdf');
      expect(html).not.toMatch(new RegExp(`aria-label="${messages.campaigns.scope.modelKnowledge}"[^>]*aria-disabled="true"`));
      expect(html).not.toContain('campaigns.page.scopeStarting');
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server)).toContain(`GET /api/v1/campaigns/${ID}/scope`);
    // The scope is read for its tab only.
    server.calls.length = 0;
    renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query() }));
    expect(calls(server)).not.toContain(`GET /api/v1/campaigns/${ID}/scope`);
    // A scope that cannot be read: a notice in place of the controls.
    routes[`GET /api/v1/campaigns/${ID}/scope`] = problem(503, 'server.unavailable');
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    const html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'scope' }) }));
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    expect(switchesOf(html)).toEqual([]);
  });

  it('the conversations tab counts the conversations of each area with "Abrir" for each, or one sentence when there is none', async () => {
    const QUESTIONS = `GET /api/v1/campaigns/${ID}/conversations?area=questions&limit=1`;
    const RULES = `GET /api/v1/campaigns/${ID}/conversations?area=rules&limit=1`;
    const listed = (total: number) => ({ status: 200, body: { items: total === 0 ? [] : [{ id: CONVERSATION, area: 'questions', name: 'x', questions: 1, createdAt: '2026-11-22T12:00:00Z', lastAskedAt: '2026-11-22T12:00:00Z', version: 0 }], total } });
    const routes: Record<string, { status: number; body: unknown }> = {
      [`GET /api/v1/campaigns/${ID}`]: current(THURSDAY),
      'GET /api/v1/campaigns/current': current(FIRST),
      [QUESTIONS]: listed(3),
      [RULES]: listed(1),
    };
    const server = await useBackend(routes);
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'conversations' }) }));
      expect(linkTo(html, `/campaigns/${ID}?tab=conversations`)).toContain('aria-current="page"');
      expect(html).toContain(`aria-label="${messages.campaigns.page.conversationList}"`);
      // One row per area, in the sidebar's order, each with its count and an "Abrir" that carries its area.
      expect(html.indexOf(messages.shell.entries.questions)).toBeLessThan(html.indexOf(messages.shell.entries.rules));
      expect(html).toContain(language === 'en' ? '3 conversations<' : '3 conversas<');
      expect(html).toContain(language === 'en' ? '1 conversation<' : '1 conversa<');
      expect(html.match(new RegExp(`<button[^>]*>${messages.campaigns.page.open}</button>`, 'g'))).toHaveLength(2);
      expect(html).toContain('<input type="hidden" name="area" value="questions"/>');
      expect(html).toContain('<input type="hidden" name="area" value="rules"/>');
    }
    expect(calls(server)).toEqual(expect.arrayContaining([QUESTIONS, RULES]));
    // A campaign with only rule conversations still lists them; Consultas shows 0.
    routes[QUESTIONS] = listed(0);
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    const rulesOnly = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'conversations' }) }));
    expect(rulesOnly).toContain('0 conversas<');
    expect(rulesOnly).not.toContain('Esta campanha ainda não tem conversas.');
    // An archived campaign's rows show, with no "Abrir" (it cannot become current) but a sentence in its place.
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
    routes[RULES] = listed(0);
    const none = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'conversations' }) }));
    expect(none).toContain('Esta campanha ainda não tem conversas.');
    // A list that cannot be read says why.
    routes[RULES] = problem(503, 'server.unavailable');
    const down = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query({ tab: 'conversations' }) }));
    expect(down).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
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

  it('"Abrir" makes the campaign current and opens the list of its area', async () => {
    const routes: Record<string, { status: number; body: unknown }> = { 'PUT /api/v1/campaigns/current': { status: 200, body: THURSDAY } };
    const server = await useBackend(routes);
    expect(await thrownDigest(() => openConversationAction(START, form({ id: ID, area: 'questions' })))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/questions;/);
    // The shared layout (switcher, context bar) is rendered again with the new current campaign or name.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    revalidatePath.mockClear();
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ campaignId: ID });
    expect(await thrownDigest(() => openConversationAction(START, form({ id: ID, area: 'rules' })))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/rules;/);
    // An area that is not one never reaches the backend.
    const count = server.calls.length;
    for (const fields of [{ id: ID }, { id: ID, area: 'search' }, { id: ID, area: '../campaigns' }] as Record<string, string>[]) {
      expect(await openConversationAction(START, form(fields))).toEqual({ error: 'O pedido não é válido.', done: 0 });
    }
    expect(server.calls).toHaveLength(count);
    routes['PUT /api/v1/campaigns/current'] = problem(404, 'request.not_found');
    expect(await openConversationAction(START, form({ id: ID, area: 'questions' }))).toEqual({ error: 'Não encontrado.', done: 0 });
  });
});

describe('deleting a campaign (Story 3.2 part B)', () => {
  it('"Excluir" is a danger pill in the header, last, for a campaign in use, the current one and an archived one, in both languages', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`GET /api/v1/campaigns/${ID}`]: { status: 200, body: THURSDAY },
      'GET /api/v1/campaigns/current': { status: 200, body: FIRST },
      [`GET /api/v1/campaigns/${ID}/deletion`]: { status: 200, body: { conversations: 1, materials: 2 } },
    };
    const server = await useBackend(routes);
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query() }));
      const pill = new RegExp(`<button[^>]*data-variant="danger"[^>]*>${messages.campaigns.page.delete}</button>`);
      expect(html).toMatch(pill);
      expect(html).toMatch(new RegExp(`<button[^>]*aria-haspopup="dialog"[^>]*>${messages.campaigns.page.delete}</button>`));
      // The dialog is rendered closed, already naming the counts of this campaign.
      expect(html).toContain(language === 'en' ? 'Going with it: 1 conversation and 2 materials of this campaign.' : 'Vão junto: 1 conversa e 2 materiais desta campanha.');
      expect(html.indexOf(`>${messages.campaigns.page.archive}</button>`)).toBeLessThan(html.indexOf(`>${messages.campaigns.page.delete}</button>`));
      expect(solids(html)).toEqual([messages.campaigns.page.use]);
    }
    expect(server.calls.filter((call) => call.url === `/api/v1/campaigns/${ID}/deletion`)[0]!.headers['x-session-token']).toBe(SESSION);
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    routes['GET /api/v1/campaigns/current'] = { status: 200, body: THURSDAY };
    expect(renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query() }))).toMatch(/<button[^>]*data-variant="danger"[^>]*>Excluir<\/button>/);
    routes[`GET /api/v1/campaigns/${ID}`] = { status: 200, body: { ...THURSDAY, archived: true } };
    routes['GET /api/v1/campaigns/current'] = { status: 200, body: FIRST };
    expect(renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query() }))).toMatch(/<button[^>]*data-variant="danger"[^>]*>Excluir<\/button>/);
  });

  it('without the counts, the dialog names what goes in words', async () => {
    await useBackend({
      [`GET /api/v1/campaigns/${ID}`]: { status: 200, body: THURSDAY },
      'GET /api/v1/campaigns/current': { status: 200, body: FIRST },
      [`GET /api/v1/campaigns/${ID}/deletion`]: problem(503, 'backend.unavailable'),
    });
    const html = renderToStaticMarkup(await CampaignPage({ params: params(ID), searchParams: query() }));
    expect(html).toContain('Vão junto as conversas e os materiais desta campanha. Isso não pode ser desfeito.');
    expect(html).toMatch(/<button[^>]*data-variant="danger"[^>]*>Excluir<\/button>/);
  });

  it('"Excluir campanha" deletes it, revalidates the layout and opens Minhas Mesas; a refusal comes back as its text', async () => {
    const routes: Record<string, { status: number; body?: unknown }> = { [`DELETE /api/v1/campaigns/${ID}`]: { status: 202 } };
    const server = await useBackend(routes);

    expect(await thrownDigest(() => deleteCampaignAction({ error: null }, form({ id: ID })))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/campaigns;/);
    // The shared layout (switcher, context bar) is rendered again without it.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(server.calls[0]!.method).toBe('DELETE');
    expect(server.calls[0]!.url).toBe(`/api/v1/campaigns/${ID}`);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    revalidatePath.mockClear();

    // Matrix row "Twice": already deleting, or another owner's.
    routes[`DELETE /api/v1/campaigns/${ID}`] = problem(404, 'request.not_found');
    expect(await deleteCampaignAction({ error: null }, form({ id: ID }))).toEqual({ error: 'Não encontrado.' });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await deleteCampaignAction({ error: null }, form({ id: ID }))).toEqual({ error: 'Not found.' });
    expect(revalidatePath).not.toHaveBeenCalled();
    const count = server.calls.length;
    for (const fields of [{ id: '../x' }, {}] as Record<string, string>[]) {
      expect(await deleteCampaignAction({ error: null }, form(fields))).toEqual({ error: 'The request is not valid.' });
    }
    expect(server.calls).toHaveLength(count);
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

describe("a campaign's scope (Story 3.6)", () => {
  const PUT = `PUT /api/v1/campaigns/${ID}/scope`;
  const GET = `GET /api/v1/campaigns/${ID}/scope`;
  /** The form a press posts: the whole settings on the version read. */
  const pressed = (fields: Record<string, string> = {}, off: readonly string[] = [BESTIARY]) => {
    const data = form({ campaign: ID, version: '4', campaignTier: 'true', systemTier: 'true', otherTier: 'false', modelKnowledge: 'false', ...fields });
    for (const id of off) {
      data.append('materialsOff', id);
    }
    return data;
  };

  it('matrix row "Material off": the full settings go on the version read, the layout follows and the answer says when it applies', async () => {
    const saved = { ...SCOPE, version: 5, materials: SCOPE.materials.map((m) => (m.id === BOOK ? { ...m, on: false } : m)) };
    const server = await useBackend({ [PUT]: { status: 200, body: saved } });
    const answer = await changeScopeAction(NO_SCOPE_ANSWER, pressed({}, [BESTIARY, BOOK]));
    expect(answer).toEqual({ scope: saved, error: null, saved: true });
    expect(calls(server)).toEqual([PUT]);
    expect(JSON.parse(server.calls[0]!.body)).toEqual({
      version: 4,
      campaignTier: true,
      systemTier: true,
      otherTier: false,
      modelKnowledge: false,
      materialsOff: [BESTIARY, BOOK],
    });
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('matrix rows "Tier off" and "All off": the tier switches go as pressed, the materials off kept', async () => {
    const server = await useBackend({ [PUT]: { status: 200, body: { ...SCOPE, version: 5, systemTier: false } } });
    expect((await changeScopeAction(NO_SCOPE_ANSWER, pressed({ systemTier: 'false' }))).saved).toBe(true);
    expect(JSON.parse(server.calls[0]!.body)).toMatchObject({ campaignTier: true, systemTier: false, otherTier: false, materialsOff: [BESTIARY] });
    await changeScopeAction(NO_SCOPE_ANSWER, pressed({ campaignTier: 'false', systemTier: 'false' }, []));
    expect(JSON.parse(server.calls[1]!.body)).toMatchObject({ campaignTier: false, systemTier: false, otherTier: false, materialsOff: [] });
  });

  it('matrix row "Stale": the settings are read again and shown, with the stale line; nothing is saved', async () => {
    const now = { ...SCOPE, version: 6, otherTier: true };
    const routes: Record<string, { status: number; body: unknown }> = { [PUT]: problem(409, 'request.stale_version'), [GET]: { status: 200, body: now } };
    const server = await useBackend(routes);
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const answer = await changeScopeAction(NO_SCOPE_ANSWER, pressed());
      expect(answer).toEqual({ scope: now, error: messages.campaigns.scope.stale, saved: false });
    }
    expect(calls(server)).toEqual([PUT, GET, PUT, GET]);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    // When the settings cannot be read again either, the reason is said, and the switches stay.
    routes[GET] = problem(503, 'server.unavailable');
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    const previous = { ...NO_SCOPE_ANSWER, scope: SCOPE };
    expect(await changeScopeAction(previous, pressed())).toEqual({
      ...previous,
      error: 'O serviço está indisponível agora. Tente de novo em instantes.',
    });
  });

  it('matrix row "Refused": scope.material_unknown is said in words, in both languages, and the switches stay', async () => {
    await useBackend({ [PUT]: problem(400, 'scope.material_unknown') });
    const previous = { ...NO_SCOPE_ANSWER, scope: SCOPE, saved: true };
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      expect(await changeScopeAction(previous, pressed())).toEqual({
        ...previous,
        error: messages.errors.codes.scope.material_unknown,
        saved: false,
      });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a malformed form never reaches the backend', async () => {
    const server = await useBackend({});
    const many = Array.from({ length: 1001 }, (_, i) => `0190a0b0-0000-7000-8000-${String(i).padStart(12, '0')}`);
    for (const data of [
      pressed({ campaign: '../x' }),
      pressed({ version: '-1' }),
      pressed({ version: '9'.repeat(16) }),
      pressed({ campaignTier: 'yes' }),
      pressed({ modelKnowledge: '' }),
      pressed({}, ['not-an-id']),
      pressed({}, many),
    ]) {
      expect((await changeScopeAction(NO_SCOPE_ANSWER, data)).error).toBe('O pedido não é válido.');
    }
    const missing = pressed();
    missing.delete('otherTier');
    expect((await changeScopeAction(NO_SCOPE_ANSWER, missing)).error).toBe('O pedido não é válido.');
    expect(server.calls).toEqual([]);
  });
});
