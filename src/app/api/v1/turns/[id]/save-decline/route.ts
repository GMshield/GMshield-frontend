import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { declineDraftSave, isId, relayProblem, reopenDraftSave } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * The GM's "Agora não" on a draft's save confirmation (PUT) and "Salvar como artefato", which offers it again (DELETE)
 * (Story 5.4 part A), relayed to the backend through the typed client (`src/server/conversations.ts`) with the
 * visitor's session, as the bookmark relay is. A request from another origin is refused, an id that is not one answers
 * "not found" without reaching the backend, and no session is `session.required`. The backend's answer goes back as it
 * is: 204 (also when nothing changed), or its problem detail (`conversation.turn_not_saveable`,
 * `conversation.turn_saved`).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string }> };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

async function relay(request: NextRequest, context: Context, action: typeof declineDraftSave): Promise<Response> {
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
  return relay(request, context, declineDraftSave);
}

export async function DELETE(request: NextRequest, context: Context): Promise<Response> {
  return relay(request, context, reopenDraftSave);
}
