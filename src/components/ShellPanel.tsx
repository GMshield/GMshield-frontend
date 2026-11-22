'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import styles from './Shell.module.css';
import { BEHIND_PANEL, setInertBy } from './shell-entries';
import { WIDE_QUERY } from './Sidebar';

/**
 * What fills the slot from the browser: the source view and the previews (560px), or (Story 3.12) the saved items
 * panel (340px).
 */
export type PanelKind = 'source' | 'saved';

/** The shell's right panel slot, as a page fills it (Story 2.7): where it is, and a claim on it. */
type Slot = {
  readonly target: HTMLElement | null;
  /**
   * Opens the slot for the caller; the returned function gives it back. Story 3.12: one right panel at a time, so a new
   * claim first calls the previous holder's `replaced`, which closes it (without giving focus back to what opened it).
   */
  readonly claim: (kind: PanelKind, replaced: () => void) => () => void;
};

/** A claim on the slot (Story 3.12): its order, its kind and how its holder closes when another claim replaces it. */
type Claim = { readonly id: number; readonly kind: PanelKind };

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
 * and under 768px it is a full-screen sheet. Which layout applies is CSS's decision. Story 3.12: the saved items panel
 * fills it too, 340px wide (`data-panel="saved"`), with the same overlay and sheet; and the slot holds one panel at a
 * time: a new claim closes the one before it (the source view, a search or material preview, or the saved items).
 */
export function ShellFrame({ panel, children }: ShellFrameProps) {
  const [claims, setClaims] = useState<readonly Claim[]>([]);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const wide = useWide();
  const holders = useRef(new Map<number, () => void>());
  const next = useRef(0);
  const claim = useCallback((kind: PanelKind, replaced: () => void) => {
    next.current += 1;
    const id = next.current;
    // One right panel at a time: whoever holds the slot now closes, and this claim takes it.
    const before = [...holders.current.values()];
    holders.current.clear();
    holders.current.set(id, replaced);
    setClaims((all) => [...all, { id, kind }]);
    for (const close of before) {
      close();
    }
    return () => {
      holders.current.delete(id);
      setClaims((all) => all.filter((one) => one.id !== id));
      // At once, not after the next render: the closing page gives focus back to an element behind the panel.
      for (const element of document.querySelectorAll(`[${BEHIND_PANEL}]`)) {
        setInertBy(element, 'panel', false);
      }
    };
  }, []);
  const source = panel === undefined && claims.length > 0;
  const kind: PanelKind = claims.at(-1)?.kind ?? 'source';

  // Story 3.12: set again for each holder, as the release of the one it replaced clears it.
  const holder = claims.at(-1)?.id;
  useEffect(() => {
    if (!source || wide || holder === undefined) {
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
  }, [source, wide, holder]);

  const slot = useMemo(() => ({ target: source ? target : null, claim }), [source, target, claim]);
  let aside: ReactNode = null;
  let shown = 'none';
  if (panel !== undefined) {
    shown = 'open';
    aside = (
      <aside className={styles.panel} data-behind-sidebar="">
        {panel}
      </aside>
    );
  } else if (source) {
    shown = kind;
    aside = <aside ref={setTarget} className={styles.panel} data-behind-sidebar="" />;
  }
  return (
    <SlotContext.Provider value={slot}>
      <div className={styles.shell} data-panel={shown}>
        {children}
        {aside}
      </div>
    </SlotContext.Provider>
  );
}

export type ShellPanelProps = {
  /** Story 3.12: what fills the slot (the source view's 560px by default, or the saved items' 340px). */
  readonly kind?: PanelKind;
  /**
   * Story 3.12: closes this panel when another one opens in the slot (one right panel at a time). Focus is not given
   * back to what opened it then: the new panel takes it.
   */
  readonly onReplaced?: () => void;
  readonly children: ReactNode;
};

/**
 * Renders `children` in the shell's right panel slot while it is mounted (Story 2.7); outside a shell (a test, a page
 * without one) in place. Story 3.12: mounting it closes the panel the slot held before.
 */
export function ShellPanel({ kind = 'source', onReplaced, children }: ShellPanelProps) {
  const slot = useContext(SlotContext);
  const claim = slot?.claim;
  const replaced = useRef(onReplaced);
  useEffect(() => {
    replaced.current = onReplaced;
  }, [onReplaced]);
  useEffect(() => claim?.(kind, () => replaced.current?.()), [claim, kind]);
  if (slot === null) {
    return children;
  }
  return slot.target === null ? null : createPortal(children, slot.target);
}
