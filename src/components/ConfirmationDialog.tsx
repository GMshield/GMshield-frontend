'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';

import { messagesFor, type Language } from '@/messages';

import styles from './ConfirmationDialog.module.css';
import { PillButton } from './PillButton';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type ConfirmationDialogProps = {
  readonly open: boolean;
  /** Names what goes, such as "Excluir «Livro do Jogador»?". */
  readonly title: string;
  /** The consequence, in one or two sentences. */
  readonly consequence: string;
  readonly confirmLabel: string;
  /** Defaults to "Cancelar" / "Cancel". */
  readonly cancelLabel?: string;
  readonly language: Language;
  readonly onConfirm: () => void;
  /** Called by the cancel button and by Esc. */
  readonly onCancel: () => void;
  /**
   * Story 5.4 part B: more of the dialog, under the consequence and above the buttons (a conversation's saved artifacts,
   * to tick). Its controls are inside the Tab trap; focus still opens on the cancel button.
   */
  readonly children?: ReactNode;
  /**
   * Story 5.7 part B: the confirmation cannot be pressed yet (nothing is ticked). It says so with `aria-disabled` and
   * ignores presses, so it stays inside the Tab trap. Absent: it can always be pressed.
   */
  readonly confirmDisabled?: boolean;
  /**
   * Story 5.7 part B: what the confirmation does. `danger` (the default) removes something and is filled in the danger
   * colour; `solid` is a confirmation that removes nothing (an export), filled in the text colour.
   */
  readonly confirmTone?: 'danger' | 'solid';
  /** Story 5.7 part B: the id of what describes the confirmation (why it is unavailable, what it covers). */
  readonly confirmDescribedBy?: string;
};

/**
 * A modal 440px dialog on a dimmed canvas that confirms a destructive action. It opens with
 * `showModal()`, keeps Tab inside itself, closes on Esc through `onCancel`, and gives focus back to
 * the element that had it when it opened.
 */
export function ConfirmationDialog({
  open,
  title,
  consequence,
  confirmLabel,
  cancelLabel,
  language,
  onConfirm,
  onCancel,
  children,
  confirmDisabled = false,
  confirmTone = 'danger',
  confirmDescribedBy,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const consequenceId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocus(openerRef);
    }
  }, [open]);

  // Unmounted while open: focus still goes back to the opener.
  useEffect(() => () => returnFocus(openerRef), []);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Tab') {
      trapTab(event);
    }
  }

  // The browser's own close request (Esc without our key handler, or a back gesture).
  function onNativeCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onCancel();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={consequenceId}
      onKeyDown={onKeyDown}
      onCancel={onNativeCancel}
    >
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <p id={consequenceId} className={styles.consequence}>
        {consequence}
      </p>
      {children === undefined || children === null ? null : <div className={styles.more}>{children}</div>}
      <div className={styles.actions}>
        <PillButton ref={cancelRef} onClick={onCancel}>
          {cancelLabel ?? messagesFor(language).dialog.cancel}
        </PillButton>
        <PillButton
          variant={confirmTone}
          className={confirmTone === 'danger' ? styles.confirm : undefined}
          aria-disabled={confirmDisabled || undefined}
          aria-describedby={confirmDescribedBy}
          onClick={() => {
            if (!confirmDisabled) {
              onConfirm();
            }
          }}
        >
          {confirmLabel}
        </PillButton>
      </div>
    </dialog>
  );
}

function returnFocus(openerRef: { current: HTMLElement | null }) {
  const opener = openerRef.current;
  openerRef.current = null;
  if (opener?.isConnected) {
    opener.focus();
  }
}

function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
  const dialog = event.currentTarget;
  const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !(active instanceof Node) || !dialog.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}
