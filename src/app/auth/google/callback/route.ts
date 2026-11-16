import { NextResponse, type NextRequest } from 'next/server';

import { homeWithNotice, signInNoticeFor } from '@/app/sign-in/notice';
import { problemFields } from '@/messages';
import { finishGoogleSignIn } from '@/server/accounts';
import {
  EXPIRED_COOKIE_OPTIONS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE,
  SIGN_IN_COOKIE,
  maxAgeFrom,
  tokenFrom,
} from '@/server/session-cookies';

export const dynamic = 'force-dynamic';

/** A 303 to a path of this site, relative, so it never depends on the host the request named. */
function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } });
}

const PARAMETER_LIMIT = 2048;

function parameter(request: NextRequest, name: string): string | undefined {
  const value = request.nextUrl.searchParams.get(name);
  return value === null ? undefined : value.slice(0, PARAMETER_LIMIT);
}

/**
 * Google's redirect after sign-in (a top-level GET, so the `SameSite=Lax` attempt cookie comes along; the
 * proxy refuses only state-changing methods from elsewhere). It relays the state, the code or Google's
 * error, with the attempt token of the cookie, to the backend, which alone talks to Google:
 *
 * - a known account: the session cookie is set and the visitor lands on `/` signed in;
 * - a first sign-in: on to the username step, keeping the attempt cookie;
 * - anything else: back to the sign-in screen with its message, the attempt cookie cleared.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const attemptToken = tokenFrom(request.cookies.get(SIGN_IN_COOKIE)?.value);
  if (attemptToken === null) {
    const response = seeOther(homeWithNotice('request.sign_in_expired'));
    response.cookies.set(SIGN_IN_COOKIE, '', EXPIRED_COOKIE_OPTIONS);
    return response;
  }
  const result = await finishGoogleSignIn({
    attemptToken,
    state: parameter(request, 'state'),
    code: parameter(request, 'code'),
    error: parameter(request, 'error'),
  });
  if (result.ok && result.data.outcome === 'username_required') {
    return seeOther('/sign-in/username');
  }
  let response: NextResponse;
  if (result.ok && result.data.outcome === 'signed_in' && result.data.session !== undefined) {
    response = seeOther('/');
    response.cookies.set(SESSION_COOKIE, result.data.session.sessionToken, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: maxAgeFrom(result.data.session.expiresInSeconds, SESSION_MAX_AGE),
    });
  } else {
    response = seeOther(homeWithNotice(signInNoticeFor(result.ok ? null : problemFields(result.problem).code)));
  }
  response.cookies.set(SIGN_IN_COOKIE, '', EXPIRED_COOKIE_OPTIONS);
  return response;
}
