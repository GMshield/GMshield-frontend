'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { errorText, problemFields } from '@/messages';
import { currentPreferences } from '@/preferences';
import { completeSignIn, endSession } from '@/server/accounts';
import {
  EXPIRED_COOKIE_OPTIONS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE,
  SIGN_IN_COOKIE,
  currentSessionToken,
  currentSignInToken,
  maxAgeFrom,
} from '@/server/session-cookies';

import type { UsernameFormState } from './form-state';
import { homeWithNotice } from './notice';

/**
 * The Server Actions of sign-in (Story 1.9): the username step and sign-out. Starting is a plain form post
 * to `./google/route.ts`. The proxy (src/proxy.ts) and Next.js both refuse a cross-origin POST before any
 * of them runs. Tokens go only into `__Host-` cookies and to the backend.
 */

/**
 * The username step: the backend creates the account and a session. A taken or invalid username, or
 * unticked terms, come back to the form; an attempt that is over goes back to the sign-in screen.
 */
export async function completeSignInAction(_previous: UsernameFormState, form: FormData): Promise<UsernameFormState> {
  const jar = await cookies();
  const attemptToken = await currentSignInToken();
  if (attemptToken === null) {
    redirect(homeWithNotice('request.sign_in_expired'));
  }
  const typed = form.get('username');
  const username = typeof typed === 'string' ? typed.trim().slice(0, 64) : '';
  const termsAccepted = form.get('terms') === 'accepted';
  const result = await completeSignIn({ attemptToken, username, termsAccepted });
  if (result.ok) {
    jar.set(SESSION_COOKIE, result.data.sessionToken, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: maxAgeFrom(result.data.expiresInSeconds, SESSION_MAX_AGE),
    });
    jar.set(SIGN_IN_COOKIE, '', EXPIRED_COOKIE_OPTIONS);
    redirect('/');
  }
  const { code } = problemFields(result.problem);
  if (code === 'request.sign_in_expired') {
    jar.set(SIGN_IN_COOKIE, '', EXPIRED_COOKIE_OPTIONS);
    redirect(homeWithNotice('request.sign_in_expired'));
  }
  const { language } = await currentPreferences();
  let field: UsernameFormState['field'] = null;
  if (code === 'request.terms_required') {
    field = 'terms';
  } else if (code === 'request.username_taken' || code === 'request.username_invalid') {
    field = 'username';
  }
  return { username, termsAccepted, error: errorText(result.problem, language), field };
}

/** "Sair": the backend ends the session, the cookie goes, and the sign-in screen is next. */
export async function signOutAction(): Promise<void> {
  const token = await currentSessionToken();
  if (token !== null) {
    // Whatever the backend answers, this browser forgets the session.
    await endSession(token);
  }
  (await cookies()).set(SESSION_COOKIE, '', EXPIRED_COOKIE_OPTIONS);
  redirect('/');
}
