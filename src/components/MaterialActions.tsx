'use client';

import { startTransition, useActionState, useState } from 'react';

import { translator, type Language } from '@/messages';

import { ConfirmationDialog } from './ConfirmationDialog';
import styles from './MaterialActions.module.css';
import { PillButton, SolidPillButton } from './PillButton';

/** What an action left to say: the text of the backend's refusal, or nothing. */
export type MaterialActionState = { readonly error: string | null };

const INITIAL: MaterialActionState = { error: null };

/** An action the material's view allows now (`Material.actions`). */
export type ActionName = 'accept' | 'reprocess' | 'retry' | 'discard';

export type MaterialActionsProps = {
  readonly id: string;
  readonly name: string;
  /** Only these are shown, as the backend allows them now. */
  readonly actions: readonly ActionName[];
  /** The pages read, which a discard removes; undefined when none was counted. */
  readonly pages: number | undefined;
  readonly language: Language;
  readonly action: (previous: MaterialActionState, form: FormData) => Promise<MaterialActionState>;
};

/**
 * The GM's actions on a material (Story 1.20), only those the backend allows now: "Aceitar" the one solid pill (or
 * "Tentar de novo" for a failed version), "Reprocessar páginas com falha" and "Descartar" pills. Each posts the form
 * to the Server Action, which refreshes the page; "Descartar" first opens a confirmation that names what goes, with
 * its count. A refusal shows as an alert under the pills. Every action is a native button, so it works from the
 * keyboard, and without JavaScript every action but the confirmed discard still posts.
 */
export function MaterialActions({ id, name, actions, pages, language, action }: MaterialActionsProps) {
  const t = translator(language);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState(false);
  if (actions.length === 0) {
    return null;
  }
  let consequence = t('material.discard.noPages');
  if (pages === 1) {
    consequence = t('material.discard.pagesOne');
  } else if (pages !== undefined && pages > 1) {
    consequence = t('material.discard.pagesOther', { pages });
  }
  const discard = () => {
    setConfirming(false);
    const data = new FormData();
    data.set('id', id);
    data.set('action', 'discard');
    startTransition(() => formAction(data));
  };
  return (
    <div className={styles.actions}>
      <form action={formAction} className={styles.row} aria-label={t('material.actions.label')}>
        <input type="hidden" name="id" value={id} />
        {actions.includes('accept') ? (
          <SolidPillButton type="submit" name="action" value="accept" disabled={pending}>
            {t('material.actions.accept')}
          </SolidPillButton>
        ) : null}
        {actions.includes('retry') ? (
          <SolidPillButton type="submit" name="action" value="retry" disabled={pending}>
            {t('material.actions.retry')}
          </SolidPillButton>
        ) : null}
        {actions.includes('reprocess') ? (
          <PillButton type="submit" name="action" value="reprocess" disabled={pending}>
            {t('material.actions.reprocess')}
          </PillButton>
        ) : null}
        {actions.includes('discard') ? (
          <PillButton aria-haspopup="dialog" disabled={pending} onClick={() => setConfirming(true)}>
            {t('material.actions.discard')}
          </PillButton>
        ) : null}
      </form>
      {state.error === null ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      {actions.includes('discard') ? (
        <ConfirmationDialog
          open={confirming}
          title={t('material.discard.title', { name })}
          consequence={consequence}
          confirmLabel={t('material.actions.discard')}
          language={language}
          onConfirm={discard}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
