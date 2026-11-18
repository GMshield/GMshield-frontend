import { NextResponse, type NextRequest } from 'next/server';

import {
  EXPIRED_COOKIE_OPTIONS,
  RETURN_COOKIE,
  RETURN_COOKIE_OPTIONS,
  SESSION_COOKIE,
  safeReturnPath,
} from '@/server/session-cookies';

import { homeWithNotice } from '../notice';

export const dynamic = 'force-dynamic';

/**
 * Where a visitor whose session the backend no longer knows is sent (by `/`, the proxy or
 * `/session/renew`): a Server Component cannot clear a cookie, so this clears the stale session cookie
 * and answers 303 to the sign-in screen with "Sua sessão terminou." once, instead of on every visit for
 * the cookie's remaining days. A safe `next` path is kept for an hour in `__Host-gmshield-return`, so that
 * signing in again lands where the visitor was (Story 1.10).
 */
export function GET(request: NextRequest): NextResponse {
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: homeWithNotice('session.required'), 'Cache-Control': 'no-store' },
  });
  response.cookies.set(SESSION_COOKIE, '', EXPIRED_COOKIE_OPTIONS);
  if (next === '/') {
    response.cookies.set(RETURN_COOKIE, '', EXPIRED_COOKIE_OPTIONS);
  } else {
    response.cookies.set(RETURN_COOKIE, next, RETURN_COOKIE_OPTIONS);
  }
  return response;
}
