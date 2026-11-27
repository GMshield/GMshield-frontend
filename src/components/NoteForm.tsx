'use client';

import { unstable_rethrow } from 'next/navigation';
import { startTransition, useActionState, useCallback, useEffect, useId, useRef, useState } from 'react';

import type { NoteFormState } from '@/app/(signed-in)/campaigns/[id]/shields/form-state';

import { SolidPillButton } from './PillButton';
import { PillLink } from './PillLink';
import statusStyles from './RecordCorrection.module.css';
import styles from './SystemForm.module.css';
import { useOnline } from './useOnline';

export type NoteFormLabels = {
  readonly name: string;
  readonly content: string;
  readonly submit: string;
  readonly cancel: string;
  /** The line said while the browser has no connection: "Sem conexão". */
  readonly offline: string;
};

export type NoteFormProps = {
  /** Every text, in the interface's language (the server translates). */
  readonly labels: NoteFormLabels;
  /** The values to start from: empty for a new note. */
  readonly initial: NoteFormState;
  /** The Shield's campaign. */
  readonly campaignId: string;
  /** The Shield the note is written in. */
  readonly shieldId: string;
  /** Where "Cancelar" goes: the Shield's screen. */
  readonly cancelHref: string;
  readonly action: (previous: NoteFormState, form: FormData) => Promise<NoteFormState>;
};

/**
 * A new note's form (Story 6.2), a page of its own in the main column: "Título" (a bordered field) and "Texto" (a
 * bordered free text), then "Salvar nota" (the screen's one solid pill) and "Cancelar". A refusal comes back as a message
 * under the field it is about (or under the form), and that field takes the focus. What is typed lives in this
 * component's state, so it is never lost to a refusal or to a lost connection: while the browser has none
 * ({@link useOnline}) a status line says "Sem conexão" and "Salvar nota" is `aria-disabled` and sends nothing; once the
 * connection is back it saves again. A post that fails on its way (the connection dropped while the browser still said
 * it had one, the server restarting) says "Sem conexão" under the form instead of leaving the page, with the text kept.
 * Nothing goes to browser storage.
 */
export function NoteForm({ labels, initial, campaignId, shieldId, cancelHref, action }: NoteFormProps) {
  const online = useOnline();
  // A post that never got an answer comes back as a refusal of the whole form, so the page (and the text) stays.
  const guarded = useCallback(
    async (previous: NoteFormState, form: FormData): Promise<NoteFormState> => {
      try {
        return await action(previous, form);
      } catch (error) {
        // A redirect or a not-found is how a saved note leaves: never caught here.
        unstable_rethrow(error);
        return { ...previous, serial: previous.serial + 1, error: labels.offline, field: null };
      }
    },
    [action, labels.offline],
  );
  const [state, dispatch, pending] = useActionState(guarded, initial);
  const [name, setName] = useState(initial.values.name);
  const [content, setContent] = useState(initial.values.content);
  const base = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const contentInput = useRef<HTMLTextAreaElement>(null);
  const nameError = state.error !== null && state.field === 'name';
  const contentError = state.error !== null && state.field === 'content';

  useEffect(() => {
    // A refusal about a field: the focus goes to it, so its message is read with it.
    if (state.serial > 0 && state.field === 'name') {
      nameInput.current?.focus();
    } else if (state.serial > 0 && state.field === 'content') {
      contentInput.current?.focus();
    }
  }, [state.serial, state.field]);

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // Without a connection nothing is sent: the text stays as typed until it is back.
        if (!online || pending) {
          return;
        }
        const data = new FormData();
        data.set('campaign', campaignId);
        data.set('shield', shieldId);
        data.set('name', name);
        data.set('content', content);
        startTransition(() => dispatch(data));
      }}
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor={`${base}-name`} className={styles.label}>
            {labels.name}
          </label>
          {/* No maxLength: the backend counts code points after trimming, and its field problem decides. */}
          <input
            ref={nameInput}
            id={`${base}-name`}
            name="name"
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-required="true"
            autoComplete="off"
            aria-invalid={nameError}
            aria-describedby={nameError ? `${base}-name-error` : undefined}
          />
          {nameError ? (
            <p id={`${base}-name-error`} role="alert" className={styles.error}>
              {state.error}
            </p>
          ) : null}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${base}-content`} className={styles.label}>
            {labels.content}
          </label>
          <textarea
            ref={contentInput}
            id={`${base}-content`}
            name="content"
            className={styles.textarea}
            value={content}
            rows={8}
            onChange={(event) => setContent(event.target.value)}
            aria-invalid={contentError}
            aria-describedby={contentError ? `${base}-content-error` : undefined}
          />
          {contentError ? (
            <p id={`${base}-content-error`} role="alert" className={styles.error}>
              {state.error}
            </p>
          ) : null}
        </div>
      </div>
      {state.error !== null && state.field === null ? (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <SolidPillButton type="submit" disabled={pending} pending={pending} aria-disabled={!online || undefined}>
          {labels.submit}
        </SolidPillButton>
        <PillLink href={cancelHref}>{labels.cancel}</PillLink>
        {/* Beside the pill it blocks, so it is seen where the GM presses. */}
        <p role="status" className={`${statusStyles.status} ${statusStyles.besidePills}`}>
          {online ? '' : labels.offline}
        </p>
      </div>
    </form>
  );
}
