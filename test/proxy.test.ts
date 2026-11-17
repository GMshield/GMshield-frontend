import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NO_RENEWAL_PATHS, config, contentSecurityPolicy, isDocumentVisit, isServerAction, isSpeculative, proxy, renewsFor, renewsOn, siteOrigin } from '@/proxy';

import { captureOutput } from './support/capture';
import { closedAddress, startScripted, type Scripted } from './support/servers';

const SITE = 'http://127.0.0.1:3000';

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(new URL(path, SITE), {
    method: init.method ?? 'GET',
    headers: { host: '127.0.0.1:3000', ...init.headers },
  });
}

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('same-origin');
  expect(response.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
}

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe('proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('Page: GET / passes with a nonce CSP and no-store', async () => {
    const response = await proxy(request('/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const policy = response.headers.get('content-security-policy')!;
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    expect(nonce).toBeDefined();
    // Next.js reads the nonce from the request's policy: the same policy is forwarded.
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expectSecurityHeaders(response);
  });

  it('names the requested path for the signed-in layout, replacing what the browser sent (Story 1.11)', async () => {
    const response = await proxy(request('/systems?x=1', { headers: { 'x-gmshield-path': '//evil.example/' } }));
    expect(response.headers.get('x-middleware-request-x-gmshield-path')).toBe('/systems?x=1');
  });

  it('allows the site itself only: every fetch directive is self, plus the nonce on scripts and styles', () => {
    const map = directives(contentSecurityPolicy('abc123==', false));
    const fetchDirectives = ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'media-src', 'manifest-src', 'worker-src', 'frame-src', 'child-src'];
    for (const name of fetchDirectives) {
      const values = map.get(name);
      expect(values, name).toBeDefined();
      const expected =
        name === 'script-src'
          ? ["'self'", "'nonce-abc123=='", "'wasm-unsafe-eval'"]
          : name === 'style-src'
            ? ["'self'", "'nonce-abc123=='"]
            : ["'self'"];
      expect(values, name).toEqual(expected);
    }
    expect(map.get('object-src')).toEqual(["'none'"]);
    expect(map.get('frame-ancestors')).toEqual(["'none'"]);
    expect(map.get('base-uri')).toEqual(["'self'"]);
    // The sign-in form's post is answered with a redirect to Google (Story 1.9).
    expect(map.get('form-action')).toEqual(["'self'", 'https://accounts.google.com']);
    expect([...map.keys()].sort()).toEqual([...fetchDirectives, 'object-src', 'frame-ancestors', 'base-uri', 'form-action'].sort());
  });

  it('uses a new nonce for every request', async () => {
    const a = (await proxy(request('/'))).headers.get('content-security-policy');
    const b = (await proxy(request('/'))).headers.get('content-security-policy');
    expect(a).not.toBe(b);
  });

  it('marks API answers no-store too', async () => {
    const response = await proxy(request('/api/health'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('Cross-origin POST: 403 problem detail request.cross_origin', async () => {
    const output = captureOutput();
    const response = await proxy(request('/api/health', { method: 'POST', headers: { origin: 'https://evil.example' } }));
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expectSecurityHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      type: 'urn:gmshield:problem:request.cross_origin',
      status: 403,
      category: 'request',
      code: 'request.cross_origin',
      params: {},
    });
    expect(body.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(output.lines()[0]).toMatchObject({ event: 'request.refused', unit: 'proxy', method: 'POST', traceId: body.traceId });
    expect(output.raw()).not.toContain('evil.example');
  });

  it('refuses every state-changing method without the same origin', async () => {
    captureOutput();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const variants: Record<string, string>[] = [
        { origin: 'https://evil.example' },
        { origin: 'null' },
        { origin: 'http://127.0.0.1:3001' },
        { origin: 'https://127.0.0.1:3000' },
        {},
        { 'sec-fetch-site': 'same-site' },
        { 'sec-fetch-site': 'cross-site' },
        { 'sec-fetch-site': 'none' },
        // An Origin header decides even when Sec-Fetch-Site claims the same origin.
        { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' },
      ];
      for (const headers of variants) {
        expect((await proxy(request('/', { method, headers }))).status, `${method} ${JSON.stringify(headers)}`).toBe(403);
      }
    }
  });

  it('lets same-origin state changes through', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await proxy(request('/', { method, headers: { origin: SITE } }))).headers.get('x-middleware-next')).toBe('1');
      expect((await proxy(request('/', { method, headers: { 'sec-fetch-site': 'same-origin' } }))).headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('takes the scheme from X-Forwarded-Proto behind a TLS proxy', async () => {
    const behindTunnel = request('/', { method: 'POST', headers: { host: 'gmshield.example', 'x-forwarded-proto': 'https', origin: 'https://gmshield.example' } });
    expect(siteOrigin(behindTunnel)).toBe('https://gmshield.example');
    expect((await proxy(behindTunnel)).headers.get('x-middleware-next')).toBe('1');
  });

  it('does not refuse safe methods from elsewhere', async () => {
    expect((await proxy(request('/', { headers: { origin: 'https://evil.example' } }))).headers.get('x-middleware-next')).toBe('1');
  });

  it('gives the request a traceparent when it has no valid one, and keeps a valid one', async () => {
    const created = (await proxy(request('/'))).headers.get('x-middleware-request-traceparent');
    expect(created).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const valid = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const kept = await proxy(request('/', { headers: { traceparent: valid } }));
    expect(kept.headers.get('x-middleware-request-traceparent')).toBe(valid);
  });

  it('adds unsafe-eval in development only', () => {
    expect(contentSecurityPolicy('n', true)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy('n', false)).not.toContain("'unsafe-eval'");
    // WebAssembly only (the upload's whole-file hash, Story 1.14): never JavaScript eval.
    expect(contentSecurityPolicy('n', false)).toContain("'wasm-unsafe-eval'");
  });

  it('runs on everything except Next.js static files and the upload relay (Story 1.13)', () => {
    const [source] = config.matcher;
    const pattern = new RegExp(`^${source!}$`);
    for (const path of ['/', '/api/health', '/campaigns/1', '/api/v1/other', '/files/add']) {
      expect(pattern.test(path), path).toBe(true);
    }
    // When the proxy runs, Next.js holds up to 10 MB of the body in memory: an upload part must stream past it.
    for (const path of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico', '/api/v1/uploads', '/api/v1/uploads/abc',
      '/api/v1/uploads/abc/completion']) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});

describe('proxy: session renewal (Story 1.10)', () => {
  const OLD = 'oldSessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const NEW = 'newSessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const CREDENTIAL = 'configured-service-credential-0123456789';
  const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  let backend: Scripted | undefined;

  async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
    backend = await startScripted(routes);
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
    return backend;
  }

  function withSession(path: string, cookie: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
    return request(path, { ...init, headers: { cookie: `__Host-gmshield-session=${cookie}; __Host-gmshield-lang=en`, traceparent: TRACEPARENT, ...init.headers } });
  }

  const now = () => Math.floor(Date.now() / 1000);
  const GRANT = { status: 200, body: { sessionToken: NEW, expiresInSeconds: 600_000, renewAfterSeconds: 900 } };
  const problem = (status: number, code: string) => ({ status, body: { status, category: code.split('.')[0], code, params: {}, traceId: 't' } });

  afterEach(async () => {
    await backend?.close();
    backend = undefined;
    vi.unstubAllEnvs();
  });

  it('renews a token past its renew-after time: the new cookie on the answer, and the page sees the new token', async () => {
    const server = await useBackend({ 'POST /api/v1/session/renewal': GRANT });
    const output = captureOutput();
    const response = await proxy(withSession('/', `${OLD}.${now() - 1}`));

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(server.calls).toHaveLength(1);
    const [call] = server.calls;
    expect(call!.headers['x-session-token']).toBe(OLD);
    expect(call!.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
    expect(call!.headers.cookie).toBeUndefined();
    expect(String(call!.headers.traceparent)).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-/);
    const [setCookie] = response.headers.getSetCookie();
    const match = new RegExp(`^__Host-gmshield-session=${NEW}\\.(\\d+); Path=/; (Expires=[^;]+; )?Max-Age=600000; Secure; HttpOnly; SameSite=lax$`, 'i').exec(setCookie ?? '');
    expect(match, setCookie).not.toBeNull();
    expect(Math.abs(Number(match![1]) - (now() + 900))).toBeLessThanOrEqual(2);
    // The request goes on with the new token and the other cookies as they were.
    const forwarded = response.headers.get('x-middleware-request-cookie') ?? '';
    expect(forwarded).toContain(`__Host-gmshield-session=${NEW}.`);
    expect(forwarded).not.toContain(OLD);
    expect(forwarded).toContain('__Host-gmshield-lang=en');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(output.raw()).toContain('session.renewed');
    expect(output.raw()).not.toContain(OLD);
    expect(output.raw()).not.toContain(NEW);
  });

  it('renews a cookie of Story 1.9, which has no renew-after time, at once', async () => {
    const server = await useBackend({ 'POST /api/v1/session/renewal': GRANT });
    captureOutput();
    const response = await proxy(withSession('/terms', OLD));
    expect(server.calls).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toMatch(new RegExp(`^__Host-gmshield-session=${NEW}\\.`));
  });

  it('leaves a token alone before its renew-after time, and never renews on sign-in, Google, health or renewal paths', async () => {
    const server = await useBackend({ 'POST /api/v1/session/renewal': GRANT });
    const early = await proxy(withSession('/', `${OLD}.${now() + 60}`));
    expect(early.headers.getSetCookie()).toEqual([]);
    for (const path of ['/sign-in/ended', '/sign-in/username', '/auth/google/callback', '/api/health', '/session/renew']) {
      const response = await proxy(withSession(path, `${OLD}.${now() - 1}`));
      expect(response.headers.getSetCookie(), path).toEqual([]);
    }
    expect(server.calls).toEqual([]);
    expect(NO_RENEWAL_PATHS).toEqual(['/sign-in', '/auth', '/api/health', '/session/renew']);
    expect(renewsOn('/sign-input')).toBe(true);
    expect(renewsOn('/campaigns/1')).toBe(true);
  });

  it('another renewal came first, or the backend does not answer: the request goes on with the token it has', async () => {
    await useBackend({ 'POST /api/v1/session/renewal': problem(409, 'session.already_renewed') });
    captureOutput();
    const raced = await proxy(withSession('/', `${OLD}.${now() - 1}`));
    expect(raced.headers.get('x-middleware-next')).toBe('1');
    expect(raced.headers.getSetCookie()).toEqual([]);
    expect(raced.headers.get('x-middleware-request-cookie')).toContain(`__Host-gmshield-session=${OLD}.`);

    vi.stubEnv('GMSHIELD_BACKEND_URL', await closedAddress());
    const down = await proxy(withSession('/', `${OLD}.${now() - 1}`));
    expect(down.headers.get('x-middleware-next')).toBe('1');
    expect(down.headers.getSetCookie()).toEqual([]);
  });

  it('an ended session: a page visit goes to /sign-in/ended with the path and query to come back to', async () => {
    await useBackend({ 'POST /api/v1/session/renewal': problem(401, 'session.required') });
    captureOutput();
    const response = await proxy(withSession('/campaigns/1?tab=notes', `${OLD}.${now() - 1}`));
    expect(response.status).toBe(303);
    // Absolute, as Next.js requires of a proxy answer, on the request's own origin (Next.js then makes it relative).
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe(new NextRequest(new URL('/', SITE)).nextUrl.origin);
    expect(`${location.pathname}${location.search}`).toBe('/sign-in/ended?next=%2Fcampaigns%2F1%3Ftab%3Dnotes');
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expectSecurityHeaders(response);
    // A plain form post goes on (no renewal): its own call meets session.required and answers it.
    const action = await proxy(withSession('/', `${OLD}.${now() - 1}`, { method: 'POST', headers: { origin: SITE } }));
    expect(action.headers.get('x-middleware-next')).toBe('1');
  });

  // What a browser sends: Next.js removes rsc and next-router-prefetch before the proxy runs, so a
  // router fetch or prefetch reaches it as a plain fetch (Sec-Fetch-Dest: empty).
  const DOCUMENT = { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' };
  const FETCH = { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' };

  it('a fetch (router RSC fetch, prefetch) with a due cookie neither renews nor is redirected', async () => {
    const server = await useBackend({ 'POST /api/v1/session/renewal': problem(401, 'session.required') });
    captureOutput();
    for (const path of ['/', '/campaigns/1', '/terms?x=1']) {
      const response = await proxy(withSession(path, `${OLD}.${now() - 1}`, { headers: FETCH }));
      expect(response.headers.get('x-middleware-next'), path).toBe('1');
      expect(response.status, path).not.toBe(303);
      expect(response.headers.get('location'), path).toBeNull();
      expect(response.headers.getSetCookie(), path).toEqual([]);
      expect(response.headers.get('x-middleware-request-cookie') ?? '', path).not.toContain(NEW);
    }
    expect(server.calls).toEqual([]);
  });

  it('a document visit with a due cookie renews; with an ended session it is redirected, GET and HEAD alike', async () => {
    const renewing = await useBackend({ 'POST /api/v1/session/renewal': GRANT });
    captureOutput();
    const renewed = await proxy(withSession('/campaigns/1', `${OLD}.${now() - 1}`, { headers: DOCUMENT }));
    expect(renewing.calls).toHaveLength(1);
    expect(renewed.headers.getSetCookie()[0]).toMatch(new RegExp(`^__Host-gmshield-session=${NEW}\\.`));
    await renewing.close();

    await useBackend({ 'POST /api/v1/session/renewal': problem(401, 'session.required') });
    for (const method of ['GET', 'HEAD']) {
      const ended = await proxy(withSession('/terms?x=1', `${OLD}.${now() - 1}`, { method, headers: DOCUMENT }));
      expect(ended.status, method).toBe(303);
      expect(new URL(ended.headers.get('location')!).search, method).toBe('?next=%2Fterms%3Fx%3D1');
    }
  });

  it('a browser speculative load (Sec-Purpose or Purpose: prefetch) neither renews nor is redirected', async () => {
    const server = await useBackend({ 'POST /api/v1/session/renewal': problem(401, 'session.required') });
    captureOutput();
    const purposes: Record<string, string>[] = [{ 'sec-purpose': 'prefetch' }, { 'sec-purpose': 'prefetch;prerender' }, { purpose: 'prefetch' }];
    for (const purpose of purposes) {
      const response = await proxy(withSession('/terms?x=1', `${OLD}.${now() - 1}`, { headers: { ...DOCUMENT, ...purpose } }));
      expect(response.headers.get('x-middleware-next'), JSON.stringify(purpose)).toBe('1');
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(isDocumentVisit(withSession('/', OLD, { headers: { ...DOCUMENT, ...purpose } }))).toBe(false);
      expect(isSpeculative(withSession('/', OLD, { headers: purpose }))).toBe(true);
    }
    expect(server.calls).toEqual([]);
    expect(isSpeculative(withSession('/', OLD, { headers: { 'sec-purpose': 'prerender' } }))).toBe(false);
  });

  it('a Server Action with a due cookie renews, and with an ended session goes on to meet the answer itself', async () => {
    const renewing = await useBackend({ 'POST /api/v1/session/renewal': GRANT });
    captureOutput();
    const action = { origin: SITE, 'next-action': 'a1b2c3', ...FETCH };
    const renewed = await proxy(withSession('/', `${OLD}.${now() - 1}`, { method: 'POST', headers: action }));
    expect(renewing.calls).toHaveLength(1);
    expect(renewed.headers.getSetCookie()[0]).toMatch(new RegExp(`^__Host-gmshield-session=${NEW}\\.`));
    expect(renewed.headers.get('x-middleware-request-cookie')).toContain(`__Host-gmshield-session=${NEW}.`);
    await renewing.close();

    const ending = await useBackend({ 'POST /api/v1/session/renewal': problem(401, 'session.required') });
    const ended = await proxy(withSession('/', `${OLD}.${now() - 1}`, { method: 'POST', headers: action }));
    expect(ending.calls).toHaveLength(1);
    expect(ended.headers.get('x-middleware-next')).toBe('1');
    expect(ended.headers.get('location')).toBeNull();
    // A POST without Next-Action (a plain form post) does not renew.
    const plain = await proxy(withSession('/', `${OLD}.${now() - 1}`, { method: 'POST', headers: { origin: SITE } }));
    expect(ending.calls).toHaveLength(1);
    expect(plain.headers.get('x-middleware-next')).toBe('1');
  });

  it('tells the request kinds apart by Sec-Fetch-Dest and Next-Action; without Sec-Fetch-Dest a GET is a document visit', () => {
    expect(isDocumentVisit(withSession('/', OLD, { headers: DOCUMENT }))).toBe(true);
    expect(isDocumentVisit(withSession('/', OLD, { method: 'HEAD' }))).toBe(true);
    expect(isDocumentVisit(withSession('/', OLD))).toBe(true);
    expect(isDocumentVisit(withSession('/', OLD, { headers: FETCH }))).toBe(false);
    expect(isDocumentVisit(withSession('/', OLD, { headers: { 'sec-fetch-dest': 'image' } }))).toBe(false);
    expect(isDocumentVisit(withSession('/', OLD, { method: 'POST', headers: { origin: SITE, ...DOCUMENT } }))).toBe(false);
    expect(isServerAction(withSession('/', OLD, { method: 'POST', headers: { 'next-action': 'x' } }))).toBe(true);
    expect(isServerAction(withSession('/', OLD, { method: 'POST' }))).toBe(false);
    expect(isServerAction(withSession('/', OLD, { headers: { 'next-action': 'x' } }))).toBe(false);
    expect(renewsFor(withSession('/campaigns/1', OLD, { headers: DOCUMENT }))).toBe(true);
    expect(renewsFor(withSession('/sign-in/ended', OLD, { headers: DOCUMENT }))).toBe(false);
    expect(renewsFor(withSession('/campaigns/1', OLD, { headers: FETCH }))).toBe(false);
  });
});
