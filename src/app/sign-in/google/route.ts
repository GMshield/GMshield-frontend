import { NextResponse } from 'next/server';

import { problemFields } from '@/messages';
import { safeAuthorizationUrl, startGoogleSignIn } from '@/server/accounts';
import { SIGN_IN_COOKIE, SIGN_IN_COOKIE_OPTIONS, SIGN_IN_MAX_AGE, maxAgeFrom } from '@/server/session-cookies';

import { homeWithNotice, signInNoticeFor } from '../notice';

export const dynamic = 'force-dynamic';

function seeOther(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

/**
 * "Continuar com Google": a plain form post (the proxy refuses it from another origin), answered with a
 * 303, so the browser always makes a full navigation to Google, or in the backend's test mode to the
 * frontend's own callback. The backend issues the attempt; its token goes into the `__Host-` cookie.
 * The destination must be Google's authorization endpoint or the callback path, nothing else.
 */
export async function POST(): Promise<NextResponse> {
  const result = await startGoogleSignIn();
  if (!result.ok) {
    return seeOther(homeWithNotice(signInNoticeFor(problemFields(result.problem).code)));
  }
  const destination = safeAuthorizationUrl(result.data.authorizationUrl);
  if (destination === null) {
    return seeOther(homeWithNotice('server.unexpected'));
  }
  const response = seeOther(destination);
  response.cookies.set(SIGN_IN_COOKIE, result.data.attemptToken, {
    ...SIGN_IN_COOKIE_OPTIONS,
    maxAge: maxAgeFrom(result.data.expiresInSeconds, SIGN_IN_MAX_AGE),
  });
  return response;
}
