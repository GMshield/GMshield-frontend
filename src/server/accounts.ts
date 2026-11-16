import 'server-only';

import { headers } from 'next/headers';

import { createBackendClient } from './backend/client';
import type { components } from './backend/generated/public';
import { errorType } from './health';
import { logEvent } from './log';
import { currentSettings } from './settings';
import { outgoingTraceparent, traceFrom } from './trace';

/**
 * Sign-in, the signed-in account, renewal and sign-out, through the backend (Stories 1.9 and 1.10). The backend alone talks
 * to Google; these calls only relay tokens and the visitor's choices. Nothing here logs a token, a code,
 * an email address or a username.
 */
const UNIT = 'server.accounts';

type Schemas = components['schemas'];
export type SignInStarted = Schemas['SignInStarted'];
export type SignInOutcome = Schemas['SignInOutcome'];
export type SessionGrant = Schemas['SessionGrant'];
export type Me = Schemas['Me'];

/** A backend answer: its data, or the problem detail it sent (or a stand-in problem when it did not answer). */
export type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly status: number; readonly problem: unknown };

export type CallOptions = {
  /** For tests only. */
  readonly baseUrl?: string;
  /**
   * The incoming `traceparent`, for callers outside a page, route or action (the proxy), where
   * `next/headers` is not there to give it.
   */
  readonly traceparent?: string | null;
};

/**
 * The callback's own limit: the backend may spend up to 15 s on Google's token endpoint (5 s to connect,
 * 10 s to read) after it has already used up the attempt, so the default 2 s would show "unavailable"
 * for a sign-in that is still going through.
 */
export const GOOGLE_CALLBACK_TIMEOUT_MS = 16_000;

/** The problem used when the backend does not answer: the frontend shows its "unavailable" text. */
export const UNAVAILABLE = { status: 503, category: 'server', code: 'server.unavailable', params: {} } as const;

async function backend(options: CallOptions, timeoutMs?: number) {
  const incoming = options.traceparent === undefined ? (await headers()).get('traceparent') : options.traceparent;
  const trace = traceFrom(incoming);
  return {
    trace,
    client: createBackendClient({
      baseUrl: options.baseUrl ?? currentSettings().backendUrl,
      traceparent: outgoingTraceparent(trace),
      timeoutMs,
    }),
  };
}

async function call<T>(
  event: string,
  options: CallOptions,
  send: (client: Awaited<ReturnType<typeof backend>>['client']) => Promise<{ data?: T; error?: unknown; response: Response }>,
  timeoutMs?: number,
): Promise<Result<T>> {
  const { trace, client } = await backend(options, timeoutMs);
  try {
    const { data, error, response } = await send(client);
    if (response.ok) {
      return { ok: true, data: data as T };
    }
    logEvent('INFO', UNIT, `${event}.refused`, trace.traceId, { backendStatus: response.status });
    return { ok: false, status: response.status, problem: error };
  } catch (failure) {
    logEvent('WARN', UNIT, `${event}.backend_unreachable`, trace.traceId, { errorType: errorType(failure) });
    return { ok: false, status: UNAVAILABLE.status, problem: UNAVAILABLE };
  }
}

export function startGoogleSignIn(options: CallOptions = {}): Promise<Result<SignInStarted>> {
  return call('sign_in.start', options, (client) => client.POST('/api/v1/sign-in/google'));
}

export function finishGoogleSignIn(body: Schemas['GoogleCallback'], options: CallOptions = {}): Promise<Result<SignInOutcome>> {
  return call(
    'sign_in.callback',
    options,
    (client) => client.POST('/api/v1/sign-in/google/callback', { body }),
    GOOGLE_CALLBACK_TIMEOUT_MS,
  );
}

export function completeSignIn(body: Schemas['CompleteSignIn'], options: CallOptions = {}): Promise<Result<SessionGrant>> {
  return call('sign_in.complete', options, (client) => client.POST('/api/v1/sign-in/complete', { body }));
}

export function currentAccount(sessionToken: string, options: CallOptions = {}): Promise<Result<Me>> {
  return call('session.me', options, (client) =>
    client.GET('/api/v1/me', { params: { header: { 'X-Session-Token': sessionToken } } }),
  );
}

/**
 * Renews the session (Story 1.10): a new token, the presented one still served for the overlap. A refusal
 * is `session.already_renewed` (another renewal came first; keep using the token), or `session.required`.
 */
export function renewSession(sessionToken: string, options: CallOptions = {}): Promise<Result<SessionGrant>> {
  return call('session.renew', options, (client) =>
    client.POST('/api/v1/session/renewal', { params: { header: { 'X-Session-Token': sessionToken } } }),
  );
}

export function endSession(sessionToken: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('session.end', options, (client) =>
    client.DELETE('/api/v1/session', { params: { header: { 'X-Session-Token': sessionToken } } }),
  );
}

/** Where the browser may be sent after starting: Google's authorization endpoint, or the frontend's own callback path. */
export function safeAuthorizationUrl(url: unknown): string | null {
  if (typeof url !== 'string') {
    return null;
  }
  // The frontend's own callback (the backend's test-mode stand-in): a same-origin path, harmless in any mode.
  if (url.startsWith('/auth/google/callback?')) {
    return url;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.host === 'accounts.google.com' && parsed.username === '' ? url : null;
  } catch {
    return null;
  }
}
