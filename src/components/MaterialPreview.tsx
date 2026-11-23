'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { translator, type Language } from '@/messages';
import type { components } from '@/server/backend/generated/public';

import { CloseIcon } from './Icons';
import { PageView, pictureUrl } from './PageView';
import { PillButton } from './PillButton';
import styles from './SourceView.module.css';

type Page = components['schemas']['MaterialPageView'];

/** Reads one page of a material: a Server Action in the app, a function in a test. Null when it cannot be read. */
export type LoadPreviewPage = (id: string, page: number) => Promise<Page | null>;

export type MaterialPreviewProps = {
  readonly id: string;
  readonly name: string;
  /** The material's own page, which "Abrir arquivo" leads to. */
  readonly href: string | null;
  /** How many pages it has. */
  readonly pages: number;
  readonly language: Language;
  readonly load: LoadPreviewPage;
  /** Called by the close control and by Esc; the caller gives focus back to the control that opened the preview. */
  readonly onClose: () => void;
};

type Shown = { readonly page: number } & (
  | { readonly state: 'loading' }
  | { readonly state: 'loaded'; readonly view: Page }
  | { readonly state: 'failed' }
);

/**
 * A material's preview (usability pass, 2026-11-21): a panel at the right of a list (a non-modal `<dialog>`, named by
 * the material) that shows its pages, from the first, as the source view shows a cited page, so the GM can check what
 * a file is without leaving the list. It opens at once with the frame and "p. 1" and fills in the page when it arrives.
 *
 * - On open, focus goes to the close control. Esc, or the close control, closes it; the caller gives focus back.
 * - With focus in the panel, ← and → move one page, as the footer's previous and next controls do; each is disabled at
 *   its end.
 * - A page that cannot be read says so, with "Tentar de novo".
 * - "Abrir arquivo" leads to the material's page.
 *
 * Pages are read through the caller's loader and this site's picture relay only, never stored.
 */
export function MaterialPreview({ id, name, href, pages, language, load, onClose }: MaterialPreviewProps) {
  const t = translator(language);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState<Shown>({ page: 1, state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    let current = true;
    void load(id, page)
      .catch(() => null)
      .then((view) => {
        if (current) {
          setShown(view === null ? { page, state: 'failed' } : { page, state: 'loaded', view });
        }
      });
    return () => {
      current = false;
    };
  }, [load, id, page, attempt]);

  const total = shown.state === 'loaded' ? shown.view.pageTotal : pages;
  function move(step: -1 | 1) {
    const next = page + step;
    if (next >= 1 && next <= total) {
      // A control that reaches its end is disabled: focus waits on the close control.
      if (next === 1 || next === total) {
        closeRef.current?.focus();
      }
      setPage(next);
    }
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

  let body;
  if (shown.page !== page || shown.state === 'loading') {
    body = <div className={styles.frame} />;
  } else if (shown.state === 'failed') {
    body = (
      <div className={styles.failed}>
        <p role="alert" className={styles.unopened}>
          {t('pageView.loadFailed')}
        </p>
        <PillButton
          onClick={() => {
            closeRef.current?.focus();
            setShown({ page, state: 'loading' });
            setAttempt((count) => count + 1);
          }}
        >
          {t('conversation.retry')}
        </PillButton>
      </div>
    );
  } else if (shown.view.picture === null && shown.view.text === null) {
    body = <p className={styles.unopened}>{t('pageView.unopened')}</p>;
  } else {
    body = <PageView page={shown.view} pictureSrc={pictureUrl(id, shown.view.page)} language={language} caption={false} fit />;
  }

  return (
    <dialog open className={styles.view} aria-labelledby={titleId} onKeyDown={onKeyDown} data-preview="">
      <header className={styles.header}>
        <div className={styles.titles}>
          <h2 id={titleId} className={styles.title}>
            {name}
          </h2>
          {href === null ? null : (
            <Link className={styles.openLink} href={href}>
              {t('preview.openFile')}
            </Link>
          )}
        </div>
        <button ref={closeRef} type="button" className={styles.close} aria-label={t('preview.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className={styles.body}>{body}</div>
      <footer className={styles.footer}>
        <PillButton disabled={page <= 1} onClick={() => move(-1)}>
          {t('pageView.previous')}
        </PillButton>
        <span className={styles.position} aria-live="polite">
          {t('pageView.position', { page, total })}
        </span>
        <PillButton disabled={page >= total} onClick={() => move(1)}>
          {t('pageView.next')}
        </PillButton>
      </footer>
    </dialog>
  );
}
