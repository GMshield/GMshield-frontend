'use client';

import { useActionState } from 'react';

import { CAMPAIGN_ACTION_START, type CampaignActionState } from '@/app/(signed-in)/campaigns/form-state';

import styles from './CampaignAction.module.css';
import { PillButton, type PillVariant } from './PillButton';

export type CampaignActionProps = {
  /** The pill's text, in the interface's language. */
  readonly label: string;
  readonly variant?: PillVariant;
  /** What the form posts: the campaign's id, and its version and archive for an archive or a restore. */
  readonly fields: Readonly<Record<string, string>>;
  readonly action: (previous: CampaignActionState, form: FormData) => Promise<CampaignActionState>;
};

/**
 * One action on a campaign as a pill that posts its form to a Server Action (Story 3.2): "Usar esta campanha",
 * "Arquivar", "Restaurar" or a conversation's "Abrir". Archive and restore are reversible, so none asks a confirmation.
 * A refusal shows as an alert under the pill. The pill stays focusable while the action runs (`aria-disabled`), so
 * focus is still there when a refusal comes back. Without JavaScript the form still posts.
 */
export function CampaignAction({ label, variant = 'default', fields, action }: CampaignActionProps) {
  const [state, formAction, pending] = useActionState(action, CAMPAIGN_ACTION_START);
  return (
    <form action={formAction} className={styles.action}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <PillButton
        type="submit"
        variant={variant}
        aria-disabled={pending}
        pending={pending}
        onClick={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
      >
        {label}
      </PillButton>
      {state.error === null ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
    </form>
  );
}
