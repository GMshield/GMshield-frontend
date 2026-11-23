'use client';

import { startTransition, useActionState, useState } from 'react';

import { translator, type Language, type Translate } from '@/messages';

import styles from './CampaignDeleteAction.module.css';
import { ConfirmationDialog } from './ConfirmationDialog';
import { PillButton } from './PillButton';

/** What the delete left to say: the text of the backend's refusal, or nothing (it opened Minhas Mesas). */
export type CampaignDeleteState = { readonly error: string | null };

const INITIAL: CampaignDeleteState = { error: null };

/** What goes with the campaign, as the backend counted it (`GET /api/v1/campaigns/{id}/deletion`). */
export type CampaignDeletionCounts = {
  readonly conversations: number;
  readonly materials: number;
};

export type CampaignDeleteActionProps = {
  readonly id: string;
  /** Null when the counts could not be read: the dialog then names what goes without numbers. */
  readonly counts: CampaignDeletionCounts | null;
  readonly language: Language;
  readonly action: (previous: CampaignDeleteState, form: FormData) => Promise<CampaignDeleteState>;
};

/** "1 conversa" or "{n} conversas": the one form for one, the other for any other count (zero included). */
function counted(t: Translate, key: 'conversations' | 'materials', count: number): string {
  return count === 1 ? t(`campaigns.delete.${key}One`) : t(`campaigns.delete.${key}Other`, { count });
}

/** The dialog's consequence: what goes, with its counts, or in words when there are none. */
export function campaignDeletionConsequence(t: Translate, counts: CampaignDeletionCounts | null): string {
  if (counts === null) {
    return t('campaigns.delete.unknown');
  }
  return t('campaigns.delete.consequence', {
    conversations: counted(t, 'conversations', counts.conversations),
    materials: counted(t, 'materials', counts.materials),
  });
}

/**
 * "Excluir" on a campaign's page (Story 3.2 part B): a danger pill in the header that opens the confirmation, which
 * names what goes with its counts ("Vão junto: 1 conversa e 2 materiais desta campanha."). "Excluir campanha" posts the
 * campaign to the Server Action, which deletes it and opens Minhas Mesas; a refusal shows as an alert under the pill.
 * "Cancelar" or Esc closes the dialog, and focus goes back to "Excluir", which stays focusable (`aria-disabled`, its
 * clicks ignored) while the delete runs, so focus is still there when a refusal comes back.
 */
export function CampaignDeleteAction({ id, counts, language, action }: CampaignDeleteActionProps) {
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
        {t('campaigns.page.delete')}
      </PillButton>
      {state.error === null ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <ConfirmationDialog
        open={confirming}
        title={t('campaigns.delete.title')}
        consequence={campaignDeletionConsequence(t, counts)}
        confirmLabel={t('campaigns.delete.confirm')}
        language={language}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
