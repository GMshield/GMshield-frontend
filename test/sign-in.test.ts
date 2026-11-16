import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SetCall = { name: string; value: string; options: Record<string, unknown> };
let setCalls: SetCall[] = [];
let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' }),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
      cookieJar[name] = value;
    },
  }),
}));

const { NextRequest } = await import('next/server');
const accounts = await import('@/server/accounts');
const cookiesModule = await import('@/server/session-cookies');
const { GET: callback } = await import('@/app/auth/google/callback/route');
const { completeSignInAction, signOutAction } = await import('@/app/sign-in/actions');
const { POST: start } = await import('@/app/sign-in/google/route');
const { GET: ended } = await import('@/app/sign-in/ended/route');
const { INITIAL_USERNAME_FORM } = await import('@/app/sign-in/form-state');
const { signInNoticeFrom } = await import('@/app/sign-in/notice');
const { default: HomePage } = await import('@/app/page');
const { default: UsernamePage } = await import('@/app/sign-in/username/page');
const { renderToStaticMarkup } = await import('react-dom/server');
const { captureOutput } = await import('./support/capture');
const { closedAddress, startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const ATTEMPT = 'attemptTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const COOKIE = { secure: true, httpOnly: true, sameSite: 'lax', path: '/' };
const EXPIRED = { ...COOKIE, maxAge: 0 };

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

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  return backend;
}

function problem(status: number, code: string, params: Record<string, number> = {}) {
  return { status, body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params, traceId: 't' } };
}

beforeEach(() => {
  setCalls = [];
  cookieJar = {};
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('cookies and small rules', () => {
  it('names both cookies with __Host- and keeps them HttpOnly, Secure, Lax, for 600 s and 7 days', () => {
    expect(cookiesModule.SIGN_IN_COOKIE).toBe('__Host-gmshield-sign-in');
    expect(cookiesModule.SESSION_COOKIE).toBe('__Host-gmshield-session');
    expect(cookiesModule.SIGN_IN_COOKIE_OPTIONS).toEqual({ ...COOKIE, maxAge: 600 });
    expect(cookiesModule.SESSION_COOKIE_OPTIONS).toEqual({ ...COOKIE, maxAge: 604800 });
    expect(cookiesModule.EXPIRED_COOKIE_OPTIONS).toEqual(EXPIRED);
  });

  it('treats a cookie that cannot be a token as absent, and bounds lifetimes', () => {
    expect(cookiesModule.tokenFrom(ATTEMPT)).toBe(ATTEMPT);
    for (const bad of ['', 'short', 'has space aaaaaaaaaaaaaaaa', 'a'.repeat(129), '<script>aaaaaaaaaaaaaaaa', undefined, null]) {
      expect(cookiesModule.tokenFrom(bad), String(bad)).toBeNull();
    }
    expect(cookiesModule.maxAgeFrom(300, 600)).toBe(300);
    for (const bad of [0, -1, 601, 1.5, '300', null]) {
      expect(cookiesModule.maxAgeFrom(bad, 600), String(bad)).toBe(600);
    }
  });

  it('sends the browser only to Google or to its own callback', () => {
    const google = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y';
    expect(accounts.safeAuthorizationUrl(google)).toBe(google);
    expect(accounts.safeAuthorizationUrl('/auth/google/callback?state=s&code=c')).toBe('/auth/google/callback?state=s&code=c');
    for (const bad of ['https://evil.example/o/oauth2', 'http://accounts.google.com/x', '//evil.example/auth/google/callback?x', '/elsewhere',
      'https://user@accounts.google.com/x', 'javascript:alert(1)', 42, null]) {
      expect(accounts.safeAuthorizationUrl(bad), String(bad)).toBeNull();
    }
  });

  it('shows only the known sign-in outcomes', () => {
    expect(signInNoticeFrom('request.sign_in_refused')).toBe('request.sign_in_refused');
    expect(signInNoticeFrom('request.invalid')).toBeNull();
    expect(signInNoticeFrom(['request.sign_in_refused'])).toBeNull();
  });
});

describe('the backend calls', () => {
  it('send the session token as X-Session-Token, never a cookie, with the trace', async () => {
    const server = await useBackend({ 'GET /api/v1/me': { status: 200, body: { username: 'Mestre' } }, 'DELETE /api/v1/session': { status: 204 } });
    expect(await accounts.currentAccount(SESSION)).toEqual({ ok: true, data: { username: 'Mestre' } });
    expect(await accounts.endSession(SESSION)).toMatchObject({ ok: true });
    for (const call of server.calls) {
      expect(call.headers['x-session-token']).toBe(SESSION);
      expect(call.headers.cookie).toBeUndefined();
      expect(String(call.headers.traceparent)).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
    }
  });

  it('give the problem of a refusal, and "unavailable" when the backend does not answer, logging no token', async () => {
    await useBackend({ 'GET /api/v1/me': problem(401, 'session.required') });
    const output = captureOutput();
    const refused = await accounts.currentAccount(SESSION);
    expect(refused).toMatchObject({ ok: false, status: 401, problem: { code: 'session.required' } });
    vi.stubEnv('GMSHIELD_BACKEND_URL', await closedAddress());
    expect(await accounts.currentAccount(SESSION)).toEqual({ ok: false, status: 503, problem: accounts.UNAVAILABLE });
    const lines = output.lines();
    expect(lines.map((line) => line.event)).toEqual(['session.me.refused', 'session.me.backend_unreachable']);
    expect(JSON.stringify(lines)).not.toContain(SESSION);
  });
});

describe('"Continuar com Google" (POST /sign-in/google)', () => {
  it('keeps the attempt token in its cookie and sends the browser to the authorization URL with a 303', async () => {
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=s';
    await useBackend({ 'POST /api/v1/sign-in/google': { status: 200, body: { attemptToken: ATTEMPT, authorizationUrl: url, expiresInSeconds: 600 } } });
    const response = await start();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(url);
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(new RegExp(`^__Host-gmshield-sign-in=${ATTEMPT}; Path=/; (Expires=[^;]+; )?Max-Age=600; Secure; HttpOnly; SameSite=lax$`, 'i')),
    ]);
  });

  it("in test mode, the stand-in's callback path; anywhere else is refused, and a backend failure is shown", async () => {
    await useBackend({ 'POST /api/v1/sign-in/google': { status: 200, body: { attemptToken: ATTEMPT, authorizationUrl: '/auth/google/callback?state=s&code=c', expiresInSeconds: 600 } } });
    expect((await start()).headers.get('location')).toBe('/auth/google/callback?state=s&code=c');
    await backend?.close();
    await useBackend({ 'POST /api/v1/sign-in/google': { status: 200, body: { attemptToken: ATTEMPT, authorizationUrl: 'https://evil.example/', expiresInSeconds: 600 } } });
    const evil = await start();
    expect(evil.headers.get('location')).toBe('/?signIn=server.unexpected');
    expect(evil.headers.getSetCookie()).toEqual([]);
    await backend?.close();
    await useBackend({ 'POST /api/v1/sign-in/google': problem(503, 'server.unavailable') });
    expect((await start()).headers.get('location')).toBe('/?signIn=server.unavailable');
  });
});

describe('Google redirect (GET /auth/google/callback)', () => {
  function relay(query: string, cookie: string | null = ATTEMPT) {
    const headers: Record<string, string> = cookie === null ? {} : { cookie: `__Host-gmshield-sign-in=${cookie}` };
    return callback(new NextRequest(`http://localhost:3000/auth/google/callback${query}`, { headers }));
  }

  function setCookies(response: Response): string[] {
    return response.headers.getSetCookie();
  }

  it('a known account: the session cookie, the attempt cookie cleared, and / signed in', async () => {
    const server = await useBackend({
      'POST /api/v1/sign-in/google/callback': { status: 200, body: { outcome: 'signed_in', session: { sessionToken: SESSION, expiresInSeconds: 604800 } } },
    });
    const response = await relay('?state=the-state&code=the-code');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    const cookies = setCookies(response);
    expect(cookies.find((c) => c.startsWith('__Host-gmshield-session='))).toMatch(
      new RegExp(`^__Host-gmshield-session=${SESSION}; Path=/; (Expires=[^;]+; )?Max-Age=604800; Secure; HttpOnly; SameSite=lax$`, 'i'),
    );
    expect(cookies.find((c) => c.startsWith('__Host-gmshield-sign-in='))).toMatch(/^__Host-gmshield-sign-in=; Path=\/; (Expires=[^;]+; )?Max-Age=0; Secure; HttpOnly; SameSite=lax$/i);
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ attemptToken: ATTEMPT, state: 'the-state', code: 'the-code' });
  });

  it('a first sign-in: on to the username step, keeping the attempt', async () => {
    await useBackend({ 'POST /api/v1/sign-in/google/callback': { status: 200, body: { outcome: 'username_required' } } });
    const response = await relay('?state=s&code=c');
    expect(response.headers.get('location')).toBe('/sign-in/username');
    expect(setCookies(response)).toEqual([]);
  });

  it('no attempt cookie: the sign-in screen says it expired, and the backend is not asked', async () => {
    const server = await useBackend({});
    for (const cookie of [null, 'not a token']) {
      const response = await relay('?state=s&code=c', cookie);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/?signIn=request.sign_in_expired');
    }
    expect(server.calls).toEqual([]);
  });

  it("Google's error or a refusal: the sign-in screen with the backend's code, the attempt cleared", async () => {
    const server = await useBackend({ 'POST /api/v1/sign-in/google/callback': problem(400, 'request.sign_in_refused') });
    const response = await relay('?state=s&error=access_denied');
    expect(response.headers.get('location')).toBe('/?signIn=request.sign_in_refused');
    expect(setCookies(response)[0]).toMatch(/^__Host-gmshield-sign-in=; Path=\/; (Expires=[^;]+; )?Max-Age=0; Secure/);
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ attemptToken: ATTEMPT, state: 's', error: 'access_denied' });
    await backend?.close();
    await useBackend({ 'POST /api/v1/sign-in/google/callback': problem(400, 'request.sign_in_expired') });
    expect((await relay('?state=s&code=c')).headers.get('location')).toBe('/?signIn=request.sign_in_expired');
    await backend?.close();
    await useBackend({ 'POST /api/v1/sign-in/google/callback': problem(500, 'integrity.failed') });
    expect((await relay('?state=s&code=c')).headers.get('location')).toBe('/?signIn=integrity.failed');
    await backend?.close();
    await useBackend({ 'POST /api/v1/sign-in/google/callback': problem(400, 'request.something_new') });
    expect((await relay('?state=s&code=c')).headers.get('location')).toBe('/?signIn=server.unexpected');
  });
});

describe('the callback relay waits for the backend', () => {
  it('gives the callback 16 s, enough for the backend to wait 15 s on Google', async () => {
    expect(accounts.GOOGLE_CALLBACK_TIMEOUT_MS).toBe(16_000);
    // Slower than every other call's 2 s limit: only the callback still gets its answer.
    await useBackend({
      'POST /api/v1/sign-in/google/callback': { status: 200, body: { outcome: 'username_required' }, delayMs: 2500 },
      'GET /api/v1/me': { status: 200, body: { username: 'x' }, delayMs: 2500 },
    });
    expect(await accounts.finishGoogleSignIn({ attemptToken: ATTEMPT, state: 's', code: 'c' })).toEqual({
      ok: true,
      data: { outcome: 'username_required' },
    });
    captureOutput();
    expect(await accounts.currentAccount(SESSION)).toMatchObject({ ok: false, status: 503 });
  }, 10_000);
});

describe('the username step (completeSignInAction)', () => {
  function form(username: string, terms: boolean): FormData {
    const data = new FormData();
    data.set('username', username);
    if (terms) {
      data.set('terms', 'accepted');
    }
    return data;
  }

  it('creates the account: the session cookie, the attempt cookie cleared, and /', async () => {
    cookieJar = { '__Host-gmshield-sign-in': ATTEMPT };
    const server = await useBackend({ 'POST /api/v1/sign-in/complete': { status: 200, body: { sessionToken: SESSION, expiresInSeconds: 604800 } } });
    expect(await redirectOf(() => completeSignInAction(INITIAL_USERNAME_FORM, form('  Mestre_Ana ', true)))).toBe('/');
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ attemptToken: ATTEMPT, username: 'Mestre_Ana', termsAccepted: true });
    expect(setCalls).toEqual([
      { name: '__Host-gmshield-session', value: SESSION, options: { ...COOKIE, maxAge: 604800 } },
      { name: '__Host-gmshield-sign-in', value: '', options: EXPIRED },
    ]);
  });

  it('a taken or invalid username, or unticked terms: the form again with the message under its field', async () => {
    cookieJar = { '__Host-gmshield-sign-in': ATTEMPT };
    await useBackend({ 'POST /api/v1/sign-in/complete': problem(409, 'request.username_taken') });
    expect(await completeSignInAction(INITIAL_USERNAME_FORM, form('mestre', true))).toEqual({
      username: 'mestre',
      termsAccepted: true,
      error: 'Este nome de usuário já está em uso.',
      field: 'username',
    });
    await backend?.close();
    await useBackend({ 'POST /api/v1/sign-in/complete': problem(400, 'request.username_invalid', { min: 3, max: 24 }) });
    expect((await completeSignInAction(INITIAL_USERNAME_FORM, form('ab', true))).error).toBe(
      'Use de 3 a 24 caracteres: letras de a a z, maiúsculas ou minúsculas, números, "_", "." e "-".',
    );
    await backend?.close();
    await useBackend({ 'POST /api/v1/sign-in/complete': problem(400, 'request.terms_required') });
    expect(await completeSignInAction(INITIAL_USERNAME_FORM, form('mestre', false))).toMatchObject({ field: 'terms', termsAccepted: false });
    expect(setCalls).toEqual([]);
  });

  it('an attempt that is over, or no attempt cookie: back to the sign-in screen', async () => {
    cookieJar = { '__Host-gmshield-sign-in': ATTEMPT };
    await useBackend({ 'POST /api/v1/sign-in/complete': problem(400, 'request.sign_in_expired') });
    expect(await redirectOf(() => completeSignInAction(INITIAL_USERNAME_FORM, form('mestre', true)))).toBe('/?signIn=request.sign_in_expired');
    expect(setCalls).toEqual([{ name: '__Host-gmshield-sign-in', value: '', options: EXPIRED }]);
    cookieJar = {};
    expect(await redirectOf(() => completeSignInAction(INITIAL_USERNAME_FORM, form('mestre', true)))).toBe('/?signIn=request.sign_in_expired');
  });
});

describe('"Sair" (signOutAction)', () => {
  it('ends the session at the backend, clears the cookie and goes to the sign-in screen', async () => {
    cookieJar = { '__Host-gmshield-session': SESSION };
    const server = await useBackend({ 'DELETE /api/v1/session': { status: 204 } });
    expect(await redirectOf(() => signOutAction())).toBe('/');
    expect(server.calls.map((call) => [call.method, call.url, call.headers['x-session-token']])).toEqual([['DELETE', '/api/v1/session', SESSION]]);
    expect(setCalls).toEqual([{ name: '__Host-gmshield-session', value: '', options: EXPIRED }]);
  });

  it('clears the cookie even when the backend does not answer', async () => {
    cookieJar = { '__Host-gmshield-session': SESSION };
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_BACKEND_URL', await closedAddress());
    const output = captureOutput();
    expect(await redirectOf(() => signOutAction())).toBe('/');
    expect(setCalls).toEqual([{ name: '__Host-gmshield-session', value: '', options: EXPIRED }]);
    expect(JSON.stringify(output.lines())).not.toContain(SESSION);
  });
});

describe('the home page (/) and the username page', () => {
  it('signed in: "Olá, <username>", the preferences form and "Sair", with the session sent as X-Session-Token', async () => {
    const server = await useBackend({ 'GET /api/v1/me': { status: 200, body: { username: 'Mestre_Ana' } } });
    cookieJar = { '__Host-gmshield-session': SESSION };
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('<h1');
    expect(html).toContain('Olá, Mestre_Ana');
    expect(html).toContain('>Sair<');
    expect(html).toContain('name="theme"');
    expect(html).not.toContain('Continuar com Google');
    expect(server.calls[0]?.headers['x-session-token']).toBe(SESSION);
  });

  it('an ended session: through GET /sign-in/ended, which clears the stale cookie, to "Sua sessão terminou." once', async () => {
    await useBackend({ 'GET /api/v1/me': problem(401, 'session.required') });
    cookieJar = { '__Host-gmshield-session': SESSION };
    expect(await redirectOf(() => HomePage())).toBe('/sign-in/ended');

    const response = ended();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/?signIn=session.required');
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^__Host-gmshield-session=; Path=\/; (Expires=[^;]+; )?Max-Age=0; Secure; HttpOnly; SameSite=lax$/i),
    ]);
    // Back on / without the cookie: the sign-in screen with the message, and no backend call.
    cookieJar = {};
    const html = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({ signIn: 'session.required' }) }));
    expect(html).toContain('Sua sessão terminou.');
    expect(html).toContain('Continuar com Google');
  });

  it('any other failure of /api/v1/me: the sign-in screen saying what happened, the cookie kept', async () => {
    await useBackend({ 'GET /api/v1/me': problem(500, 'integrity.failed') });
    cookieJar = { '__Host-gmshield-session': SESSION };
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('Estes dados não passaram na verificação de integridade');
    expect(setCalls).toEqual([]);
  });

  it('signed out: no backend call, the sign-in screen', async () => {
    const server = await useBackend({});
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('Continuar com Google');
    expect(server.calls).toEqual([]);
  });

  it('the username step needs the attempt cookie', async () => {
    expect(await redirectOf(() => UsernamePage())).toBe('/?signIn=request.sign_in_expired');
    cookieJar = { '__Host-gmshield-sign-in': ATTEMPT };
    const html = renderToStaticMarkup(await UsernamePage());
    expect(html).toContain('Escolha um nome de usuário');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('Criar conta');
  });
});
