'use client';

import { ErrorScreen } from '@/components/ErrorScreen';

/**
 * The fallback of a page that failed unexpectedly (usability pass, 2026-11-21): `ErrorScreen`, in the interface's
 * language, with a way to try again. Nothing about the failure is shown; the server's log has it.
 */
export default function PageError({ retry }: { readonly error: unknown; readonly retry: () => void }) {
  return <ErrorScreen retry={retry} />;
}
