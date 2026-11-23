import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { bookmarkTurn, isId, relayProblem, unbookmarkTurn } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * The GM's bookmark of a turn's answer (PUT) and its removal (DELETE) (Story 3.12), relayed to the backend through the
 * typed client (`src/server/conversations.ts`) with the visitor's session. A request from another origin is refused, an
 * id that is not one answers "not found" without reaching the backend, and no session is `session.required`. The
 * backend's answer goes back as it is: 204 (also when nothing changed), or its problem detail
 * (`conversation.turn_not_done` for an answer that is running, stopped, failed or silent).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string }> };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

async function relay(request: NextRequest, context: Context, action: typeof bookmarkTurn): Promise<Response> {
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
  const result = await action(token, id, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return new Response(null, { status: 204, headers: HEADERS });
  }
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}

export async function PUT(request: NextRequest, context: Context): Promise<Response> {
  return relay(request, context, bookmarkTurn);
}

export async function DELETE(request: NextRequest, context: Context): Promise<Response> {
  return relay(request, context, unbookmarkTurn);
}
