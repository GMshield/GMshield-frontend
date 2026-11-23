'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import styles from './FullScreen.module.css';
import { NamedIcon } from './Icons';
import { PillButton } from './PillButton';

/** The frame's full screen, as its control uses it: whether the browser offers it, whether it is on, and the toggle. */
type FullScreenState = {
  readonly supported: boolean;
  readonly active: boolean;
  readonly toggle: () => void;
};

const FullScreenContext = createContext<FullScreenState | null>(null);

/**
 * The page view's full-screen frame (2026-11-23): a layout above the `[page]` segment holds it, so it stays mounted,
 * and stays in full screen, while the GM turns from page to page. Full screen shows only this frame: the sidebar, the
 * bars and the toasts are outside it. Esc, the browser's own, leaves it; so does going to a screen outside the frame,
 * which unmounts it. Where the browser offers no element full screen (an iPhone), nothing changes and no control shows.
 */
export function FullScreenFrame({ children }: { readonly children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  useEffect(() => {
    setSupported(document.fullscreenEnabled === true && typeof frame.current?.requestFullscreen === 'function');
    const changed = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement === frame.current && frame.current !== null) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      // A refusal (no user gesture, a policy) leaves the page as it was: nothing to tell the GM.
      void frame.current?.requestFullscreen().catch(() => undefined);
    }
  }, []);
  const state = useMemo(() => ({ supported, active, toggle }), [supported, active, toggle]);
  return (
    <FullScreenContext.Provider value={state}>
      <div ref={frame} className={styles.frame} data-fullscreen={active ? 'on' : undefined}>
        {children}
      </div>
    </FullScreenContext.Provider>
  );
}

/** Whether a key press belongs to a field, a list box or editable text, which keep their own arrow keys. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

/**
 * The page view header's full-screen control: "Tela cheia", or "Sair da tela cheia" while on. While on, ArrowLeft and
 * ArrowRight turn to `previous` and `next` (null at the first and the last page), unless the key belongs to a field or
 * comes with a modifier. Renders nothing outside a `FullScreenFrame` or where the browser offers no full screen.
 */
export function FullScreenButton({
  enter,
  leave,
  previous,
  next,
}: {
  readonly enter: string;
  readonly leave: string;
  readonly previous: string | null;
  readonly next: string | null;
}) {
  const state = useContext(FullScreenContext);
  const router = useRouter();
  const active = state?.active === true;
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const turn = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || typing(event.target)) {
        return;
      }
      const href = event.key === 'ArrowLeft' ? previous : event.key === 'ArrowRight' ? next : null;
      if (href !== null) {
        event.preventDefault();
        router.push(href);
      }
    };
    document.addEventListener('keydown', turn);
    return () => document.removeEventListener('keydown', turn);
  }, [active, previous, next, router]);
  if (state === null || !state.supported) {
    return null;
  }
  return (
    <PillButton onClick={state.toggle}>
      <NamedIcon name={active ? 'fullScreenExit' : 'fullScreen'} />
      {active ? leave : enter}
    </PillButton>
  );
}
