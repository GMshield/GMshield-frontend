import { NextResponse, type NextRequest } from 'next/server';

import { renewSession } from '@/server/accounts';
import { SESSION_COOKIE, endedPath, safeReturnPath, sessionCookieFor, sessionFrom } from '@/server/session-cookies';

export const dynamic = 'force-dynamic';

function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } });
}

/**
 * Where a page goes when the backend answers `session.renewal_required` (the account's seal version rose,
 * Story 1.10): a Server Component cannot set a cookie, so this renews the token, sets the new cookie and
 * answers 303 back to `next`, which then loads with the new token. Any failure, a renewal that another
 * request won included, ends at `/sign-in/ended`, so the browser never goes round in a loop.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  const session = sessionFrom(request.cookies.get(SESSION_COOKIE)?.value);
  if (session === null) {
    return seeOther(endedPath(next));
  }
  const result = await renewSession(session.token);
  if (!result.ok) {
    return seeOther(endedPath(next));
  }
  const cookie = sessionCookieFor(result.data);
  const response = seeOther(next);
  response.cookies.set(SESSION_COOKIE, cookie.value, cookie.options);
  return response;
}
