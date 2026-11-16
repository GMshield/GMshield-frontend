import 'server-only';

import { cookies } from 'next/headers';

/**
 * The two sign-in cookies (Story 1.9), both `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`:
 *
 * - `__Host-gmshield-sign-in`: the backend's sign-in attempt token, for the attempt's 10 minutes. It
 *   rides along with Google's top-level redirect to `/auth/google/callback` (Lax allows that GET).
 * - `__Host-gmshield-session`: the session token, for the session's 7 days.
 *
 * The frontend keeps no session state: it only carries the tokens to the backend, the attempt in the
 * JSON body and the session in `X-Session-Token`. A value that cannot be a token is treated as absent.
 */
export const SIGN_IN_COOKIE = '__Host-gmshield-sign-in';
export const SESSION_COOKIE = '__Host-gmshield-session';

const BASE = { secure: true, httpOnly: true, sameSite: 'lax', path: '/' } as const;
export const SIGN_IN_MAX_AGE = 600;
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
export const SIGN_IN_COOKIE_OPTIONS = { ...BASE, maxAge: SIGN_IN_MAX_AGE } as const;
export const SESSION_COOKIE_OPTIONS = { ...BASE, maxAge: SESSION_MAX_AGE } as const;
/** Clears a cookie: the same attributes, expired. */
export const EXPIRED_COOKIE_OPTIONS = { ...BASE, maxAge: 0 } as const;

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** A cookie value that can be a token, else null. */
export function tokenFrom(value: string | undefined | null): string | null {
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

/** A lifetime from the backend, within (0, fallback], else the fallback. */
export function maxAgeFrom(seconds: unknown, fallback: number): number {
  return typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0 && seconds <= fallback ? seconds : fallback;
}

export async function currentSessionToken(): Promise<string | null> {
  return tokenFrom((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function currentSignInToken(): Promise<string | null> {
  return tokenFrom((await cookies()).get(SIGN_IN_COOKIE)?.value);
}
