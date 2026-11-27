import type { NextRequest } from 'next/server';

import { LANGUAGE_COOKIE, preferencesFor } from '@/preferences';
import { SESSION_COOKIE, relayExport } from '@/server/backend/export-relay';

/**
 * An export of the campaign's artifacts (Story 5.7 part A): the backend's file, relayed as a stream by the export relay
 * (`src/server/backend/export-relay.ts`), its labels in the visitor's language (the language cookie, else the browser's).
 * Node runtime, never cached. A GET only: `src/proxy.ts` runs here and sets the site's headers as on every page.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { id } = await context.params;
  const { language } = preferencesFor({ language: request.cookies.get(LANGUAGE_COOKIE)?.value }, request.headers.get('accept-language'));
  return relayExport(
    {
      headers: request.headers,
      signal: request.signal,
      sessionCookie: request.cookies.get(SESSION_COOKIE)?.value,
      ids: request.nextUrl.searchParams.get('ids'),
      format: request.nextUrl.searchParams.get('format'),
      language,
    },
    id,
  );
}
