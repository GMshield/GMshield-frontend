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
};

/**
 * One line across the top of the main column: the status word in its colour (colour never carries
 * the status alone), the message, an optional link, and a dismiss control. Announced politely.
 */
export function Notice({ status, message, language, link, onDismiss }: NoticeProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) {
    return null;
  }
  const t = translator(language);
  return (
    <div role="status" className={`${styles.notice} ${styles[status]}`} data-status={status}>
      <span className={styles.word}>{t(`notice.status.${status}`)}</span>
      <span className={styles.message}>{message}</span>
      {link === undefined ? null : (
        <a className={styles.link} href={link.href}>
          {link.label}
        </a>
      )}
      <button
        type="button"
        className={styles.dismiss}
        aria-label={t('notice.dismiss')}
        onClick={() => {
          setDismissed(true);
          onDismiss?.();
        }}
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="16" height="16">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  );
}
