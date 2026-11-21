import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cookieJar: Record<string, string> = {};
let requestHeaders: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers(requestHeaders),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: () => undefined,
  }),
}));
// The shell's client parts ask for the router (the tray refreshes through it); outside Next.js there is none.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { default: SignedInLayout } = await import('@/app/(signed-in)/layout');
// A page still to be built: the layout tests' plain page.
const { default: CharactersPage } = await import('@/app/(signed-in)/characters/page');
const { default: FilesPage } = await import('@/app/(signed-in)/files/page');
const { default: MaterialPage } = await import('@/app/(signed-in)/files/[id]/page');
const { default: PageRoute } = await import('@/app/(signed-in)/files/[id]/pages/[page]/page');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const ME = { status: 200, body: { username: 'Mestre_Ana' } };
const CAMPAIGN = {
  status: 200,
  body: { id: '0190a0b0-0000-7000-8000-000000000002', name: 'First campaign', system: { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Untitled system' } },
};

const MATERIALS = 'GET /api/v1/materials?state=uploading&state=waiting&state=processing&state=needs_review&state=failed&limit=50';
const MATERIAL_ID = '0190a0b0-0000-7000-8000-000000000003';
/** Story 3.3: a material's version and place, which every material of the contract carries (here: none). */
const PLACE = { version: 0, belonging: { campaign: null, systems: [] }, serving: null };

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  return backend;
}

function problem(status: number, code: string) {
  return { status, body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params: {}, traceId: 't' } };
}

/** The URL a `redirect()` call threw, or null. */
async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest ?? '');
    if (!digest.startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    return digest.split(';').slice(2, -2).join(';');
  }
}

async function layoutHtml(page: unknown = createElement('p', null, 'page')): Promise<string> {
  return renderToStaticMarkup(await SignedInLayout({ children: page as never }));
}

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
  requestHeaders = { 'x-gmshield-path': '/systems' };
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('the signed-in layout (Story 1.11)', () => {
  it('loads the account and its current campaign with the session, and shows them in the shell', async () => {
    const server = await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': CAMPAIGN });
    cookieJar['__Host-gmshield-lang'] = 'en';
    const html = await layoutHtml(await CharactersPage());

    expect(html).toContain('Untitled system');
    expect(html).toContain('First campaign');
    // Usability pass: the account menu, in the bar, names the account under a small label.
    expect(html).toMatch(/Signed in as<\/span><span[^>]*>Mestre_Ana<\/span>/);
    expect(html).toContain('aria-label="Account of Mestre_Ana"');
    expect(html).toContain('<main');
    expect(html).toContain('<h1');
    expect(html).toContain('Here you will keep the characters of your campaigns.');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    // The sidebar, then the context bar, then the main column.
    expect(html.indexOf('data-testid="sidebar"')).toBeLessThan(html.indexOf('aria-label="System and campaign"'));
    expect(html.indexOf('aria-label="System and campaign"')).toBeLessThan(html.indexOf('<main'));
    expect(server.calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      'GET /api/v1/campaigns/current',
      'GET /api/v1/campaigns?limit=50',
      'GET /api/v1/conversations/current',
      MATERIALS,
      'GET /api/v1/me',
      'GET /api/v1/systems?limit=50',
    ]);
    for (const call of server.calls) {
      expect(call.headers['x-session-token']).toBe(SESSION);
      expect(call.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
    }
  });

  it('the sidebar starts as the cookie says', async () => {
    await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': CAMPAIGN });
    expect(await layoutHtml()).toContain('data-wide="open"');
    cookieJar['__Host-gmshield-sidebar'] = 'closed';
    expect(await layoutHtml()).toContain('data-wide="closed"');
    cookieJar['__Host-gmshield-sidebar'] = '<script>';
    expect(await layoutHtml()).toContain('data-wide="open"');
  });

  it('signed out: the sign-in screen at /, with no backend call', async () => {
    const server = await useBackend({});
    cookieJar = {};
    expect(await redirectOf(() => layoutHtml())).toBe('/');
    expect(server.calls).toEqual([]);
  });

  it('an ended session goes through /sign-in/ended and comes back to the same page', async () => {
    await useBackend({ 'GET /api/v1/me': problem(401, 'session.required'), 'GET /api/v1/campaigns/current': problem(401, 'session.required') });
    expect(await redirectOf(() => layoutHtml())).toBe('/sign-in/ended?next=%2Fsystems');
    requestHeaders = { 'x-gmshield-path': '//evil.example/x' };
    expect(await redirectOf(() => layoutHtml())).toBe('/sign-in/ended?next=%2F');
  });

  it('a seal version that rose goes through /session/renew and comes back to the same page', async () => {
    requestHeaders = { 'x-gmshield-path': '/files' };
    await useBackend({ 'GET /api/v1/me': problem(401, 'session.renewal_required'), 'GET /api/v1/campaigns/current': CAMPAIGN });
    expect(await redirectOf(() => layoutHtml())).toBe('/session/renew?next=%2Ffiles');
  });

  it('any other failure of the account: the sign-in screen at /, which says what happened', async () => {
    await useBackend({ 'GET /api/v1/me': problem(500, 'integrity.failed'), 'GET /api/v1/campaigns/current': CAMPAIGN });
    expect(await redirectOf(() => layoutHtml())).toBe('/');
  });

  it('no campaign: the shell says so; a campaign that cannot be loaded: a notice in the main column', async () => {
    await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': problem(404, 'request.not_found') });
    let html = await layoutHtml(await CharactersPage());
    expect(html).toContain('Nenhuma campanha');
    expect(html).not.toContain('role="status"');
    expect(html).toContain('Aqui você vai guardar os personagens das suas campanhas.');
    await backend!.close();

    await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': problem(503, 'server.unavailable') });
    html = await layoutHtml();
    expect(html).toContain('role="status"');
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    expect(html).toContain('Nenhuma campanha');
  });

  it('every entry page still to be built names itself and says what will be there, in both languages', async () => {
    const pages = {
      rules: (await import('@/app/(signed-in)/rules/page')).default,
      characters: CharactersPage,
    } as const;
    const ptBR = (await import('@/messages/pt-BR.json')).default;
    const en = (await import('@/messages/en.json')).default;
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar = { '__Host-gmshield-lang': language };
      for (const [key, Page] of Object.entries(pages) as [keyof typeof pages, (typeof pages)[keyof typeof pages]][]) {
        const html = renderToStaticMarkup(await Page());
        expect(html, `${language} ${key}`).toContain(`<h1`);
        expect(html, `${language} ${key}`).toContain(messages.shell.entries[key]);
        expect(html, `${language} ${key}`).toContain(messages.placeholder[key]);
        expect(messages.placeholder[key], `${language} ${key}`).not.toMatch(/!|\p{Extended_Pictographic}/u);
      }
    }
    expect(ptBR.placeholder.rules).toBe('Aqui você vai escrever suas próprias regras e conteúdos, à mão ou com um agente.');
  });

  it('the questions page (Story 2.4) is the conversation: the composer, and with no source the empty state', async () => {
    const conversation = { campaignId: '0190a0b0-0000-7000-8000-000000000002', hasSources: false };
    const review = { items: [{ id: MATERIAL_ID, name: 'Bestiário.pdf', state: 'needs_review', kind: 'rulebook' }] };
    const server = await useBackend({
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      [MATERIALS]: { status: 200, body: { items: [] } },
      'GET /api/v1/conversations/current': { status: 200, body: conversation },
      'GET /api/v1/materials?state=needs_review&limit=1': { status: 200, body: review },
    });
    requestHeaders = { 'x-gmshield-path': '/questions' };
    const { default: QuestionsPage } = await import('@/app/(signed-in)/questions/page');

    let html = await layoutHtml(await QuestionsPage());

    expect(html).toContain('<h1');
    expect(html).toContain('Consultas');
    expect(html).toContain('aria-label="Enviar"');
    expect(html).toContain('<textarea');
    expect(html).toContain('Esta campanha ainda não tem fontes aceitas.');
    expect(html).toContain('Enviar um arquivo');
    expect(html).toContain(`href="/files/${MATERIAL_ID}"`);
    expect(html).toContain('Revisar Bestiário.pdf');
    expect(html).not.toContain('style=');
    const asked = server.calls.find((request) => request.url === '/api/v1/conversations/current');
    expect(asked?.headers['x-session-token']).toBe(SESSION);

    await backend?.close();
    await useBackend({
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      [MATERIALS]: { status: 200, body: { items: [] } },
      'GET /api/v1/conversations/current': { status: 200, body: { ...conversation, hasSources: true } },
      'GET /api/v1/materials?state=needs_review&limit=1': { status: 200, body: { items: [] } },
    });
    cookieJar = { ...cookieJar, '__Host-gmshield-lang': 'en' };
    html = await layoutHtml(await QuestionsPage());
    expect(html).toContain('aria-label="Send"');
    expect(html).not.toContain('has no accepted sources');
  });
});

describe('the campaign switcher in the layout (Story 3.2)', () => {
  it('lists the campaigns in use with their system, the current one marked "atual" and not a choice', async () => {
    const server = await useBackend({
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      'GET /api/v1/campaigns?limit=50': {
        status: 200,
        body: {
          items: [
            { id: '0190a0b0-0000-7000-8000-000000000040', name: 'Mesa de quinta', system: { id: '0190a0b0-0000-7000-8000-000000000030', name: 'D&D', edition: '5.2.1' }, archived: false },
            { id: '0190a0b0-0000-7000-8000-000000000002', name: 'First campaign', system: { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Untitled system', edition: null }, archived: false },
          ],
        },
      },
    });
    const html = await layoutHtml();

    expect(server.calls.find((call) => call.url === '/api/v1/campaigns?limit=50')?.headers['x-session-token']).toBe(SESSION);
    // Under the logo and in the context bar: one list each.
    expect(html.match(/aria-label="Suas campanhas"/g)).toHaveLength(2);
    expect(html).toContain('Mesa de quinta');
    expect(html).toContain('D&amp;D 5.2.1');
    expect(html).toContain('Untitled system');
    // The other campaign is a choice: a submit button posting its id.
    expect(html).toMatch(/<input type="hidden" name="id" value="0190a0b0-0000-7000-8000-000000000040"\/><button type="submit"[^>]*>.*?Mesa de quinta/);
    // The current one is marked in words and is not a choice.
    const marked = [...html.matchAll(/<span[^>]*aria-current="true"[^>]*>(.*?)<\/span><\/li>/g)].map((match) => match[1]!);
    expect(marked).toHaveLength(2);
    for (const item of marked) {
      expect(item).toContain('First campaign');
      expect(item).toContain('atual');
    }
    expect(html).not.toContain('name="id" value="0190a0b0-0000-7000-8000-000000000002"');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
  });
});

describe('the questions page with no campaign (Story 3.2)', () => {
  it('shows the composer disabled with the reason and a link to a new campaign, not "Não encontrado."', async () => {
    await useBackend({
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': problem(404, 'request.not_found'),
      'GET /api/v1/campaigns?limit=50': { status: 200, body: { items: [] } },
      [MATERIALS]: { status: 200, body: { items: [] } },
      'GET /api/v1/conversations/current': problem(404, 'request.not_found'),
      'GET /api/v1/materials?state=needs_review&limit=1': { status: 200, body: { items: [] } },
    });
    requestHeaders = { 'x-gmshield-path': '/questions' };
    const { default: QuestionsPage } = await import('@/app/(signed-in)/questions/page');

    const html = await layoutHtml(await QuestionsPage());

    expect(html).toContain('Não há campanha em uso: crie uma para fazer perguntas.');
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*aria-label="Enviar"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Enviar"/);
    expect(html).toContain('href="/campaigns/new"');
    expect(html).not.toContain('Não encontrado.');
    // The switcher says there is none, and still offers a new campaign.
    expect(html).toContain('Nenhuma campanha');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
  });
});

describe('the upload tray and the material page (Story 1.14)', () => {
  const uploading = {
    id: MATERIAL_ID,
    name: 'Livro do Jogador.pdf',
    state: 'uploading',
    kind: 'rulebook',
    upload: { id: '0190a0b0-0000-7000-8000-000000000005', offset: 1024, length: 4096, expiresAt: '2099-01-01T06:00:00Z' },
  };

  it('asks for the tray states with the session and shows each row with its pill and a link to its page', async () => {
    const server = await useBackend({
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      [MATERIALS]: { status: 200, body: { items: [uploading, { id: '0190a0b0-0000-7000-8000-000000000006', name: 'Bestiário.pdf', state: 'needs_review' }] } },
    });
    const html = await layoutHtml();

    expect(server.calls.find((call) => `${call.method} ${call.url}` === MATERIALS)?.headers['x-session-token']).toBe(SESSION);
    expect(html).toContain('aria-label="Arquivos em andamento"');
    expect(html).toContain(`href="/files/${MATERIAL_ID}"`);
    expect(html).toContain('Livro do Jogador.pdf');
    // No live upload in this tab: the row is interrupted, and offers Retomar.
    expect(html).toContain('Envio interrompido.');
    expect(html).toContain('Retomar');
    // Usability pass: a material that needs review is no longer "in progress". It waits for the GM in the notice
    // and under the bell, and the tray keeps the files in motion.
    expect(html).toContain('Bestiário.pdf precisa de revisão.');
    expect(html).not.toContain('data-state="needs_review"');
    // "Adicionar Arquivo" is a button now, with the tray just before it; the dialog is in the page, closed.
    expect(html.indexOf('Arquivos em andamento')).toBeLessThan(html.indexOf('Adicionar Arquivo'));
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>.*Adicionar Arquivo<\/button>/);
    expect(html).not.toContain('href="/files/add"');
    expect(html).toContain('<dialog');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
  });

  it('a tray that cannot be loaded shows no row and leaves the page as it is', async () => {
    await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': CAMPAIGN, [MATERIALS]: problem(503, 'server.unavailable') });
    const html = await layoutHtml();
    expect(html).not.toContain('Arquivos em andamento');
    expect(html).toContain('Adicionar Arquivo');
    expect(html).not.toContain('role="status"');
  });

  it('an ended session met by the tray goes through /sign-in/ended', async () => {
    await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': CAMPAIGN, [MATERIALS]: problem(401, 'session.required') });
    expect(await redirectOf(() => layoutHtml())).toBe('/sign-in/ended?next=%2Fsystems');
  });

  it('the material page shows the name and the state pill, in both languages', async () => {
    const server = await useBackend({
      [`GET /api/v1/materials/${MATERIAL_ID}`]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', ...PLACE, state: 'waiting' } },
    });
    let html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
    expect(html).toContain('<h1');
    expect(html).toContain('Livro do Jogador.pdf');
    expect(html).toContain('aguardando');
    expect(html).toContain('data-state="waiting"');
    expect(server.calls[0]?.headers['x-session-token']).toBe(SESSION);
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
    expect(html).toContain('waiting');
    expect(html).toContain('State');
  });

  it('a processing material shows its pages in the pill, and a failed one says why, never with a code (Story 1.15)', async () => {
    const key = `GET /api/v1/materials/${MATERIAL_ID}`;
    const routes: Record<string, { status: number; body: unknown }> = {};
    const answer = (body: Record<string, unknown>) => {
      routes[key] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', ...PLACE, ...body } };
    };
    const page = async (language?: 'en') => {
      if (language === undefined) {
        delete cookieJar['__Host-gmshield-lang'];
      } else {
        cookieJar['__Host-gmshield-lang'] = language;
      }
      return renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
    };
    await useBackend(routes);

    const unsorted = { text: { done: 0, total: 0 }, image: { done: 0, total: 0 }, readDirectly: 0, readByOcr: 0, unreadable: 0, reading: null };
    answer({ state: 'processing', pages: { done: 0, total: 320, ...unsorted } });
    expect(await page()).toContain('processando · 0 de 320 páginas');
    expect(await page('en')).toContain('processing · 0 of 320 pages');

    const failures: [string | undefined, string, string][] = [
      ['ingestion.password_required', 'Este PDF é protegido por senha. Remova a senha e envie o arquivo de novo.', 'This PDF is protected by a password.'],
      ['ingestion.file_unreadable', 'Não foi possível ler este arquivo como PDF.', 'This file could not be read as a PDF.'],
      ['ingestion.too_many_steps', 'precisa de mais etapas do que suas páginas permitem', 'needs more steps than its pages allow'],
      ['ingestion.step_failed', 'Este arquivo não pôde ser processado.', 'This file could not be processed.'],
      ['job.attempts_exhausted', 'Algo deu errado no servidor.', 'Something went wrong on the server.'],
      [undefined, 'Algo deu errado no servidor.', 'Something went wrong on the server.'],
    ];
    for (const [failure, portuguese, english] of failures) {
      answer(failure === undefined ? { state: 'failed' } : { state: 'failed', failure });
      const html = await page();
      expect(html).toContain('falhou');
      expect(html).toContain(portuguese);
      if (failure !== undefined) {
        expect(html).not.toContain(failure);
      }
      expect(await page('en')).toContain(english);
    }
    // A material that is not failed shows no reason.
    answer({ state: 'waiting', failure: 'ingestion.password_required' });
    expect(await page()).not.toContain('senha');
  });

  it('a processing or reviewed material names what is read and lists its pages by outcome (Story 1.17)', async () => {
    const key = `GET /api/v1/materials/${MATERIAL_ID}`;
    const routes: Record<string, { status: number; body: unknown }> = {};
    const answer = (body: Record<string, unknown>) => {
      routes[key] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', ...PLACE, ...body } };
    };
    const page = async (language?: 'en') => {
      if (language === undefined) {
        delete cookieJar['__Host-gmshield-lang'];
      } else {
        cookieJar['__Host-gmshield-lang'] = language;
      }
      return renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
    };
    const count = (html: string, name: string) => new RegExp(`data-count="${name}"><dt>[^<]*</dt><dd>(\\d+)</dd>`).exec(html)?.[1];
    await useBackend(routes);

    // A mixed book: its text pages being read, its scanned pages waiting for OCR.
    answer({
      state: 'processing',
      pages: { done: 40, total: 444, text: { done: 40, total: 364 }, image: { done: 0, total: 80 }, readDirectly: 40, readByOcr: 0, unreadable: 0, reading: null },
    });
    let html = await page();
    expect(html).toContain('lendo texto · 40 de 364 páginas');
    expect(html).toContain('Lidas diretamente');
    expect([count(html, 'readDirectly'), count(html, 'readByOcr'), count(html, 'waiting')]).toEqual(['40', '0', '404']);
    // No unreadable page yet: not listed.
    expect(html).not.toContain('data-count="unreadable"');
    html = await page('en');
    expect(html).toContain('reading text · 40 of 364 pages');
    expect(html).toContain('Read by OCR');

    answer({
      state: 'processing',
      pages: { done: 376, total: 444, text: { done: 364, total: 364 }, image: { done: 12, total: 80 }, readDirectly: 364, readByOcr: 11, unreadable: 1, reading: null },
    });
    html = await page();
    expect(html).toContain('lendo por OCR · 12 de 80 páginas');
    expect([count(html, 'readDirectly'), count(html, 'readByOcr'), count(html, 'waiting'), count(html, 'unreadable')]).toEqual(['364', '11', '68', '1']);
    expect(html).toContain('Ilegíveis');

    // OCR between text batches: the step in progress reads image pages while later text pages wait.
    answer({
      state: 'processing',
      pages: { done: 8, total: 30, text: { done: 8, total: 18 }, image: { done: 0, total: 12 }, readDirectly: 8, readByOcr: 0, unreadable: 0, reading: 'image' },
    });
    html = await page();
    expect(html).toContain('lendo por OCR · 0 de 12 páginas');
    expect([count(html, 'readDirectly'), count(html, 'readByOcr'), count(html, 'waiting')]).toEqual(['8', '0', '22']);

    // Needs review: no list; the quality report counts the pages from Story 1.20.
    answer({
      state: 'needs_review',
      actions: [],
      pages: { done: 444, total: 444, text: { done: 364, total: 364 }, image: { done: 80, total: 80 }, readDirectly: 364, readByOcr: 79, unreadable: 1, reading: null },
    });
    html = await page();
    expect(html).toContain('precisa de revisão');
    expect(html).not.toContain(' · ');
    expect(html).not.toContain('data-count=');

    // Waiting, ready or failed: no list.
    for (const state of ['waiting', 'ready', 'failed']) {
      answer({ state, pages: { done: 444, total: 444, text: { done: 364, total: 364 }, image: { done: 80, total: 80 }, readDirectly: 364, readByOcr: 80, unreadable: 0, reading: null } });
      expect(await page()).not.toContain('data-count=');
    }
  });

  it('an unknown, malformed or other owner\'s material is the single not-found page', async () => {
    await useBackend({});
    for (const id of [MATERIAL_ID, 'not-a-uuid', '../me']) {
      const thrown = await MaterialPage({ params: Promise.resolve({ id }) }).then(
        () => null,
        (error: unknown) => String((error as { digest?: unknown }).digest ?? ''),
      );
      expect(thrown, id).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    }
  });

  it('another failure on the material page is a notice, never a code', async () => {
    await useBackend({ [`GET /api/v1/materials/${MATERIAL_ID}`]: problem(503, 'server.unavailable') });
    const html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
    expect(html).toContain('role="status"');
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    expect(html).not.toContain('server.unavailable');
  });
});

describe('a page of a material (Story 1.19)', () => {
  const PAGE_13 = `GET /api/v1/materials/${MATERIAL_ID}/pages/13?ground=review`;
  const MATERIAL = `GET /api/v1/materials/${MATERIAL_ID}`;
  const picturePage = {
    page: 13,
    pageTotal: 364,
    picture: { width: 1545, height: 2000 },
    lines: [{ text: 'Plate | 1,500 gp | 18', box: [0.1, 0.2, 0.5, 0.215] }],
    text: null,
    passages: [{ id: '0190a0b0-0000-7000-8000-000000000009', boxes: [[0.1, 0.2, 0.5, 0.215]] }],
  };
  const route = async (page: string, language?: 'en') => {
    if (language === undefined) {
      delete cookieJar['__Host-gmshield-lang'];
    } else {
      cookieJar['__Host-gmshield-lang'] = language;
    }
    return renderToStaticMarkup(await PageRoute({ params: Promise.resolve({ id: MATERIAL_ID, page }) }));
  };

  it('the material page links "Ver páginas" to page 1 once it needs review or is ready, and not before', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {};
    await useBackend(routes);
    for (const state of ['needs_review', 'ready']) {
      routes[MATERIAL] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', ...PLACE, state } };
      const html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
      expect(html, state).toContain(`href="/files/${MATERIAL_ID}/pages/1"`);
      expect(html).toContain('Ver páginas');
    }
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }))).toContain('View pages');
    delete cookieJar['__Host-gmshield-lang'];
    for (const state of ['uploading', 'waiting', 'processing', 'failed']) {
      routes[MATERIAL] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', ...PLACE, state } };
      const html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
      expect(html, state).not.toContain('/pages/');
    }
  });

  it('shows the page with its number, its name back to the material, and both page links in the middle', async () => {
    const server = await useBackend({
      [PAGE_13]: { status: 200, body: picturePage },
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', ...PLACE, state: 'needs_review' } },
    });
    let html = await route('13');
    expect(server.calls.find((call) => `${call.method} ${call.url}` === PAGE_13)?.headers['x-session-token']).toBe(SESSION);
    expect(html).toContain('Página 13 de 364');
    // Usability pass: the material's name is the way back above the title, and the title is the page's place.
    expect(html).toMatch(/<a[^>]*href="\/files\/0190a0b0-0000-7000-8000-000000000003"[^>]*>(<svg.*?<\/svg>)?Livro do Jogador.pdf<\/a>/);
    expect(html).toMatch(/<h1[^>]*>Página 13 de 364<\/h1>/);
    expect(html).toContain(`href="/api/v1/materials/${MATERIAL_ID}/pages/13/picture?ground=review"`);
    expect(html).toContain('Plate | 1,500 gp | 18');
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/12"`);
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/14"`);
    expect(html).toContain('Página anterior');
    expect(html).toContain('Próxima página');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    html = await route('13', 'en');
    expect(html).toContain('Page 13 of 364');
    expect(html).toContain('Previous page');
    expect(html).toContain('Next page');
  });

  it('hides the previous link on the first page and the next link on the last', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', ...PLACE, state: 'ready' } },
      [`GET /api/v1/materials/${MATERIAL_ID}/pages/1?ground=review`]: { status: 200, body: { ...picturePage, page: 1 } },
      [`GET /api/v1/materials/${MATERIAL_ID}/pages/364?ground=review`]: { status: 200, body: { ...picturePage, page: 364 } },
      [`GET /api/v1/materials/${MATERIAL_ID}/pages/2?ground=review`]: {
        status: 200,
        body: { page: 2, pageTotal: 2, picture: null, lines: [], text: '# Regras\n\nTexto.', passages: [] },
      },
    };
    await useBackend(routes);
    let html = await route('1');
    expect(html).not.toContain('Página anterior');
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/2"`);
    html = await route('364');
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/363"`);
    expect(html).not.toContain('Próxima página');
    // A text page of two: its text, no picture, only the previous link.
    html = await route('2');
    expect(html).toContain('Página 2 de 2');
    expect(html).toContain('# Regras\n\nTexto.');
    expect(html).not.toContain('/picture');
    expect(html).not.toContain('Próxima página');
  });

  it("a page the backend does not serve, another owner's, or a malformed number is the single not-found page", async () => {
    await useBackend({ [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', ...PLACE, state: 'processing' } } });
    for (const page of ['13', '0', '013', 'x', '-1', '99999999']) {
      const thrown = await PageRoute({ params: Promise.resolve({ id: MATERIAL_ID, page }) }).then(
        () => null,
        (error: unknown) => String((error as { digest?: unknown }).digest ?? ''),
      );
      expect(thrown, page).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    }
  });

  it('another failure on the page route is a notice, never a code', async () => {
    await useBackend({ [PAGE_13]: problem(503, 'server.unavailable') });
    const html = await route('13');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('server.unavailable');
  });
});

describe('the quality report, the actions and the needs-review notice (Story 1.20)', () => {
  const MATERIAL = `GET /api/v1/materials/${MATERIAL_ID}`;
  const REPORT = `GET /api/v1/materials/${MATERIAL_ID}/report`;
  const reviewPages = {
    done: 444,
    total: 444,
    text: { done: 364, total: 364 },
    image: { done: 80, total: 80 },
    readDirectly: 364,
    readByOcr: 77,
    unreadable: 3,
    reading: null,
  };
  const report = {
    outline: [
      { level: 1, title: 'Equipamento', page: 92 },
      { level: 2, title: 'Armaduras <b>pesadas</b>', page: 93 },
      { level: 9, title: 'Muito fundo', page: 94 },
    ],
    unreadable: [
      { firstPage: 9, lastPage: 9 },
      { firstPage: 40, lastPage: 41 },
    ],
    warnings: [
      { code: 'report.pages_unreadable', count: 3 },
      { code: 'report.pages_unopened', count: 1 },
      { code: 'report.something_new', count: 7 },
    ],
  };
  const page = async (language?: 'en') => {
    if (language === undefined) {
      delete cookieJar['__Host-gmshield-lang'];
    } else {
      cookieJar['__Host-gmshield-lang'] = language;
    }
    return renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
  };
  const numeral = (html: string, name: string) => new RegExp(`data-numeral="${name}"><dt[^>]*>[^<]*</dt><dd[^>]*>(\\d+)</dd>`).exec(html)?.[1];
  // The page's pills, before the (closed) confirmation dialog and its own pills; not "Onde pertence"'s (Story 3.3).
  const buttons = (html: string) =>
    [...(html.replace(/<section[^>]*aria-labelledby="material-place".*?<\/section>/s, '').split('<dialog')[0] ?? '').matchAll(/<button[^>]*data-variant="(\w+)"[^>]*>([^<]*)<\/button>/g)].map((match) => `${match[2]}:${match[1]}`);

  it('a material that needs review shows its report: numerals, warnings as facts, unreadable pages as links, the outline by level', async () => {
    const server = await useBackend({
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', ...PLACE, state: 'needs_review', actions: ['accept', 'reprocess', 'discard'], pages: reviewPages } },
      [REPORT]: { status: 200, body: report },
    });
    let html = await page();

    expect(server.calls.find((call) => `${call.method} ${call.url}` === REPORT)?.headers['x-session-token']).toBe(SESSION);
    expect(html).toContain('Relatório de qualidade');
    expect([numeral(html, 'done'), numeral(html, 'readByOcr'), numeral(html, 'unreadable')]).toEqual(['444', '77', '3']);
    expect(html).toContain('Páginas processadas');
    expect(html).toContain('3 páginas não puderam ser lidas.');
    expect(html).toContain('1 página não pôde ser aberta para leitura.');
    // A warning this release does not know is left out, never shown as its code.
    expect(html).not.toContain('something_new');
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/9">Página 9</a>`);
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/40">Páginas 40 a 41</a>`);
    // The outline: a plain list indented by level through classes, titles as text, never HTML.
    expect(html).toMatch(/<li class="[^"]*level0[^"]*" data-level="1"><a[^>]*href="\/files\/[^"]+\/pages\/92"[^>]*>Equipamento<\/a>/);
    expect(html).toMatch(/<li class="[^"]*level1[^"]*" data-level="2">/);
    expect(html).toMatch(/<li class="[^"]*level6[^"]*" data-level="9">/);
    expect(html).toContain('Armaduras &lt;b&gt;pesadas&lt;/b&gt;');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    // The actions it allows: Aceitar the one solid pill.
    expect(buttons(html)).toEqual(['Aceitar:solid', 'Reprocessar páginas com falha:default', 'Descartar:danger']);
    expect(html).toContain('name="id" value="0190a0b0-0000-7000-8000-000000000003"');
    expect(html).toContain('<dialog');
    expect(html).toContain('href="/files/0190a0b0-0000-7000-8000-000000000003/pages/1"');

    html = await page('en');
    expect(html).toContain('Quality report');
    expect(html).toContain('3 pages could not be read.');
    expect(html).toContain('Pages 40 to 41');
    expect(buttons(html)).toEqual(['Accept:solid', 'Reprocess failed pages:default', 'Discard:danger']);
  });

  it('shows only the actions the material allows: read-only when ready, retry and discard when failed, none while processing', async () => {
    const routes: Record<string, { status: number; body: unknown }> = { [REPORT]: { status: 200, body: { outline: [], unreadable: [], warnings: [{ code: 'report.outline_empty', count: 0 }] } } };
    const server = await useBackend(routes);
    const answer = (body: Record<string, unknown>) => {
      routes[MATERIAL] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', ...PLACE, ...body } };
    };

    // Nothing to reprocess.
    answer({ state: 'needs_review', actions: ['accept', 'discard'], pages: { ...reviewPages, unreadable: 0 } });
    let html = await page();
    expect(buttons(html)).toEqual(['Aceitar:solid', 'Descartar:danger']);
    expect(html).toContain('Nenhuma seção foi encontrada no texto.');
    expect(html).not.toContain('Páginas ilegíveis');

    // Accepted: the report, read-only, and the pill "pronto". Story 3.4: "Substituir" and "Reprocessar", two plain pills,
    // with no confirmation (nothing is removed).
    answer({ state: 'ready', actions: ['reprocess'], pages: reviewPages });
    html = await page();
    expect(html).toContain('pronto');
    expect(html).toContain('Relatório de qualidade');
    expect(buttons(html)).toEqual(['Substituir:default', 'Reprocessar:default']);
    expect(html).not.toContain('Reprocessar páginas com falha');
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('data-serving');

    // Story 3.4: a new version under review, the ready one serving beside it.
    answer({ state: 'needs_review', actions: ['accept', 'discard'], pages: { ...reviewPages, unreadable: 0 }, serving: { pages: 320, size: 1000 } });
    html = await page();
    expect(html).toContain('A versão anterior (320 páginas) continua em uso enquanto a nova não for aceita.');
    expect(buttons(html)).toEqual(['Aceitar:solid', 'Descartar:danger']);
    answer({ state: 'uploading', actions: [], serving: { pages: 1, size: 1000 } });
    expect(await page()).toContain('A versão anterior (1 página) continua em uso enquanto a nova não for aceita.');
    answer({ state: 'waiting', actions: [], serving: { pages: null, size: null } });
    html = await page();
    expect(html).toContain('A versão anterior continua em uso enquanto a nova não for aceita.');
    expect(buttons(html)).toEqual([]);
    answer({ state: 'processing', actions: [], serving: { pages: 320, size: 1000 } });
    expect(await page('en')).toContain('The previous version (320 pages) stays in use while the new one is not accepted.');

    // Failed: why, then Tentar de novo and Descartar.
    answer({ state: 'failed', failure: 'ingestion.step_failed', actions: ['retry', 'discard'] });
    server.calls.length = 0;
    html = await page();
    expect(html).toContain('Este arquivo não pôde ser processado.');
    expect(html.indexOf('Este arquivo não pôde ser processado.')).toBeLessThan(html.indexOf('Tentar de novo'));
    expect(buttons(html)).toEqual(['Tentar de novo:solid', 'Descartar:danger']);
    expect(html).not.toContain('Relatório de qualidade');
    expect(server.calls.map((call) => call.url)).not.toContain(`/api/v1/materials/${MATERIAL_ID}/report`);

    // Retry impossible: only Descartar.
    answer({ state: 'failed', failure: 'ingestion.password_required', actions: ['discard'] });
    expect(buttons(await page())).toEqual(['Descartar:danger']);

    // Processing (after reprocess or retry) and discarded: no action, no report.
    for (const state of ['processing', 'discarded']) {
      answer({ state, actions: [] });
      html = await page();
      expect(buttons(html), state).toEqual([]);
      expect(html).not.toContain('Relatório de qualidade');
    }
    expect(await page()).toContain('descartado');
  });

  it('a report that cannot be loaded is a sentence, never a code', async () => {
    await useBackend({
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', ...PLACE, state: 'needs_review', actions: ['accept', 'discard'], pages: reviewPages } },
      [REPORT]: problem(503, 'server.unavailable'),
    });
    const html = await page();
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    expect(html).not.toContain('server.unavailable');
    expect(buttons(html)).toEqual(['Aceitar:solid', 'Descartar:danger']);
  });

  // Usability pass (2026-11-21): no notice across every page for a material; the bell lists each one that waits.
  it('the signed-in layout lists every material that needs review or failed under the bell, with a link, and counts them', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      [MATERIALS]: {
        status: 200,
        body: {
          items: [
            { id: '0190a0b0-0000-7000-8000-000000000007', name: 'Enviando.pdf', state: 'processing', actions: [] },
            { id: '0190a0b0-0000-7000-8000-000000000006', name: 'Bestiário.pdf', state: 'needs_review', actions: ['accept', 'discard'] },
            { id: MATERIAL_ID, name: 'Antigo.pdf', state: 'needs_review', actions: ['accept', 'discard'] },
            { id: '0190a0b0-0000-7000-8000-000000000008', name: 'Scan.pdf', state: 'failed', actions: ['retry', 'discard'] },
          ],
        },
      },
    };
    await useBackend(routes);
    let html = await layoutHtml();
    const bar = (text: string) => text.slice(0, text.indexOf('<main'));
    const column = (text: string) => text.slice(text.indexOf('<main'));
    // Under the bell, before the main column: the ones to review first, then the failed one; each with its link.
    expect(bar(html)).toContain('aria-label="Notificações, 3 novas"');
    expect(bar(html)).toContain('Bestiário.pdf precisa de revisão.');
    expect(bar(html)).toContain('href="/files/0190a0b0-0000-7000-8000-000000000006">Revisar</a>');
    expect(bar(html)).toContain('Antigo.pdf precisa de revisão.');
    expect(bar(html)).toContain('Scan.pdf falhou.');
    expect(bar(html)).toContain('href="/files/0190a0b0-0000-7000-8000-000000000008">Abrir</a>');
    expect(bar(html).indexOf('Antigo.pdf precisa de revisão.')).toBeLessThan(bar(html).indexOf('Scan.pdf falhou.'));
    // Nothing about them across the page, and nothing announced on load.
    expect(column(html)).not.toContain('precisa de revisão');
    expect(html).not.toContain('role="status"');
    // The tray keeps the file in motion alone.
    expect(html).toContain('Enviando.pdf');
    expect(html).not.toContain('data-state="failed"');
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = await layoutHtml();
    expect(bar(html)).toContain('Bestiário.pdf needs review.');
    expect(bar(html)).toContain('>Review</a>');
    expect(bar(html)).toContain('Scan.pdf failed.');

    // Accepted (no longer in the tray's states): nothing waits, and the bell counts nothing.
    routes[MATERIALS] = { status: 200, body: { items: [{ id: '0190a0b0-0000-7000-8000-000000000007', name: 'Enviando.pdf', state: 'processing', actions: [] }] } };
    html = await layoutHtml();
    expect(html).toContain('aria-label="Notifications"');
    expect(html).not.toContain('needs review');

    // A campaign that cannot be loaded is still a notice across the page: it is the page's own state.
    routes['GET /api/v1/campaigns/current'] = problem(503, 'server.unavailable');
    routes[MATERIALS] = { status: 200, body: { items: [{ id: MATERIAL_ID, name: 'Antigo.pdf', state: 'needs_review', actions: [] }] } };
    html = await layoutHtml();
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(column(html)).toContain('data-status="danger"');
    expect(column(html)).not.toContain('Antigo.pdf needs review.');
    expect(bar(html)).toContain('Antigo.pdf needs review.');
  });
});

describe('the indexing notice', () => {
  const CONVERSATION = 'GET /api/v1/conversations/current';
  const conversation = (
    indexing: { remaining: number } | null,
    indexingFailed: { passages: number; retrying: boolean } | null = null,
  ) => ({
    status: 200,
    body: { campaignId: '0190a0b0-0000-7000-8000-000000000002', hasSources: true, indexing, indexingFailed },
  });
  /** The notices of the main column, in order: [status, text, live?]. */
  const notices = (html: string) =>
    [...html.matchAll(/<div ([^>]*)data-status="(\w+)"[^>]*>(.*?)<\/div>/g)].map((match) => [
      match[2],
      match[3]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      match[1]!.includes('role="status"'),
    ]);

  it('says how many passages are left, in both languages, with no dismiss control and no live role, on every signed-in page', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      [CONVERSATION]: conversation({ remaining: 2000 }),
    };
    const server = await useBackend(routes);
    let html = await layoutHtml(await CharactersPage());

    // Matrix row "Indexing": the SRD's 2,000 passages pending.
    expect(notices(html)).toEqual([['warning', 'Atenção Preparando as fontes para busca: faltam 2.000 trechos', false]]);
    expect(html).not.toContain('Dispensar aviso');
    expect(html).not.toContain('role="status"');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    expect(server.calls.find((call) => call.url === '/api/v1/conversations/current')?.headers['x-session-token']).toBe(SESSION);
    // In the main column, before the page.
    expect(html.indexOf('<main')).toBeLessThan(html.indexOf('Preparando as fontes'));
    expect(html.indexOf('Preparando as fontes')).toBeLessThan(html.indexOf('<h1'));
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = await layoutHtml();
    expect(notices(html)).toEqual([['warning', 'Warning Preparing your sources for search: 2,000 passages left', false]]);
    expect(html).not.toContain('Dismiss notice');

    // Matrix row "Two versions": the backend adds them up; the layout shows its number as it is.
    routes[CONVERSATION] = conversation({ remaining: 150 });
    expect(notices(await layoutHtml())).toEqual([['warning', 'Warning Preparing your sources for search: 150 passages left', false]]);

    // Matrix row "Nothing pending": no notice.
    routes[CONVERSATION] = conversation(null);
    html = await layoutHtml();
    expect(notices(html)).toEqual([]);
    expect(html).not.toContain('Preparing your sources');
  });

  it('adds the failure line second: a warning while a retry remains, an error after, also with nothing pending', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      [CONVERSATION]: conversation({ remaining: 50 }, { passages: 200, retrying: true }),
    };
    await useBackend(routes);

    // Matrix row "Run fails": both lines, the failure second, neither dismissible nor live.
    let html = await layoutHtml();
    expect(notices(html)).toEqual([
      ['warning', 'Atenção Preparando as fontes para busca: faltam 50 trechos', false],
      ['warning', 'Atenção Não foi possível preparar 200 trechos para busca; nova tentativa em alguns minutos.', false],
    ]);
    expect(html).not.toContain('Dispensar aviso');
    // Nothing pending, a retry to come: the failure line alone.
    routes[CONVERSATION] = conversation(null, { passages: 1, retrying: true });
    expect(notices(await layoutHtml())).toEqual([
      ['warning', 'Atenção Não foi possível preparar 1 trecho para busca; nova tentativa em alguns minutos.', false],
    ]);
    // Matrix row "Retries used": an error line.
    routes[CONVERSATION] = conversation(null, { passages: 200, retrying: false });
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = await layoutHtml();
    expect(notices(html)).toEqual([['danger', 'Error Could not prepare 200 passages for search.', false]]);
    expect(html).not.toContain('Dismiss notice');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
  });

  it('no conversation (no campaign) or one that cannot be loaded: no notice', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': problem(404, 'request.not_found'),
      [CONVERSATION]: problem(404, 'request.not_found'),
    };
    await useBackend(routes);
    let html = await layoutHtml();
    expect(notices(html)).toEqual([]);
    routes['GET /api/v1/campaigns/current'] = CAMPAIGN;
    routes[CONVERSATION] = problem(503, 'server.unavailable');
    html = await layoutHtml();
    expect(notices(html)).toEqual([]);
  });

  it('stacks under a campaign error, one line each, in that order; a material that needs review is the bell\'s', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': problem(503, 'server.unavailable'),
      [MATERIALS]: { status: 200, body: { items: [{ id: MATERIAL_ID, name: 'Bestiário.pdf', state: 'needs_review', actions: [] }] } },
      [CONVERSATION]: conversation({ remaining: 150 }),
    };
    await useBackend(routes);
    let html = await layoutHtml();

    expect(notices(html)).toEqual([
      ['danger', 'Erro O serviço está indisponível agora. Tente de novo em instantes.', true],
      ['warning', 'Atenção Preparando as fontes para busca: faltam 150 trechos', false],
    ]);
    // The first can be dismissed; the indexing notice cannot.
    expect(html.match(/aria-label="Dispensar aviso"/g)).toHaveLength(1);
    expect(html.lastIndexOf('Dispensar aviso')).toBeLessThan(html.indexOf('Preparando as fontes'));
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    // Usability pass: the material that needs review is under the bell, before the main column.
    expect(html.indexOf('Bestiário.pdf precisa de revisão.')).toBeLessThan(html.indexOf('<main'));

    // The campaign loads again: the indexing notice stays.
    routes['GET /api/v1/campaigns/current'] = CAMPAIGN;
    html = await layoutHtml();
    expect(notices(html).map(([status]) => status)).toEqual(['warning']);
  });
});

describe('a page beside its extracted text (Story 1.20)', () => {
  const MATERIAL = `GET /api/v1/materials/${MATERIAL_ID}`;
  const at = (page: number) => `GET /api/v1/materials/${MATERIAL_ID}/pages/${page}?ground=review`;
  const route = async (page: string) =>
    renderToStaticMarkup(await PageRoute({ params: Promise.resolve({ id: MATERIAL_ID, page }) }));

  it('a picture page sits beside "Texto extraído", which holds its lines, or says none was extracted', async () => {
    await useBackend({
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', ...PLACE, state: 'needs_review', actions: [] } },
      [at(13)]: {
        status: 200,
        body: {
          page: 13,
          pageTotal: 30,
          picture: { width: 1545, height: 2000 },
          lines: [
            { text: 'Armor', box: [0.1, 0.1, 0.3, 0.125] },
            { text: '<i>Plate</i> | 1,500 gp', box: [0.1, 0.15, 0.6, 0.17] },
          ],
          text: null,
          passages: [],
          outcome: 'read_directly',
        },
      },
      [at(7)]: { status: 200, body: { page: 7, pageTotal: 30, picture: { width: 1545, height: 2000 }, lines: [], text: null, passages: [], outcome: 'unreadable' } },
    });
    let html = await route('13');
    expect(html).toContain('Texto extraído');
    expect(html).toContain('Armor\n&lt;i&gt;Plate&lt;/i&gt; | 1,500 gp</div>');
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('Texto extraído'));
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    // A blank scan: its picture, and no text beside it.
    html = await route('7');
    expect(html).toContain('<svg');
    expect(html).toContain('Nenhum texto foi extraído desta página.');
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = await route('7');
    expect(html).toContain('Extracted text');
    expect(html).toContain('No text was extracted from this page.');
  });

  it('an unreadable page whose reading crashed says it could not be opened, with its number and both links', async () => {
    await useBackend({
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', ...PLACE, state: 'needs_review', actions: [] } },
      [at(9)]: { status: 200, body: { page: 9, pageTotal: 30, picture: null, lines: [], text: null, passages: [], outcome: 'unreadable' } },
    });
    const html = await route('9');
    expect(html).toContain('Esta página não pôde ser aberta.');
    expect(html).toContain('Página 9 de 30');
    // No page picture: the only drawing left is the arrow of the way back.
    expect(html).not.toContain('<image');
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain('/picture');
    expect(html).not.toContain('Texto extraído');
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/8"`);
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/10"`);
  });
});

describe('"Meus Arquivos" and where a material belongs (Story 3.3)', () => {
  const FILES = 'GET /api/v1/materials?state=uploading&state=waiting&state=processing&state=needs_review&state=ready&state=superseded&state=failed&limit=10';
  const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
  const OTHER_SYSTEM = '0190a0b0-0000-7000-8000-000000000030';
  const IN_CAMPAIGN = { campaign: { id: CAMPAIGN.body.id, name: 'Mesa de sexta', system: { id: SYSTEM, name: 'D&D' } }, systems: [] };
  const pages = { done: 320, total: 320, text: { done: 320, total: 320 }, image: { done: 0, total: 0 }, readDirectly: 320, readByOcr: 0, unreadable: 0, reading: null };
  const files = [
    { id: MATERIAL_ID, name: 'Livro.pdf', state: 'ready', actions: [], version: 1, size: 1234567, pages, belonging: IN_CAMPAIGN, serving: null },
    {
      id: '0190a0b0-0000-7000-8000-000000000006',
      name: 'Bestiário.pdf',
      state: 'needs_review',
      actions: [],
      version: 0,
      size: 2000,
      pages: { ...pages, total: 1 },
      belonging: { campaign: null, systems: [{ id: SYSTEM, name: 'D&D' }, { id: OTHER_SYSTEM, name: 'Pathfinder' }] },
      serving: null,
    },
    { id: '0190a0b0-0000-7000-8000-000000000007', name: 'Solto.md', state: 'uploading', actions: [], version: 0, belonging: { campaign: null, systems: [] }, serving: null },
  ];

  it('lists every material but a discarded one, each with its state, size, pages and place, opening its page', async () => {
    const server = await useBackend({
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      [FILES]: { status: 200, body: { items: files, total: 3 } },
    });
    requestHeaders = { 'x-gmshield-path': '/files' };

    const html = await layoutHtml(await FilesPage());

    expect(html).toMatch(/<h1[^>]*>Meus Arquivos<\/h1>/);
    // "Adicionar Arquivo" is the page's one solid pill, and opens the guided upload.
    expect(html).toMatch(/<main.*<button(?=[^>]*aria-haspopup="dialog")(?=[^>]*data-variant="solid")[^>]*>Adicionar Arquivo<\/button>/s);
    expect(html).toContain('aria-label="Seus arquivos"');
    expect(html).toContain(`href="/files/${MATERIAL_ID}"`);
    expect(html).toMatch(/Livro\.pdf<\/span><span[^>]*><span[^>]*data-state="ready"[^>]*>.*?pronto.*?<span[^>]*>1,2 MB · 320 páginas · Campanha Mesa de sexta<\/span>/s);
    expect(html).toContain('>2 KB · 1 página · D&amp;D e Pathfinder</span>');
    expect(html).toContain('>Sem lugar</span>');
    // Third round of the usability pass: one page says how many files there are; nothing is added by "Carregar mais".
    expect(html).toContain('3 itens');
    expect(html).not.toContain('Carregar mais');
    expect(server.calls.find((call) => `${call.method} ${call.url}` === FILES)?.headers['x-session-token']).toBe(SESSION);
  });

  it('an empty list says so in one sentence, with "Adicionar Arquivo" its only action; a list that cannot load says why', async () => {
    await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': CAMPAIGN, [FILES]: { status: 200, body: { items: [], total: 0 } } });
    let html = await layoutHtml(await FilesPage());
    expect(html).toContain('Os arquivos que você enviar aparecem aqui, com o estado de cada um.');
    expect(html).not.toContain('aria-label="Seus arquivos"');
    await backend!.close();
    await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': CAMPAIGN, [FILES]: problem(503, 'server.unavailable') });
    html = await layoutHtml(await FilesPage());
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
  });

  it('a page the backend left empty (every material on it was leaving) is not the empty sentence while the list has rows', async () => {
    // A material whose every place is being deleted is counted but left out of its page until the deletion is done.
    await useBackend({
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      [FILES]: { status: 200, body: { items: [], total: 1 } },
    });
    const html = await layoutHtml(await FilesPage());
    expect(html).not.toContain('Os arquivos que você enviar aparecem aqui');
    expect(html).toContain('aria-label="Seus arquivos"');
    expect(html).toContain('1 item');
  });

  it('a long list is paged: ten files a page, the rows shown of the total, and a page link keeps the address', async () => {
    const twelve = Array.from({ length: 12 }, (_, index) => ({
      ...files[2]!,
      id: `0190a0b0-0000-7000-8000-0000000006${String(index).padStart(2, '0')}`,
      name: `Arquivo ${index + 1}.md`,
    }));
    const server = await useBackend({
      'GET /api/v1/me': ME,
      'GET /api/v1/campaigns/current': CAMPAIGN,
      [FILES]: { status: 200, body: { items: twelve.slice(0, 10), nextCursor: twelve[9]!.id, total: 12 } },
      [`${FILES}&offset=10`]: { status: 200, body: { items: twelve.slice(10), total: 12 } },
    });
    let html = await layoutHtml(await FilesPage());
    expect(html).toContain('1–10 de 12');
    expect(html).toContain('Arquivo 10.md');
    expect(html).not.toContain('Arquivo 11.md');
    // Above the rows and under them: the page is turned without scrolling to the end of the list.
    expect(html).toContain('aria-label="Paginação, acima da lista"');
    expect(html).toContain('aria-label="Paginação"');
    expect([...html.matchAll(/href="\/files\?page=2"/g)].length).toBeGreaterThanOrEqual(3);
    html = await layoutHtml(await FilesPage({ searchParams: Promise.resolve({ page: '2' }) }));
    expect(html).toContain('11–12 de 12');
    expect(html).toContain('Arquivo 12.md');
    expect(html).not.toContain('Arquivo 10.md');
    // One call a page: its size, and its start from the second page on.
    expect(server.calls.map((call) => `${call.method} ${call.url}`).filter((call) => call.includes('state=ready'))).toEqual([FILES, `${FILES}&offset=10`]);
  });

  it('a material page says where it belongs, with "Alterar", reading the campaigns and systems it can be given', async () => {
    const server = await useBackend({
      [`GET /api/v1/materials/${MATERIAL_ID}`]: { status: 200, body: files[0] },
      'GET /api/v1/campaigns?limit=50': { status: 200, body: { items: [{ id: CAMPAIGN.body.id, name: 'Mesa de sexta', system: { id: SYSTEM, name: 'D&D', edition: null }, archived: false }] } },
      'GET /api/v1/systems?limit=50': { status: 200, body: { items: [{ id: SYSTEM, name: 'D&D', edition: null, description: null, version: 0 }] } },
    });
    let html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
    expect(html).toContain('aria-labelledby="material-place"');
    expect(html).toContain('>Onde pertence</h2>');
    expect(html).toContain('Na campanha Mesa de sexta, do sistema D&amp;D.');
    expect(html).toMatch(/<button[^>]*data-variant="default"[^>]*>Alterar<\/button>/);
    expect(server.calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual(
      [
        'GET /api/v1/campaigns?limit=50',
        `GET /api/v1/materials/${MATERIAL_ID}`,
        // Usability pass: a ready material with pages shows its first page beside its facts.
        `GET /api/v1/materials/${MATERIAL_ID}/pages/1?ground=review`,
        `GET /api/v1/materials/${MATERIAL_ID}/report`,
        'GET /api/v1/systems?limit=50',
      ].sort(),
    );
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
    expect(html).toContain('In the campaign Mesa de sexta, of the system D&amp;D.');
  });

  it('a material page whose campaigns and systems cannot be loaded says why instead of offering "Alterar"', async () => {
    await useBackend({
      [`GET /api/v1/materials/${MATERIAL_ID}`]: { status: 200, body: files[2] },
      'GET /api/v1/campaigns?limit=50': problem(503, 'server.unavailable'),
      'GET /api/v1/systems?limit=50': problem(503, 'server.unavailable'),
    });
    const html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
    expect(html).toContain('Em nenhum lugar: nenhuma pergunta usa este arquivo.');
    expect(html).not.toMatch(/>Alterar<\/button>/);
    expect(html).toMatch(/aria-labelledby="material-place".*O serviço está indisponível agora\. Tente de novo em instantes\./s);
  });
});
