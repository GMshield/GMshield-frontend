'use client';

import { startTransition, useActionState, useState } from 'react';

import { translator, type Language, type Translate } from '@/messages';

import { ConfirmationDialog } from './ConfirmationDialog';
import { PillButton } from './PillButton';
import styles from './ShieldDeleteAction.module.css';

/** What the delete left to say: the text of the backend's refusal, or nothing (it opened the Shields tab). */
export type ShieldDeleteState = { readonly error: string | null };

const INITIAL: ShieldDeleteState = { error: null };

/** What goes with the Shield, as the backend counted it (`GET …/shields/{shieldId}/deletion`). */
export type ShieldDeletionPreview = {
  readonly notes: number;
  readonly rolls: number;
  /** The campaign's only Shield, which cannot be deleted. */
  readonly last: boolean;
};

export type ShieldDeleteActionProps = {
  readonly campaignId: string;
  readonly shieldId: string;
  /** The name the screen shows ("Escudo do Mestre" for the unnamed first one), for the dialog's title. */
  readonly name: string;
  /** Null when the preview could not be read: the dialog then names what goes without numbers, and the backend decides. */
  readonly deletion: ShieldDeletionPreview | null;
  readonly language: Language;
  readonly action: (previous: ShieldDeleteState, form: FormData) => Promise<ShieldDeleteState>;
};

/** "1 nota" or "{n} notas": the one form for one, the other for any other count. */
function counted(t: Translate, key: 'notes' | 'rolls', count: number): string {
  return count === 1 ? t(`shields.delete.${key}One`) : t(`shields.delete.${key}Other`, { count });
}

/** The dialog's consequence: "O escudo está vazio." with nothing in it, else what goes with its counts, or in words. */
export function shieldDeletionConsequence(t: Translate, deletion: ShieldDeletionPreview | null): string {
  if (deletion === null) {
    return t('shields.delete.unknown');
  }
  if (deletion.notes === 0 && deletion.rolls === 0) {
    return t('shields.delete.empty');
  }
  return t('shields.delete.consequence', { notes: counted(t, 'notes', deletion.notes), rolls: counted(t, 'rolls', deletion.rolls) });
}

/**
 * "Excluir" on a Shield's screen (Story 6.1 part B): a danger pill last in the header. When the preview loaded with the
 * page says this is the campaign's only Shield, a press opens nothing and says "Uma campanha precisa de pelo menos um
 * escudo." under the pill (`role="alert"`). Otherwise it opens the confirmation, which names what goes ("O escudo está
 * vazio." while it holds nothing, else its notes and rolls with their counts). "Excluir escudo" posts the campaign and
 * the Shield to the Server Action, which deletes it and opens the campaign's Shields tab; a refusal (the last Shield, when
 * another tab deleted the other one meanwhile) shows as the same alert. "Cancelar" or Esc closes the dialog, and focus
 * goes back to "Excluir", which stays focusable (`aria-disabled`, its clicks ignored) while the delete runs.
 */
export function ShieldDeleteAction({ campaignId, shieldId, name, deletion, language, action }: ShieldDeleteActionProps) {
  const t = translator(language);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState(false);
  const [lastRefused, setLastRefused] = useState(false);
  const last = deletion?.last === true;
  const confirm = () => {
    setConfirming(false);
    const data = new FormData();
    data.set('campaign', campaignId);
    data.set('id', shieldId);
    startTransition(() => formAction(data));
  };
  const error = lastRefused ? t('shields.delete.last') : state.error;
  return (
    <div className={styles.actions}>
      {/* aria-disabled, not disabled, while the delete runs: the dialog gives focus back here, and a refusal keeps it. */}
      <PillButton
        variant="danger"
        aria-haspopup={last ? undefined : 'dialog'}
        aria-disabled={pending}
        pending={pending}
        onClick={() => {
          if (pending) {
            return;
          }
          if (last) {
            setLastRefused(true);
          } else {
            setConfirming(true);
          }
        }}
      >
        {t('shields.delete.action')}
      </PillButton>
      {error === null ? null : (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {last ? null : (
        <ConfirmationDialog
          open={confirming}
          title={t('shields.delete.title', { name })}
          consequence={shieldDeletionConsequence(t, deletion)}
          confirmLabel={t('shields.delete.confirm')}
          language={language}
          onConfirm={confirm}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
