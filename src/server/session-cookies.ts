import 'server-only';

import { cookies } from 'next/headers';

/**
 * The sign-in cookies, all `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`:
 *
 * - `__Host-gmshield-sign-in`: the backend's sign-in attempt token, for the attempt's 10 minutes. It
 *   rides along with Google's top-level redirect to `/auth/google/callback` (Lax allows that GET).
 * - `__Host-gmshield-session`: `<session token>.<renew-after, in epoch seconds>` (Story 1.10), for what
 *   is left of the session's absolute lifetime. Once the renew-after time passes, `src/proxy.ts` renews
 *   the token before the request goes on. A value without the suffix (Story 1.9) is due at once.
 * - `__Host-gmshield-return`: where to go after signing in again when a session ended (a path of this
 *   site, checked by {@link safeReturnPath}), for an hour.
 *
 * The frontend keeps no session state: it only carries the tokens to the backend, the attempt in the
 * JSON body and the session in `X-Session-Token`. A value that cannot be a token is treated as absent.
 */
export const SIGN_IN_COOKIE = '__Host-gmshield-sign-in';
export const SESSION_COOKIE = '__Host-gmshield-session';
export const RETURN_COOKIE = '__Host-gmshield-return';

const BASE = { secure: true, httpOnly: true, sameSite: 'lax', path: '/' } as const;
export const SIGN_IN_MAX_AGE = 600;
/** The longest a session lives (the backend's default absolute timeout); a grant may give less. */
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
export const RETURN_MAX_AGE = 60 * 60;
export const SIGN_IN_COOKIE_OPTIONS = { ...BASE, maxAge: SIGN_IN_MAX_AGE } as const;
export const SESSION_COOKIE_OPTIONS = { ...BASE, maxAge: SESSION_MAX_AGE } as const;
export const RETURN_COOKIE_OPTIONS = { ...BASE, maxAge: RETURN_MAX_AGE } as const;
/** Clears a cookie: the same attributes, expired. */
export const EXPIRED_COOKIE_OPTIONS = { ...BASE, maxAge: 0 } as const;

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const RENEW_AFTER = /^\d{1,12}$/;

/** A cookie value that can be a token, else null. */
export function tokenFrom(value: string | undefined | null): string | null {
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

/** A lifetime from the backend, within (0, fallback], else the fallback. */
export function maxAgeFrom(seconds: unknown, fallback: number): number {
  return typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0 && seconds <= fallback ? seconds : fallback;
}

/** The session cookie read: the token, and when it is due for renewal (null: due at once). */
export type SessionCookie = { readonly token: string; readonly renewAfter: number | null };

/** `<token>.<renew-after>` or a bare token of Story 1.9; anything else is no session. */
export function sessionFrom(value: string | undefined | null): SessionCookie | null {
  if (typeof value !== 'string') {
    return null;
  }
  const dot = value.lastIndexOf('.');
  if (dot === -1) {
    const token = tokenFrom(value);
    return token === null ? null : { token, renewAfter: null };
  }
  const token = tokenFrom(value.slice(0, dot));
  const suffix = value.slice(dot + 1);
  return token === null || !RENEW_AFTER.test(suffix) ? null : { token, renewAfter: Number(suffix) };
}

/** Whether the token should be renewed before this request: past its renew-after time, or without one. */
export function due(session: SessionCookie, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  return session.renewAfter === null || nowSeconds >= session.renewAfter;
}

export type CookieOptions = typeof BASE & { readonly maxAge: number };

/**
 * The session cookie for a backend grant: `<token>.<now + renewAfterSeconds>`, living `expiresInSeconds`
 * (at most {@link SESSION_MAX_AGE}). A renew-after beyond the cookie's life is clamped to it, so the last
 * window renews only when the session ends; a missing or odd renew-after makes the token due at once.
 */
export function sessionCookieFor(
  grant: { readonly sessionToken: string; readonly expiresInSeconds?: unknown; readonly renewAfterSeconds?: unknown },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { readonly value: string; readonly options: CookieOptions } {
  const maxAge = maxAgeFrom(grant.expiresInSeconds, SESSION_MAX_AGE);
  const renewIn = grant.renewAfterSeconds;
  const renewAfter = typeof renewIn === 'number' && Number.isInteger(renewIn) && renewIn >= 0 ? Math.min(renewIn, maxAge) : 0;
  return { value: `${grant.sessionToken}.${nowSeconds + renewAfter}`, options: { ...BASE, maxAge } };
}

/**
 * Where to return after signing in: a path of this site with its query, else `/`. Refused: anything that
 * is not a single-slash path (`//host`, `/\host`, a scheme), control characters, and the sign-in, Google,
 * API and renewal routes, which would loop or leave the page.
 */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    return '/';
  }
  let url: URL;
  try {
    url = new URL(value, 'http://return.invalid');
  } catch {
    return '/';
  }
  if (url.origin !== 'http://return.invalid') {
    return '/';
  }
  const path = url.pathname.toLowerCase();
  for (const blocked of ['/sign-in', '/auth', '/api', '/session/renew']) {
    if (path === blocked || path.startsWith(`${blocked}/`)) {
      return '/';
    }
  }
  return `${url.pathname}${url.search}`;
}

/** `/sign-in/ended`, which clears the session cookie and says "Sua sessão terminou.", returning to `next` later. */
export function endedPath(next: string): string {
  return `/sign-in/ended?next=${encodeURIComponent(safeReturnPath(next))}`;
}

/** `/session/renew`, which renews the token and goes back to `next`. */
export function renewPath(next: string): string {
  return `/session/renew?next=${encodeURIComponent(safeReturnPath(next))}`;
}

export async function currentSessionToken(): Promise<string | null> {
  return sessionFrom((await cookies()).get(SESSION_COOKIE)?.value)?.token ?? null;
}

export async function currentSignInToken(): Promise<string | null> {
  return tokenFrom((await cookies()).get(SIGN_IN_COOKIE)?.value);
}
