'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Logo } from './Logo';
import styles from './LogoMenu.module.css';

export type LogoMenuProps = {
  /** "GMshield": the button's text, beside the mark. */
  readonly name: string;
  /** The spoken name of the opened menu. */
  readonly label: string;
  /** What the menu holds: the preferences form and "Sair" (no Account or Administration entry yet). */
  readonly children: ReactNode;
};

/**
 * The logo and name at the top of the sidebar: a disclosure button that shows and hides the menu under it.
 * Esc, with focus in the button or the open menu, closes it and gives focus back to the button. The key is
 * heard on the document while the menu is open (no handler on a non-interactive element, SonarQube S6848); it
 * is marked handled, so the sidebar does not also close on it.
 */
export function LogoMenu({ name, label, children }: LogoMenuProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

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
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div ref={container} className={styles.menu}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Logo name={name} />
      </button>
      <div id={id} role="group" aria-label={label} className={styles.panel} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
