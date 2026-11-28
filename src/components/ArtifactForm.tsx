'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';

import type { ArtifactFormField, ArtifactFormState } from '@/app/(signed-in)/campaigns/[id]/artifacts/form-state';
import type { ArtifactFrom } from '@/app/(signed-in)/campaigns/[id]/artifacts/texts';

import { SolidPillButton } from './PillButton';
import { PillLink } from './PillLink';
import { RecordFieldsEditor, editorRows, type EditorDraft, type EditorTypeOption, type RecordFieldsEditorTexts } from './RecordFieldsEditor';
import formStyles from './SystemForm.module.css';

/** Every text of the form, in the interface's language (the server translates). */
export type ArtifactFormTexts = RecordFieldsEditorTexts & {
  readonly form: string;
  readonly content: string;
  readonly save: string;
  readonly cancel: string;
};

export type ArtifactFormProps = {
  /** The campaign the artifact is written in. */
  readonly campaignId: string;
  /** The record types of the campaign's system, core and approved, each named as this interface names it. */
  readonly types: readonly EditorTypeOption[];
  readonly texts: ArtifactFormTexts;
  /** The values to start from: the type chosen (`?type=`), nothing else. */
  readonly initial: ArtifactFormState;
  /**
   * Where the form was opened from, posted with it so the saved artifact leads back there: "Personagens", (Story 7.2)
   * the item encyclopedia, or none.
   */
  readonly from?: ArtifactFrom | null;
  /** Where "Cancelar" goes: the campaign's artifacts tab, or "Personagens". */
  readonly cancelHref: string;
  readonly action: (previous: ArtifactFormState, form: FormData) => Promise<ArtifactFormState>;
};

/**
 * A new artifact's form (Story 5.1), a page of its own in the main column: the record's editable body shared with a
 * record's correction ({@link RecordFieldsEditor}: the name, the type among the campaign's system's record types and
 * the fields, each with "Remover campo", then "Adicionar campo"), then "Conteúdo", a bordered free text, then "Salvar"
 * (the screen's one solid pill) and "Cancelar". Saved, the artifact's page opens with the toast "Artefato salvo.". A
 * refusal shows under the part it is about, with what was typed kept, and the focus goes to that part; one about the
 * whole form shows under it. The focus starts on the name. The inputs carry their form names, so the form posts them
 * as they are shown.
 */
export function ArtifactForm({ campaignId, types, texts, initial, from = null, cancelHref, action }: ArtifactFormProps) {
  const [state, formAction, pending] = useActionState(action, initial);
  const [draft, setDraft] = useState<EditorDraft>({
    name: initial.values.name,
    recordType: initial.values.recordType,
    rows: editorRows(initial.values.fields),
  });
  const [content, setContent] = useState(initial.values.content);
  const id = useId();
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  useEffect(() => {
    // A refusal: the focus goes to the part it is about (the name's input, the type, a field's name or value).
    if (state.serial === 0 || state.field === null) {
      return;
    }
    const field = state.field;
    const target =
      field === 'content'
        ? document.getElementById(`${id}-content`)
        : document.querySelector<HTMLElement>(`[aria-describedby="${id}-${field.replace(':', '-')}-error"]`);
    target?.focus();
  }, [state.serial, state.field, id]);

  const shown = (field: ArtifactFormField) => state.error !== null && state.field === field;
  const contentError = shown('content') ? `${id}-content-error` : undefined;
  return (
    <form action={formAction} className={formStyles.form} aria-label={texts.form} noValidate>
      <input type="hidden" name="campaignId" value={campaignId} />
      {from === null ? null : <input type="hidden" name="from" value={from} />}
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
          name="content"
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
      {state.error !== null && state.field === null ? (
        <p role="alert" className={formStyles.error}>
          {state.error}
        </p>
      ) : null}
      <div className={formStyles.actions}>
        <SolidPillButton type="submit" disabled={pending} pending={pending}>
          {texts.save}
        </SolidPillButton>
        <PillLink href={cancelHref}>{texts.cancel}</PillLink>
      </div>
    </form>
  );
}
