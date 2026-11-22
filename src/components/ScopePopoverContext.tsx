'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * The context bar's scope popover, as the rest of the page may open it (Story 3.8: the offer under a silent answer).
 * `available` says whether a popover is there to open (none without a campaign, or when its scope could not be read).
 * `open` opens it with focus inside it; it does nothing when none is available.
 */
export type ScopePopoverOpener = {
  readonly available: boolean;
  readonly open: () => void;
};

/** What `ScopePopover` gives the provider: how to open it, or null once it is gone. */
type Registry = {
  readonly register: (opener: (() => void) | null) => void;
};

const OpenerContext = createContext<ScopePopoverOpener | null>(null);
const RegistryContext = createContext<Registry | null>(null);

/** The scope popover's opener, or null outside `ScopePopoverProvider` (a component rendered alone, as in its tests). */
export function useOptionalScopePopover(): ScopePopoverOpener | null {
  return useContext(OpenerContext);
}

/** For `ScopePopover`: how it hands the provider its opener; null outside the provider. */
export function useScopePopoverRegistry(): Registry | null {
  return useContext(RegistryContext);
}

/**
 * Holds how to open the context bar's scope popover (Story 3.8), provided by `Shell` around the bar and the page. The
 * popover registers its opener while it is mounted; the page asks the provider to open it.
 */
export function ScopePopoverProvider({ children }: { readonly children: ReactNode }) {
  const opener = useRef<(() => void) | null>(null);
  const [available, setAvailable] = useState(false);
  const register = useCallback((next: (() => void) | null) => {
    opener.current = next;
    setAvailable(next !== null);
  }, []);
  const open = useCallback(() => opener.current?.(), []);
  const value = useMemo(() => ({ available, open }), [available, open]);
  const registry = useMemo(() => ({ register }), [register]);
  return (
    <RegistryContext.Provider value={registry}>
      <OpenerContext.Provider value={value}>{children}</OpenerContext.Provider>
    </RegistryContext.Provider>
  );
}
