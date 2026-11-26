'use client';

import { startTransition, useActionState, useState } from 'react';

import { translator, type Language, type Translate } from '@/messages';

import { ConfirmationDialog } from './ConfirmationDialog';
import { PillButton } from './PillButton';
import styles from './SystemActions.module.css';

/** What the delete left to say: the text of the backend's refusal, or nothing (it opened the list). */
export type SystemDeleteState = { readonly error: string | null };

const INITIAL: SystemDeleteState = { error: null };

/** What goes with the system, as the backend counted it (`GET /api/v1/systems/{id}/deletion`). */
export type SystemDeletionCounts = {
  readonly campaigns: number;
  readonly conversations: number;
  readonly materials: number;
  /** Story 5.1: the artifacts of its campaigns. */
  readonly artifacts: number;
};

export type SystemActionsProps = {
  readonly id: string;
  /** Null when the counts could not be read: the dialog then names what goes without numbers. */
  readonly counts: SystemDeletionCounts | null;
  readonly language: Language;
  readonly action: (previous: SystemDeleteState, form: FormData) => Promise<SystemDeleteState>;
};

/** "1 campanha" or "{n} campanhas": the one form for one, the other for any other count (zero included). */
function counted(t: Translate, key: 'campaigns' | 'conversations' | 'materials' | 'artifacts', count: number): string {
  return count === 1 ? t(`systems.delete.${key}One`) : t(`systems.delete.${key}Other`, { count });
}

/** The dialog's consequence: what goes, with its counts. */
export function deletionConsequence(t: Translate, counts: SystemDeletionCounts | null): string {
  if (counts === null) {
    return t('systems.delete.unknown');
  }
  return t('systems.delete.consequence', {
    campaigns: counted(t, 'campaigns', counts.campaigns),
    conversations: counted(t, 'conversations', counts.conversations),
    materials: counted(t, 'materials', counts.materials),
    artifacts: counted(t, 'artifacts', counts.artifacts),
  });
}

/**
 * "Excluir" on a system's page (Story 3.1 part B): a danger pill next to "Editar" that opens the confirmation, which
 * names what goes with its counts ("Vão junto: 2 campanhas, 3 conversas e 1 material ligado só a ele."). "Excluir
 * sistema" posts the system to the Server Action, which deletes it and opens the list of systems; a refusal shows as
 * an alert under the pill. "Cancelar" or Esc closes the dialog, and focus goes back to "Excluir", which stays focusable
 * (`aria-disabled`, its clicks ignored) while the delete runs, so focus is still there when a refusal comes back.
 */
export function SystemActions({ id, counts, language, action }: SystemActionsProps) {
  const t = translator(language);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState(false);
  const confirm = () => {
    setConfirming(false);
    const data = new FormData();
    data.set('id', id);
    startTransition(() => formAction(data));
  };
  return (
    <div className={styles.actions}>
      {/* aria-disabled, not disabled, while the delete runs: the dialog gives focus back here, and a refusal keeps it. */}
      <PillButton
        variant="danger"
        aria-haspopup="dialog"
        aria-disabled={pending}
        pending={pending}
        onClick={() => {
          if (!pending) {
            setConfirming(true);
          }
        }}
      >
        {t('systems.page.delete')}
      </PillButton>
      {state.error === null ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <ConfirmationDialog
        open={confirming}
        title={t('systems.delete.title')}
        consequence={deletionConsequence(t, counts)}
        confirmLabel={t('systems.delete.confirm')}
        language={language}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
