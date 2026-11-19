import 'server-only';

import { call, type CallOptions, type Result } from './accounts';
import type { components } from './backend/generated/public';
import { errorType } from './health';
import { logEvent } from './log';
import { currentSettings } from './settings';
import { outgoingTraceparent, traceFrom } from './trace';

/**
 * The GM's conversation through the backend (Story 2.4): the current conversation, a new turn, the relay of a
 * turn's answer as server-sent events, and the GM's stop of an answer (Story 2.6). The backend takes the owner from
 * the session token alone; another owner's campaign or turn answers `request.not_found`. Nothing here logs a question
 * or an answer's text.
 */
const UNIT = 'server.conversations';

type Schemas = components['schemas'];
export type CurrentConversation = Schemas['CurrentConversation'];
export type Turn = Schemas['Turn'];

/** A campaign or turn id as the backend mints it (a UUID); anything else is one nowhere. */
const ID = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** A `Last-Event-ID` as the backend writes them: a sequence. Anything else is not forwarded. */
const SEQUENCE = /^\d{1,18}$/;
const PROBLEM = 'application/problem+json';
export const EVENT_STREAM = 'text/event-stream';

/** The current campaign and whether it has an accepted source; `request.not_found` when the account has none. */
export function currentConversation(sessionToken: string, options: CallOptions = {}): Promise<Result<CurrentConversation>> {
  return call('conversations.current', options, (client) =>
    client.GET('/api/v1/conversations/current', { params: { header: { 'X-Session-Token': sessionToken } } }),
  );
}

/** Records a question on the campaign: the turn, its conversation and its language. */
export function askQuestion(sessionToken: string, campaignId: string, question: string, options: CallOptions = {}): Promise<Result<Turn>> {
  return call('conversations.ask', options, (client) =>
    client.POST('/api/v1/campaigns/{campaignId}/turns', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { campaignId } },
      body: { question },
    }),
  );
}

/**
 * Stops the turn's answer (Story 2.6): 204, also for a turn whose answer had ended; `request.not_found` for a turn
 * that is not the account's.
 */
export function stopTurn(sessionToken: string, turnId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('conversations.stop', options, (client) =>
    client.POST('/api/v1/turns/{turnId}/stop', { params: { header: { 'X-Session-Token': sessionToken }, path: { turnId } } }),
  );
}

/** Whether an id can be a campaign's or a turn's. */
export function isId(id: string): boolean {
  return ID.test(id);
}

/** A problem detail answered by the relay itself. */
export function relayProblem(status: number, category: string, code: string, title: string, traceId: string): Response {
  const body = JSON.stringify({ type: `urn:gmshield:problem:${code}`, title, status, category, code, params: {}, traceId });
  return new Response(body, {
    status,
    headers: { 'Content-Type': PROBLEM, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** What the stream relay needs to know of the incoming request. */
export type StreamRequest = {
  readonly headers: Headers;
  /**
   * The `lastEventId` query parameter (Story 2.6): the last event id a reopened stream asks to resume after, forwarded
   * as `Last-Event-ID` when the header is absent. A browser's own reconnection sends the header; the page's reopen
   * cannot set it on an `EventSource`, so it names the id in the address.
   */
  readonly lastEventId?: string | null;
  readonly signal: AbortSignal;
  /** The session token of the visitor's cookie, if any. */
  readonly sessionToken: string | null;
  readonly sameOrigin: boolean;
};

export type StreamRelayOptions = {
  /** For tests only. */
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
};

/**
 * Relays `GET /api/v1/turns/{id}/events` to the backend and its event stream back, never buffered.
 *
 * - A request that is not from the site's own origin is refused (403 `request.cross_origin`); an id that is not one
 *   answers "not found" without reaching the backend.
 * - Only the service credential, the session token, the `traceparent`, `Accept: text/event-stream` and a valid
 *   `Last-Event-ID` go to the backend: the request's header, or else its `lastEventId` query (Story 2.6), each only
 *   when it is a sequence. There is no time limit: the stream lives as long as the answer. When the browser
 *   leaves, the backend request is aborted (the backend never stops the answer for that).
 * - The answer goes back with its status and only its content type, `no-store`, `nosniff` and `X-Accel-Buffering: no`.
 */
export async function relayTurnEvents(request: StreamRequest, turnId: string, options: StreamRelayOptions = {}): Promise<Response> {
  const trace = traceFrom(request.headers.get('traceparent'));
  if (!request.sameOrigin) {
    logEvent('WARN', UNIT, 'request.refused', trace.traceId, { reason: 'request.cross_origin' });
    return relayProblem(403, 'request', 'request.cross_origin', 'Cross-origin request refused', trace.traceId);
  }
  if (!isId(turnId)) {
    return relayProblem(404, 'request', 'request.not_found', 'Not found', trace.traceId);
  }
  const settings = currentSettings();
  const send = options.fetch ?? globalThis.fetch;
  const headers = new Headers({
    authorization: `Bearer ${settings.frontendCredential}`,
    traceparent: outgoingTraceparent(trace),
    accept: EVENT_STREAM,
  });
  if (request.sessionToken !== null) {
    headers.set('x-session-token', request.sessionToken);
  }
  const last = request.headers.get('last-event-id') ?? request.lastEventId ?? null;
  if (last !== null && SEQUENCE.test(last)) {
    headers.set('last-event-id', last);
  }
  let answer: Response;
  try {
    answer = await send(`${options.baseUrl ?? settings.backendUrl}/api/v1/turns/${turnId}/events`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: request.signal,
    });
  } catch (failure) {
    logEvent('WARN', UNIT, 'turn_events.backend_unreachable', trace.traceId, { errorType: errorType(failure) });
    return relayProblem(503, 'server', 'server.unavailable', 'Service unavailable', trace.traceId);
  }
  logEvent('INFO', UNIT, 'turn_events.relayed', trace.traceId, { backendStatus: answer.status });
  const streaming = answer.ok && (answer.headers.get('content-type') ?? '').startsWith(EVENT_STREAM);
  return new Response(answer.body, {
    status: answer.status,
    headers: {
      'Content-Type': streaming ? EVENT_STREAM : PROBLEM,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    },
  });
}
