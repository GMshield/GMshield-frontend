import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { createSearch, isId, relayProblem } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { traceFrom } from '@/server/trace';

/**
 * A new search of the campaign's scope (Story 3.9): `{query, tier?, materialId?}`, recorded by the backend through the
 * typed client (`src/server/conversations.ts`), with the visitor's session. A request from another origin is refused,
 * and so is anything but a JSON object with a string query and, when given, a string (or null) tier and material; the
 * backend decides the rest (length, blank, the words and ids it takes, owner). Its answer goes back as it is: the
 * search's id (202), or its problem detail.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string }> };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function optional(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
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
  let body: Record<string, unknown> | null;
  try {
    const parsed: unknown = await request.json();
    body = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (body === null || typeof body.query !== 'string' || !optional(body.tier) || !optional(body.materialId)) {
    return relayProblem(400, 'request', 'request.invalid', 'Invalid request', traceId);
  }
  const search = {
    query: body.query,
    ...(typeof body.tier === 'string' ? { tier: body.tier as 'campaign' | 'system' | 'other' } : {}),
    ...(typeof body.materialId === 'string' ? { materialId: body.materialId } : {}),
  };
  const result = await createSearch(token, id, search, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return Response.json(result.data, { status: 202, headers: HEADERS });
  }
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}
