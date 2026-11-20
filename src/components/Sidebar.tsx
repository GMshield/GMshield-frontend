'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { sidebarCookieLine, type SidebarState } from '@/sidebar-cookie';

import { ChevronLeftIcon, ChevronRightIcon, UploadIcon } from './Icons';
import { LogoMark } from './Logo';
import { LogoMenu } from './LogoMenu';
import { ADD_FILE, BEHIND_SIDEBAR, SIDEBAR_ENTRIES, setInertBy, type EntryKey } from './shell-entries';
import styles from './Sidebar.module.css';
import type { Material } from './uploads/types';
import { UploadDialog } from './uploads/UploadDialog';
import { UploadTray } from './uploads/UploadTray';
import { useUploads } from './uploads/UploadsProvider';

/** At this width and above the sidebar sits beside the main column, and its state is remembered. */
export const WIDE_QUERY = '(min-width: 1280px)';

export type SidebarLabels = {
  readonly name: string;
  readonly menu: string;
  readonly openMenu: string;
  readonly closeMenu: string;
  readonly navigation: string;
  readonly currentCampaign: string;
  readonly entries: Readonly<Record<EntryKey, string>>;
};

export type SidebarProps = {
  /** Every text, in the interface's language (the server translates; no message file reaches the browser). */
  readonly labels: SidebarLabels;
  /** The current campaign's name, or the words for none. */
  readonly campaign: string;
  /** The wide-screen state from `__Host-gmshield-sidebar`, read by the server, so the first render is right. */
  readonly initialState: SidebarState;
  /** The logo menu's content. */
  readonly menu: ReactNode;
  /** The tray's rows from the server (Story 1.14), merged in the tray with this tab's live uploads. */
  readonly trayRows?: readonly Material[];
};

function isWide(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia(WIDE_QUERY).matches;
}

/**
 * The signed-in sidebar (Story 1.11). From 1280px it sits beside the main column; its collapse control or
 * Ctrl+B / ⌘B closes it to a handle "Abrir menu" and the logo mark, and the state is kept in a cookie. Under
 * 1280px it always starts closed: the handle opens it over the main column (768 to 1279px) or as a full-screen
 * sheet (under 768px), and it closes again after an entry is chosen. Which layout applies is CSS's decision;
 * this component only keeps the two states. An entry is marked current on its page and on every page below it
 * (Story 3.1: "Sistemas" on `/systems/new` and `/systems/<id>`).
 */
export function Sidebar({ labels, campaign, initialState, menu, trayRows = [] }: SidebarProps) {
  const pathname = usePathname();
  const [wideState, setWideState] = useState<SidebarState>(initialState);
  // Under 1280px: the path the sidebar was opened on. Navigating elsewhere closes it, with no effect to run.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const narrowOpen = openedOn !== null && openedOn === pathname;
  const handle = useRef<HTMLButtonElement>(null);
  const collapse = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'handle' | 'collapse' | null>(null);
  const addFile = useRef<HTMLButtonElement>(null);
  const { uploadOpen: uploading, openUpload, closeUpload } = useUploads();
  const focusAfterDialog = useRef(false);

  const toggle = useCallback(() => {
    if (isWide()) {
      const next: SidebarState = wideState === 'open' ? 'closed' : 'open';
      document.cookie = sidebarCookieLine(next);
      focusNext.current = next === 'open' ? 'collapse' : 'handle';
      setWideState(next);
    } else {
      focusNext.current = narrowOpen ? 'handle' : 'collapse';
      setOpenedOn(narrowOpen ? null : pathname);
    }
  }, [wideState, narrowOpen, pathname]);

  // The control that was used disappears: focus moves to the one that takes its place.
  useEffect(() => {
    const target = focusNext.current === 'handle' ? handle.current : focusNext.current === 'collapse' ? collapse.current : null;
    focusNext.current = null;
    target?.focus();
  }, [wideState, narrowOpen]);

  // Under 1280px the open sidebar covers the page: what is behind it leaves the Tab order and the pointer
  // until it closes. The shell renders those parts on the server, so they are found by their attribute.
  useEffect(() => {
    const behind = document.querySelectorAll(`[${BEHIND_SIDEBAR}]`);
    for (const element of behind) {
      setInertBy(element, 'sidebar', narrowOpen);
    }
    return () => {
      for (const element of behind) {
        setInertBy(element, 'sidebar', false);
      }
    };
  }, [narrowOpen]);

  // Widened to 1280px or more while open over the page: that state ends (the wide state takes over).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const wide = window.matchMedia(WIDE_QUERY);
    const onChange = () => {
      if (wide.matches) {
        setOpenedOn(null);
      }
    };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  // The dialog closed: focus goes back to "Adicionar Arquivo", or to the handle when the sidebar is closed and hides it.
  useEffect(() => {
    if (uploading || !focusAfterDialog.current) {
      return;
    }
    focusAfterDialog.current = false;
    const add = addFile.current;
    const shown = add !== null && add.isConnected && (typeof add.checkVisibility !== 'function' || add.checkVisibility());
    (shown ? add : handle.current)?.focus();
  }, [uploading]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggle();
      } else if (event.key === 'Escape' && narrowOpen && !event.defaultPrevented) {
        focusNext.current = 'handle';
        setOpenedOn(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle, narrowOpen]);

  // Outside the app router (a page rendered on its own) there is no path to compare.
  const entry = (key: EntryKey, href: string, className: string) => (
    <Link
      href={href}
      className={className}
      aria-current={pathname === href || (pathname ?? '').startsWith(`${href}/`) ? 'page' : undefined}
      onClick={() => setOpenedOn(null)}
    >
      {labels.entries[key]}
    </Link>
  );

  return (
    <div className={styles.area} data-wide={wideState} data-narrow={narrowOpen ? 'open' : 'closed'}>
      <div className={styles.panel} id="sidebar" data-testid="sidebar">
        <div className={styles.header}>
          <LogoMenu name={labels.name} label={labels.menu}>
            {menu}
          </LogoMenu>
          <button
            ref={collapse}
            type="button"
            className={styles.collapse}
            aria-label={labels.closeMenu}
            aria-controls="sidebar"
            aria-expanded="true"
            onClick={toggle}
          >
            <ChevronLeftIcon />
          </button>
        </div>
        <p className={styles.campaign}>
          <span className={styles.campaignLabel}>{labels.currentCampaign}</span>
          <span className={styles.campaignName}>{campaign}</span>
        </p>
        <nav aria-label={labels.navigation} className={styles.nav}>
          <ul className={styles.entries}>
            {SIDEBAR_ENTRIES.map(({ key, href }) => (
              <li key={key}>{entry(key, href, styles.entry ?? '')}</li>
            ))}
          </ul>
        </nav>
        <UploadTray rows={trayRows} />
        <button
          ref={addFile}
          type="button"
          className={styles.add}
          aria-haspopup="dialog"
          onClick={() => {
            // Under 1280px the sheet closes first: the dialog never stacks on it.
            setOpenedOn(null);
            openUpload();
          }}
        >
          <UploadIcon />
          {labels.entries[ADD_FILE.key]}
        </button>
      </div>
      <UploadDialog
        open={uploading}
        onClose={() => {
          focusAfterDialog.current = true;
          closeUpload();
        }}
      />
      <LogoMark className={styles.mark} />
      <button
        ref={handle}
        type="button"
        className={styles.handle}
        aria-label={labels.openMenu}
        aria-controls="sidebar"
        aria-expanded="false"
        onClick={toggle}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}
