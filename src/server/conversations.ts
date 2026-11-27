import 'server-only';

import { call, type CallOptions, type Result } from './accounts';
import type { components } from './backend/generated/public';
import { errorType } from './health';
import { logEvent } from './log';
import { currentSettings } from './settings';
import { outgoingTraceparent, traceFrom } from './trace';

/**
 * The GM's conversation through the backend (Story 2.4): the current conversation, a new turn, the relay of a
 * turn's answer as server-sent events, the GM's stop of an answer (Story 2.6), and a page a turn's source reference
 * names (Story 2.7). From Story 3.9 a search of
 * the library (created as a job, then read by id) and a page of the campaign's current scope, the ground a search
 * result opens on. From Story 3.10 a campaign's conversations of one area (its campaign page counts them with the
 * same list), one conversation with its stored turns,
 * its rename, and a question that continues a conversation or starts one in an area; from Story 3.10 part B what goes
 * with a conversation and its deletion; from Story 3.11 a turn's dismissal and its undo; from Story 3.12 a turn's
 * bookmark, its removal and the account's saved answers; from Story 5.4 part A a draft saved as an artifact, its save
 * declined and offered again. The backend takes the owner from
 * the session token alone; another owner's campaign or turn answers `request.not_found`. Nothing here logs a question
 * or an answer's text.
 */
const UNIT = 'server.conversations';

type Schemas = components['schemas'];
export type CurrentConversation = Schemas['CurrentConversation'];
export type Turn = Schemas['Turn'];
/** A page a reference names (Story 2.7): the same shape as a material's page on the review ground. */
export type ReferencePage = Schemas['MaterialPageView'];
/** A search of the library (Story 3.9): its query, filters, state and, once done, its results. */
export type Search = Schemas['Search'];
export type SearchCreated = Schemas['SearchCreated'];
export type NewSearch = Schemas['NewSearch'];
/** Story 3.10: a conversation in a list, a page of them, one conversation, its stored turns and a rename. */
export type ConversationSummary = Schemas['ConversationSummary'];
export type ConversationPage = Schemas['ConversationPage'];
export type ConversationItem = Schemas['Conversation'];
export type StoredTurn = Schemas['StoredTurn'];
export type ConversationTurns = Schemas['ConversationTurns'];
export type ConversationChange = Schemas['ConversationChange'];
/** Story 3.10 part B: what goes with a conversation if it is deleted (its questions). */
export type ConversationDeletion = Schemas['ConversationDeletion'];
export type ConversationDeletionArtifact = Schemas['ConversationDeletionArtifact'];
/** Story 5.4 part A: what a draft is saved as, and the artifact it becomes. */
export type SavedDraft = Schemas['SavedDraft'];
export type SavedArtifact = Schemas['Artifact'];
/** Story 3.12: a saved answer, and a page of them. */
export type SavedAnswer = Schemas['SavedAnswer'];
export type SavedAnswerPage = Schemas['SavedAnswerPage'];
/** The areas of the sidebar a conversation belongs to (Story 3.10). */
export const AREAS = ['questions', 'rules'] as const;
export type Area = (typeof AREAS)[number];
/** What the GM asks for in a turn (Story 5.3 part A): a question (the default), or a draft. */
export const TURN_KINDS = ['question', 'draft'] as const;
export type TurnKind = (typeof TURN_KINDS)[number];
/**
 * Where a question goes (Story 3.10): a conversation to continue, or the area of a new one. Story 5.3 part A: and what it
 * asks for (`kind`; absent: a question).
 */
export type QuestionTarget = { readonly conversationId?: string; readonly area?: Area; readonly kind?: TurnKind };

/** A campaign or turn id as the backend mints it (a UUID); anything else is one nowhere. */
const ID = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** A reference or page number as the backend reads it: from 1, no sign, no leading zero. */
const NUMBER = /^[1-9]\d{0,6}$/;
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

/**
 * Records a question on the campaign: the turn, its conversation and its language. Story 3.10: in the conversation
 * `target` names, or in a new one of its area; with neither, the campaign's latest questions conversation. Story 5.3
 * part A: with the target's `kind` when it has one.
 */
export function askQuestion(
  sessionToken: string,
  campaignId: string,
  question: string,
  options: CallOptions = {},
  target: QuestionTarget = {},
): Promise<Result<Turn>> {
  return call('conversations.ask', options, (client) =>
    client.POST('/api/v1/campaigns/{campaignId}/turns', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { campaignId } },
      body: {
        question,
        ...(target.conversationId === undefined ? {} : { conversationId: target.conversationId }),
        ...(target.area === undefined ? {} : { area: target.area }),
        ...(target.kind === undefined ? {} : { kind: target.kind }),
      },
    }),
  );
}

/**
 * One page of the campaign's conversations of `area` (Story 3.10), the most recently asked first, with the list's
 * total; `request.not_found` for a campaign that is not the account's.
 */
export function listConversations(
  sessionToken: string,
  campaignId: string,
  area: Area,
  query: { readonly limit?: number; readonly offset?: number } = {},
  options: CallOptions = {},
): Promise<Result<ConversationPage>> {
  return call('conversations.list', options, (client) =>
    client.GET('/api/v1/campaigns/{campaignId}/conversations', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { campaignId }, query: { area, ...query } },
    }),
  );
}

/** One conversation of the account (Story 3.10): its campaign, area, name and version; `request.not_found` otherwise. */
export function getConversation(sessionToken: string, conversationId: string, options: CallOptions = {}): Promise<Result<ConversationItem>> {
  return call('conversations.get', options, (client) =>
    client.GET('/api/v1/conversations/{conversationId}', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { conversationId } },
    }),
  );
}

/** A conversation's newest 200 turns, oldest first, each with its stored events (Story 3.10). */
export function conversationTurns(sessionToken: string, conversationId: string, options: CallOptions = {}): Promise<Result<ConversationTurns>> {
  return call('conversations.turns', options, (client) =>
    client.GET('/api/v1/conversations/{conversationId}/turns', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { conversationId } },
    }),
  );
}

/**
 * Renames a conversation on the version it was read at (Story 3.10); `request.stale_version` when it changed since,
 * `request.conversation_name_invalid` for a name outside its limits.
 */
export function renameConversation(
  sessionToken: string,
  conversationId: string,
  body: ConversationChange,
  options: CallOptions = {},
): Promise<Result<ConversationItem>> {
  return call('conversations.rename', options, (client) =>
    client.PATCH('/api/v1/conversations/{conversationId}', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { conversationId } },
      body,
    }),
  );
}

/**
 * What goes with one of the account's conversations if it is deleted (Story 3.10 part B): its questions, and (Story 5.4
 * part B) the artifacts saved from it that are not being deleted, oldest first; `request.not_found` otherwise.
 */
export function conversationDeletion(
  sessionToken: string,
  conversationId: string,
  options: CallOptions = {},
): Promise<Result<ConversationDeletion>> {
  return call('conversations.deletion', options, (client) =>
    client.GET('/api/v1/conversations/{conversationId}/deletion', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { conversationId } },
    }),
  );
}

/**
 * Deletes one of the account's conversations with its questions, answers and references (Story 3.10 part B; 202, no
 * body: the removal runs in the backend); `request.not_found` for any other id, one already deleted included. From Story
 * 5.4 part B the artifacts saved from it among `artifactIds` (0 to 64; none keeps them all) go with it, in the same
 * request (`POST /api/v1/conversations/{id}/deletion`); an id that is not one of them is ignored by the backend, and a
 * malformed list is `request.invalid` on `artifactIds`.
 */
export function deleteConversation(
  sessionToken: string,
  conversationId: string,
  artifactIds: readonly string[] = [],
  options: CallOptions = {},
): Promise<Result<undefined>> {
  return call('conversations.delete', options, (client) =>
    client.POST('/api/v1/conversations/{conversationId}/deletion', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { conversationId } },
      body: { artifactIds: [...artifactIds] },
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

/**
 * Dismisses the turn's answer (Story 3.11): 204, also for a turn dismissed already; `conversation.turn_running` for a
 * turn whose answer is still being written, `request.not_found` for a turn that is not the account's or is of a
 * conversation being deleted.
 */
export function dismissTurn(sessionToken: string, turnId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('conversations.dismiss', options, (client) =>
    client.PUT('/api/v1/turns/{turnId}/dismissal', { params: { header: { 'X-Session-Token': sessionToken }, path: { turnId } } }),
  );
}

/**
 * Undoes the dismissal of the turn's answer (Story 3.11): 204, also for a turn that is shown; `request.not_found` as
 * {@link dismissTurn}.
 */
export function restoreTurn(sessionToken: string, turnId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('conversations.restore', options, (client) =>
    client.DELETE('/api/v1/turns/{turnId}/dismissal', { params: { header: { 'X-Session-Token': sessionToken }, path: { turnId } } }),
  );
}

/**
 * Saves the turn's answer (Story 3.12): 204, also for a turn saved already; `conversation.turn_not_done` for a turn
 * that is running, stopped, failed or silent, `request.not_found` for a turn that is not the account's or is of a conversation
 * being deleted.
 */
export function bookmarkTurn(sessionToken: string, turnId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('conversations.bookmark', options, (client) =>
    client.PUT('/api/v1/turns/{turnId}/bookmark', { params: { header: { 'X-Session-Token': sessionToken }, path: { turnId } } }),
  );
}

/** Removes the turn's answer from the saved answers (Story 3.12): 204, also for one not saved; not found as above. */
export function unbookmarkTurn(sessionToken: string, turnId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('conversations.unbookmark', options, (client) =>
    client.DELETE('/api/v1/turns/{turnId}/bookmark', { params: { header: { 'X-Session-Token': sessionToken }, path: { turnId } } }),
  );
}

/**
 * Saves a done draft as an artifact of its conversation's campaign (Story 5.4 part A): 201 with the artifact;
 * `request.invalid` naming the field outside its limits (`recordType`, `name`, `content`),
 * `conversation.turn_not_saveable` for a turn that is not offered, `conversation.turn_saved` for one saved already, and
 * `request.not_found` for a turn that is not the account's or is of a conversation being deleted.
 */
export function saveDraft(sessionToken: string, turnId: string, body: SavedDraft, options: CallOptions = {}): Promise<Result<SavedArtifact>> {
  return call('conversations.save_draft', options, (client) =>
    client.POST('/api/v1/turns/{turnId}/artifact', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { turnId } },
      body,
    }),
  );
}

/**
 * "Agora não" on a draft's save confirmation (Story 5.4 part A): 204, also for a draft declined already;
 * `conversation.turn_not_saveable` and `conversation.turn_saved` as {@link saveDraft}, not found as above.
 */
export function declineDraftSave(sessionToken: string, turnId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('conversations.save_decline', options, (client) =>
    client.PUT('/api/v1/turns/{turnId}/save-decline', { params: { header: { 'X-Session-Token': sessionToken }, path: { turnId } } }),
  );
}

/** "Salvar como artefato" (Story 5.4 part A): the draft offered again; 204, also for one offered already. */
export function reopenDraftSave(sessionToken: string, turnId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('conversations.save_reopen', options, (client) =>
    client.DELETE('/api/v1/turns/{turnId}/save-decline', { params: { header: { 'X-Session-Token': sessionToken }, path: { turnId } } }),
  );
}

/**
 * One page of the account's saved answers across all its campaigns (Story 3.12), the newest saved first, with the
 * list's total. A dismissed answer, one of a conversation being deleted and those of an archived campaign or of a
 * campaign being deleted are left out.
 */
export function savedAnswers(
  sessionToken: string,
  query: { readonly limit?: number; readonly offset?: number } = {},
  options: CallOptions = {},
): Promise<Result<SavedAnswerPage>> {
  return call('conversations.saved', options, (client) =>
    client.GET('/api/v1/saved-answers', { params: { header: { 'X-Session-Token': sessionToken }, query } }),
  );
}

/**
 * One page of the version the turn's reference `number` names (Story 2.7), any page from 1 to its page total;
 * `request.not_found` for a turn that is not the account's, no such reference, a source removed since, or a page that
 * is not one.
 */
export function referencePage(
  sessionToken: string,
  turnId: string,
  number: string,
  page: string,
  options: CallOptions = {},
): Promise<Result<ReferencePage>> {
  return call('conversations.reference_page', options, (client) =>
    client.GET('/api/v1/turns/{turnId}/references/{number}/pages/{page}', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { turnId, number: Number(number), page: Number(page) } },
    }),
  );
}

/**
 * Starts a search of the campaign's scope (Story 3.9), narrowed by its filters: 202 with the search's id;
 * `request.invalid` for a blank query, one past 500 code points or a filter that is not one, `request.not_found` for a
 * campaign that is not the account's.
 */
export function createSearch(sessionToken: string, campaignId: string, body: NewSearch, options: CallOptions = {}): Promise<Result<SearchCreated>> {
  return call('conversations.search', options, (client) =>
    client.POST('/api/v1/campaigns/{campaignId}/searches', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { campaignId } },
      body,
    }),
  );
}

/**
 * A search of the account (Story 3.9): its state and, once done, its results as they stand in its campaign's current
 * scope; `request.not_found` for anything that is not the account's (pruned, or of a campaign deleted since, too).
 */
export function getSearch(sessionToken: string, searchId: string, options: CallOptions = {}): Promise<Result<Search>> {
  return call('conversations.search_read', options, (client) =>
    client.GET('/api/v1/searches/{searchId}', { params: { header: { 'X-Session-Token': sessionToken }, path: { searchId } } }),
  );
}

/**
 * One page of a version of the campaign's current scope (Story 3.5's ground, opened by a search result in Story 3.9);
 * `request.not_found` for a version outside that scope, a campaign that is not the account's or a page that is not
 * one.
 */
export function scopeSourcePage(
  sessionToken: string,
  campaignId: string,
  versionId: string,
  page: string,
  options: CallOptions = {},
): Promise<Result<ReferencePage>> {
  return call('conversations.scope_page', options, (client) =>
    client.GET('/api/v1/campaigns/{campaignId}/sources/{versionId}/pages/{page}', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { campaignId, versionId, page: Number(page) } },
    }),
  );
}

/** Whether a text can be a reference's or a page's number. */
export function isNumber(text: string): boolean {
  return NUMBER.test(text);
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
