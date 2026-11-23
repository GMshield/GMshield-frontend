import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { isId, isNumber, relayProblem } from '@/server/conversations';
import { recordSourcePage } from '@/server/library';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * A page of the version a record was read from, on the record's ground (Story 4.3: the page a record's reference
 * opens), read from the backend through the typed client (`src/server/library.ts`) with the visitor's session: the same
 * shape as a material's page on the review ground. A request from another origin is refused; an id or a page that
 * cannot be one answers "not found" without reaching the backend, and no session is `session.required`. The backend
 * decides the rest (owner, system, record, page) and its answer goes back as it is, never stored.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string; readonly recordId: string; readonly page: string }> };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { traceId } = traceFrom(request.headers.get('traceparent'));
  if (!isSameOrigin(request)) {
    return relayProblem(403, 'request', 'request.cross_origin', 'Cross-origin request refused', traceId);
  }
  const { id, recordId, page } = await context.params;
  if (!isId(id) || !isId(recordId) || !isNumber(page)) {
    return relayProblem(404, 'request', 'request.not_found', 'Not found', traceId);
  }
  const token = sessionFrom(request.cookies.get(SESSION_COOKIE)?.value)?.token;
  if (token === undefined) {
    return relayProblem(401, 'session', 'session.required', 'Session required', traceId);
  }
  const result = await recordSourcePage(token, id, recordId, page, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return Response.json(result.data, { status: 200, headers: HEADERS });
  }
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}
