'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type SyntheticEvent } from 'react';

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
      <div className={styles.actions}>
        <PillButton ref={cancelRef} onClick={onCancel}>
          {cancelLabel ?? messagesFor(language).dialog.cancel}
        </PillButton>
        <PillButton variant="danger" onClick={onConfirm}>
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
