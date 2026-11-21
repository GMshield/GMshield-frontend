'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { flashClearLine, flashIn, type FlashStatus } from '@/flash-cookie';
import { translator, type Language } from '@/messages';

import { CloseIcon, NamedIcon, type IconName } from '../Icons';

import styles from './Notifications.module.css';

export type NotificationStatus = FlashStatus;

/** What is told: its status, its text, and optionally where it leads. */
export type NotificationInput = {
  readonly status: NotificationStatus;
  readonly message: string;
  readonly link?: { readonly href: string; readonly label: string };
  /** Whether its teller already announces it (the uploads' own live region): the toast is then seen and not announced. */
  readonly quiet?: boolean;
  /** Whether it is a toast only, not kept in the bell's list: what it says is already listed there as waiting. */
  readonly transient?: boolean;
};

/** A notification of this visit: kept in the list until it is cleared, shown as a toast until it goes or is dismissed. */
export type AppNotification = NotificationInput & {
  readonly id: number;
  /** When it was told, in epoch milliseconds. */
  readonly at: number;
  readonly read: boolean;
  /** Whether its toast is still on the screen. */
  readonly toast: boolean;
};

type Notifications = {
  readonly items: readonly AppNotification[];
  readonly unread: number;
  /** Tells something: a toast now, and a line in the list. */
  readonly notify: (input: NotificationInput) => void;
  readonly markRead: () => void;
  readonly clear: () => void;
};

const NONE: Notifications = { items: [], unread: 0, notify: () => undefined, markRead: () => undefined, clear: () => undefined };

const NotificationsContext = createContext<Notifications>(NONE);

/** The notifications of the page; outside a provider (a component rendered alone) nothing is told and nothing fails. */
export function useNotifications(): Notifications {
  return useContext(NotificationsContext);
}

/** The most kept in the list; older ones go. */
const MOST = 30;
/** The most toasts on the screen at once; the newest ones. */
const MOST_TOASTS = 3;
/** How long a toast stays, by status; an error stays until it is dismissed. */
const STAY_MS: Readonly<Record<NotificationStatus, number | null>> = { success: 6000, info: 6000, warning: 10_000, danger: null };

export const STATUS_ICON: Readonly<Record<NotificationStatus, IconName>> = { success: 'check', info: 'info', warning: 'warning', danger: 'error' };

function Toast({
  item,
  language,
  onDismiss,
}: {
  readonly item: AppNotification;
  readonly language: Language;
  readonly onDismiss: (id: number) => void;
}) {
  const t = translator(language);
  const [paused, setPaused] = useState(false);
  const stay = STAY_MS[item.status];
  useEffect(() => {
    if (stay === null || paused) {
      return undefined;
    }
    const timer = setTimeout(() => onDismiss(item.id), stay);
    return () => clearTimeout(timer);
  }, [stay, paused, item.id, onDismiss]);
  return (
    <li
      className={styles.toast}
      data-status={item.status}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className={styles.icon}>
        <NamedIcon name={STATUS_ICON[item.status]} />
      </span>
      {/* An error interrupts; anything else waits its turn. */}
      <p className={styles.text} role={item.quiet === true ? undefined : item.status === 'danger' ? 'alert' : 'status'}>
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
      <button type="button" className={styles.dismiss} aria-label={t('notifications.dismiss')} onClick={() => onDismiss(item.id)}>
        <CloseIcon />
      </button>
    </li>
  );
}

/**
 * The notifications of the signed-in pages (usability pass, 2026-11-21): the one place that says what an action did.
 *
 * - `notify` shows a toast at the top of the window, in the middle (clear of a page's title on the left, its actions on
 *   the right and the composer at the bottom), and keeps a line in the bell's list for this visit.
 * - A toast goes by itself after 6 seconds (10 for a warning), waits while the pointer or the focus is on it, and an
 *   error stays until it is dismissed. At most three show at once. Each is a live region: an error is announced at
 *   once, anything else politely. The status is always a word beside its icon, never a colour alone. Opening the
 *   bell's list takes the toasts away: the list holds them.
 * - A Server Action speaks through the flash cookie (`src/server/flash.ts`): after every render and on every change of
 *   page the cookie is read once, told and cleared, so a redirect ("Sistema criado.") and a refresh in place ("Campanha
 *   arquivada.") are both heard.
 *
 * Nothing is stored: the list is kept in memory and ends with the visit.
 */
export function NotificationsProvider({ language, children }: { readonly language: Language; readonly children: ReactNode }) {
  const [items, setItems] = useState<readonly AppNotification[]>([]);
  const nextId = useRef(1);
  const pathname = usePathname();

  const notify = useCallback((input: NotificationInput) => {
    const id = nextId.current;
    nextId.current += 1;
    setItems((current) => [{ ...input, id, at: Date.now(), read: false, toast: true }, ...current].slice(0, MOST));
  }, []);
  const dismissToast = useCallback((id: number) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, toast: false } : item)));
  }, []);
  // Seen in the bell's list: nothing is new any more, and the toasts still showing go (the list now holds them).
  const markRead = useCallback(() => {
    setItems((current) =>
      current.some((item) => !item.read || item.toast) ? current.map((item) => ({ ...item, read: true, toast: false })) : current,
    );
  }, []);
  const clear = useCallback(() => setItems([]), []);

  // After every render (a Server Action's refresh renders the layout again) and on every change of page: what the
  // server left to say, once. Reading a cookie is cheap, and clearing it first keeps a second render from repeating it.
  useEffect(() => {
    const flash = flashIn(document.cookie);
    if (flash !== null) {
      document.cookie = flashClearLine();
      notify(flash);
    }
  });

  const value = useMemo(() => {
    const listed = items.filter((item) => item.transient !== true);
    return { items: listed, unread: listed.filter((item) => !item.read).length, notify, markRead, clear };
  }, [items, notify, markRead, clear]);
  const toasts = items.filter((item) => item.toast).slice(0, MOST_TOASTS);
  const t = translator(language);
  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <section className={styles.toasts} aria-label={t('notifications.toasts')} data-path={pathname ?? ''}>
        <ol className={styles.toastList}>
          {/* Newest last: a new toast appears under the ones still showing, where the eye already is. */}
          {[...toasts].reverse().map((item) => (
            <Toast key={item.id} item={item} language={language} onDismiss={dismissToast} />
          ))}
        </ol>
      </section>
    </NotificationsContext.Provider>
  );
}
