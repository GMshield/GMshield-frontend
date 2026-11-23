import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, relayScopePicture } from '@/server/backend/picture-relay';

/**
 * The picture of a page of a version of the campaign's current scope (Story 3.9: a search result's page): the backend's
 * WebP, relayed as a stream by the picture relay (`src/server/backend/picture-relay.ts`). Node runtime, never cached. A
 * GET only: `src/proxy.ts` runs here and sets the site's headers as on every page.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string; readonly versionId: string; readonly page: string }> };

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { id, versionId, page } = await context.params;
  return relayScopePicture(
    { headers: request.headers, signal: request.signal, sessionCookie: request.cookies.get(SESSION_COOKIE)?.value },
    id,
    versionId,
    page,
  );
}
