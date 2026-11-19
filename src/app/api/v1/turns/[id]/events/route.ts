import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { relayTurnEvents } from '@/server/conversations';
import { SESSION_COOKIE, sessionFrom } from '@/server/session-cookies';

/**
 * A turn's answer as server-sent events (Story 2.4), relayed from the backend as a stream
 * (`src/server/conversations.ts`), with `Last-Event-ID` forwarded and no time limit; leaving aborts the backend
 * request. Node runtime, never cached. `src/proxy.ts` leaves this path alone, so the relay checks the origin itself.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { id } = await context.params;
  return relayTurnEvents(
    {
      headers: request.headers,
      signal: request.signal,
      sessionToken: sessionFrom(request.cookies.get(SESSION_COOKIE)?.value)?.token ?? null,
      sameOrigin: isSameOrigin(request),
    },
    id,
  );
}
