'use client';

import { useEffect, useState } from 'react';

import { fetchIndexing, type IndexingFailed, type IndexingPoll } from '@/client/conversation';
import { translator, type Language } from '@/messages';

import { Notice } from './Notice';
import { useVisible } from './useRefreshWhileMoving';

/** How often the notice reads its state again while the tab is visible. */
export const INDEXING_POLL_MS = 5000;
/** A read that has not settled after this long counts as failed, so a hung read never blocks the next ones. */
export const INDEXING_READ_TIMEOUT_MS = 4000;
/**
 * After this long of successful reads without a change, the notice stops reading and keeps its last lines, unless a
 * failure is retrying: then it reads until the state changes.
 */
export const INDEXING_STALL_MS = 10 * 60 * 1000;
/** The successful reads without a change that make {@link INDEXING_STALL_MS}. */
const STALL_READS = INDEXING_STALL_MS / INDEXING_POLL_MS;
const FAILED: IndexingPoll = { kind: 'failed' };

export type IndexingNoticeProps = {
  /** The passages still being prepared for search, as the layout read them (at least 1), or null when none is. */
  readonly remaining: number | null;
  /** The passages that could not be prepared for search, and whether a retry remains, or null when none failed. */
  readonly failed: IndexingFailed | null;
  readonly language: Language;
};

/** A failure as one comparable value: null, or "passages:retrying". */
function failureKey(failed: IndexingFailed | null): string | null {
  return failed === null ? null : `${failed.passages}:${failed.retrying}`;
}

/**
 * The indexing notice: up to two lines at the top of the main column, stacked, with no dismiss control, and not live
 * regions (their changing numbers are never announced again).
 *
 * - The pending line, a warning: "Preparando as fontes para busca: faltam 2.000 trechos" ("falta 1 trecho" for one).
 * - The failure line, second: while a retry remains, a warning, "Não foi possível preparar 200 trechos para busca; nova
 *   tentativa em alguns minutos."; once none does, an error, "Não foi possível preparar 200 trechos para busca." (the
 *   singular for one). Each number is formatted for the language.
 *
 * It keeps its own state: every {@link INDEXING_POLL_MS} while the tab is visible it reads `indexing` and
 * `indexingFailed` from the relay of the current conversation (`fetchIndexing`), each read bounded by
 * {@link INDEXING_READ_TIMEOUT_MS}. New values replace the shown ones; a failed read keeps the last lines and changes
 * nothing else. It reads while anything is pending or a retry remains, and stops when only a final failure is left (that
 * line stays) or nothing is (the notice goes). While no failure is retrying, after {@link INDEXING_STALL_MS} of
 * successful reads without a change it stops reading and the lines stay; while one is, it reads until the state changes
 * (the retry's outcome, at most about 40 minutes over 3 retries). New values from the page (the layout rendered again)
 * show at once and start the reads again. It never refreshes the page, so whatever the page holds (a conversation's turns) is left alone.
 */
export function IndexingNotice({ remaining, failed, language }: IndexingNoticeProps) {
  const [count, setCount] = useState<number | null>(remaining);
  const [failure, setFailure] = useState<IndexingFailed | null>(failed);
  const [polling, setPolling] = useState(true);
  // What the page last gave: new values replace the shown ones and start the reads again.
  const [given, setGiven] = useState(`${remaining}|${failureKey(failed)}`);
  const givenNow = `${remaining}|${failureKey(failed)}`;
  if (given !== givenNow) {
    setGiven(givenNow);
    setCount(remaining);
    setFailure(failed);
    setPolling(true);
  }
  const visible = useVisible();
  const shownFailure = failureKey(failure);
  // Something can still change: a passage is pending, or a failed run will be tried again.
  const retrying = failure?.retrying === true;
  const moving = count !== null || retrying;

  useEffect(() => {
    if (!polling || !visible || !moving) {
      return undefined;
    }
    const controller = new AbortController();
    // Successful reads without a change since the state last changed or the reads (re)started.
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
        if (poll.remaining !== count || failureKey(poll.failed) !== shownFailure) {
          // The effect starts again with the new state, or ends when nothing can change any more.
          setCount(poll.remaining);
          setFailure(poll.failed);
          return;
        }
        unchanged += 1;
        // A retry to come always changes the state (pending again, then done or failed): no stall waits it out.
        if (!retrying && unchanged >= STALL_READS) {
          setPolling(false);
        }
      });
    }, INDEXING_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [polling, visible, moving, retrying, count, shownFailure]);

  if (count === null && failure === null) {
    return null;
  }
  const t = translator(language);
  const format = new Intl.NumberFormat(language);
  return (
    <>
      {count === null ? null : (
        <Notice
          key="pending"
          status="warning"
          language={language}
          message={
            count === 1
              ? t('notice.indexingOne', { remaining: format.format(count) })
              : t('notice.indexing', { remaining: format.format(count) })
          }
          dismissible={false}
          live={false}
        />
      )}
      {failure === null ? null : (
        <Notice
          key="failed"
          status={failure.retrying ? 'warning' : 'danger'}
          language={language}
          message={failureMessage(t, failure, format.format(failure.passages))}
          dismissible={false}
          live={false}
        />
      )}
    </>
  );
}

/** The failure line's text: a retry to come, or none left; the singular for one passage. */
function failureMessage(t: ReturnType<typeof translator>, failure: IndexingFailed, count: string): string {
  const one = failure.passages === 1;
  if (failure.retrying) {
    return one ? t('notice.indexingRetryingOne', { count }) : t('notice.indexingRetrying', { count });
  }
  return one ? t('notice.indexingFailedOne', { count }) : t('notice.indexingFailed', { count });
}
