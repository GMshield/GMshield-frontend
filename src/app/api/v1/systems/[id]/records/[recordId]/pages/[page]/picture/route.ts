import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, relayRecordPicture } from '@/server/backend/picture-relay';

/**
 * The picture of a page of the version a record was read from (Story 4.3: a record's reference): the backend's WebP,
 * relayed as a stream by the picture relay (`src/server/backend/picture-relay.ts`). Node runtime, never cached. A GET
 * only: `src/proxy.ts` runs here and sets the site's headers as on every page.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string; readonly recordId: string; readonly page: string }> };

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { id, recordId, page } = await context.params;
  return relayRecordPicture(
    { headers: request.headers, signal: request.signal, sessionCookie: request.cookies.get(SESSION_COOKIE)?.value },
    id,
    recordId,
    page,
  );
}
