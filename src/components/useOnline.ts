'use client';

import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/**
 * Whether the browser says it has a connection (Story 6.2): `navigator.onLine`, kept up to date by the `online` and
 * `offline` events; true while rendering on the server, so a page never starts by saying it is offline. A note cannot be
 * saved without one, so the note forms and the artifact editor block their save while this is false and keep what was
 * typed in their own state. Story 6.4 part B: the Shield's dice roller shows its offline line while this is false.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
