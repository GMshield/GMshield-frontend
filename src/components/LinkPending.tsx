'use client';

import { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';

import styles from './LinkPending.module.css';
import { Spinner } from './Spinner';

/**
 * What a link shows at its end while the page it leads to is on its way (usability pass, 2026-11-21): a spinner in
 * place of `children` (an arrow, or nothing). Every page is rendered per request, so a slow backend used to leave a
 * press on a link without any answer for up to two seconds. It must sit inside a `Link`; its box keeps one size, so
 * nothing moves when the spinner comes and goes.
 */
export function LinkPending({ children }: { readonly children?: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span className={styles.hint} data-pending={pending ? 'true' : undefined}>
      {pending ? <Spinner size={14} /> : children}
    </span>
  );
}
