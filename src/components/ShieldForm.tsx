'use client';

import { useActionState, useId } from 'react';

import type { ShieldFormState } from '@/app/(signed-in)/campaigns/[id]/shields/form-state';

import { SolidPillButton } from './PillButton';
import { PillLink } from './PillLink';
import styles from './SystemForm.module.css';

export type ShieldFormLabels = {
  readonly name: string;
  readonly submit: string;
  readonly cancel: string;
  /** What the empty name field shows: the default name of the campaign's unnamed first Shield; none for a new Shield. */
  readonly placeholder?: string;
};

export type ShieldFormProps = {
  /** Every text, in the interface's language (the server translates). */
  readonly labels: ShieldFormLabels;
  /** The value and the version to start from: empty for a new Shield, the Shield's own for a rename. */
  readonly initial: ShieldFormState;
  /** The Shield's campaign. */
  readonly campaignId: string;
  /** The Shield's id, for a rename; absent for a new Shield. */
  readonly id?: string;
  /** Where "Cancelar" goes. */
  readonly cancelHref: string;
  readonly action: (previous: ShieldFormState, form: FormData) => Promise<ShieldFormState>;
};

/**
 * A Shield's form (Story 6.1), a page of its own in the main column: its name (a bordered field), then "Criar escudo" or
 * "Salvar" (the screen's one solid pill) and "Cancelar". A refusal comes back as a message under the name (or under the
 * form), with what was typed kept. A rename made on a stale version comes back with the Shield's current name, and says
 * so above the field. Without JavaScript the form still posts to the Server Action.
 */
export function ShieldForm({ labels, initial, campaignId, id, cancelHref, action }: ShieldFormProps) {
  const [state, formAction, pending] = useActionState(action, initial);
  const base = useId();
  const errorId = `${base}-name-error`;
  const invalid = state.error !== null && state.field === 'name';
  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.stale && state.error !== null ? (
        <p role="alert" className={styles.stale}>
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="campaign" value={campaignId} />
      {id === undefined ? null : <input type="hidden" name="id" value={id} />}
      {state.version === null ? null : <input type="hidden" name="version" value={state.version} />}
      {/* Keyed by version: after a stale rename the field starts again from the Shield's current name. */}
      <div key={state.version ?? 'new'} className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor={`${base}-name`} className={styles.label}>
            {labels.name}
          </label>
          {/* No maxLength: the backend counts code points after trimming, and its field problem decides. */}
          <input
            id={`${base}-name`}
            name="name"
            className={styles.input}
            aria-required="true"
            defaultValue={state.values.name}
            placeholder={labels.placeholder}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
          />
          {invalid ? (
            <p id={errorId} role="alert" className={styles.error}>
              {state.error}
            </p>
          ) : null}
        </div>
      </div>
      {!state.stale && state.error !== null && state.field === null ? (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <SolidPillButton type="submit" disabled={pending} pending={pending}>
          {labels.submit}
        </SolidPillButton>
        <PillLink href={cancelHref}>{labels.cancel}</PillLink>
      </div>
    </form>
  );
}
