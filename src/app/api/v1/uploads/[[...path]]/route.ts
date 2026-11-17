import type { NextRequest } from 'next/server';

import { isSameOrigin } from '@/proxy';
import { SESSION_COOKIE, relayUpload } from '@/server/backend/upload-relay';

/**
 * The resumable upload (Story 1.13): tus creation, offset and parts, and the whole-file check, relayed to the
 * backend's `/api/v1/uploads/**` as a stream (`src/server/backend/upload-relay.ts`). Node runtime, never cached;
 * `src/proxy.ts` leaves these paths alone, so the relay checks the origin itself.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly path?: string[] }> };

async function relay(request: NextRequest, context: Context): Promise<Response> {
  const { path } = await context.params;
  return relayUpload(
    {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      sessionCookie: request.cookies.get(SESSION_COOKIE)?.value,
      sameOrigin: isSameOrigin(request),
    },
    path,
  );
}

export const POST = relay;
export const HEAD = relay;
export const PATCH = relay;
