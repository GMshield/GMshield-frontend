'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import styles from './Shell.module.css';
import { BEHIND_PANEL, setInertBy } from './shell-entries';
import { WIDE_QUERY } from './Sidebar';

/** The shell's right panel slot, as a page fills it (Story 2.7): where it is, and a claim on it. */
type Slot = {
  readonly target: HTMLElement | null;
  /** Opens the slot for the caller; the returned function gives it back. */
  readonly claim: () => () => void;
};

const SlotContext = createContext<Slot | null>(null);

function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function wideNow(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia(WIDE_QUERY).matches;
}

/** Whether the window is 1280px wide or more; true on the server, where nothing is inert. */
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, wideNow, () => true);
}

export type ShellFrameProps = {
  /** A panel the page renders on the server, which narrows the main column. */
  readonly panel?: ReactNode;
  /** The sidebar and the main column. */
  readonly children: ReactNode;
};

/**
 * The shell's grid (Story 1.11) and its right panel slot. A server-rendered `panel` fills the slot as before. From
 * Story 2.7 a component of the page fills it from the browser through {@link ShellPanel} (the source view): the slot
 * is then 560px wide (`data-panel="source"`). At 1280px and more it is a column and the main column narrows, with
 * nothing inert; under 1280px it opens over the main column, which is inert while it is open (as behind the sidebar),
 * and under 768px it is a full-screen sheet. Which layout applies is CSS's decision.
 */
export function ShellFrame({ panel, children }: ShellFrameProps) {
  const [claims, setClaims] = useState(0);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const wide = useWide();
  const claim = useCallback(() => {
    setClaims((count) => count + 1);
    return () => {
      setClaims((count) => count - 1);
      // At once, not after the next render: the closing page gives focus back to an element behind the panel.
      for (const element of document.querySelectorAll(`[${BEHIND_PANEL}]`)) {
        setInertBy(element, 'panel', false);
      }
    };
  }, []);
  const source = panel === undefined && claims > 0;

  useEffect(() => {
    if (!source || wide) {
      return undefined;
    }
    const behind = document.querySelectorAll(`[${BEHIND_PANEL}]`);
    for (const element of behind) {
      setInertBy(element, 'panel', true);
    }
    return () => {
      for (const element of behind) {
        setInertBy(element, 'panel', false);
      }
    };
  }, [source, wide]);

  const slot = useMemo(() => ({ target: source ? target : null, claim }), [source, target, claim]);
  let aside: ReactNode = null;
  let kind = 'none';
  if (panel !== undefined) {
    kind = 'open';
    aside = (
      <aside className={styles.panel} data-behind-sidebar="">
        {panel}
      </aside>
    );
  } else if (source) {
    kind = 'source';
    aside = <aside ref={setTarget} className={styles.panel} data-behind-sidebar="" />;
  }
  return (
    <SlotContext.Provider value={slot}>
      <div className={styles.shell} data-panel={kind}>
        {children}
        {aside}
      </div>
    </SlotContext.Provider>
  );
}

/**
 * Renders `children` in the shell's right panel slot while it is mounted (Story 2.7); outside a shell (a test, a page
 * without one) in place.
 */
export function ShellPanel({ children }: { readonly children: ReactNode }) {
  const slot = useContext(SlotContext);
  const claim = slot?.claim;
  useEffect(() => claim?.(), [claim]);
  if (slot === null) {
    return children;
  }
  return slot.target === null ? null : createPortal(children, slot.target);
}
