'use client';

import { startTransition, useActionState, useId, useState } from 'react';

import { translator, type Language, type Translate } from '@/messages';

import { ConfirmationDialog } from '../ConfirmationDialog';
import { PillButton } from '../PillButton';
import styles from './ConversationDeleteAction.module.css';

/** What the delete left to say: the text of the backend's refusal, or nothing (it opened the area's list). */
export type ConversationDeleteState = { readonly error: string | null };

const INITIAL: ConversationDeleteState = { error: null };

/**
 * An artifact saved from the conversation, as its deletion's dialog lists it (Story 5.4 part B): its id, its name and its
 * record type's label as the page names it; from Story 5.5 part A whether it overrides a record, and from Story 5.6 part
 * B whether it is shared with other campaigns (absent: it does not, it is not).
 */
export type ConversationDeleteArtifact = {
  readonly id: string;
  readonly name: string;
  readonly typeLabel: string;
  readonly overrides?: boolean;
  readonly shared?: boolean;
};

/** The checkbox's accessible name: the name and type, then each note the row shows ("substitui um registro", "compartilhado"). */
function rowLabelKey(artifact: ConversationDeleteArtifact) {
  if (artifact.overrides === true) {
    return artifact.shared === true ? 'conversations.delete.artifactRowBoth' : 'conversations.delete.artifactRowOverrides';
  }
  return artifact.shared === true ? 'conversations.delete.artifactRowShared' : 'conversations.delete.artifactRow';
}

const NO_ARTIFACTS: readonly ConversationDeleteArtifact[] = [];

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
  /**
   * Story 5.4 part B: the artifacts saved from it that are not being deleted, oldest first (the deletion read); with
   * none the dialog is the plain confirmation.
   */
  readonly artifacts?: readonly ConversationDeleteArtifact[];
};

/**
 * The dialog's consequence: "Vai junto: 1 pergunta e sua resposta." or "Vão junto: {n} perguntas e suas respostas.",
 * then that it cannot be undone; in words when there is no count. From Story 5.4 part B, with the ticked artifacts too
 * ("…, e 2 artefatos salvos.") when there are some.
 */
export function conversationDeletionConsequence(t: Translate, questions: number | null, artifacts = 0): string {
  if (artifacts > 0) {
    const going = artifacts === 1 ? t('conversations.delete.artifactsOne') : t('conversations.delete.artifactsOther', { count: artifacts });
    if (questions === null) {
      return t('conversations.delete.unknownWithArtifacts', { artifacts: going });
    }
    return questions === 1
      ? t('conversations.delete.consequenceOneWithArtifacts', { artifacts: going })
      : t('conversations.delete.consequenceOtherWithArtifacts', { count: questions, artifacts: going });
  }
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
 *
 * Story 5.4 part B: when artifacts were saved from the conversation, the dialog also lists them ("Artefatos salvos desta
 * conversa"), each a bordered row with its checkbox, name and record type; a ticked row goes with the conversation.
 * Nothing is ticked when it opens. Above the rows, two buttons pressed in words: "Manter todos" (pressed while nothing is
 * ticked; it clears every tick) and "Selecionar todos" (pressed while every row is ticked; it ticks them all). The
 * consequence counts the ticked artifacts too, and the confirmation posts their ids (`artifactIds`, repeated) with the
 * conversation's in one request. Focus still opens on "Cancelar", and every control is inside the Tab trap.
 *
 * Story 5.6 part B: a row whose artifact is shared with other campaigns adds the note "Compartilhado", after "Substitui um
 * registro" when it has both, and its checkbox's name says each note it shows.
 */
export function ConversationDeleteAction({ id, questions, language, action, artifacts = NO_ARTIFACTS }: ConversationDeleteActionProps) {
  const t = translator(language);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState(false);
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const legendId = useId();
  // Only rows still listed count (the list comes from the page, which a refresh may change).
  const going = artifacts.filter((artifact) => ticked.includes(artifact.id));
  const open = () => {
    setTicked([]);
    setConfirming(true);
  };
  const confirm = () => {
    setConfirming(false);
    const data = new FormData();
    data.set('id', id);
    for (const artifact of going) {
      data.append('artifactIds', artifact.id);
    }
    startTransition(() => formAction(data));
  };
  const toggle = (artifactId: string, on: boolean) =>
    setTicked((current) => (on ? [...current.filter((other) => other !== artifactId), artifactId] : current.filter((other) => other !== artifactId)));
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
            open();
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
        consequence={conversationDeletionConsequence(t, questions, going.length)}
        confirmLabel={t('conversations.delete.confirm')}
        language={language}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      >
        {artifacts.length === 0 ? null : (
          <fieldset className={styles.artifacts} aria-labelledby={legendId}>
            <legend id={legendId} className={styles.legend}>
              {t('conversations.delete.artifactsLegend')}
            </legend>
            <p className={styles.hint}>{t('conversations.delete.artifactsHint')}</p>
            <div className={styles.controls} role="group" aria-label={t('conversations.delete.artifactsControls')}>
              <button type="button" className={styles.control} aria-pressed={going.length === 0} onClick={() => setTicked([])}>
                {t('conversations.delete.keepAll')}
              </button>
              <button
                type="button"
                className={styles.control}
                aria-pressed={going.length === artifacts.length}
                onClick={() => setTicked(artifacts.map((artifact) => artifact.id))}
              >
                {t('conversations.delete.selectAll')}
              </button>
            </div>
            <ul className={styles.rows}>
              {artifacts.map((artifact) => (
                <li key={artifact.id} className={styles.row}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      name="artifactIds"
                      value={artifact.id}
                      checked={ticked.includes(artifact.id)}
                      onChange={(event) => toggle(artifact.id, event.target.checked)}
                      aria-label={t(rowLabelKey(artifact), {
                        name: artifact.name,
                        type: artifact.typeLabel,
                      })}
                    />
                    <span className={styles.artifactText}>
                      <span className={styles.artifactName}>{artifact.name}</span>
                      {/* Story 5.5 part A: deleting it ends the override, so its row says it has one. */}
                      {artifact.overrides === true ? <span className={styles.artifactNote}>{t('conversations.delete.artifactOverrides')}</span> : null}
                      {/* Story 5.6 part B: deleting it takes it out of the campaigns it is shared with too. */}
                      {artifact.shared === true ? <span className={styles.artifactNote}>{t('conversations.delete.artifactShared')}</span> : null}
                    </span>
                    <span className={styles.artifactType}>{artifact.typeLabel}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </ConfirmationDialog>
    </div>
  );
}
