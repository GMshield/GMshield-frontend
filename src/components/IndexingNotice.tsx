'use client';

import { useEffect, useState } from 'react';

import { fetchIndexing, type IndexingPoll } from '@/client/conversation';
import { translator, type Language } from '@/messages';

import { Notice } from './Notice';
import { useVisible } from './useRefreshWhileMoving';

/** How often the notice reads its count again while the tab is visible. */
export const INDEXING_POLL_MS = 5000;
/** A read that has not settled after this long counts as failed, so a hung read never blocks the next ones. */
export const INDEXING_READ_TIMEOUT_MS = 4000;
/** After this long of successful reads without a change, the notice stops reading and keeps its last number. */
export const INDEXING_STALL_MS = 10 * 60 * 1000;
/** The successful reads without a change that make {@link INDEXING_STALL_MS}. */
const STALL_READS = INDEXING_STALL_MS / INDEXING_POLL_MS;
const FAILED: IndexingPoll = { kind: 'failed' };

export type IndexingNoticeProps = {
  /** The passages still being prepared for search, as the layout read them (at least 1). */
  readonly remaining: number;
  readonly language: Language;
};

/**
 * The indexing notice: a warning at the top of the main column, "Preparando as fontes para busca: faltam 2.000
 * trechos" ("falta 1 trecho" for one; the number formatted for the language), with no dismiss control, and not a live
 * region (its changing number is never announced again).
 *
 * It keeps its own count: every {@link INDEXING_POLL_MS} while the tab is visible it reads `indexing` from the relay
 * of the current conversation (`fetchIndexing`), each read bounded by {@link INDEXING_READ_TIMEOUT_MS}. A new number
 * replaces the shown one; null (nothing pending) hides the notice and stops the reads; a failed read keeps the last
 * number and changes nothing else. After {@link INDEXING_STALL_MS} of successful reads without a change, it stops
 * reading and the line stays. A new count from the page (the layout rendered again) shows at once and starts the reads
 * again. It never refreshes the page, so whatever the page holds (a conversation's turns) is left alone.
 */
export function IndexingNotice({ remaining, language }: IndexingNoticeProps) {
  const [count, setCount] = useState<number | null>(remaining);
  const [polling, setPolling] = useState(true);
  // The count the page last gave: a new one replaces the shown count and starts the reads again.
  const [given, setGiven] = useState(remaining);
  if (given !== remaining) {
    setGiven(remaining);
    setCount(remaining);
    setPolling(true);
  }
  const visible = useVisible();

  useEffect(() => {
    if (!polling || !visible || count === null) {
      return undefined;
    }
    const controller = new AbortController();
    // Successful reads without a change since the count last changed or the reads (re)started.
    let unchanged = 0;
    let reading = false;
    const timer = setInterval(() => {
      if (reading) {
        return;
      }
      reading = true;
      const read = new AbortController();
      const stop = () => read.abort();
      controller.signal.addEventListener('abort', stop);
      const timeout = setTimeout(stop, INDEXING_READ_TIMEOUT_MS);
      const abandoned = new Promise<IndexingPoll>((resolve) => read.signal.addEventListener('abort', () => resolve(FAILED)));
      void Promise.race([fetchIndexing(read.signal), abandoned]).then((poll) => {
        reading = false;
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', stop);
        if (controller.signal.aborted || poll.kind === 'failed') {
          return;
        }
        if (poll.kind === 'none') {
          setCount(null);
          return;
        }
        if (poll.remaining !== count) {
          // The effect starts again with the new count.
          setCount(poll.remaining);
          return;
        }
        unchanged += 1;
        if (unchanged >= STALL_READS) {
          setPolling(false);
        }
      });
    }, INDEXING_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [polling, visible, count]);

  if (count === null) {
    return null;
  }
  const t = translator(language);
  const number = new Intl.NumberFormat(language).format(count);
  return (
    <Notice
      status="warning"
      language={language}
      message={count === 1 ? t('notice.indexingOne', { remaining: number }) : t('notice.indexing', { remaining: number })}
      dismissible={false}
      live={false}
    />
  );
}
