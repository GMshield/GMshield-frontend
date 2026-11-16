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

const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { default: SignedInLayout } = await import('@/app/(signed-in)/layout');
const { default: SystemsPage } = await import('@/app/(signed-in)/systems/page');
const { default: FilesAddPage } = await import('@/app/(signed-in)/files/add/page');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const ME = { status: 200, body: { username: 'Mestre_Ana' } };
const CAMPAIGN = {
  status: 200,
  body: { id: '0190a0b0-0000-7000-8000-000000000002', name: 'First campaign', system: { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Untitled system' } },
};

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
    expect(server.calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual(['GET /api/v1/campaigns/current', 'GET /api/v1/me']);
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
    requestHeaders = { 'x-gmshield-path': '/files/add' };
    await useBackend({ 'GET /api/v1/me': problem(401, 'session.renewal_required'), 'GET /api/v1/campaigns/current': CAMPAIGN });
    expect(await redirectOf(() => layoutHtml())).toBe('/session/renew?next=%2Ffiles%2Fadd');
  });

  it('any other failure of the account: the sign-in screen at /, which says what happened', async () => {
    await useBackend({ 'GET /api/v1/me': problem(500, 'integrity.failed'), 'GET /api/v1/campaigns/current': CAMPAIGN });
    expect(await redirectOf(() => layoutHtml())).toBe('/');
  });

  it('no campaign: the shell says so; a campaign that cannot be loaded: a notice in the main column', async () => {
    await useBackend({ 'GET /api/v1/me': ME, 'GET /api/v1/campaigns/current': problem(404, 'request.not_found') });
    let html = await layoutHtml(await FilesAddPage());
    expect(html).toContain('Nenhuma campanha');
    expect(html).not.toContain('role="status"');
    expect(html).toContain('Aqui você vai enviar um livro ou arquivo para a sua biblioteca.');
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
      files: (await import('@/app/(signed-in)/files/page')).default,
      addFile: FilesAddPage,
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
