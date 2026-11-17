import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, relayPicture } from '@/server/backend/picture-relay';

/**
 * A page's picture (Story 1.19): the backend's WebP for `?ground=...`, relayed as a stream
 * (`src/server/backend/picture-relay.ts`). Node runtime, never cached. A GET only: `src/proxy.ts` runs here and sets
 * the site's headers as on every page.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string; readonly page: string }> };

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { id, page } = await context.params;
  return relayPicture(
    {
      headers: request.headers,
      signal: request.signal,
      sessionCookie: request.cookies.get(SESSION_COOKIE)?.value,
      ground: request.nextUrl.searchParams.get('ground'),
    },
    id,
    page,
  );
}
