'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { PillButton } from '../PillButton';
import type { OverrideActionState } from './ArtifactOverride';
import styles from './NoteMove.module.css';

const INITIAL: OverrideActionState = { serial: 0, done: false, error: null };

/** Another live Shield of the note's campaign, as the move offers it: its id and its name, already in words. */
export type MoveShield = { readonly id: string; readonly label: string };

export type NoteMoveTexts = {
  /** The pill that opens the move. */
  readonly move: string;
  /** The select's label ("Mover para"). */
  readonly moveTo: string;
  /** The one sentence shown instead of the select when the campaign has no other Shield. */
  readonly none: string;
  /** The form's solid pill. */
  readonly submit: string;
  readonly cancel: string;
};

export type NoteMoveProps = {
  readonly campaignId: string;
  readonly artifactId: string;
  /** "No escudo «…»", already in words, and where it leads (the Shield's screen). */
  readonly inShield: string;
  readonly shieldHref: string;
  /** The campaign's other live Shields, in the order shown. */
  readonly shields: readonly MoveShield[];
  readonly texts: NoteMoveTexts;
  /** The Server Action the move posts to: `campaignId`, `artifactId` and `shieldId`. */
  readonly action: (previous: OverrideActionState, form: FormData) => Promise<OverrideActionState>;
};

/**
 * "No escudo «…»" on a held note's current-version page (Story 6.2 part B), with a "Mover" pill beside it. The pill
 * opens an inline form: a bordered select of the campaign's other live Shields (or, with none, one sentence saying so),
 * a solid "Mover" pill and "Cancelar". "Mover" posts the chosen Shield through its Server Action, whose toast confirms
 * the move while the page stays and is read again (the page mounts this again under the new Shield). A refusal shows
 * under the form as an alert. The select takes the focus when the form opens, and "Cancelar" gives it back to "Mover".
 */
export function NoteMove({ campaignId, artifactId, inShield, shieldHref, shields, texts, action }: NoteMoveProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const errorId = useId();
  const [chosen, setChosen] = useState(shields[0]?.id ?? '');
  useEffect(() => {
    if (open) {
      // The select, or with no other Shield the form's "Cancelar".
      (select.current ?? cancel.current)?.focus();
    }
  }, [open]);
  const close = () => {
    setOpen(false);
    // Back to the pill that opened the form, once it is there again.
    queueMicrotask(() => opener.current?.focus());
  };
  const shownError = state.error === null || state.serial === 0 ? null : state.error;
  return (
    <div className={styles.block}>
      <div className={styles.line}>
        <p className={styles.origin}>
          <Link className={styles.originLink} href={shieldHref}>
            {inShield}
          </Link>
        </p>
        {open ? null : (
          <PillButton ref={opener} onClick={() => setOpen(true)}>
            {texts.move}
          </PillButton>
        )}
      </div>
      {open ? (
        <form className={styles.inline} action={formAction} aria-describedby={shownError === null ? undefined : errorId}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="artifactId" value={artifactId} />
          {shields.length === 0 ? (
            <p className={styles.note}>{texts.none}</p>
          ) : (
            <>
              <label className={styles.fieldLabel} htmlFor={fieldId}>
                {texts.moveTo}
              </label>
              <select
                ref={select}
                id={fieldId}
                className={styles.select}
                name="shieldId"
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                required
              >
                {shields.map((shield) => (
                  <option key={shield.id} value={shield.id}>
                    {shield.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className={styles.pills}>
            {shields.length === 0 ? null : (
              <PillButton type="submit" variant="solid" pending={pending} disabled={pending}>
                {texts.submit}
              </PillButton>
            )}
            <PillButton ref={cancel} onClick={close}>
              {texts.cancel}
            </PillButton>
          </div>
        </form>
      ) : null}
      {shownError === null ? null : (
        <p id={errorId} role="alert" className={styles.error}>
          {shownError}
        </p>
      )}
    </div>
  );
}
