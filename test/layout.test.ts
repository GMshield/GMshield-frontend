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
const { default: SystemsPage } = await import('@/app/(signed-in)/systems/page');
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
    const html = await layoutHtml(await SystemsPage());

    expect(html).toContain('Untitled system');
    expect(html).toContain('First campaign');
    expect(html).toContain('Signed in as Mestre_Ana');
    expect(html).toContain('<main');
    expect(html).toContain('<h1');
    expect(html).toContain('Here you will see and organise your game systems.');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    // The sidebar, then the context bar, then the main column.
    expect(html.indexOf('data-testid="sidebar"')).toBeLessThan(html.indexOf('aria-label="System and campaign"'));
    expect(html.indexOf('aria-label="System and campaign"')).toBeLessThan(html.indexOf('<main'));
    expect(server.calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual(['GET /api/v1/campaigns/current', MATERIALS, 'GET /api/v1/me']);
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
    let html = await layoutHtml(await FilesPage());
    expect(html).toContain('Nenhuma campanha');
    expect(html).not.toContain('role="status"');
    expect(html).toContain('Aqui você vai ver os arquivos que enviou e o estado de cada um.');
    await backend!.close();

    await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': problem(503, 'server.unavailable') });
    html = await layoutHtml();
    expect(html).toContain('role="status"');
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    expect(html).toContain('Nenhuma campanha');
  });

  it('every entry page names itself and says what will be there, in both languages', async () => {
    const pages = {
      questions: (await import('@/app/(signed-in)/questions/page')).default,
      rules: (await import('@/app/(signed-in)/rules/page')).default,
      campaigns: (await import('@/app/(signed-in)/campaigns/page')).default,
      systems: SystemsPage,
      characters: (await import('@/app/(signed-in)/characters/page')).default,
      files: FilesPage,
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
    expect(ptBR.placeholder.questions).toBe('Aqui você vai fazer perguntas sobre os seus livros e ler as respostas com as fontes.');
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
    expect(html).toContain('precisa de revisão');
    expect(html).toContain('data-state="needs_review"');
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
      [`GET /api/v1/materials/${MATERIAL_ID}`]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', state: 'waiting' } },
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
      routes[key] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', ...body } };
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
      routes[key] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', ...body } };
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
      routes[MATERIAL] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', state } };
      const html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
      expect(html, state).toContain(`href="/files/${MATERIAL_ID}/pages/1"`);
      expect(html).toContain('Ver páginas');
    }
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }))).toContain('View pages');
    delete cookieJar['__Host-gmshield-lang'];
    for (const state of ['uploading', 'waiting', 'processing', 'failed']) {
      routes[MATERIAL] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', state } };
      const html = renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }) }));
      expect(html, state).not.toContain('/pages/');
    }
  });

  it('shows the page with its number, its name back to the material, and both page links in the middle', async () => {
    const server = await useBackend({
      [PAGE_13]: { status: 200, body: picturePage },
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', state: 'needs_review' } },
    });
    let html = await route('13');
    expect(server.calls.find((call) => `${call.method} ${call.url}` === PAGE_13)?.headers['x-session-token']).toBe(SESSION);
    expect(html).toContain('Página 13 de 364');
    expect(html).toMatch(/<h1[^>]*><a[^>]*href="\/files\/0190a0b0-0000-7000-8000-000000000003"[^>]*>Livro do Jogador.pdf<\/a><\/h1>/);
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
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', state: 'ready' } },
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
    await useBackend({ [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', state: 'processing' } } });
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
  // The page's pills, before the (closed) confirmation dialog and its own pills.
  const buttons = (html: string) =>
    [...(html.split('<dialog')[0] ?? '').matchAll(/<button[^>]*data-variant="(\w+)"[^>]*>([^<]*)<\/button>/g)].map((match) => `${match[2]}:${match[1]}`);

  it('a material that needs review shows its report: numerals, warnings as facts, unreadable pages as links, the outline by level', async () => {
    const server = await useBackend({
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro do Jogador.pdf', state: 'needs_review', actions: ['accept', 'reprocess', 'discard'], pages: reviewPages } },
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
    expect(buttons(html)).toEqual(['Aceitar:solid', 'Reprocessar páginas com falha:default', 'Descartar:default']);
    expect(html).toContain('name="id" value="0190a0b0-0000-7000-8000-000000000003"');
    expect(html).toContain('<dialog');
    expect(html).toContain('href="/files/0190a0b0-0000-7000-8000-000000000003/pages/1"');

    html = await page('en');
    expect(html).toContain('Quality report');
    expect(html).toContain('3 pages could not be read.');
    expect(html).toContain('Pages 40 to 41');
    expect(buttons(html)).toEqual(['Accept:solid', 'Reprocess failed pages:default', 'Discard:default']);
  });

  it('shows only the actions the material allows: read-only when ready, retry and discard when failed, none while processing', async () => {
    const routes: Record<string, { status: number; body: unknown }> = { [REPORT]: { status: 200, body: { outline: [], unreadable: [], warnings: [{ code: 'report.outline_empty', count: 0 }] } } };
    const server = await useBackend(routes);
    const answer = (body: Record<string, unknown>) => {
      routes[MATERIAL] = { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', ...body } };
    };

    // Nothing to reprocess.
    answer({ state: 'needs_review', actions: ['accept', 'discard'], pages: { ...reviewPages, unreadable: 0 } });
    let html = await page();
    expect(buttons(html)).toEqual(['Aceitar:solid', 'Descartar:default']);
    expect(html).toContain('Nenhuma seção foi encontrada no texto.');
    expect(html).not.toContain('Páginas ilegíveis');

    // Accepted: the report, read-only, and the pill "pronto".
    answer({ state: 'ready', actions: [], pages: reviewPages });
    html = await page();
    expect(html).toContain('pronto');
    expect(html).toContain('Relatório de qualidade');
    expect(buttons(html)).toEqual([]);
    expect(html).not.toContain('<dialog');

    // Failed: why, then Tentar de novo and Descartar.
    answer({ state: 'failed', failure: 'ingestion.step_failed', actions: ['retry', 'discard'] });
    server.calls.length = 0;
    html = await page();
    expect(html).toContain('Este arquivo não pôde ser processado.');
    expect(html.indexOf('Este arquivo não pôde ser processado.')).toBeLessThan(html.indexOf('Tentar de novo'));
    expect(buttons(html)).toEqual(['Tentar de novo:solid', 'Descartar:default']);
    expect(html).not.toContain('Relatório de qualidade');
    expect(server.calls.map((call) => call.url)).not.toContain(`/api/v1/materials/${MATERIAL_ID}/report`);

    // Retry impossible: only Descartar.
    answer({ state: 'failed', failure: 'ingestion.password_required', actions: ['discard'] });
    expect(buttons(await page())).toEqual(['Descartar:default']);

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
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', state: 'needs_review', actions: ['accept', 'discard'], pages: reviewPages } },
      [REPORT]: problem(503, 'server.unavailable'),
    });
    const html = await page();
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    expect(html).not.toContain('server.unavailable');
    expect(buttons(html)).toEqual(['Aceitar:solid', 'Descartar:default']);
  });

  it('the signed-in layout names the newest material that needs review in a warning notice that links to it', async () => {
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
          ],
        },
      },
    };
    await useBackend(routes);
    let html = await layoutHtml();
    expect(html).toMatch(/<div role="status"[^>]*data-status="warning"/);
    expect(html).toContain('Bestiário.pdf precisa de revisão.');
    expect(html).toContain('href="/files/0190a0b0-0000-7000-8000-000000000006">Revisar</a>');
    expect(html).not.toContain('Antigo.pdf precisa de revisão.');
    expect(html).toContain('aria-label="Dispensar aviso"');
    cookieJar['__Host-gmshield-lang'] = 'en';
    html = await layoutHtml();
    expect(html).toContain('Bestiário.pdf needs review.');
    expect(html).toContain('>Review</a>');

    // Accepted (no longer in the tray's states): the notice is gone.
    routes[MATERIALS] = { status: 200, body: { items: [{ id: '0190a0b0-0000-7000-8000-000000000007', name: 'Enviando.pdf', state: 'processing', actions: [] }] } };
    expect(await layoutHtml()).not.toContain('role="status"');

    // A campaign notice already shown: no second notice.
    routes['GET /api/v1/campaigns/current'] = problem(503, 'server.unavailable');
    routes[MATERIALS] = { status: 200, body: { items: [{ id: MATERIAL_ID, name: 'Antigo.pdf', state: 'needs_review', actions: [] }] } };
    html = await layoutHtml();
    expect(html).toContain('data-status="danger"');
    expect(html).not.toContain('needs review.');
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });
});

describe('a page beside its extracted text (Story 1.20)', () => {
  const MATERIAL = `GET /api/v1/materials/${MATERIAL_ID}`;
  const at = (page: number) => `GET /api/v1/materials/${MATERIAL_ID}/pages/${page}?ground=review`;
  const route = async (page: string) =>
    renderToStaticMarkup(await PageRoute({ params: Promise.resolve({ id: MATERIAL_ID, page }) }));

  it('a picture page sits beside "Texto extraído", which holds its lines, or says none was extracted', async () => {
    await useBackend({
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', state: 'needs_review', actions: [] } },
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
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', state: 'needs_review', actions: [] } },
      [at(9)]: { status: 200, body: { page: 9, pageTotal: 30, picture: null, lines: [], text: null, passages: [], outcome: 'unreadable' } },
    });
    const html = await route('9');
    expect(html).toContain('Esta página não pôde ser aberta.');
    expect(html).toContain('Página 9 de 30');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('/picture');
    expect(html).not.toContain('Texto extraído');
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/8"`);
    expect(html).toContain(`href="/files/${MATERIAL_ID}/pages/10"`);
  });
});
