import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { askQuestion, isId, relayProblem } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * A new turn (Story 2.4): `{question}` on the current campaign, recorded by the backend through the typed client
 * (`src/server/conversations.ts`), with the visitor's session. A request from another origin is refused, and so is
 * anything but a JSON object with a string question; the backend decides the rest (length, blank, owner). The
 * backend's answer goes back as it is: the turn (201), or its problem detail.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string }> };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

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
  let question: unknown;
  try {
    question = ((await request.json()) as { question?: unknown } | null)?.question;
  } catch {
    question = undefined;
  }
  if (typeof question !== 'string') {
    return relayProblem(400, 'request', 'request.invalid', 'Invalid request', traceId);
  }
  const result = await askQuestion(token, id, question, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return Response.json(result.data, { status: 201, headers: HEADERS });
  }
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}
