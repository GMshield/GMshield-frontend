'use client';

import { startTransition, useActionState, useState } from 'react';

import { translator, type Language, type Translate } from '@/messages';

import { ConfirmationDialog } from './ConfirmationDialog';
import styles from './MaterialDeleteAction.module.css';
import { PillButton } from './PillButton';

/** What the delete left to say: the text of the backend's refusal, or nothing (it opened Meus Arquivos). */
export type MaterialDeleteState = { readonly error: string | null };

const INITIAL: MaterialDeleteState = { error: null };

/** What goes with the material, as the backend counted it (`GET /api/v1/materials/{id}/deletion`). */
export type MaterialDeletionCounts = {
  readonly versions: number;
  readonly pages: number;
};

export type MaterialDeleteActionProps = {
  readonly id: string;
  readonly name: string;
  /** Null when the counts could not be read: the dialog then names what goes without numbers. */
  readonly counts: MaterialDeletionCounts | null;
  readonly language: Language;
  readonly action: (previous: MaterialDeleteState, form: FormData) => Promise<MaterialDeleteState>;
};

/** "1 versão" or "{n} versões", "1 página lida" or "{n} páginas lidas": the one form for one, the other for any other count. */
function counted(t: Translate, key: 'versions' | 'pages', count: number): string {
  return count === 1 ? t(`material.delete.${key}One`) : t(`material.delete.${key}Other`, { count });
}

/**
 * The dialog's consequence: what goes, with its counts; its versions alone when no page of them was read; in words when
 * there are no counts.
 */
export function materialDeletionConsequence(t: Translate, counts: MaterialDeletionCounts | null): string {
  if (counts === null) {
    return t('material.delete.unknown');
  }
  if (counts.pages === 0) {
    return t('material.delete.noPages', { versions: counted(t, 'versions', counts.versions) });
  }
  return t('material.delete.consequence', {
    versions: counted(t, 'versions', counts.versions),
    pages: counted(t, 'pages', counts.pages),
  });
}

/**
 * "Excluir" on a material's page (Story 3.4 part B): a danger pill in the header that opens the confirmation, which
 * names what goes with its counts ("Vão junto: 2 versões e 640 páginas lidas, ...", or the versions alone when no page
 * was read). "Excluir arquivo" posts the
 * material to the Server Action, which deletes it and opens Meus Arquivos; a refusal shows as an alert under the pill.
 * "Cancelar" or Esc closes the dialog, and focus goes back to "Excluir", which stays focusable (`aria-disabled`, its
 * clicks ignored) while the delete runs, so focus is still there when a refusal comes back.
 */
export function MaterialDeleteAction({ id, name, counts, language, action }: MaterialDeleteActionProps) {
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
        {t('material.delete.action')}
      </PillButton>
      {state.error === null ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <ConfirmationDialog
        open={confirming}
        title={t('material.delete.title', { name })}
        consequence={materialDeletionConsequence(t, counts)}
        confirmLabel={t('material.delete.confirm')}
        language={language}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
