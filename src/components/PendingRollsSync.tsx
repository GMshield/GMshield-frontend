'use client';

import { useEffect } from 'react';

import { flush } from '@/client/pending-rolls';

export type PendingRollsSyncProps = {
  /** The signed-in account's id: only its pending rolls are sent. */
  readonly accountId: string;
};

/** How often a visible tab sends what still waits (after a 5xx or a timeout while the browser stays online). */
export const PENDING_ROLLS_RETRY_MS = 30_000;

/**
 * Sends the account's pending rolls from the signed-in layout (Story 6.4 part B, AD-31), through the one sender
 * ({@link flush}), so a roll the Shield's screen is sending is not sent twice in this tab: when the layout mounts (a full
 * page load, which covers the next sign-in in this browser and a tab closed before its rolls were saved; a client
 * navigation keeps it mounted), whenever the connection returns, when the tab becomes visible, and every
 * {@link PENDING_ROLLS_RETRY_MS} while it is visible (a flush with nothing pending, or offline, does nothing). Every
 * Shield of the account is covered; another account's rolls in this browser are never read or sent. It renders nothing.
 */
export function PendingRollsSync({ accountId }: PendingRollsSyncProps) {
  useEffect(() => {
    const send = () => void flush(accountId);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        send();
      }
    };
    send();
    window.addEventListener('online', send);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        send();
      }
    }, PENDING_ROLLS_RETRY_MS);
    return () => {
      window.removeEventListener('online', send);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [accountId]);
  return null;
}
