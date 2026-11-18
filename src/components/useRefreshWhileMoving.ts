'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';

/** How often a page asks for fresh data while what it shows is moving and the tab is visible. */
export const REFRESH_MS = 5000;

/** Whether the tab is visible, kept up to date; false while rendering on the server. */
export function useVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
    () => document.visibilityState === 'visible',
    () => false,
  );
}

/**
 * While `moving` and the tab is visible, asks the router for fresh server data every {@link REFRESH_MS}
 * (`router.refresh()`: an RSC fetch, which never renews the session). The upload tray (Story 1.14) and a material's
 * page (Story 1.15) share it.
 */
export function useRefreshWhileMoving(moving: boolean): void {
  const router = useRouter();
  const visible = useVisible();
  useEffect(() => {
    if (!moving || !visible) {
      return undefined;
    }
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [moving, visible, router]);
}
