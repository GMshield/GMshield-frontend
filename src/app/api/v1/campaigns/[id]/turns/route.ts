import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import {
  AREAS,
  TURN_KINDS,
  askQuestion,
  isId,
  relayProblem,
  type Area,
  type QuestionTarget,
  type TurnKind,
} from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * A new turn (Story 2.4): `{question}` on the current campaign, recorded by the backend through the typed client
 * (`src/server/conversations.ts`), with the visitor's session. Story 3.10: with `conversationId` (an id) it continues
 * that conversation, with `area` (`questions` or `rules`) it starts one; anything else in them is refused here.
 * Story 5.3 part A: `kind` (`question` or `draft`) is passed on the same way; the backend refuses a draft outside the
 * questions area. A request from another origin is refused, and so is anything but a JSON object with a string
 * question; the backend decides the rest (length, blank, owner, the conversation's campaign). The backend's answer goes
 * back as it is: the turn (201), or its problem detail.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string }> };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/**
 * Where the question goes (Story 3.10) and what it asks for (Story 5.3 part A, `kind`): absent or null fields are none;
 * anything else that is not one is null.
 */
function targetOf(conversationId: unknown, area: unknown, kind: unknown): QuestionTarget | null {
  const target: { conversationId?: string; area?: Area; kind?: TurnKind } = {};
  if (conversationId !== undefined && conversationId !== null) {
    if (typeof conversationId !== 'string' || !isId(conversationId)) {
      return null;
    }
    target.conversationId = conversationId;
  }
  if (area !== undefined && area !== null) {
    const known = AREAS.find((word) => word === area);
    if (known === undefined) {
      return null;
    }
    target.area = known;
  }
  if (kind !== undefined && kind !== null) {
    const known = TURN_KINDS.find((word) => word === kind);
    if (known === undefined) {
      return null;
    }
    target.kind = known;
  }
  return target;
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
  let body: { question?: unknown; conversationId?: unknown; area?: unknown; kind?: unknown } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = null;
  }
  const question = body?.question;
  const target = targetOf(body?.conversationId, body?.area, body?.kind);
  if (typeof question !== 'string' || target === null) {
    return relayProblem(400, 'request', 'request.invalid', 'Invalid request', traceId);
  }
  const result = await askQuestion(token, id, question, { traceparent: request.headers.get('traceparent') }, target);
  if (result.ok) {
    return Response.json(result.data, { status: 201, headers: HEADERS });
  }
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}
