'use client';

import { useActionState, useId } from 'react';

import type { CampaignField, CampaignFormState } from '@/app/(signed-in)/campaigns/form-state';

import { SolidPillButton } from './PillButton';
import { PillLink } from './PillLink';
import styles from './SystemForm.module.css';

export type CampaignFormLabels = {
  readonly name: string;
  readonly system: string;
  readonly submit: string;
  readonly cancel: string;
};

/** A system the new campaign may belong to: its id and the words that name it (name and edition). */
export type SystemChoice = { readonly id: string; readonly label: string };

export type CampaignFormProps = {
  /** Every text, in the interface's language (the server translates). */
  readonly labels: CampaignFormLabels;
  /** The values and the version to start from: empty for a new campaign, the campaign's own for a rename. */
  readonly initial: CampaignFormState;
  /** The systems to choose from, for a new campaign; absent for a rename (a campaign's system never changes). */
  readonly systems?: readonly SystemChoice[];
  /** The campaign's id, for a rename; absent for a new campaign. */
  readonly id?: string;
  /** Where "Cancelar" goes. */
  readonly cancelHref: string;
  readonly action: (previous: CampaignFormState, form: FormData) => Promise<CampaignFormState>;
};

/**
 * A campaign's form (Story 3.2), a page of its own in the main column: the name and, for a new campaign, the choice of
 * its system, then "Criar campanha" or "Salvar" (the screen's one solid pill) and "Cancelar". A refusal comes back as a
 * message under the field it is about (or under the form), with what was typed kept. A rename made on a stale version
 * comes back with the campaign's current name, and says so above the field. Without JavaScript the form still posts to
 * the Server Action.
 */
export function CampaignForm({ labels, initial, systems, id, cancelHref, action }: CampaignFormProps) {
  const [state, formAction, pending] = useActionState(action, initial);
  const base = useId();
  const errorId = (field: CampaignField) => `${base}-${field}-error`;
  const invalid = (field: CampaignField) => state.error !== null && state.field === field;
  const error = (field: CampaignField) =>
    invalid(field) ? (
      <p id={errorId(field)} role="alert" className={styles.error}>
        {state.error}
      </p>
    ) : null;
  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.stale && state.error !== null ? (
        <p role="alert" className={styles.stale}>
          {state.error}
        </p>
      ) : null}
      {id === undefined ? null : <input type="hidden" name="id" value={id} />}
      {state.version === null ? null : <input type="hidden" name="version" value={state.version} />}
      {/* Keyed by version: after a stale rename the field starts again from the campaign's current name. */}
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
            aria-invalid={invalid('name')}
            aria-describedby={invalid('name') ? errorId('name') : undefined}
          />
          {error('name')}
        </div>
        {systems === undefined ? null : (
          <div className={styles.field}>
            <label htmlFor={`${base}-systemId`} className={styles.label}>
              {labels.system}
            </label>
            <select
              id={`${base}-systemId`}
              name="systemId"
              className={styles.select}
              aria-required="true"
              defaultValue={state.values.systemId}
              aria-invalid={invalid('systemId')}
              aria-describedby={invalid('systemId') ? errorId('systemId') : undefined}
            >
              {systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.label}
                </option>
              ))}
            </select>
            {error('systemId')}
          </div>
        )}
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
