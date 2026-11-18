import 'server-only';

import { errorType } from '../health';
import { logEvent } from '../log';
import { SESSION_COOKIE, sessionFrom } from '../session-cookies';
import { currentSettings } from '../settings';
import { outgoingTraceparent, traceFrom } from '../trace';

/**
 * The relay of a page's picture (Story 1.19), modelled on the upload relay: `GET /api/v1/materials/{id}/pages/{page}/
 * picture?ground=...` of this site goes to the same path of the backend, and the backend's WebP streams back.
 *
 * - The material id must be a UUID and the page a number from 1, and the ground a plain word: anything else answers
 *   "not found" without reaching the backend. The backend decides everything else (owner, ground, state, page).
 * - Only the service credential, the session of the visitor's cookie as `X-Session-Token` and a `traceparent` go to the
 *   backend; no header of the browser does.
 * - The body is never buffered: the backend's answer streams back. A picture comes back as `image/webp`, a refusal as
 *   its problem detail; both with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and nothing else of
 *   the backend's headers but the length.
 *
 * Nothing here reads, logs or keeps any of the picture.
 */
const UNIT = 'server.pictures';

/** A material id as the backend mints it (a UUID); anything else is a material nowhere. */
const ID = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** A page number from 1, as the backend reads it: no sign, no leading zero. */
const PAGE = /^[1-9]\d{0,6}$/;
/** A ground is a lowercase word (`review` in this release); the backend refuses the ones it does not serve. */
const GROUND = /^[a-z]{1,32}$/;

export const WEBP = 'image/webp';
const PROBLEM = 'application/problem+json';

/** What the relay needs to know of the incoming request. */
export type PictureRequest = {
  readonly headers: Headers;
  readonly signal: AbortSignal;
  /** The visitor's session cookie value, if any. */
  readonly sessionCookie: string | undefined;
  /** The `ground` query parameter, if any. */
  readonly ground: string | null;
};

export type PictureRelayOptions = {
  /** For tests only. */
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
};

/** The backend path of a page's picture, with its ground; null when the id, the page or the ground cannot be one. */
export function picturePath(id: string, page: string, ground: string | null): string | null {
  if (!ID.test(id) || !PAGE.test(page) || (ground !== null && !GROUND.test(ground))) {
    return null;
  }
  const query = ground === null ? '' : `?ground=${ground}`;
  return `/api/v1/materials/${id}/pages/${page}/picture${query}`;
}

function problem(status: number, category: string, code: string, title: string, traceId: string): Response {
  const body = JSON.stringify({ type: `urn:gmshield:problem:${code}`, title, status, category, code, params: {}, traceId });
  return new Response(body, {
    status,
    headers: { 'Content-Type': PROBLEM, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** The headers sent back: the picture's or the problem's type and length, never stored, never sniffed. */
export function pictureHeaders(answer: Headers, ok: boolean): Headers {
  const returned = new Headers();
  returned.set('content-type', ok ? WEBP : PROBLEM);
  const length = answer.get('content-length');
  if (length !== null && /^\d{1,12}$/.test(length)) {
    returned.set('content-length', length);
  }
  returned.set('cache-control', 'no-store');
  returned.set('x-content-type-options', 'nosniff');
  return returned;
}

/** Relays one picture request to the backend and its answer back, as a stream. */
export async function relayPicture(
  request: PictureRequest,
  id: string,
  page: string,
  options: PictureRelayOptions = {},
): Promise<Response> {
  const trace = traceFrom(request.headers.get('traceparent'));
  const path = picturePath(id, page, request.ground);
  if (path === null) {
    return problem(404, 'request', 'request.not_found', 'Not found', trace.traceId);
  }
  const settings = currentSettings();
  const send = options.fetch ?? globalThis.fetch;
  const headers = new Headers({ authorization: `Bearer ${settings.frontendCredential}`, traceparent: outgoingTraceparent(trace) });
  const token = sessionFrom(request.sessionCookie)?.token;
  if (token !== undefined) {
    headers.set('x-session-token', token);
  }
  let answer: Response;
  try {
    answer = await send(`${options.baseUrl ?? settings.backendUrl}${path}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: request.signal,
    });
  } catch (failure) {
    logEvent('WARN', UNIT, 'picture.backend_unreachable', trace.traceId, { errorType: errorType(failure) });
    return problem(503, 'server', 'server.unavailable', 'Service unavailable', trace.traceId);
  }
  logEvent('INFO', UNIT, 'picture.relayed', trace.traceId, { backendStatus: answer.status });
  return new Response(answer.body, { status: answer.status, headers: pictureHeaders(answer.headers, answer.status === 200) });
}

/** The visitor's session cookie name, for the route. */
export { SESSION_COOKIE };
