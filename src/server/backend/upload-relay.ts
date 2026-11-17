import 'server-only';

import { errorType } from '../health';
import { logEvent } from '../log';
import { SESSION_COOKIE, sessionFrom } from '../session-cookies';
import { currentSettings } from '../settings';
import { outgoingTraceparent, traceFrom } from '../trace';

/**
 * The relay of the resumable upload (Story 1.13, AD-16): `/api/v1/uploads/**` of this site goes to the same path of
 * the backend, as a stream. The browser's tus client (`src/client/upload`) talks to it.
 *
 * - The body is never buffered: the request's stream is handed to the backend call (`duplex: 'half'`) and the
 *   backend's answer streams back. There is no timeout on the body, which may take minutes; a browser that goes
 *   away aborts the backend call.
 * - Only the tus headers, `Content-Type` and `Content-Length` go to the backend, with the service credential, the
 *   session of the visitor's cookie as `X-Session-Token` and a `traceparent`. Only `Location`, the `Upload-*` and
 *   `Tus-*` headers and `Content-Type` come back, always with `Cache-Control: no-store`.
 * - `src/proxy.ts` does not run on these routes (it would hold up to 10 MB of each body in memory), so the relay
 *   refuses a request from another origin itself, with the proxy's own `isSameOrigin`.
 *
 * Nothing here reads, logs or keeps any of the file.
 */
const UNIT = 'server.uploads';

/** The request headers that reach the backend, besides the credential, the session and the trace. */
export const UPLOAD_REQUEST_HEADERS: readonly string[] = [
  'tus-resumable',
  'upload-length',
  'upload-metadata',
  'upload-offset',
  'upload-checksum',
  'content-type',
  'content-length',
];

/** The backend's answer headers that reach the browser. */
export const UPLOAD_RESPONSE_HEADERS: readonly string[] = [
  'location',
  'tus-resumable',
  'tus-version',
  'upload-offset',
  'upload-length',
  'upload-expires',
  'content-type',
];

/** The relayed path of the backend. */
export const UPLOADS_PATH = '/api/v1/uploads';

/** An upload id as the backend mints it, or anything the backend can answer "not found" to; never `.` or `..`. */
const ID = /^[0-9A-Za-z-]{1,64}$/;

/** What the relay needs to know of the incoming request. */
export type RelayedRequest = {
  readonly method: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly signal: AbortSignal;
  /** The visitor's session cookie value, if any. */
  readonly sessionCookie: string | undefined;
  /** Whether the request comes from this site (the proxy's `isSameOrigin`). */
  readonly sameOrigin: boolean;
};

export type RelayOptions = {
  /** For tests only. */
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
};

/** `[]` → `/api/v1/uploads`, `[id]` → `/api/v1/uploads/{id}`, `[id, 'completion']` → its completion; else null. */
export function backendPath(segments: readonly string[] | undefined): string | null {
  const parts = segments ?? [];
  if (parts.length === 0) {
    return UPLOADS_PATH;
  }
  if (parts.length > 2 || !ID.test(parts[0]!) || (parts.length === 2 && parts[1] !== 'completion')) {
    return null;
  }
  return `${UPLOADS_PATH}/${parts.join('/')}`;
}

function problem(status: number, category: string, code: string, title: string, traceId: string, method: string): Response {
  const body = JSON.stringify({ type: `urn:gmshield:problem:${code}`, title, status, category, code, params: {}, traceId });
  return new Response(method === 'HEAD' ? null : body, {
    status,
    headers: {
      'Content-Type': 'application/problem+json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Tus-Resumable': '1.0.0',
    },
  });
}

/** The headers sent to the backend: the allowed ones of the request, the credential, the session and the trace. */
export function relayedHeaders(incoming: Headers, credential: string, sessionToken: string | null, traceparent: string): Headers {
  const outgoing = new Headers();
  for (const name of UPLOAD_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) {
      outgoing.set(name, value);
    }
  }
  outgoing.set('authorization', `Bearer ${credential}`);
  outgoing.set('traceparent', traceparent);
  if (sessionToken !== null) {
    outgoing.set('x-session-token', sessionToken);
  }
  return outgoing;
}

/** The headers sent back to the browser: the allowed ones of the backend's answer, never stored by a cache. */
export function returnedHeaders(answer: Headers): Headers {
  const returned = new Headers();
  for (const name of UPLOAD_RESPONSE_HEADERS) {
    const value = answer.get(name);
    if (value !== null) {
      returned.set(name, value);
    }
  }
  returned.set('cache-control', 'no-store');
  returned.set('x-content-type-options', 'nosniff');
  return returned;
}

/** Relays one upload request to the backend and its answer back, both as streams. */
export async function relayUpload(request: RelayedRequest, segments: readonly string[] | undefined, options: RelayOptions = {}): Promise<Response> {
  const trace = traceFrom(request.headers.get('traceparent'));
  if (!request.sameOrigin) {
    logEvent('WARN', UNIT, 'request.refused', trace.traceId, { method: request.method, reason: 'request.cross_origin' });
    return problem(403, 'request', 'request.cross_origin', 'Cross-origin request refused', trace.traceId, request.method);
  }
  const path = backendPath(segments);
  if (path === null) {
    return problem(404, 'request', 'request.not_found', 'Not found', trace.traceId, request.method);
  }
  const settings = currentSettings();
  const send = options.fetch ?? globalThis.fetch;
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: relayedHeaders(request.headers, settings.frontendCredential, sessionFrom(request.sessionCookie)?.token ?? null, outgoingTraceparent(trace)),
    cache: 'no-store',
    redirect: 'error',
    // No timeout: a part of 64 MiB over a slow line takes minutes. The browser leaving ends the call.
    signal: request.signal,
  };
  if (request.method !== 'HEAD' && request.method !== 'GET' && request.body !== null) {
    init.body = request.body;
    init.duplex = 'half';
  }
  let answer: Response;
  try {
    answer = await send(`${options.baseUrl ?? settings.backendUrl}${path}`, init);
  } catch (failure) {
    logEvent('WARN', UNIT, 'upload.backend_unreachable', trace.traceId, { method: request.method, errorType: errorType(failure) });
    return problem(503, 'server', 'server.unavailable', 'Service unavailable', trace.traceId, request.method);
  }
  logEvent('INFO', UNIT, 'upload.relayed', trace.traceId, { method: request.method, backendStatus: answer.status });
  const empty = request.method === 'HEAD' || answer.status === 204 || answer.status === 304;
  if (empty) {
    await answer.body?.cancel();
  }
  return new Response(empty ? null : answer.body, { status: answer.status, headers: returnedHeaders(answer.headers) });
}

/** The visitor's session cookie name, for the route. */
export { SESSION_COOKIE };
