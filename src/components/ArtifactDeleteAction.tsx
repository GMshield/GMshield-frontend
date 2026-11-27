'use client';

import { startTransition, useActionState, useState } from 'react';

import { translator, type Language } from '@/messages';

import styles from './ArtifactDeleteAction.module.css';
import { ConfirmationDialog } from './ConfirmationDialog';
import { PillButton } from './PillButton';

/** What the delete left to say: the text of the backend's refusal, or nothing (it opened the way back). */
export type ArtifactDeleteState = { readonly error: string | null };

const INITIAL: ArtifactDeleteState = { error: null };

export type ArtifactDeleteActionProps = {
  readonly campaignId: string;
  readonly artifactId: string;
  readonly name: string;
  /** Where the page was opened from (`from=characters`), so the delete lands there; null for the artifacts tab. */
  readonly from: string | null;
  readonly language: Language;
  readonly action: (previous: ArtifactDeleteState, form: FormData) => Promise<ArtifactDeleteState>;
  /** Story 5.6 part B: the names of the campaigns the artifact is shared with, in its `sharedWith` order; none: absent. */
  readonly sharedWith?: readonly string[];
};

const NOT_SHARED: readonly string[] = [];

/**
 * "Excluir" on an artifact's page (Story 5.2 part B), as a material's page has it: a danger pill in the header that
 * opens the confirmation, which names the artifact and what goes with it (every version, answers that cited it show
 * «fonte removida», and it cannot be undone). "Excluir artefato" posts the artifact, its name and where the page was
 * opened from to the Server Action, which deletes it and opens the artifacts tab (or "Personagens"); a refusal shows as
 * an alert under the pill. "Cancelar" or Esc closes the dialog, and focus goes back to "Excluir", which stays focusable
 * (`aria-disabled`, its clicks ignored) while the delete runs, so focus is still there when a refusal comes back.
 *
 * Story 5.6 part B: when the artifact is shared, the consequence also says "Também sai de: {A} e {B}." before it says it
 * cannot be undone, naming the campaigns in `sharedWith` order as a list in the interface's language.
 */
export function ArtifactDeleteAction({ campaignId, artifactId, name, from, language, action, sharedWith = NOT_SHARED }: ArtifactDeleteActionProps) {
  const t = translator(language);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState(false);
  const confirm = () => {
    setConfirming(false);
    const data = new FormData();
    data.set('campaignId', campaignId);
    data.set('artifactId', artifactId);
    data.set('name', name);
    if (from !== null) {
      data.set('from', from);
    }
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
        {t('artifacts.delete.action')}
      </PillButton>
      {state.error === null ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <ConfirmationDialog
        open={confirming}
        title={t('artifacts.delete.title', { name })}
        consequence={
          sharedWith.length === 0
            ? t('artifacts.delete.consequence')
            : t('artifacts.delete.consequenceShared', {
                campaigns: new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(sharedWith),
              })
        }
        confirmLabel={t('artifacts.delete.confirm')}
        cancelLabel={t('artifacts.delete.cancel')}
        language={language}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
