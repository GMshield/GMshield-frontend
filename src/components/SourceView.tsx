'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { fetchReferencePage, referencePictureUrl, type SourcePage, type SourceReference } from '@/client/conversation';
import { fetchScopePage, scopePictureUrl } from '@/client/search';
import { translator, type Language } from '@/messages';

import { CloseIcon } from './Icons';
import { PageView } from './PageView';
import { PillButton } from './PillButton';
import styles from './SourceView.module.css';

/** How a page a turn's reference names is read: the relay's fetcher by default; tests give their own. */
export type LoadPage = (turnId: string, number: number, page: number, signal: AbortSignal) => Promise<SourcePage | null>;

/** How a page of the campaign's current scope is read (Story 3.9): the relay's fetcher by default; tests give their own. */
export type LoadScopePage = (campaignId: string, versionId: string, page: number, signal: AbortSignal) => Promise<SourcePage | null>;

/**
 * The ground a page is served on (AD-9), other than a turn's reference (Story 3.9): the campaign's current scope, a
 * version of which a search result names.
 */
export type ScopeGround = { readonly kind: 'scope'; readonly campaignId: string; readonly versionId: string };

/** What the view shows of where the page comes from, and what it marks: a reference, or a search result's place. */
export type SourceSpot = Pick<SourceReference, 'materialName' | 'sectionPath' | 'page' | 'passageIds'>;

type Common = {
  readonly language: Language;
  /** Called by the close control and by Esc; the caller gives focus back to what opened it. */
  readonly onClose: () => void;
};

export type SourceViewProps = Common &
  (
    | {
        /** The turn whose reference is open: the ground "a source reference stored with a turn" (Story 2.7). */
        readonly turnId: string;
        /** The open reference: its number names it to the backend; its page is where the view opens. */
        readonly reference: SourceReference;
        readonly ground?: undefined;
        readonly load?: LoadPage;
        readonly loadScope?: undefined;
      }
    | {
        /** Story 3.9: the ground "the current scope", for a search result. */
        readonly ground: ScopeGround;
        /** The result's place: its page is where the view opens, its passage the one marked. */
        readonly reference: SourceSpot;
        readonly turnId?: undefined;
        readonly load?: undefined;
        readonly loadScope?: LoadScopePage;
      }
  );

/** The page shown: loading, loaded, or one that could not be opened. */
type Shown = { readonly page: number } & (
  | { readonly state: 'loading' }
  | { readonly state: 'loaded'; readonly view: SourcePage }
  | { readonly state: 'failed' }
);

/** The source line of the header: the material's name and the section path joined with " › ". */
function sourceLine(reference: SourceSpot): string {
  return reference.sectionPath.length === 0 ? reference.materialName : `${reference.materialName}, ${reference.sectionPath.join(' › ')}`;
}

/**
 * The source view (Story 2.7): a panel (a non-modal `<dialog>`, named by its header) with the page a reference names, the cited
 * passages marked (`PageView`). It opens at once with the frame and "p. N" and fills in the page when it arrives.
 *
 * - On open, focus goes to the close control.
 * - With focus in the panel, ← and → move one page, as the footer's previous and next controls do; a control at the
 *   first or the last page is disabled (the last is known once a page has arrived).
 * - Esc, or the close control, closes it: the caller gives focus back to the reference. That Esc is marked handled, and
 *   the conversation's Esc listener skips a dialog, so it never stops a running answer.
 * - A page that failed to load (a source removed since, no session, a server error, no network) shows "could not be
 *   loaded" with "Try again", which loads the same page again. An unreadable page with nothing on it (no picture and
 *   no text) shows the "could not be opened" text.
 * - ← and → with Alt, Ctrl, Meta or Shift are left to the browser (Alt+← is its back).
 * - Once a page has arrived, the panel that holds the view (its `<aside>`) scrolls so the first cited passage sits in
 *   the middle of what it shows, clear of the sticky header and footer; a page without one opens at its top. Only that
 *   panel scrolls, never the conversation behind it.
 *
 * The page is read from this site's relays only, never stored.
 *
 * Story 3.9: the page is read on a ground. With `turnId`, a turn's reference, as above; with `ground` of kind `scope`,
 * the campaign's current scope (a search result's version and page, its passage marked). Everything else is the same.
 */
export function SourceView(props: SourceViewProps) {
  const { reference, language, onClose } = props;
  const scope = props.ground ?? null;
  const turnId = props.turnId ?? null;
  const number = props.ground === undefined ? props.reference.number : null;
  const load = props.load ?? fetchReferencePage;
  const loadScope = props.loadScope ?? fetchScopePage;
  const t = translator(language);
  const titleId = useId();
  const viewRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  const [page, setPage] = useState(reference.page);
  const [total, setTotal] = useState<number | null>(null);
  const [shown, setShown] = useState<Shown>({ page: reference.page, state: 'loading' });
  /** How many times the page was asked for again after a failure: a retry loads the same page anew. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const campaignId = scope?.campaignId ?? null;
  const versionId = scope?.versionId ?? null;
  useEffect(() => {
    const controller = new AbortController();
    const read =
      campaignId !== null && versionId !== null
        ? loadScope(campaignId, versionId, page, controller.signal)
        : load(turnId ?? '', number ?? 0, page, controller.signal);
    void read.then((view) => {
      if (controller.signal.aborted) {
        return;
      }
      if (view === null) {
        setShown({ page, state: 'failed' });
        return;
      }
      setTotal(view.pageTotal);
      setShown({ page, state: 'loaded', view });
    });
    return () => controller.abort();
  }, [load, loadScope, page, number, turnId, campaignId, versionId, attempt]);

  const atLast = total === null || page >= total;
  /** Moves one page. A control that reaches the end is disabled: its focus goes to a control still enabled. */
  function move(step: -1 | 1) {
    const next = page + step;
    if (next < 1 || (step > 0 && atLast)) {
      return;
    }
    const ends = step < 0 ? next <= 1 : total !== null && next >= total;
    const control = step < 0 ? previousRef.current : nextRef.current;
    const footer = [closeRef.current, previousRef.current, nextRef.current];
    if (!footer.includes(document.activeElement as HTMLButtonElement | null)) {
      // Focus in the page (its retry control, its text): the body becomes the frame, so focus goes to the close control.
      focusAfter.current = closeRef;
    } else if (ends && control !== null && document.activeElement === control) {
      // Once rendered, the other footer control when it is enabled then, else the close control.
      let other = previousRef;
      if (step < 0) {
        other = total !== null && next < total ? nextRef : closeRef;
      }
      focusAfter.current = other;
    }
    setPage(next);
  }

  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    target?.current?.focus();
  }, [page]);

  // A page that has arrived: bring its first cited passage into the middle of the panel, or open it at its top.
  useEffect(() => {
    if (shown.state !== 'loaded' || shown.page !== page) {
      return;
    }
    const scroller = viewRef.current?.closest('aside');
    if (scroller === null || scroller === undefined) {
      return;
    }
    const cited = viewRef.current?.querySelector('[data-cited]');
    if (cited === null || cited === undefined) {
      scroller.scrollTop = 0;
      return;
    }
    const mark = cited.getBoundingClientRect();
    const panel = scroller.getBoundingClientRect();
    scroller.scrollTop += mark.top + mark.height / 2 - (panel.top + panel.height / 2);
  }, [shown, page]);

  /** Loads the page that failed again; focus, on the retry control, goes to the close control meanwhile. */
  function retry() {
    closeRef.current?.focus();
    setShown({ page, state: 'loading' });
    setAttempt((count) => count + 1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (!modified && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  const position = t('conversation.page', { page });
  let body;
  if (shown.page !== page || shown.state === 'loading') {
    body = <div className={styles.frame} />;
  } else if (shown.state === 'failed') {
    body = (
      <div className={styles.failed}>
        <p role="alert" className={styles.unopened}>
          {t('pageView.loadFailed')}
        </p>
        <PillButton onClick={retry}>{t('conversation.retry')}</PillButton>
      </div>
    );
  } else if (shown.view.picture === null && shown.view.text === null) {
    body = <p className={styles.unopened}>{t('pageView.unopened')}</p>;
  } else {
    body = (
      <PageView
        page={shown.view}
        pictureSrc={
          campaignId !== null && versionId !== null
            ? scopePictureUrl(campaignId, versionId, shown.view.page)
            : referencePictureUrl(turnId ?? '', number ?? 0, shown.view.page)
        }
        language={language}
        cited={reference.passageIds}
        caption={false}
        fit
      />
    );
  }

  return (
    <dialog ref={viewRef} open className={styles.view} aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {sourceLine(reference)}
        </h2>
        <button ref={closeRef} type="button" className={styles.close} aria-label={t('conversation.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className={styles.body}>{body}</div>
      <footer className={styles.footer}>
        <PillButton ref={previousRef} disabled={page <= 1} onClick={() => move(-1)}>
          {t('pageView.previous')}
        </PillButton>
        <span className={styles.position} aria-live="polite">
          {position}
        </span>
        <PillButton ref={nextRef} disabled={atLast} onClick={() => move(1)}>
          {t('pageView.next')}
        </PillButton>
      </footer>
    </dialog>
  );
}
