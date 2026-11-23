import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { isId, isNumber, relayProblem, scopeSourcePage } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * A page of a version of the campaign's current scope (Story 3.9: the page a search result opens, on Story 3.5's ground),
 * read from the backend through the typed client (`src/server/conversations.ts`) with the visitor's session: the same
 * shape as a material's page on the review ground. A request from another origin is refused; an id or a page that
 * cannot be one answers "not found" without reaching the backend, and no session is `session.required`. The backend
 * decides the rest (owner, scope, page) and its answer goes back as it is, never stored.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string; readonly versionId: string; readonly page: string }> };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { traceId } = traceFrom(request.headers.get('traceparent'));
  if (!isSameOrigin(request)) {
    return relayProblem(403, 'request', 'request.cross_origin', 'Cross-origin request refused', traceId);
  }
  const { id, versionId, page } = await context.params;
  if (!isId(id) || !isId(versionId) || !isNumber(page)) {
    return relayProblem(404, 'request', 'request.not_found', 'Not found', traceId);
  }
  const token = sessionFrom(request.cookies.get(SESSION_COOKIE)?.value)?.token;
  if (token === undefined) {
    return relayProblem(401, 'session', 'session.required', 'Session required', traceId);
  }
  const result = await scopeSourcePage(token, id, versionId, page, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return Response.json(result.data, { status: 200, headers: HEADERS });
  }
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}
