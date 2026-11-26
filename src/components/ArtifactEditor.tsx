'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import {
  NO_ARTIFACT_EDIT,
  type ArtifactEditState,
  type ArtifactFormField,
  type ArtifactFormValues,
} from '@/app/(signed-in)/campaigns/[id]/artifacts/form-state';

import { PillButton, SolidPillButton } from './PillButton';
import styles from './RecordCorrection.module.css';
import { RecordFieldsEditor, editorRows, type EditorDraft, type EditorTypeOption, type RecordFieldsEditorTexts } from './RecordFieldsEditor';
import formStyles from './SystemForm.module.css';

/** Every text of the editor, in the interface's language (the server translates). */
export type ArtifactEditorTexts = RecordFieldsEditorTexts & {
  readonly open: string;
  readonly form: string;
  readonly content: string;
  readonly save: string;
  readonly cancel: string;
  readonly stale: string;
  readonly viewCurrent: string;
  readonly keepMine: string;
  /** The line said once a save is stored: "Vale a partir da próxima pergunta." */
  readonly saved: string;
};

export type ArtifactEditorProps = {
  readonly campaignId: string;
  readonly artifactId: string;
  /** The artifact's newest version as the page read it: an edit is made on it. */
  readonly version: number;
  /** The newest version's type key, name, fields and content as the page read them: the form starts from them. */
  readonly values: ArtifactFormValues;
  /** The record types of the campaign's system, core and approved, each named as this interface names it. */
  readonly types: readonly EditorTypeOption[];
  readonly texts: ArtifactEditorTexts;
  readonly action: (previous: ArtifactEditState, form: FormData) => Promise<ArtifactEditState>;
  /** The artifact's fields and content as the page draws them, shown until the GM chooses "Editar". */
  readonly children?: ReactNode;
};

function fill(text: string, params: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));
}

/**
 * An artifact's edit in place (Story 5.2), on its page, modelled on a record's correction ({@link RecordCorrection}):
 * the artifact's fields and content (`children`) and "Editar", which opens a form in their place with the name, the
 * type (a select of the campaign's system's record types), the fields ({@link RecordFieldsEditor}) and "Conteúdo" (a
 * bordered free text), then "Salvar" (the one solid pill) and "Cancelar". A saved edit closes the form, a toast says
 * "Artefato atualizado.", the page is read again with the new version, and a status line says "Vale a partir da
 * próxima pergunta.". A refusal shows under the part it is about, with what was typed kept. An edit the backend finds
 * stale says "Este item mudou em outra aba." with "Ver a versão atual" (the page read again, the form closed) and
 * "Manter a minha como nova versão" (the draft sent again on the newest version). Every part is reachable from the
 * keyboard: the form takes the focus on the name, and "Editar" gets it back when the form closes. Nothing here deletes.
 */
export function ArtifactEditor({ campaignId, artifactId, version, values, types, texts, action, children }: ArtifactEditorProps) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(action, NO_ARTIFACT_EDIT);
  // The answer the form opened after (null: closed): an edit saved since then closes it.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditorDraft>({ name: '', recordType: '', rows: [] });
  const [content, setContent] = useState('');
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
  useEffect(() => {
    // A refusal about the content: the focus goes to it (the editor's own parts show theirs under them).
    if (answered && !state.stale && state.field === 'content') {
      document.getElementById(`${id}-content`)?.focus();
    }
  }, [answered, state.serial, state.stale, state.field, id]);

  const start = () => {
    setDraft({ name: values.name, recordType: values.recordType, rows: editorRows(values.fields) });
    setContent(values.content);
    // Right after a save the page may not have brought the new version yet: the saved one is the newer.
    setBase(state.saved && state.currentVersion !== null ? Math.max(version, state.currentVersion) : version);
    setOpenedAt(state.serial);
  };
  const send = (on: number) => {
    const data = new FormData();
    data.set('campaignId', campaignId);
    data.set('artifactId', artifactId);
    data.set('version', String(on));
    data.set('name', draft.name);
    data.set('recordType', draft.recordType);
    for (const row of draft.rows) {
      data.append('fieldName', row.name);
      data.append('fieldValue', row.value);
    }
    data.set('content', content);
    setBase(on);
    startTransition(() => dispatch(data));
  };

  if (!open) {
    return (
      <>
        {children}
        <div className={styles.toolbar}>
          <PillButton ref={opener} onClick={start}>
            {texts.open}
          </PillButton>
        </div>
        <p role="status" className={styles.status}>
          {state.saved && openedAt !== null ? texts.saved : ''}
        </p>
      </>
    );
  }

  const shown = (field: ArtifactFormField) => answered && !state.stale && state.error !== null && state.field === field;
  const contentError = shown('content') ? `${id}-content-error` : undefined;
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
      <div className={formStyles.field}>
        <label htmlFor={`${id}-content`} className={formStyles.label}>
          {texts.content}
        </label>
        {/* No maxLength: the backend counts code points after trimming, and its field problem decides. */}
        <textarea
          id={`${id}-content`}
          className={formStyles.textarea}
          value={content}
          rows={4}
          onChange={(event) => setContent(event.target.value)}
          aria-invalid={shown('content')}
          aria-describedby={contentError}
        />
        {contentError === undefined ? null : (
          <p id={contentError} role="alert" className={formStyles.error}>
            {state.error}
          </p>
        )}
      </div>
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
