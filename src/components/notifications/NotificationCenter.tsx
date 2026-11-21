'use client';

import { useEffect, useId, useRef } from 'react';

import { translator, type Language } from '@/messages';

import { NamedIcon } from '../Icons';
import { useDisclosure } from '../useDisclosure';

import styles from './Notifications.module.css';
import { STATUS_ICON, useNotifications, type NotificationInput } from './NotificationsProvider';

/** How many of the things that wait show under the bell; the rest are one link to the list that holds them. */
export const ATTENTION_SHOWN = 5;

export type NotificationCenterProps = {
  readonly language: Language;
  /**
   * What waits for the GM now, read by the server on every render (a material that needs review, one that failed):
   * listed first, and counted on the bell until it is dealt with.
   */
  readonly attention?: readonly (NotificationInput & { readonly id: string })[];
};

/**
 * The bell in the bar above the page (usability pass, 2026-11-21): a disclosure button that opens the list of what
 * needs the GM's attention now and of everything told during this visit, newest first, each with its status in a word,
 * its time and its link. The bell counts what waits and what has not been seen; opening the list marks the visit's
 * notifications seen. Something that starts to wait while the GM is here is also said in a toast, once. "Limpar"
 * empties the visit's list. Esc, with focus in the button or the list, closes it and gives focus back to the button; a
 * press outside closes it too.
 *
 * Third round: the panel shows the first five things that wait, then one link to "Meus Arquivos" filtered to the rest
 * ("Mais 7 em Meus Arquivos"), so a library with many files to review does not turn the bell into a long list to
 * scroll. The bell still counts them all.
 */
export function NotificationCenter({ language, attention = [] }: NotificationCenterProps) {
  const t = translator(language);
  const { items, unread, notify, markRead, clear } = useNotifications();
  // What was already waiting when the page was opened is on the bell; what starts to wait during the visit (a file
  // that has just been read and needs review, one that failed) is also said in a toast, once.
  const known = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const before = known.current;
    known.current = new Set(attention.map((item) => item.id));
    if (before === null) {
      return;
    }
    for (const item of attention) {
      if (!before.has(item.id)) {
        notify({ status: item.status, message: item.message, link: item.link, transient: true });
      }
    }
  }, [attention, notify]);
  const { open, setOpen, container, button } = useDisclosure();
  const id = useId();
  const count = unread + attention.length;

  const shown = attention.slice(0, ATTENTION_SHOWN);
  const hidden = attention.slice(ATTENTION_SHOWN);
  // The rest are in "Meus Arquivos", under the filter of the first one left out (to review, or failed).
  const moreHref = hidden[0]?.status === 'danger' ? '/files?state=failed' : '/files?state=review';
  const time = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' });
  let label = t('notifications.title');
  if (count === 1) {
    label = t('notifications.openOne');
  } else if (count > 1) {
    label = t('notifications.openOther', { count });
  }
  return (
    <div ref={container} className={styles.center}>
      <button
        ref={button}
        type="button"
        className={styles.bell}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!open) {
            markRead();
          }
          setOpen(!open);
        }}
      >
        <NamedIcon name="bell" size={22} />
        {count === 0 ? null : (
          <span className={styles.badge} aria-hidden="true">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      <div id={id} role="group" aria-label={t('notifications.title')} className={styles.panel} hidden={!open}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t('notifications.title')}</h2>
          {items.length === 0 ? null : (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                clear();
                // "Limpar" goes with the list it emptied: focus waits on the bell, so Esc still closes the panel.
                button.current?.focus();
              }}
            >
              {t('notifications.clear')}
            </button>
          )}
        </div>
        {attention.length === 0 && items.length === 0 ? <p className={styles.none}>{t('notifications.empty')}</p> : null}
        {attention.length === 0 ? null : (
          <>
            <h3 className={styles.group}>{t('notifications.attention')}</h3>
            <ul className={styles.items}>
              {shown.map((item) => (
                <li key={item.id} className={styles.item} data-status={item.status}>
                  <span className={styles.icon}>
                    <NamedIcon name={STATUS_ICON[item.status]} />
                  </span>
                  <p className={styles.text}>
                    <span className={styles.word}>{t(`notifications.status.${item.status}`)}</span> {item.message}
                    {item.link === undefined ? null : (
                      <>
                        {' '}
                        <a className={styles.link} href={item.link.href}>
                          {item.link.label}
                        </a>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
            {hidden.length === 0 ? null : (
              <p className={styles.more}>
                <a className={styles.link} href={moreHref}>
                  {t('notifications.more', { count: hidden.length })}
                </a>
              </p>
            )}
          </>
        )}
        {items.length === 0 ? null : (
          <>
            <h3 className={styles.group}>{t('notifications.recent')}</h3>
            <ul className={styles.items}>
              {items.map((item) => (
                <li key={item.id} className={styles.item} data-status={item.status}>
                  <span className={styles.icon}>
                    <NamedIcon name={STATUS_ICON[item.status]} />
                  </span>
                  <p className={styles.text}>
                    <span className={styles.word}>{t(`notifications.status.${item.status}`)}</span> {item.message}
                    {item.link === undefined ? null : (
                      <>
                        {' '}
                        <a className={styles.link} href={item.link.href}>
                          {item.link.label}
                        </a>
                      </>
                    )}
                  </p>
                  <time className={styles.time} dateTime={new Date(item.at).toISOString()}>
                    {time.format(item.at)}
                  </time>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
