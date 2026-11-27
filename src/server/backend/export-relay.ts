import 'server-only';

import { EXPORT_FORMATS, type ExportFormat } from '@/client/exports';
import type { Language } from '@/messages';

import { errorType } from '../health';
import { logEvent } from '../log';
import { SESSION_COOKIE, sessionFrom } from '../session-cookies';
import { currentSettings } from '../settings';
import { outgoingTraceparent, traceFrom } from '../trace';

/**
 * The relay of an artifacts export (Story 5.7 part A), modelled on the picture relay: `GET /api/v1/campaigns/{id}/
 * artifacts/export?ids=a,b&format=...` of this site goes to the same path of the backend, with the visitor's language
 * as `language`, and the backend's file streams back.
 *
 * - The campaign id must be a UUID (else "not found"), the ids 1 to 50 separated by commas and the format one of
 *   `pdf`, `txt`, `markdown` and `jpg` (else "invalid"), and each id a UUID (else "not found", as the backend answers a
 *   malformed id): the backend is not reached then. The backend decides
 *   everything else (owner, each id, duplicates). Only these three values and the language go to the backend.
 * - Only the service credential, the session of the visitor's cookie as `X-Session-Token` and a `traceparent` go to the
 *   backend; no header of the browser does.
 * - The body is never buffered: the backend's answer streams back. A file comes back with its type (one the backend
 *   answers for an export, else a plain octet stream), its length and its `Content-Disposition` (an attachment), a
 *   refusal as its problem detail; both with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and
 *   nothing else of the backend's headers.
 *
 * Nothing here reads, logs or keeps any of the file, nor its name.
 */
const UNIT = 'server.exports';

/** A campaign or artifact id as the backend mints it (a UUID); anything else is one nowhere. */
const ID = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** The most artifacts one export takes, as the backend counts them. */
export const MAX_EXPORT_IDS = 50;

/** The types the backend answers an export with; any other is passed on as an octet stream. */
const FILE_TYPES = new Set(['application/pdf', 'text/plain;charset=utf-8', 'text/markdown;charset=utf-8', 'image/jpeg', 'application/zip']);
const OCTETS = 'application/octet-stream';
const PROBLEM = 'application/problem+json';
/** An attachment's `Content-Disposition`, as the backend writes it: printable ASCII only, so no header can be added. */
const ATTACHMENT = /^attachment;[\x20-\x7E]{1,2000}$/;

/** What the relay needs to know of the incoming request. */
export type ExportRequest = {
  readonly headers: Headers;
  readonly signal: AbortSignal;
  /** The visitor's session cookie value, if any. */
  readonly sessionCookie: string | undefined;
  /** The `ids` and `format` query parameters, if any. */
  readonly ids: string | null;
  readonly format: string | null;
  /** The visitor's language (its cookie, else its browser's). */
  readonly language: Language;
};

export type ExportRelayOptions = {
  /** For tests only. */
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
};

/** The format if it is one of an export's. */
export function exportFormat(value: string | null): ExportFormat | null {
  return EXPORT_FORMATS.find((format) => format === value) ?? null;
}

/**
 * The ids as the backend counts them: `invalid` for none, an empty one or more than 50 (the backend's 400), `unknown`
 * for a list holding an id that is no UUID (an id that exists nowhere: the backend's 404), else the ids (the backend
 * refuses duplicates).
 */
export function exportIds(value: string | null): readonly string[] | 'invalid' | 'unknown' {
  if (value === null || value === '') {
    return 'invalid';
  }
  const ids = value.split(',');
  if (ids.length > MAX_EXPORT_IDS || ids.some((id) => id === '')) {
    return 'invalid';
  }
  return ids.every((id) => ID.test(id)) ? ids : 'unknown';
}

/**
 * The backend path of an export (and, in the browser, the relay's own address): the campaign, the ids in order, the
 * format and the language; null when the campaign id cannot be one.
 */
export function exportPath(campaignId: string, ids: readonly string[], format: ExportFormat, language: Language): string | null {
  if (!ID.test(campaignId)) {
    return null;
  }
  const query = new URLSearchParams({ ids: ids.join(','), format, language });
  return `/api/v1/campaigns/${campaignId}/artifacts/export?${query.toString()}`;
}

function problem(status: number, category: string, code: string, title: string, traceId: string): Response {
  const body = JSON.stringify({ type: `urn:gmshield:problem:${code}`, title, status, category, code, params: {}, traceId });
  return new Response(body, {
    status,
    headers: { 'Content-Type': PROBLEM, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** The headers sent back: the file's type, length and name, or the problem's type; never stored, never sniffed. */
export function exportHeaders(answer: Headers, ok: boolean): Headers {
  const returned = new Headers();
  const given = answer.get('content-type') ?? '';
  const known = FILE_TYPES.has(given.replace(/\s+/g, '').toLowerCase());
  let type = PROBLEM;
  if (ok) {
    type = known ? given : OCTETS;
  }
  returned.set('content-type', type);
  const length = answer.get('content-length');
  if (length !== null && /^\d{1,12}$/.test(length)) {
    returned.set('content-length', length);
  }
  const disposition = answer.get('content-disposition');
  if (ok && disposition !== null && ATTACHMENT.test(disposition)) {
    returned.set('content-disposition', disposition);
  }
  returned.set('cache-control', 'no-store');
  returned.set('x-content-type-options', 'nosniff');
  return returned;
}

/** Relays one export of the campaign `campaignId`'s artifacts to the backend and its file back, as a stream. */
export async function relayExport(request: ExportRequest, campaignId: string, options: ExportRelayOptions = {}): Promise<Response> {
  const trace = traceFrom(request.headers.get('traceparent'));
  const ids = exportIds(request.ids);
  const format = exportFormat(request.format);
  if (!ID.test(campaignId)) {
    return problem(404, 'request', 'request.not_found', 'Not found', trace.traceId);
  }
  if (ids === 'invalid' || format === null) {
    return problem(400, 'request', 'request.invalid', 'Invalid request', trace.traceId);
  }
  if (ids === 'unknown') {
    return problem(404, 'request', 'request.not_found', 'Not found', trace.traceId);
  }
  const path = exportPath(campaignId, ids, format, request.language);
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
    logEvent('WARN', UNIT, 'export.backend_unreachable', trace.traceId, { errorType: errorType(failure) });
    return problem(503, 'server', 'server.unavailable', 'Service unavailable', trace.traceId);
  }
  logEvent('INFO', UNIT, 'export.relayed', trace.traceId, { backendStatus: answer.status, count: ids.length, format });
  return new Response(answer.body, { status: answer.status, headers: exportHeaders(answer.headers, answer.status === 200) });
}

/** The visitor's session cookie name, for the route. */
export { SESSION_COOKIE };
