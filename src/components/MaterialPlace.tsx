'use client';

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from 'react';

import styles from './MaterialPlace.module.css';
import { PillButton } from './PillButton';
import { PlacePicker, type PlacePickerTexts } from './PlacePicker';
import { draftOf, placeOf, type Belonging, type Place, type PlaceDraft } from './uploads/types';

/**
 * What the place form shows after a save (Story 3.3): the version the next save names (null before any), the place to
 * show after a stale save (the material's current one), the refusal's text, whether the save was stale or went
 * through, a count of answers, and a count of those (saved or stale) that start the pickers again from what they say;
 * after any other refusal the GM's choice stays.
 */
export type PlaceFormState = {
  readonly version: number | null;
  readonly place: Place | null;
  readonly error: string | null;
  readonly stale: boolean;
  readonly saved: boolean;
  readonly serial: number;
  readonly reset: number;
};

export const NO_PLACE_ANSWER: PlaceFormState = { version: null, place: null, error: null, stale: false, saved: false, serial: 0, reset: 0 };

export type MaterialPlaceTexts = {
  readonly label: string;
  readonly change: string;
  readonly formLabel: string;
  readonly save: string;
  readonly cancel: string;
  readonly saved: string;
  readonly picker: PlacePickerTexts;
};

export type MaterialPlaceProps = {
  readonly id: string;
  /** The material's version as the page read it. */
  readonly version: number;
  /** Where it belongs, as a sentence ("Na campanha X, do sistema Y."). */
  readonly summary: string;
  /** Where it belongs, as the pickers hold it; null for none. */
  readonly place: Place | null;
  /** What can be picked: the campaigns in use and the systems. */
  readonly places: Belonging;
  /** Why there is nothing to pick (the campaigns and systems could not be loaded), shown instead of "Alterar"; or null. */
  readonly unavailable?: string | null;
  readonly texts: MaterialPlaceTexts;
  readonly action: (previous: PlaceFormState, form: FormData) => Promise<PlaceFormState>;
};

/**
 * A material page's "Onde pertence" (Story 3.3): where the material belongs, in a sentence, and "Alterar", which opens a
 * form with the three rows of {@link PlacePicker} ("Uma campanha", "Um sistema", "Vários sistemas"), starting from where
 * it belongs now; a place the pickers cannot show (an archived campaign, a system not offered) or no place opens with
 * nothing picked, and "Em nenhum lugar" is never offered. "Salvar", enabled only once a place is picked, posts it to a
 * Server Action on the version the page read; once saved the form closes, the page shows the new place and a polite
 * status says "Vale a partir da próxima pergunta.". A stale save keeps the form open on the material's current place,
 * with the stale line; any other refusal shows its text, the choice kept. When the campaigns and systems could not be
 * loaded, the reason shows instead of "Alterar".
 */
export function MaterialPlace({ id, version, summary, place, places, unavailable = null, texts, action }: MaterialPlaceProps) {
  const [state, formAction, pending] = useActionState(action, NO_PLACE_ANSWER);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
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
  const next = Math.max(version, state.version ?? -1);
  const from = state.stale ? state.place : place;
  return (
    <section className={styles.section} aria-labelledby="material-place">
      <h2 id="material-place" className={styles.label}>
        {texts.label}
      </h2>
      <p className={styles.summary}>{summary}</p>
      {open ? (
        <form className={styles.form} aria-label={texts.formLabel} onSubmit={(event) => submit(event, formAction)}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={next} />
          <PlaceFields
            key={state.reset}
            places={places}
            from={from}
            texts={texts}
            error={state.error}
            pending={pending}
            onCancel={() => setOpen(false)}
          />
        </form>
      ) : unavailable === null ? (
        <PillButton ref={change} onClick={() => setOpen(true)}>
          {texts.change}
        </PillButton>
      ) : (
        <p className={styles.error}>{unavailable}</p>
      )}
      <p role="status" className={styles.status}>
        {state.saved && !open ? texts.saved : ''}
      </p>
    </section>
  );
}

/**
 * Posts the form to the action without React's reset of a form after its action, which would put the pickers' selects
 * back to their first option while their state still names the chosen one (a stale answer keeps the form open).
 */
function submit(event: FormEvent<HTMLFormElement>, formAction: (form: FormData) => void) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  startTransition(() => formAction(form));
}

type PlaceFieldsProps = {
  readonly places: Belonging;
  readonly from: Place | null;
  readonly texts: MaterialPlaceTexts;
  readonly error: string | null;
  readonly pending: boolean;
  readonly onCancel: () => void;
};

/**
 * The pickers, from a place, with the refusal and the form's pills; a saved or stale answer starts them again (its
 * `key`). "Salvar" waits for a place.
 */
function PlaceFields({ places, from, texts, error, pending, onCancel }: PlaceFieldsProps) {
  const [draft, setDraft] = useState<PlaceDraft>(() => draftOf(places, from, false));
  const picked = placeOf(draft);
  return (
    <>
      <PlacePicker places={places} draft={draft} onChange={setDraft} texts={texts.picker} name="belonging" allowNone={false} />
      {draft.choice === 'systems' && draft.systems.length === 0 ? <p className={styles.note}>{texts.picker.systemsRequired}</p> : null}
      {error === null ? null : (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <PillButton type="submit" disabled={pending || picked === null || picked.choice === 'none'} pending={pending}>
          {texts.save}
        </PillButton>
        <PillButton onClick={onCancel}>{texts.cancel}</PillButton>
      </div>
    </>
  );
}
