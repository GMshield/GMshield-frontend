'use client';

import { startTransition, useActionState, useState } from 'react';

import { translator, type Language, type Translate } from '@/messages';

import { ConfirmationDialog } from '../ConfirmationDialog';
import { PillButton } from '../PillButton';
import styles from './ConversationDeleteAction.module.css';

/** What the delete left to say: the text of the backend's refusal, or nothing (it opened the area's list). */
export type ConversationDeleteState = { readonly error: string | null };

const INITIAL: ConversationDeleteState = { error: null };

export type ConversationDeleteActionProps = {
  readonly id: string;
  /**
   * How many questions go with it (`GET /api/v1/conversations/{id}/deletion`, plus those asked on the page since); null
   * when no count was read (the count could not be read, or the conversation was made on this page): the dialog then
   * names what goes without a number.
   */
  readonly questions: number | null;
  readonly language: Language;
  readonly action: (previous: ConversationDeleteState, form: FormData) => Promise<ConversationDeleteState>;
};

/**
 * The dialog's consequence: "Vai junto: 1 pergunta e sua resposta." or "Vão junto: {n} perguntas e suas respostas.",
 * then that it cannot be undone; in words when there is no count.
 */
export function conversationDeletionConsequence(t: Translate, questions: number | null): string {
  if (questions === null) {
    return t('conversations.delete.unknown');
  }
  return questions === 1 ? t('conversations.delete.consequenceOne') : t('conversations.delete.consequenceOther', { count: questions });
}

/**
 * "Excluir" in a conversation's slim top line (Story 3.10 part B), after "Renomear": a danger pill that opens the
 * confirmation ("Excluir esta conversa?"), which names how many questions go with their answers. "Excluir conversa"
 * posts the conversation to the Server Action, which deletes it and opens the area's list with a toast naming it; a
 * refusal shows as an alert under the pill. "Cancelar" or Esc closes the dialog, and focus goes back to "Excluir", which
 * stays focusable (`aria-disabled`, its clicks ignored) while the delete runs, so focus is still there when a refusal
 * comes back.
 */
export function ConversationDeleteAction({ id, questions, language, action }: ConversationDeleteActionProps) {
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
        {t('conversations.delete.action')}
      </PillButton>
      {state.error === null ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <ConfirmationDialog
        open={confirming}
        title={t('conversations.delete.title')}
        consequence={conversationDeletionConsequence(t, questions)}
        confirmLabel={t('conversations.delete.confirm')}
        language={language}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
