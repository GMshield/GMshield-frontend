import { NextResponse } from 'next/server';

import { EXPIRED_COOKIE_OPTIONS, SESSION_COOKIE } from '@/server/session-cookies';

import { homeWithNotice } from '../notice';

export const dynamic = 'force-dynamic';

/**
 * Where `/` sends a visitor whose session the backend no longer knows: a Server Component cannot clear a
 * cookie, so this clears the stale session cookie and answers 303 to the sign-in screen with "Sua sessão
 * terminou." once, instead of on every visit for the cookie's remaining days.
 */
export function GET(): NextResponse {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: homeWithNotice('session.required'), 'Cache-Control': 'no-store' },
  });
  response.cookies.set(SESSION_COOKIE, '', EXPIRED_COOKIE_OPTIONS);
  return response;
}
