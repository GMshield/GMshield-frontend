'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { Language } from '@/messages';

import { ConfirmationDialog } from './ConfirmationDialog';
import { PillButton, SolidPillButton } from './PillButton';
import styles from './RecordCorrection.module.css';
import { RecordFieldsEditor, editorRows, type EditorDraft, type EditorField, type EditorTypeOption } from './RecordFieldsEditor';
import formStyles from './SystemForm.module.css';

/** A record's field as the form holds it. */
export type CorrectionFieldValue = { readonly name: string; readonly value: string };

/** What a correction sends: the record's name, its type's key and its fields, in order. */
export type CorrectionValues = {
  readonly name: string;
  readonly recordType: string;
  readonly fields: readonly CorrectionFieldValue[];
};

/**
 * The part of the form a refusal is about: the name, the type, the fields as a whole, or one field's name or value by
 * its position from 0; null for a refusal about the whole form.
 */
export type CorrectionField = EditorField;

/**
 * What a correction answered (Story 4.5); `serial` counts the answers. `saved`: the backend took it. `stale`: the
 * record changed in another tab and its `currentVersion` was read again, so "Manter a minha como nova versão" sends
 * the GM's edits (still in the form) again on that version. Otherwise `error` is a refusal's text and `field` its part.
 */
export type RecordCorrectionState = {
  readonly serial: number;
  readonly saved: boolean;
  readonly error: string | null;
  readonly field: CorrectionField | null;
  readonly stale: boolean;
  readonly currentVersion: number | null;
};

export const NO_CORRECTION: RecordCorrectionState = {
  serial: 0,
  saved: false,
  error: null,
  field: null,
  stale: false,
  currentVersion: null,
};

/** Where the record is corrected: on its system's page, or as the current campaign shows it (a search's result). */
export type CorrectionGround =
  | { readonly kind: 'system'; readonly systemId: string }
  | { readonly kind: 'campaign'; readonly campaignId: string };

/** A record type the form offers: its key and its name as this interface shows it. */
export type RecordTypeOption = EditorTypeOption;

/** Every text of the form, in the interface's language (the server translates). */
export type RecordCorrectionTexts = {
  readonly open: string;
  readonly form: string;
  readonly name: string;
  readonly type: string;
  readonly fields: string;
  readonly fieldName: string;
  readonly fieldValue: string;
  readonly fieldNameOf: string;
  readonly fieldValueOf: string;
  readonly noFields: string;
  readonly addField: string;
  readonly removeField: string;
  readonly removeFieldOf: string;
  readonly save: string;
  readonly cancel: string;
  readonly stale: string;
  readonly viewCurrent: string;
  readonly keepMine: string;
};

/** What a record's delete left to say (Story 4.5 part B): the text of the backend's refusal, or nothing (the page moved on). */
export type RecordDeleteState = { readonly error: string | null };

export const NO_DELETE: RecordDeleteState = { error: null };

/** The texts of a record's delete, in the interface's language: `title` holds `{name}`. */
export type RecordDeleteTexts = {
  readonly open: string;
  readonly title: string;
  readonly consequence: string;
  readonly confirm: string;
};

/**
 * "Excluir" beside "Corrigir" (Story 4.5 part B): its texts, its Server Action, and where the page goes once the record
 * is deleted, posted with it: the record type's list on a system's page (`recordTypeId`), the search on a search's page
 * (`back`, its address).
 */
export type RecordDeletion = {
  readonly texts: RecordDeleteTexts;
  /** The interface's language (the dialog's own words). */
  readonly language: Language;
  readonly action: (previous: RecordDeleteState, form: FormData) => Promise<RecordDeleteState>;
  /** Where the page goes once the record is deleted: its type's list, or the search it was opened from. */
  readonly after: { readonly recordTypeId: string } | { readonly back: string };
};

/** The page that offers no delete: never called. */
async function noDelete(previous: RecordDeleteState): Promise<RecordDeleteState> {
  return previous;
}

export type RecordCorrectionProps = {
  readonly ground: CorrectionGround;
  readonly recordId: string;
  /** The record's version as the page read it: a correction is made on it. */
  readonly version: number;
  /** The record's name, type key and fields as the page read them: the form starts from them. */
  readonly values: CorrectionValues;
  /** The record types of the page's system (the campaign's system on a search's page), core and approved. */
  readonly types: readonly RecordTypeOption[];
  readonly texts: RecordCorrectionTexts;
  readonly action: (previous: RecordCorrectionState, form: FormData) => Promise<RecordCorrectionState>;
  /** The record's fields as the page draws them, shown until the GM chooses "Corrigir". */
  readonly children?: ReactNode;
  /** "Excluir" beside "Corrigir" (Story 4.5 part B); none when absent. */
  readonly deletion?: RecordDeletion;
};

function fill(text: string, params: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));
}

/**
 * A record's correction (Story 4.5), on its system's page and on a search's record page: the record's fields
 * (`children`) and "Corrigir", which opens a form in their place with the record's name, its type (a select of the
 * page's system's record types) and its fields, each a bordered name and value with "Remover campo", then "Adicionar
 * campo", "Salvar" (the one solid pill) and "Cancelar". The page's header keeps the name until the correction is saved.
 * A saved correction closes the form, a toast says so and the page is read again. A refusal shows under the part it is
 * about, with what was typed kept. A correction the backend finds stale says "Este item mudou em outra aba." with "Ver
 * a versão atual" (the page read again, the form closed) and "Manter a minha como nova versão" (the GM's edits sent
 * again on the current version). Every part is reachable from the keyboard: the form takes the focus on the name, a new
 * field on its name, and "Corrigir" gets it back when the form closes.
 *
 * Story 5.1: the form's editable body (the name, the type and the field rows) is {@link RecordFieldsEditor}, shared with
 * a new artifact's form.
 *
 * Story 4.5 part B: with `deletion`, "Excluir" (a danger pill) sits beside "Corrigir" and opens the confirmation the way
 * a campaign's delete does ({@link ConfirmationDialog}: "Cancelar" or Esc closes it and focus goes back to "Excluir").
 * Confirmed, the record goes to the Server Action, which deletes it and moves the page on with the toast "Registro
 * excluído."; a refusal shows as an alert under the pills, and "Excluir" stays focusable (`aria-disabled`) while the
 * delete runs.
 */
export function RecordCorrection({ ground, recordId, version, values, types, texts, action, children, deletion }: RecordCorrectionProps) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(action, NO_CORRECTION);
  const [deleteState, deleteDispatch, deleting] = useActionState(deletion?.action ?? noDelete, NO_DELETE);
  const [confirming, setConfirming] = useState(false);
  // The answer the form opened after (null: closed): a correction saved since then closes it.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditorDraft>({ name: '', recordType: '', rows: [] });
  const [base, setBase] = useState(version);
  const opener = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const id = useId();
  const open = openedAt !== null && !(state.saved && state.serial > openedAt);
  const answered = openedAt !== null && state.serial > openedAt;

  useEffect(() => {
    if (open && !wasOpen.current) {
      nameInput.current?.focus();
    } else if (!open && wasOpen.current) {
      opener.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  const start = () => {
    setDraft({
      name: values.name,
      recordType: values.recordType,
      rows: editorRows(values.fields),
    });
    // Right after a save the page may not have brought the new version yet: the saved one is the newer.
    setBase(state.saved && state.currentVersion !== null ? Math.max(version, state.currentVersion) : version);
    setOpenedAt(state.serial);
  };
  const send = (on: number) => {
    const data = new FormData();
    data.set('ground', ground.kind);
    data.set('owner', ground.kind === 'system' ? ground.systemId : ground.campaignId);
    data.set('recordId', recordId);
    data.set('version', String(on));
    data.set('name', draft.name);
    data.set('recordType', draft.recordType);
    for (const row of draft.rows) {
      data.append('fieldName', row.name);
      data.append('fieldValue', row.value);
    }
    setBase(on);
    startTransition(() => dispatch(data));
  };
  const confirmDelete = () => {
    setConfirming(false);
    if (deletion === undefined) {
      return;
    }
    const data = new FormData();
    data.set('ground', ground.kind);
    data.set('owner', ground.kind === 'system' ? ground.systemId : ground.campaignId);
    data.set('recordId', recordId);
    if ('recordTypeId' in deletion.after) {
      data.set('recordTypeId', deletion.after.recordTypeId);
    } else {
      data.set('back', deletion.after.back);
    }
    startTransition(() => deleteDispatch(data));
  };

  if (!open) {
    return (
      <>
        {children}
        <div className={styles.toolbar}>
          <PillButton ref={opener} onClick={start} disabled={deleting}>
            {texts.open}
          </PillButton>
          {deletion === undefined ? null : (
            // aria-disabled, not disabled, while the delete runs: the dialog gives focus back here, and a refusal keeps it.
            <PillButton
              variant="danger"
              aria-haspopup="dialog"
              aria-disabled={deleting}
              pending={deleting}
              onClick={() => {
                if (!deleting) {
                  setConfirming(true);
                }
              }}
            >
              {deletion.texts.open}
            </PillButton>
          )}
        </div>
        {deletion === undefined || deleteState.error === null ? null : (
          <p role="alert" className={styles.deleteError}>
            {deleteState.error}
          </p>
        )}
        {deletion === undefined ? null : (
          <ConfirmationDialog
            open={confirming}
            title={fill(deletion.texts.title, { name: values.name })}
            consequence={deletion.texts.consequence}
            confirmLabel={deletion.texts.confirm}
            onConfirm={confirmDelete}
            language={deletion.language}
            onCancel={() => setConfirming(false)}
          />
        )}
      </>
    );
  }

  const shown = (field: CorrectionField) => answered && !state.stale && state.error !== null && state.field === field;
  return (
    <form
      className={formStyles.form}
      aria-label={fill(texts.form, { name: values.name })}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        send(base);
      }}
    >
      {answered && state.stale ? (
        <div role="alert" className={`${formStyles.stale} ${styles.stale}`}>
          <span>{texts.stale}</span>
          <div className={styles.choices}>
            <PillButton
              onClick={() => {
                setOpenedAt(null);
                router.refresh();
              }}
            >
              {texts.viewCurrent}
            </PillButton>
            <PillButton disabled={pending || state.currentVersion === null} onClick={() => state.currentVersion !== null && send(state.currentVersion)}>
              {texts.keepMine}
            </PillButton>
          </div>
        </div>
      ) : null}
      <RecordFieldsEditor
        id={id}
        draft={draft}
        onChange={setDraft}
        types={types}
        texts={texts}
        errorOf={(field) => (shown(field) ? state.error : null)}
        nameRef={nameInput}
      />
      {answered && !state.stale && state.error !== null && state.field === null ? (
        <p role="alert" className={formStyles.error}>
          {state.error}
        </p>
      ) : null}
      <div className={formStyles.actions}>
        <SolidPillButton type="submit" disabled={pending} pending={pending}>
          {texts.save}
        </SolidPillButton>
        <PillButton disabled={pending} onClick={() => setOpenedAt(null)}>
          {texts.cancel}
        </PillButton>
      </div>
    </form>
  );
}
