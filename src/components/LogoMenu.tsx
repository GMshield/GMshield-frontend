'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

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
 * Esc closes the open menu and gives focus back to the button.
 */
export function LogoMenu({ name, label, children }: LogoMenuProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  }

  return (
    <div className={styles.menu} onKeyDown={onKeyDown}>
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
