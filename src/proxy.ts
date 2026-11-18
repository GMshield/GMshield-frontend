import { NextResponse, type NextRequest } from 'next/server';

import { problemFields } from '@/messages';
import { renewSession } from '@/server/accounts';
import { logEvent } from '@/server/log';
import { PATH_HEADER, SESSION_COOKIE, due, endedPath, sessionCookieFor, sessionFrom } from '@/server/session-cookies';
import { outgoingTraceparent, parseTraceparent, traceFrom } from '@/server/trace';

/**
 * Runs before every request except Next.js's own static files:
 *
 * - refuses POST, PUT, PATCH and DELETE that do not come from the site's own origin (403); Google's
 *   redirect to `/auth/google/callback` is a GET, so it passes;
 * - renews the session token once its renew-after time has passed (Story 1.10), before the page, route
 *   or action runs, so that it sees the new token, and sets the new cookie on the answer. Only a
 *   document visit or a Server Action renews (see {@link renewsFor}); router fetches and prefetches
 *   pass through unchanged. Another renewal that came first, or a backend that does not answer, leaves
 *   the token as it is; an ended session sends a document visit to `/sign-in/ended` with the path to
 *   come back to, and lets any other request go on to meet the backend's answer itself;
 * - sets a Content-Security-Policy that allows the site's own origin only (and WebAssembly, for the upload's hash), with a new nonce per
 *   request for the inline scripts and styles Next.js writes (it reads the nonce from the request's
 *   `Content-Security-Policy` header), and lets a form's redirect reach Google's sign-in;
 * - marks every answer `Cache-Control: no-store`;
 * - gives the request a valid `traceparent`, so the page or route logs and forwards the same trace;
 * - names the requested path and query in `x-gmshield-path`, replacing any value the browser sent, so the
 *   signed-in layout knows where to come back to after an ended or renewed session (Story 1.11).
 *
 * It does not run on `/api/v1/uploads/**` (Story 1.13, see {@link config}): when a proxy runs, Next.js keeps a copy of
 * up to 10 MB of the request body in memory, and an upload part is 64 MiB. That route checks the origin itself with
 * {@link isSameOrigin}, and sets `no-store` on its answers.
 */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Set on every answer of the proxy, beside the Content-Security-Policy and `no-store`. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function contentSecurityPolicy(nonce: string, development: boolean): string {
  // 'wasm-unsafe-eval' lets the page compile WebAssembly, and nothing else: the whole-file SHA-256 of an upload
  // runs in hash-wasm (Story 1.13), which a real browser refuses without it (found in Story 1.14). JavaScript eval
  // stays blocked outside development.
  const scripts = `'self' 'nonce-${nonce}' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ''}`;
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'self'",
    "child-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // The sign-in form posts to /sign-in/google, which answers with a redirect to Google's sign-in.
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * The origin the browser sees for this site. Behind a proxy that ends TLS (the planned tunnel),
 * `X-Forwarded-Proto` gives the scheme. A cross-site page cannot set either header without a
 * CORS preflight, which this site never grants.
 */
export function siteOrigin(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const scheme = forwarded === 'http' || forwarded === 'https' ? forwarded : request.nextUrl.protocol.replace(/:$/, '');
  const host = request.headers.get('host') ?? request.nextUrl.host;
  return `${scheme}://${host}`.toLowerCase();
}

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin !== null) {
    return origin.toLowerCase() === siteOrigin(request);
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

function newNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}

/** Where the proxy never renews: sign-in and Google's return, the health check, and the renewal route itself. */
export const NO_RENEWAL_PATHS: readonly string[] = ['/sign-in', '/auth', '/api/health', '/session/renew'];

export function renewsOn(pathname: string): boolean {
  return !NO_RENEWAL_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** What the renewal decided: a new cookie value with its options, an ended session, or nothing to do. */
type Renewal =
  | { readonly kind: 'renewed'; readonly cookie: ReturnType<typeof sessionCookieFor> }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unchanged' };

/*
 * Which requests renew or are redirected. Next.js removes its own router headers (`rsc`,
 * `next-router-prefetch`, `next-router-state-tree`, ...) from the request before the proxy runs, so
 * they cannot tell a router fetch from a page. The browser's `Sec-Fetch-Dest` and Next.js's
 * `Next-Action` reach the proxy, so the kinds are told apart by those.
 */

/**
 * A document visit: a GET or HEAD the browser loads as a page (`Sec-Fetch-Dest: document`), not a
 * speculative load. Without a `Sec-Fetch-Dest` header (an older browser), every GET or HEAD counts as one. Router RSC fetches and
 * prefetches are `fetch` calls (`Sec-Fetch-Dest: empty`), so they are not.
 */
export function isDocumentVisit(request: NextRequest): boolean {
  if ((request.method !== 'GET' && request.method !== 'HEAD') || isSpeculative(request)) {
    return false;
  }
  const destination = request.headers.get('sec-fetch-dest');
  return destination === null || destination === 'document';
}

/**
 * A browser's speculative load (`Sec-Purpose: prefetch`, also `prefetch;prerender`, or the older
 * `Purpose: prefetch`): it says `Sec-Fetch-Dest: document`, but the browser may drop its answer, so it is
 * no document visit.
 */
export function isSpeculative(request: NextRequest): boolean {
  const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '';
  return purpose.split(';').some((part) => part.trim().toLowerCase() === 'prefetch');
}

/** A Server Action: a POST carrying Next.js's `Next-Action` header. */
export function isServerAction(request: NextRequest): boolean {
  return request.method === 'POST' && request.headers.has('next-action');
}

/**
 * Only a document visit or a Server Action renews: the answer of any other request (a router RSC fetch,
 * a prefetch, another `fetch`) may be dropped, and a renewed cookie with it, leaving the browser with a
 * token that turns stale once the overlap ends.
 */
export function renewsFor(request: NextRequest): boolean {
  return (isDocumentVisit(request) || isServerAction(request)) && renewsOn(request.nextUrl.pathname);
}

async function renewIfDue(request: NextRequest, traceparent: string, traceId: string): Promise<Renewal> {
  const session = sessionFrom(request.cookies.get(SESSION_COOKIE)?.value);
  if (session === null || !due(session) || !renewsFor(request)) {
    return { kind: 'unchanged' };
  }
  const result = await renewSession(session.token, { traceparent });
  if (result.ok) {
    logEvent('INFO', 'proxy', 'session.renewed', traceId);
    return { kind: 'renewed', cookie: sessionCookieFor(result.data) };
  }
  // session.already_renewed: another request renewed first and its answer carries the new cookie;
  // unavailable or anything else: the token stays, and the page itself meets whatever the backend says.
  return problemFields(result.problem).code === 'session.required' ? { kind: 'ended' } : { kind: 'unchanged' };
}

function withCommonHeaders<T extends NextResponse>(response: T, policy: string): T {
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const incoming = request.headers.get('traceparent');
  const trace = traceFrom(incoming);
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');

  if (STATE_CHANGING_METHODS.has(request.method) && !isSameOrigin(request)) {
    logEvent('WARN', 'proxy', 'request.refused', trace.traceId, { method: request.method, reason: 'request.cross_origin' });
    return NextResponse.json(
      {
        type: 'urn:gmshield:problem:request.cross_origin',
        title: 'Cross-origin request refused',
        status: 403,
        category: 'request',
        code: 'request.cross_origin',
        params: {},
        traceId: trace.traceId,
      },
      {
        status: 403,
        headers: {
          'Content-Type': 'application/problem+json',
          'Content-Security-Policy': policy,
          'Cache-Control': 'no-store',
          ...SECURITY_HEADERS,
        },
      },
    );
  }

  const traceparent = parseTraceparent(incoming) === null ? outgoingTraceparent(trace) : incoming!;
  const renewal = await renewIfDue(request, traceparent, trace.traceId);
  if (renewal.kind === 'ended' && isDocumentVisit(request)) {
    const back = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    // Next.js needs an absolute Location on a proxy answer: the same origin as the request, then the path.
    return withCommonHeaders(NextResponse.redirect(new URL(endedPath(back), request.nextUrl), 303), policy);
  }
  if (renewal.kind === 'renewed') {
    // The page, route or action of this request reads the new token from its own cookie header.
    request.cookies.set(SESSION_COOKIE, renewal.cookie.value);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', policy);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('traceparent', traceparent);
  requestHeaders.set(PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (renewal.kind === 'renewed') {
    response.cookies.set(SESSION_COOKIE, renewal.cookie.value, renewal.cookie.options);
  }
  return withCommonHeaders(response, policy);
}

export const config = {
  // Everything but Next.js's static files and the upload relay, whose bodies must stream (see above).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/v1/uploads).*)'],
};
