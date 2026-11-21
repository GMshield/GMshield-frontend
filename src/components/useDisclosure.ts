'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

export type Disclosure = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  /** The element that holds the button and what it shows: focus or a press inside it never closes it. */
  readonly container: RefObject<HTMLDivElement | null>;
  /** The button that opens and closes it: Esc gives focus back to it. */
  readonly button: RefObject<HTMLButtonElement | null>;
};

/**
 * A disclosure button and what it shows under it (a menu, a list, options): the pattern of the campaign switcher,
 * shared by the account menu, the bell and "Exibição". Open, Esc with focus in the button or in what it shows closes
 * it and gives focus back to the button; the key is marked handled, so nothing behind (the sidebar, a panel) also
 * closes on it. A press anywhere outside closes it too. The key is heard on the document while it is open: no handler
 * sits on a non-interactive element.
 */
export function useDisclosure(): Disclosure {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && container.current?.contains(document.activeElement)) {
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return { open, setOpen, container, button };
}
