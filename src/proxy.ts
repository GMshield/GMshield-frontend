import { NextResponse, type NextRequest } from 'next/server';

import { logEvent } from '@/server/log';
import { outgoingTraceparent, parseTraceparent, traceFrom } from '@/server/trace';

/**
 * Runs before every request except Next.js's own static files:
 *
 * - refuses POST, PUT, PATCH and DELETE that do not come from the site's own origin (403);
 * - sets a Content-Security-Policy that allows the site's own origin only, with a new nonce per
 *   request for the inline scripts and styles Next.js writes (it reads the nonce from the request's
 *   `Content-Security-Policy` header);
 * - marks every answer `Cache-Control: no-store`;
 * - gives the request a valid `traceparent`, so the page or route logs and forwards the same trace.
 */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function contentSecurityPolicy(nonce: string, development: boolean): string {
  const scripts = `'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ''}`;
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
    "form-action 'self'",
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

export function proxy(request: NextRequest): NextResponse {
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
        },
      },
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', policy);
  requestHeaders.set('x-nonce', nonce);
  if (parseTraceparent(incoming) === null) {
    requestHeaders.set('traceparent', outgoingTraceparent(trace));
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
