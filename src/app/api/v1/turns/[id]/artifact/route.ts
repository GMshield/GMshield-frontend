import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { isId, relayProblem, saveDraft, type SavedDraft } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * The GM's "Salvar" on a draft's save confirmation (Story 5.4 part A): `{name, recordType, content}` saved as an
 * artifact of the conversation's campaign by the backend, through the typed client (`src/server/conversations.ts`), with
 * the visitor's session. A request from another origin is refused, an id that is not one answers "not found" without
 * reaching the backend, and no session is `session.required`. Anything but a JSON object whose name and record type are
 * strings, and whose content is a string, null or absent, is refused here; the backend decides the rest (the limits,
 * the record type, the turn). The backend's answer goes back as it is: the artifact (201), or its problem detail.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string }> };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/** The body as the backend takes it, or null when it is not one. */
function savedOf(body: unknown): SavedDraft | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  const { name, recordType, content } = body as Record<string, unknown>;
  if (typeof name !== 'string' || typeof recordType !== 'string') {
    return null;
  }
  if (content !== undefined && content !== null && typeof content !== 'string') {
    return null;
  }
  return { name, recordType, ...(content === undefined ? {} : { content }) };
}

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  const { traceId } = traceFrom(request.headers.get('traceparent'));
  if (!isSameOrigin(request)) {
    return relayProblem(403, 'request', 'request.cross_origin', 'Cross-origin request refused', traceId);
  }
  const { id } = await context.params;
  if (!isId(id)) {
    return relayProblem(404, 'request', 'request.not_found', 'Not found', traceId);
  }
  const token = sessionFrom(request.cookies.get(SESSION_COOKIE)?.value)?.token;
  if (token === undefined) {
    return relayProblem(401, 'session', 'session.required', 'Session required', traceId);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const saved = savedOf(body);
  if (saved === null) {
    return relayProblem(400, 'request', 'request.invalid', 'Invalid request', traceId);
  }
  const result = await saveDraft(token, id, saved, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return Response.json(result.data, { status: 201, headers: HEADERS });
  }
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}
