'use client';

import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { NO_PARTY_ANSWER, type PartyField, type PartyFormState } from '@/app/(signed-in)/campaigns/form-state';

import styles from './PartyForm.module.css';
import { PillButton } from './PillButton';
import formStyles from './SystemForm.module.css';

export type PartyFormTexts = {
  readonly label: string;
  readonly change: string;
  readonly formLabel: string;
  readonly size: string;
  readonly level: string;
  readonly emptyHint: string;
  readonly levelHint: string;
  readonly save: string;
  readonly cancel: string;
};

export type PartyFormProps = {
  readonly id: string;
  /** The campaign's version as the page read it. */
  readonly version: number;
  /** The party as the page read it; null for not set. */
  readonly size: number | null;
  readonly level: number | null;
  /** The sentence on what the values are for, shown while either is not set; null when both are set. */
  readonly purpose: string | null;
  readonly texts: PartyFormTexts;
  readonly action: (previous: PartyFormState, form: FormData) => Promise<PartyFormState>;
};

/**
 * The party of a campaign's overview (Story 7.1), below its details, which show "Jogadores" and "Nível do grupo": the
 * sentence on what they are for while either is not set, then "Alterar", which opens an inline form with two bordered
 * number fields (empty: not set) on the version the page read. Once saved, the toast says the change applies from the
 * next question, the page is refreshed (the details show the new values), the form closes and focus goes back to
 * "Alterar". A refusal stays beside its field (or under the form), what was typed kept. A stale save keeps the form open
 * on the campaign's current values, and says so above the fields. Only an answer to a save made since the form opened
 * is shown: after "Cancelar", the form opens again on the page's values, with no earlier refusal or stale line.
 */
export function PartyForm({ id, version, size, level, purpose, texts, action }: PartyFormProps) {
  const [state, formAction, pending] = useActionState(action, NO_PARTY_ANSWER);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  // The answer count when the form last opened: an older answer belongs to a form that was closed.
  const [openedAt, setOpenedAt] = useState(0);
  // An answer closes the form once saved (state adjusted while rendering, not in an effect).
  if (state.serial !== seen) {
    setSeen(state.serial);
    if (state.saved) {
      setOpen(false);
    }
  }
  // Once saved, focus goes back to "Alterar", which takes the place of the form.
  const change = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state.saved) {
      change.current?.focus();
    }
  }, [state]);
  const answer = state.serial > openedAt ? state : NO_PARTY_ANSWER;
  const next = Math.max(version, answer.version ?? -1);
  const from = answer.stale ? { size: answer.size, level: answer.level } : { size, level };
  return (
    <section className={styles.party} aria-label={texts.label}>
      {purpose === null ? null : <p className={styles.purpose}>{purpose}</p>}
      {open ? (
        <form className={styles.form} aria-label={texts.formLabel} noValidate onSubmit={(event) => submit(event, formAction)}>
          {answer.stale && answer.error !== null ? (
            <p role="alert" className={formStyles.stale}>
              {answer.error}
            </p>
          ) : null}
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={next} />
          {/* Keyed by the answer's version: after a stale save the fields start again from the current values. */}
          <PartyFields key={answer.stale ? `stale-${next}` : 'typed'} from={from} state={answer} texts={texts} />
          {!answer.stale && answer.error !== null && answer.field === null ? (
            <p role="alert" className={formStyles.error}>
              {answer.error}
            </p>
          ) : null}
          <div className={styles.actions}>
            <PillButton type="submit" disabled={pending} pending={pending}>
              {texts.save}
            </PillButton>
            <PillButton onClick={() => setOpen(false)}>{texts.cancel}</PillButton>
          </div>
        </form>
      ) : (
        <PillButton
          ref={change}
          onClick={() => {
            setOpenedAt(state.serial);
            setOpen(true);
          }}
        >
          {texts.change}
        </PillButton>
      )}
    </section>
  );
}

/**
 * Posts the form to the action without React's reset of a form after its action, which would empty what the GM typed
 * while a refusal is shown beside it.
 */
function submit(event: FormEvent<HTMLFormElement>, formAction: (form: FormData) => void) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  startTransition(() => formAction(form));
}

type PartyFieldsProps = {
  readonly from: { readonly size: number | null; readonly level: number | null };
  readonly state: PartyFormState;
  readonly texts: PartyFormTexts;
};

/** The two fields, each with its label, its hint and the refusal about it. */
function PartyFields({ from, state, texts }: PartyFieldsProps) {
  const base = useId();
  const field = (name: PartyField, label: string, hint: string) => {
    const invalid = state.error !== null && state.field === name;
    const hintId = `${base}-${name}-hint`;
    const errorId = `${base}-${name}-error`;
    return (
      <div className={formStyles.field}>
        <label htmlFor={`${base}-${name}`} className={formStyles.label}>
          {label}
        </label>
        {/*
         * A text box that brings up the number keyboard: a number input would post a value it cannot read (a letter)
         * as empty, which here means "not set". The backend decides what is valid; the limits are only a hint.
         */}
        <input
          id={`${base}-${name}`}
          name={name}
          className={formStyles.input}
          inputMode="numeric"
          autoComplete="off"
          defaultValue={from[name] ?? ''}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
        />
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
        {invalid ? (
          <p id={errorId} role="alert" className={formStyles.error}>
            {state.error}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <div className={styles.fields}>
      {field('size', texts.size, texts.emptyHint)}
      {field('level', texts.level, texts.levelHint)}
    </div>
  );
}
