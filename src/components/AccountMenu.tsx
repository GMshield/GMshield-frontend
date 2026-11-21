'use client';

import { useId, type ReactNode } from 'react';

import styles from './AccountMenu.module.css';
import { NamedIcon } from './Icons';
import { useDisclosure } from './useDisclosure';

export type AccountMenuProps = {
  /** The GM's username: its first letter marks the button. */
  readonly username: string;
  /** The button's spoken name, "Conta de mestre_ana". */
  readonly label: string;
  /** The menu's spoken name, "Conta e preferências". */
  readonly title: string;
  /** The menu's content, rendered by the server: who is signed in, the preferences, the way out. */
  readonly children: ReactNode;
};

/**
 * The account menu (usability pass, 2026-11-21): a round button at the right end of the bar above the page, where an
 * account control is expected, that shows the account, the theme and the language, and "Sair" in a panel under it. It
 * replaces the menu that opened under the logo and pushed the sidebar's entries down. Esc, with focus in the button or
 * the panel, closes it and gives focus back to the button; a press outside closes it too. A choice of theme or
 * language applies at once and leaves the panel open, showing the new choice.
 */
export function AccountMenu({ username, label, title, children }: AccountMenuProps) {
  const { open, setOpen, container, button } = useDisclosure();
  const id = useId();
  // The first letter or digit of the username, as a person's initial would be shown.
  const initial = [...username].find((character) => /[\p{L}\p{N}]/u.test(character))?.toLocaleUpperCase() ?? '';
  return (
    <div ref={container} className={styles.menu}>
      <button ref={button} type="button" className={styles.trigger} aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className={styles.avatar} aria-hidden="true">
          {initial === '' ? <NamedIcon name="characters" size={18} /> : initial}
        </span>
        <span className={styles.chevron}>
          <NamedIcon name="chevronDown" size={16} />
        </span>
      </button>
      <div id={id} role="group" aria-label={title} className={styles.panel} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
