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

    answer({ state: 'processing', pages: { done: 0, total: 320 } });
    expect(await page()).toContain('processando · 0 de 320 páginas');
    expect(await page('en')).toContain('processing · 0 of 320 pages');

    const failures: [string | undefined, string, string][] = [
      ['ingestion.password_required', 'Este PDF é protegido por senha. Remova a senha e envie o arquivo de novo.', 'This PDF is protected by a password.'],
      ['ingestion.file_unreadable', 'Não foi possível ler este arquivo como PDF.', 'This file could not be read as a PDF.'],
      ['ingestion.too_many_steps', 'precisou de mais etapas do que suas páginas permitem', 'needed more steps than its pages allow'],
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
