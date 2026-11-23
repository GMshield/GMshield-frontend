import 'server-only';

import { errorType } from '../health';
import { logEvent } from '../log';
import { SESSION_COOKIE, sessionFrom } from '../session-cookies';
import { currentSettings } from '../settings';
import { outgoingTraceparent, traceFrom } from '../trace';

/**
 * The relay of a page's picture (Story 1.19), modelled on the upload relay: `GET /api/v1/materials/{id}/pages/{page}/
 * picture?ground=...` of this site goes to the same path of the backend, and the backend's WebP streams back. Story
 * 2.7: the same relay serves the picture of a page a turn's source reference names,
 * `GET /api/v1/turns/{turnId}/references/{number}/pages/{page}/picture`, whose path is its ground. Story 3.9: and the
 * picture of a page of the campaign's current scope, `GET /api/v1/campaigns/{campaignId}/sources/{versionId}/pages/
 * {page}/picture` (a search result's page). Story 4.3: and the picture of a page of the version a record was read from,
 * `GET /api/v1/systems/{systemId}/records/{recordId}/pages/{page}/picture` (a record's reference), whose path is its
 * ground too.
 *
 * - The material or turn id must be a UUID, the reference and page numbers numbers from 1, and the ground a plain
 *   word: anything else answers "not found" without reaching the backend. The backend decides everything else
 *   (owner, ground, reference, state, page).
 * - Only the service credential, the session of the visitor's cookie as `X-Session-Token` and a `traceparent` go to the
 *   backend; no header of the browser does.
 * - The body is never buffered: the backend's answer streams back. A picture comes back as `image/webp`, a refusal as
 *   its problem detail; both with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and nothing else of
 *   the backend's headers but the length.
 *
 * Nothing here reads, logs or keeps any of the picture.
 */
const UNIT = 'server.pictures';

/** A material or turn id as the backend mints it (a UUID); anything else is one nowhere. */
const ID = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** A page or reference number from 1, as the backend reads it: no sign, no leading zero. */
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
  /** The `ground` query parameter, if any (a material's page only: a reference's path is its ground). */
  readonly ground?: string | null;
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

/** The backend path of the picture of a page a turn's reference names; null when an id or a number cannot be one. */
export function referencePicturePath(turnId: string, number: string, page: string): string | null {
  if (!ID.test(turnId) || !PAGE.test(number) || !PAGE.test(page)) {
    return null;
  }
  return `/api/v1/turns/${turnId}/references/${number}/pages/${page}/picture`;
}

/**
 * The backend path of the picture of a page of the campaign's current scope (Story 3.9); null when an id or the page
 * cannot be one.
 */
export function scopePicturePath(campaignId: string, versionId: string, page: string): string | null {
  if (!ID.test(campaignId) || !ID.test(versionId) || !PAGE.test(page)) {
    return null;
  }
  return `/api/v1/campaigns/${campaignId}/sources/${versionId}/pages/${page}/picture`;
}

/**
 * The backend path of the picture of a page of the version a record was read from (Story 4.3); null when an id or the
 * page cannot be one.
 */
export function recordPicturePath(systemId: string, recordId: string, page: string): string | null {
  if (!ID.test(systemId) || !ID.test(recordId) || !PAGE.test(page)) {
    return null;
  }
  return `/api/v1/systems/${systemId}/records/${recordId}/pages/${page}/picture`;
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

/** Relays one picture request of a material's page to the backend and its answer back, as a stream. */
export function relayPicture(request: PictureRequest, id: string, page: string, options: PictureRelayOptions = {}): Promise<Response> {
  return relayPictureAt(request, picturePath(id, page, request.ground ?? null), options);
}

/** Relays the picture of a page a turn's reference names (Story 2.7), as {@link relayPicture} does. */
export function relayReferencePicture(
  request: PictureRequest,
  turnId: string,
  number: string,
  page: string,
  options: PictureRelayOptions = {},
): Promise<Response> {
  return relayPictureAt(request, referencePicturePath(turnId, number, page), options);
}

/** Relays the picture of a page of the campaign's current scope (Story 3.9), as {@link relayPicture} does. */
export function relayScopePicture(
  request: PictureRequest,
  campaignId: string,
  versionId: string,
  page: string,
  options: PictureRelayOptions = {},
): Promise<Response> {
  return relayPictureAt(request, scopePicturePath(campaignId, versionId, page), options);
}

/** Relays the picture of a page of the version a record was read from (Story 4.3), as {@link relayPicture} does. */
export function relayRecordPicture(
  request: PictureRequest,
  systemId: string,
  recordId: string,
  page: string,
  options: PictureRelayOptions = {},
): Promise<Response> {
  return relayPictureAt(request, recordPicturePath(systemId, recordId, page), options);
}

/** Relays one picture request to the backend path `path` (null: "not found", the backend is not reached). */
async function relayPictureAt(request: PictureRequest, path: string | null, options: PictureRelayOptions): Promise<Response> {
  const trace = traceFrom(request.headers.get('traceparent'));
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
