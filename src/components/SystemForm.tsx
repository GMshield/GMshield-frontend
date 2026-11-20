'use client';

import { useActionState, useId } from 'react';

import type { SystemField, SystemFormState } from '@/app/(signed-in)/systems/form-state';

import { SolidPillButton } from './PillButton';
import { PillLink } from './PillLink';
import styles from './SystemForm.module.css';

export type SystemFormLabels = {
  readonly name: string;
  readonly edition: string;
  readonly description: string;
  readonly submit: string;
  readonly cancel: string;
};

export type SystemFormProps = {
  /** Every text, in the interface's language (the server translates). */
  readonly labels: SystemFormLabels;
  /** The values and the version to start from: empty for a new system, the system's own for an edit. */
  readonly initial: SystemFormState;
  /** The system's id, for an edit; absent for a new system. */
  readonly id?: string;
  /** Where "Cancelar" goes. */
  readonly cancelHref: string;
  readonly action: (previous: SystemFormState, form: FormData) => Promise<SystemFormState>;
};

/** The limits the backend checks, given to the fields as well (Story 3.1). */
const MAX: Readonly<Record<SystemField, number>> = { name: 120, edition: 60, description: 2000 };

/**
 * A system's form (Story 3.1), a page of its own in the main column: the name, the optional edition and description,
 * then "Criar sistema" or "Salvar" (the screen's one solid pill) and "Cancelar". A refusal comes back as a message under
 * the field it is about (or under the form), with what was typed kept. An edit made on a stale version comes back with
 * the system's current values, and says so above the fields. Without JavaScript the form still posts to the Server
 * Action.
 */
export function SystemForm({ labels, initial, id, cancelHref, action }: SystemFormProps) {
  const [state, formAction, pending] = useActionState(action, initial);
  const base = useId();
  const errorId = (field: SystemField) => `${base}-${field}-error`;
  const invalid = (field: SystemField) => state.error !== null && state.field === field;
  const field = (name: SystemField, multiline: boolean) => {
    const common = {
      id: `${base}-${name}`,
      name,
      maxLength: MAX[name],
      defaultValue: state.values[name],
      'aria-invalid': invalid(name),
      'aria-describedby': invalid(name) ? errorId(name) : undefined,
    };
    return (
      <div className={styles.field}>
        <label htmlFor={`${base}-${name}`} className={styles.label}>
          {labels[name]}
        </label>
        {multiline ? <textarea {...common} className={styles.textarea} rows={5} /> : <input {...common} className={styles.input} />}
        {invalid(name) ? (
          <p id={errorId(name)} role="alert" className={styles.error}>
            {state.error}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.stale && state.error !== null ? (
        <p role="alert" className={styles.stale}>
          {state.error}
        </p>
      ) : null}
      {id === undefined ? null : <input type="hidden" name="id" value={id} />}
      {state.version === null ? null : <input type="hidden" name="version" value={state.version} />}
      {/* Keyed by version: after a stale edit the fields start again from the system's current values. */}
      <div key={state.version ?? 'new'} className={styles.fields}>
        {field('name', false)}
        {field('edition', false)}
        {field('description', true)}
      </div>
      {!state.stale && state.error !== null && state.field === null ? (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <SolidPillButton type="submit" disabled={pending}>
          {labels.submit}
        </SolidPillButton>
        <PillLink href={cancelHref}>{labels.cancel}</PillLink>
      </div>
    </form>
  );
}
