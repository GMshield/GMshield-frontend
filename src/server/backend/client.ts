import 'server-only';

import createClient, { type Client } from 'openapi-fetch';

import type { paths } from './generated/public';

/**
 * The only way to the backend. A new client is built for every request; nothing is cached, and
 * only the headers below leave the frontend. The request and response types are generated from
 * `contracts/public.json` (`npm run generate:types`) and never written by hand.
 */
export const FORWARDED_HEADERS: readonly string[] = ['accept', 'accept-language', 'content-type', 'traceparent'];

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

export function createBackendClient(options: BackendClientOptions): BackendClient {
  const send = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? BACKEND_TIMEOUT_MS;
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { traceparent: options.traceparent },
    fetch: async (request: Request) => {
      const init: RequestInit & { duplex?: 'half' } = {
        method: request.method,
        headers: allowedHeaders(request.headers),
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
