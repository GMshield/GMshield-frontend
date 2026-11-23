'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { translator, type Language } from '@/messages';

import { NamedIcon } from '../Icons';
import { WIDE_QUERY } from '../Sidebar';

import styles from './SavedItems.module.css';

/**
 * The saved items panel's state (Story 3.12), beside the shell's frame: whether it is open, the current campaign (an
 * entry of another campaign names its campaign and switches to it), and a count that rises whenever a bookmark changes
 * on the page, so the open panel reads its list again.
 */
export type SavedItems = {
  readonly open: boolean;
  readonly currentCampaignId: string | null;
  /** Rises with every bookmark changed on this page: the panel reloads. */
  readonly version: number;
  /** Opens the panel, or closes it when it is open; `opener` gets focus back when it closes by Esc or its close button. */
  readonly toggle: (opener?: HTMLElement | null) => void;
  /** Closes the panel and gives focus back to what opened it (Esc, the close button). */
  readonly close: () => void;
  /** Closes the panel without moving focus: another right panel replaced it. */
  readonly dismiss: () => void;
  /**
   * "Ir" was pressed: under 1280px, where the panel lies over the page, it closes, at once for a link, or (`later`)
   * when the page the answer is on arrives, for an "Ir" that switches campaign first.
   */
  readonly went: (later: boolean) => void;
  /** An "Ir" that was to close the panel on arrival was refused: the panel stays, whatever page comes next. */
  readonly cancelGo: () => void;
  /** A bookmark changed on the page: the open panel reads its list again. */
  readonly savedChanged: () => void;
};

const SavedItemsContext = createContext<SavedItems | null>(null);

/** The saved items' state; null outside a signed-in shell (a component rendered alone), where nothing opens. */
export function useSavedItems(): SavedItems | null {
  return useContext(SavedItemsContext);
}

function narrow(): boolean {
  return typeof window.matchMedia === 'function' && !window.matchMedia(WIDE_QUERY).matches;
}

/**
 * Holds the saved items panel's state for the signed-in shell (Story 3.12). Ctrl+Shift+S (⌘⇧S on a Mac) opens or closes
 * the panel from any signed-in screen, even while a field has focus; focus goes back to what had it when it closes.
 */
export function SavedItemsProvider({ currentCampaignId, children }: { readonly currentCampaignId: string | null; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const focusBack = useRef(false);
  const closeOnArrival = useRef(false);
  const pathname = usePathname();

  const openNow = useRef(false);
  useEffect(() => {
    openNow.current = open;
  }, [open]);

  const toggle = useCallback((from?: HTMLElement | null) => {
    if (openNow.current) {
      focusBack.current = true;
      openNow.current = false;
      setOpen(false);
    } else {
      opener.current = from ?? null;
      openNow.current = true;
      setOpen(true);
    }
  }, []);
  const close = useCallback(() => {
    focusBack.current = true;
    openNow.current = false;
    setOpen(false);
  }, []);
  const dismiss = useCallback(() => {
    focusBack.current = false;
    opener.current = null;
    openNow.current = false;
    setOpen(false);
  }, []);
  const went = useCallback(
    (later: boolean) => {
      if (!narrow()) {
        return;
      }
      if (later) {
        closeOnArrival.current = true;
      } else {
        dismiss();
      }
    },
    [dismiss],
  );
  const cancelGo = useCallback(() => {
    closeOnArrival.current = false;
  }, []);
  const savedChanged = useCallback(() => setVersion((count) => count + 1), []);

  // Closed by Esc or its close button: focus goes back to what opened it, once the page behind is no longer inert.
  useEffect(() => {
    if (open || !focusBack.current) {
      return;
    }
    focusBack.current = false;
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) {
      target.focus();
    }
  }, [open]);

  // An "Ir" that switched campaign has arrived on its page: on a narrow screen the panel goes.
  useEffect(() => {
    if (closeOnArrival.current) {
      closeOnArrival.current = false;
      dismiss();
    }
  }, [pathname, dismiss]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        toggle(document.activeElement instanceof HTMLElement ? document.activeElement : null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  const value = useMemo(
    () => ({ open, currentCampaignId, version, toggle, close, dismiss, went, cancelGo, savedChanged }),
    [open, currentCampaignId, version, toggle, close, dismiss, went, cancelGo, savedChanged],
  );
  return <SavedItemsContext.Provider value={value}>{children}</SavedItemsContext.Provider>;
}

/** The bar's "Itens salvos" button (Story 3.12), before the bell: it opens or closes the panel. */
export function SavedItemsButton({ language }: { readonly language: Language }) {
  const t = translator(language);
  const saved = useSavedItems();
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={t('saved.open')}
      aria-expanded={saved?.open ?? false}
      aria-keyshortcuts="Control+Shift+S Meta+Shift+S"
      title={t('saved.open')}
      onClick={(event) => saved?.toggle(event.currentTarget)}
    >
      <NamedIcon name="bookmark" />
    </button>
  );
}
