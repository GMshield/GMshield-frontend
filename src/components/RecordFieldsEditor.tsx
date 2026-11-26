'use client';

import { useEffect, useRef, type Ref } from 'react';

import { PillButton } from './PillButton';
import styles from './RecordCorrection.module.css';
import formStyles from './SystemForm.module.css';

/** A record type the editor offers: its key and its name as this interface shows it. */
export type EditorTypeOption = { readonly key: string; readonly label: string };

/**
 * The part of the editor a refusal is about: the name, the type, the fields as a whole, or one field's name or value by
 * its position from 0.
 */
export type EditorField = 'name' | 'recordType' | 'fields' | `fieldName:${number}` | `fieldValue:${number}`;

/** A field row as the editor holds it, with a key of its own: two rows may hold the same name and value. */
export type EditorRow = { readonly key: number; readonly name: string; readonly value: string };

/** What the editor edits: the record's name, its type's key and its field rows, in order. */
export type EditorDraft = { readonly name: string; readonly recordType: string; readonly rows: readonly EditorRow[] };

/** Every text of the editor, in the interface's language (the server translates). */
export type RecordFieldsEditorTexts = {
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
};

export type RecordFieldsEditorProps = {
  /** The base of the editor's element ids (the form's `useId`). */
  readonly id: string;
  readonly draft: EditorDraft;
  /** Applies a change to the draft the parent holds. */
  readonly onChange: (change: (before: EditorDraft) => EditorDraft) => void;
  /** The record types offered; the draft's own type comes first when they lack it. */
  readonly types: readonly EditorTypeOption[];
  readonly texts: RecordFieldsEditorTexts;
  /** The refusal to show under a part of the editor, or null. */
  readonly errorOf: (field: EditorField) => string | null;
  /** The name's input, so the parent can give it the focus. */
  readonly nameRef?: Ref<HTMLInputElement>;
};

/** The focus target after the last field row is removed: "Adicionar campo". */
const ADD = -1;

function fill(text: string, params: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));
}

/** The rows of `fields`, keyed from 0: the draft an editor starts from. */
export function editorRows(fields: readonly { readonly name: string; readonly value: string }[]): EditorRow[] {
  return fields.map((field, key) => ({ key, name: field.name, value: field.value }));
}

/**
 * The editable body of a record (Story 4.5, shared from Story 5.1): the name, the type (a select of the record types
 * offered) and the fields, each a bordered name and value with "Remover campo", then "Adicionar campo". A refusal shows
 * under the part it is about. A new field takes the focus on its name; a removed one gives it to the row that takes its
 * place, else the one before, else "Adicionar campo". The inputs carry form names (`name`, `recordType`, `fieldName`
 * and `fieldValue`, the fields in order), so a form posts them as they are shown. Used by a record's correction
 * ({@link RecordCorrection}) and by a new artifact's form.
 */
export function RecordFieldsEditor({ id, draft, onChange, types, texts, errorOf, nameRef }: RecordFieldsEditorProps) {
  const addButton = useRef<HTMLButtonElement>(null);
  const focusRow = useRef<number | null>(null);

  useEffect(() => {
    if (focusRow.current === ADD) {
      addButton.current?.focus();
    } else if (focusRow.current !== null) {
      document.getElementById(`${id}-field-${focusRow.current}-name`)?.focus();
    }
    focusRow.current = null;
  }, [draft.rows, id]);

  const change = (key: number, part: 'name' | 'value', text: string) =>
    onChange((before) => ({ ...before, rows: before.rows.map((row) => (row.key === key ? { ...row, [part]: text } : row)) }));
  const add = () => {
    const key = draft.rows.reduce((most, row) => Math.max(most, row.key), -1) + 1;
    focusRow.current = key;
    onChange((before) => ({ ...before, rows: [...before.rows, { key, name: '', value: '' }] }));
  };
  const remove = (key: number) => {
    const at = draft.rows.findIndex((row) => row.key === key);
    const rows = draft.rows.filter((row) => row.key !== key);
    // The focus goes to the row that takes its place, else the one before, else "Adicionar campo".
    const next = rows[Math.min(at, rows.length - 1)];
    focusRow.current = next === undefined ? ADD : next.key;
    onChange((before) => ({ ...before, rows: before.rows.filter((row) => row.key !== key) }));
  };

  const errorId = (field: EditorField) => `${id}-${field.replace(':', '-')}-error`;
  const describedBy = (field: EditorField) => (errorOf(field) === null ? undefined : errorId(field));
  const error = (field: EditorField) => {
    const text = errorOf(field);
    return text === null ? null : (
      <p id={errorId(field)} role="alert" className={formStyles.error}>
        {text}
      </p>
    );
  };
  const offered = types.some((type) => type.key === draft.recordType) ? types : [{ key: draft.recordType, label: draft.recordType }, ...types];
  return (
    <div className={formStyles.fields}>
      <div className={formStyles.field}>
        <label htmlFor={`${id}-name`} className={formStyles.label}>
          {texts.name}
        </label>
        <input
          ref={nameRef}
          id={`${id}-name`}
          name="name"
          className={formStyles.input}
          value={draft.name}
          onChange={(event) => onChange((before) => ({ ...before, name: event.target.value }))}
          aria-required
          autoComplete="off"
          aria-invalid={errorOf('name') !== null}
          aria-describedby={describedBy('name')}
        />
        {error('name')}
      </div>
      <div className={formStyles.field}>
        <label htmlFor={`${id}-type`} className={formStyles.label}>
          {texts.type}
        </label>
        <select
          id={`${id}-type`}
          name="recordType"
          className={formStyles.select}
          value={draft.recordType}
          onChange={(event) => onChange((before) => ({ ...before, recordType: event.target.value }))}
          aria-invalid={errorOf('recordType') !== null}
          aria-describedby={describedBy('recordType')}
        >
          {offered.map((type) => (
            <option key={type.key} value={type.key}>
              {type.label}
            </option>
          ))}
        </select>
        {error('recordType')}
      </div>
      <fieldset className={styles.group} aria-describedby={describedBy('fields')}>
        <legend className={formStyles.label}>{texts.fields}</legend>
        {draft.rows.length === 0 ? <p className={styles.none}>{texts.noFields}</p> : null}
        {draft.rows.length === 0 ? null : (
          <div className={styles.heads} aria-hidden="true">
            <span>{texts.fieldName}</span>
            <span>{texts.fieldValue}</span>
          </div>
        )}
        <ol className={styles.rows}>
          {draft.rows.map((row, index) => {
            const number = index + 1;
            const nameField: EditorField = `fieldName:${index}`;
            const valueField: EditorField = `fieldValue:${index}`;
            return (
              <li key={row.key} className={styles.row}>
                <input
                  id={`${id}-field-${row.key}-name`}
                  name="fieldName"
                  className={formStyles.input}
                  value={row.name}
                  onChange={(event) => change(row.key, 'name', event.target.value)}
                  aria-label={fill(texts.fieldNameOf, { number })}
                  placeholder={texts.fieldName}
                  autoComplete="off"
                  aria-invalid={errorOf(nameField) !== null}
                  aria-describedby={describedBy(nameField)}
                />
                <textarea
                  name="fieldValue"
                  className={`${formStyles.textarea} ${styles.value}`}
                  value={row.value}
                  rows={1}
                  onChange={(event) => change(row.key, 'value', event.target.value)}
                  aria-label={fill(texts.fieldValueOf, { number })}
                  placeholder={texts.fieldValue}
                  aria-invalid={errorOf(valueField) !== null}
                  aria-describedby={describedBy(valueField)}
                />
                <PillButton variant="quiet" className={styles.remove} aria-label={fill(texts.removeFieldOf, { number })} onClick={() => remove(row.key)}>
                  {texts.removeField}
                </PillButton>
                {error(nameField)}
                {error(valueField)}
              </li>
            );
          })}
        </ol>
        {error('fields')}
        <div>
          <PillButton ref={addButton} onClick={add}>
            {texts.addField}
          </PillButton>
        </div>
      </fieldset>
    </div>
  );
}
