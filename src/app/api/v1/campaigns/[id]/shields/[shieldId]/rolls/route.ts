import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { isId, relayProblem } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';
import { clearRolls, keepRoll, listRolls, type NewRoll, type RollQuery } from '@/server/shields';
import { traceFrom } from '@/server/trace';

/**
 * A Shield's stored rolls (Story 6.4 part A), relayed to the backend through the typed client (`src/server/shields.ts`)
 * with the visitor's session: a roll made in the browser (POST `{key, formula, results, label?, rolledAt}`), the log a
 * page at a time (GET, `limit` 1 to 50 and `cursor`, each optional), and its clearing (DELETE). A request from another
 * origin is refused, an id that is not one answers "not found" without reaching the backend, and no session is
 * `session.required`. A POST body that is not an object with a string key, formula and time, an array of whole numbers
 * as results and a string (or null) label, and a malformed `limit` or `cursor`, are `request.invalid` without reaching
 * the backend; the backend decides the rest (the formula's grammar, each die's range, the label's length, the time, the
 * key, the owner). Its answer goes back as it is: 201 for a roll stored now, 200 for one already held under its key, the
 * page, 204, or its problem detail. Nothing is stored here.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string; readonly shieldId: string }> };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const LIMIT = /^[1-9]\d?$/;
const MAX_LIMIT = 50;

type Checked = { readonly ok: true; readonly token: string; readonly id: string; readonly shieldId: string } | { readonly ok: false; readonly response: Response };

/** The origin, the ids and the session, each checked before anything reaches the backend. */
async function checked(request: NextRequest, context: Context, traceId: string): Promise<Checked> {
  if (!isSameOrigin(request)) {
    return { ok: false, response: relayProblem(403, 'request', 'request.cross_origin', 'Cross-origin request refused', traceId) };
  }
  const { id, shieldId } = await context.params;
  if (!isId(id) || !isId(shieldId)) {
    return { ok: false, response: relayProblem(404, 'request', 'request.not_found', 'Not found', traceId) };
  }
  const token = sessionFrom(request.cookies.get(SESSION_COOKIE)?.value)?.token;
  if (token === undefined) {
    return { ok: false, response: relayProblem(401, 'session', 'session.required', 'Session required', traceId) };
  }
  return { ok: true, token, id, shieldId };
}

function refused(result: { readonly status: number; readonly problem: unknown }): Response {
  return Response.json(result.problem, { status: result.status, headers: { ...HEADERS, 'Content-Type': 'application/problem+json' } });
}

/** The body as a roll, or null when it is not one in shape. */
function rollOf(parsed: unknown): NewRoll | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const body = parsed as Record<string, unknown>;
  const results = body.results;
  if (
    typeof body.key !== 'string' ||
    typeof body.formula !== 'string' ||
    typeof body.rolledAt !== 'string' ||
    !Array.isArray(results) ||
    !results.every((result) => Number.isInteger(result)) ||
    !(body.label === undefined || body.label === null || typeof body.label === 'string')
  ) {
    return null;
  }
  return {
    key: body.key,
    formula: body.formula,
    results: results as number[],
    ...(typeof body.label === 'string' ? { label: body.label } : {}),
    rolledAt: body.rolledAt,
  };
}

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  const { traceId } = traceFrom(request.headers.get('traceparent'));
  const check = await checked(request, context, traceId);
  if (!check.ok) {
    return check.response;
  }
  let roll: NewRoll | null;
  try {
    roll = rollOf(await request.json());
  } catch {
    roll = null;
  }
  if (roll === null) {
    return relayProblem(400, 'request', 'request.invalid', 'Invalid request', traceId);
  }
  const result = await keepRoll(check.token, check.id, check.shieldId, roll, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return Response.json(result.data.roll, { status: result.data.created ? 201 : 200, headers: HEADERS });
  }
  return refused(result);
}

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { traceId } = traceFrom(request.headers.get('traceparent'));
  const check = await checked(request, context, traceId);
  if (!check.ok) {
    return check.response;
  }
  const params = request.nextUrl.searchParams;
  const limit = params.get('limit');
  const cursor = params.get('cursor');
  if ((limit !== null && (!LIMIT.test(limit) || Number(limit) > MAX_LIMIT)) || (cursor !== null && !isId(cursor))) {
    return relayProblem(400, 'request', 'request.invalid', 'Invalid request', traceId);
  }
  const query: RollQuery = { ...(limit === null ? {} : { limit: Number(limit) }), ...(cursor === null ? {} : { cursor }) };
  const result = await listRolls(check.token, check.id, check.shieldId, query, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return Response.json(result.data, { status: 200, headers: HEADERS });
  }
  return refused(result);
}

export async function DELETE(request: NextRequest, context: Context): Promise<Response> {
  const { traceId } = traceFrom(request.headers.get('traceparent'));
  const check = await checked(request, context, traceId);
  if (!check.ok) {
    return check.response;
  }
  const result = await clearRolls(check.token, check.id, check.shieldId, { traceparent: request.headers.get('traceparent') });
  if (result.ok) {
    return new Response(null, { status: 204, headers: HEADERS });
  }
  return refused(result);
}
