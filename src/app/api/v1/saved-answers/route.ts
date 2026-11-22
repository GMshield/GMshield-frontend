import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { relayProblem, savedAnswers } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * The account's saved answers (Story 3.12), one page at a time, read from the backend through the typed client with
 * the visitor's session: `limit` 1 to 50 and `offset` 0 to 100000, each optional and written as the backend reads them
 * (digits, no sign, no leading zero). A request from another origin is refused, a malformed `limit` or `offset` is
 * `request.invalid` without reaching the backend, and no session is `session.required`. The backend's answer goes back
 * as it is, never stored.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const LIMIT = /^[1-9]\d?$/;
const OFFSET = /^(0|[1-9]\d{0,5})$/;
const MAX_LIMIT = 50;
const MAX_OFFSET = 100_000;

/** The query's number: absent (undefined), or a valid one, or null for one that is not. */
function field(text: string | null, pattern: RegExp, max: number): number | undefined | null {
  if (text === null) {
    return undefined;
  }
  return pattern.test(text) && Number(text) <= max ? Number(text) : null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const { traceId } = traceFrom(request.headers.get('traceparent'));
  if (!isSameOrigin(request)) {
    return relayProblem(403, 'request', 'request.cross_origin', 'Cross-origin request refused', traceId);
  }
  const params = request.nextUrl.searchParams;
  const limit = field(params.get('limit'), LIMIT, MAX_LIMIT);
  const offset = field(params.get('offset'), OFFSET, MAX_OFFSET);
  if (limit === null || offset === null) {
    return relayProblem(400, 'request', 'request.invalid', 'Invalid request', traceId);
  }
  const token = sessionFrom(request.cookies.get(SESSION_COOKIE)?.value)?.token;
  if (token === undefined) {
    return relayProblem(401, 'session', 'session.required', 'Session required', traceId);
  }
  const query = { ...(limit === undefined ? {} : { limit }), ...(offset === undefined ? {} : { offset }) };
  const result = await savedAnswers(token, query, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return Response.json(result.data, { status: 200, headers: HEADERS });
  }
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}
