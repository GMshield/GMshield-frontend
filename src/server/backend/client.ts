import 'server-only';

import createClient, { type Client } from 'openapi-fetch';

import { currentSettings } from '../settings';

import type { paths } from './generated/public';

/**
 * The only way to the backend. A new client is built for every request; nothing is cached, and
 * only the headers below leave the frontend, plus `Authorization: Bearer <service credential>`
 * (Story 1.10), which comes from the settings and never from the incoming request: a browser's own
 * `authorization` is dropped like any other header not on the list. The request and response types
 * are generated from `contracts/public.json` (`npm run generate:types`) and never written by hand.
 * `x-session-token` carries the session token of the visitor's cookie (Story 1.9); the backend never
 * reads a cookie.
 */
export const FORWARDED_HEADERS: readonly string[] = ['accept', 'accept-language', 'content-type', 'traceparent', 'x-session-token'];

/** A call that has not answered within this time fails. */
export const BACKEND_TIMEOUT_MS = 2000;

export type BackendClient = Client<paths>;

export type BackendClientOptions = {
  readonly baseUrl: string;
  /** The `traceparent` of this call (see `outgoingTraceparent`). */
  readonly traceparent: string;
  readonly timeoutMs?: number;
  /** For tests only. */
  readonly fetch?: typeof globalThis.fetch;
};

/** A copy of the headers that keeps only {@link FORWARDED_HEADERS}. */
export function allowedHeaders(headers: Headers): Headers {
  const allowed = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = headers.get(name);
    if (value !== null) {
      allowed.set(name, value);
    }
  }
  return allowed;
}

/** The headers a call sends: the allowed ones, then the service credential of the settings. */
export function outgoingHeaders(headers: Headers, credential: string): Headers {
  const outgoing = allowedHeaders(headers);
  outgoing.set('authorization', `Bearer ${credential}`);
  return outgoing;
}

export function createBackendClient(options: BackendClientOptions): BackendClient {
  const send = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? BACKEND_TIMEOUT_MS;
  // Read when the client is built: the start-up check has already refused a start without it.
  const credential = currentSettings().frontendCredential;
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { traceparent: options.traceparent },
    fetch: async (request: Request) => {
      const init: RequestInit & { duplex?: 'half' } = {
        method: request.method,
        headers: outgoingHeaders(request.headers, credential),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]),
      };
      if (request.body !== null) {
        init.body = request.body;
        init.duplex = 'half';
      }
      return send(request.url, init);
    },
  });
}
