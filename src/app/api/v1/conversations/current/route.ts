import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { currentConversation, relayProblem } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * The current conversation, read from the backend through the typed client (`src/server/conversations.ts`) with the
 * visitor's session, for the indexing notice's count (`indexing`). A request from another origin is refused, and no
 * session is `session.required`. The backend's answer goes back as it is, never stored.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: NextRequest): Promise<Response> {
  const { traceId } = traceFrom(request.headers.get('traceparent'));
  if (!isSameOrigin(request)) {
    return relayProblem(403, 'request', 'request.cross_origin', 'Cross-origin request refused', traceId);
  }
  const token = sessionFrom(request.cookies.get(SESSION_COOKIE)?.value)?.token;
  if (token === undefined) {
    return relayProblem(401, 'session', 'session.required', 'Session required', traceId);
  }
  const result = await currentConversation(token, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return Response.json(result.data, { status: 200, headers: HEADERS });
  }
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}
