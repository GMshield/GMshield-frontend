'use client';

import { useState } from 'react';

import { translator, type Language } from '@/messages';

import styles from './Notice.module.css';

export type NoticeStatus = 'danger' | 'warning' | 'success';

export type NoticeProps = {
  readonly status: NoticeStatus;
  readonly message: string;
  readonly language: Language;
  readonly link?: { readonly href: string; readonly label: string };
  readonly onDismiss?: () => void;
  /** Whether the GM may dismiss it (default true); a notice that goes away by itself has no dismiss control. */
  readonly dismissible?: boolean;
  /**
   * Whether it is a polite live region (default true). A notice whose text keeps changing on its own (the indexing
   * count) is not, so that each new number is not announced again.
   */
  readonly live?: boolean;
};

/**
 * One line across the top of the main column: the status word in its colour (colour never carries
 * the status alone), the message, an optional link, and a dismiss control unless it is not
 * `dismissible`. Announced politely, unless it is not `live`.
 */
export function Notice({ status, message, language, link, onDismiss, dismissible = true, live = true }: NoticeProps) {
  // What was dismissed, so that a different notice passed to the same instance shows again.
  const shown = `${status}\n${message}`;
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (dismissed === shown) {
    return null;
  }
  const t = translator(language);
  return (
    <div
      role={live ? 'status' : undefined}
      className={`${styles.notice} ${styles[status]}${dismissible ? '' : ` ${styles.still}`}`}
      data-status={status}
    >
      <span className={styles.word}>{t(`notice.status.${status}`)}</span>
      <span className={styles.message}>{message}</span>
      {link === undefined ? null : (
        <a className={styles.link} href={link.href}>
          {link.label}
        </a>
      )}
      {dismissible ? (
        <button
          type="button"
          className={styles.dismiss}
          aria-label={t('notice.dismiss')}
          onClick={() => {
            setDismissed(shown);
            onDismiss?.();
          }}
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="16" height="16">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
