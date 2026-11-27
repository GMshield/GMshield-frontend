'use client';

import Link from 'next/link';
import type { Ref } from 'react';

import { errorText, problemFields, type Language, type Translate } from '@/messages';

import { PillButton, SolidPillButton } from '../PillButton';
import type { EditorTypeOption } from '../RecordFieldsEditor';
import formStyles from '../SystemForm.module.css';
import styles from './Conversation.module.css';

/** What the card saves (Story 5.4 part A): the name, the record type's key ('' for none chosen) and the content. */
export type SaveValues = { readonly name: string; readonly recordType: string; readonly content: string };

/** The parts of the card a refusal may name (`params.field`). */
export type SaveField = 'name' | 'recordType' | 'content';

const FIELDS: readonly SaveField[] = ['name', 'recordType', 'content'];

/** The part a refusal is about: a value outside its limits (`request.invalid` naming it), else none. */
export function saveFieldOf(problem: unknown): SaveField | null {
  const { code, params } = problemFields(problem);
  return code === 'request.invalid' ? (FIELDS.find((field) => field === params.field) ?? null) : null;
}

/**
 * The text of a refusal, as a new artifact's form says it (`artifacts.errors`, with the field's limits) for a value
 * outside its limits, and as every other refusal reads otherwise; never a code.
 */
export function saveRefusalText(problem: unknown, t: Translate, language: Language): string {
  const field = saveFieldOf(problem);
  return field === null ? errorText(problem, language) : t(`artifacts.errors.${field}`, problemFields(problem).params);
}

export type SaveConfirmationProps = {
  /** Prefixes the ids of the card's fields, so each turn's card has its own. */
  readonly idPrefix: string;
  readonly values: SaveValues;
  /** Every core and approved record type of the campaign's system, in its order, as named here. */
  readonly types: readonly EditorTypeOption[];
  /** Whether the draft's content is open for editing in place ("Editar conteúdo" pressed; it never closes it). */
  readonly editing: boolean;
  /** Whether "Salvar" was sent and has not answered. */
  readonly pending: boolean;
  /** The last refusal of "Salvar" or "Agora não", or null. */
  readonly problem: unknown;
  readonly t: Translate;
  readonly language: Language;
  /** The name's field, where focus goes when the card is offered again. */
  readonly nameRef?: Ref<HTMLInputElement>;
  readonly onChange: (values: SaveValues) => void;
  readonly onEdit: () => void;
  readonly onSave: () => void;
  readonly onDecline: () => void;
};

/**
 * The save confirmation under a finished draft (Story 5.4 part A, EXPERIENCE.md's "Save confirmation", DESIGN.md's card):
 * a surface card with a 1px accent outline, titled "Salvar como artefato?". It holds the bordered name and record type
 * fields (the type list is every core and approved type of the system, starting empty when the proposal has none),
 * then "Editar conteúdo" (opens the draft as a textarea in place, {@link SaveContentField}, which stays open, pressed,
 * until the draft is saved or declined, so what "Salvar" sends is always on screen), "Salvar" (the solid
 * pill, with its spinner while it is sent) and "Agora não". A refusal shows on its field (`aria-invalid`, its text tied
 * by `aria-describedby`), or under the buttons when it names none; what was typed stays. Every control is reached with
 * Tab; nothing here takes focus by itself.
 */
export function SaveConfirmation({
  idPrefix,
  values,
  types,
  editing,
  pending,
  problem,
  t,
  language,
  nameRef,
  onChange,
  onEdit,
  onSave,
  onDecline,
}: SaveConfirmationProps) {
  const field = problem === null ? null : saveFieldOf(problem);
  const text = problem === null ? null : saveRefusalText(problem, t, language);
  const errorId = (part: SaveField | 'card') => `${idPrefix}-${part}-error`;
  // A key the list does not have (a type removed since the draft finished) still shows as itself.
  const options = values.recordType === '' || types.some((type) => type.key === values.recordType)
    ? types
    : [...types, { key: values.recordType, label: values.recordType }];
  return (
    <section className={styles.saveCard} aria-labelledby={`${idPrefix}-title`} data-testid="save-card">
      <h2 id={`${idPrefix}-title`} className={styles.saveTitle}>
        {t('conversation.save.title')}
      </h2>
      <div className={styles.saveFields}>
        <div className={styles.saveField}>
          <label className={formStyles.label} htmlFor={`${idPrefix}-name`}>
            {t('conversation.save.name')}
          </label>
          <input
            ref={nameRef}
            id={`${idPrefix}-name`}
            className={formStyles.input}
            value={values.name}
            aria-invalid={field === 'name' || undefined}
            aria-describedby={field === 'name' ? errorId('name') : undefined}
            onChange={(event) => onChange({ ...values, name: event.target.value })}
          />
          {field === 'name' ? (
            <p id={errorId('name')} className={formStyles.error}>
              {text}
            </p>
          ) : null}
        </div>
        <div className={styles.saveField}>
          <label className={formStyles.label} htmlFor={`${idPrefix}-type`}>
            {t('conversation.save.type')}
          </label>
          <select
            id={`${idPrefix}-type`}
            className={formStyles.select}
            value={values.recordType}
            aria-invalid={field === 'recordType' || undefined}
            aria-describedby={field === 'recordType' ? errorId('recordType') : undefined}
            onChange={(event) => onChange({ ...values, recordType: event.target.value })}
          >
            <option value="">{t('conversation.save.noType')}</option>
            {options.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
          {field === 'recordType' ? (
            <p id={errorId('recordType')} className={formStyles.error}>
              {text}
            </p>
          ) : null}
        </div>
      </div>
      <div className={styles.saveActions}>
        <PillButton aria-pressed={editing} onClick={onEdit}>
          {t('conversation.save.editContent')}
        </PillButton>
        <SolidPillButton pending={pending} aria-disabled={pending || undefined} onClick={() => (pending ? undefined : onSave())}>
          {t('conversation.save.save')}
        </SolidPillButton>
        <PillButton onClick={onDecline} disabled={pending}>
          {t('conversation.save.decline')}
        </PillButton>
      </div>
      {text !== null && field === null ? (
        <p id={errorId('card')} className={formStyles.error} data-testid="save-problem">
          {text}
        </p>
      ) : null}
    </section>
  );
}

export type SaveContentFieldProps = {
  readonly idPrefix: string;
  readonly value: string;
  /** The refusal of the content (too long), or null. */
  readonly error: string | null;
  readonly t: Translate;
  readonly onChange: (content: string) => void;
};

/**
 * Story 5.4 part A: "Editar conteúdo" turns the draft into this bordered textarea, in its place, with no dialog: the
 * Markdown as written, which the artifact keeps (the turn itself keeps the agent's text). A refusal of the content
 * shows under it.
 */
export function SaveContentField({ idPrefix, value, error, t, onChange }: SaveContentFieldProps) {
  const errorId = `${idPrefix}-content-error`;
  return (
    <div className={styles.saveContent}>
      <label className={formStyles.label} htmlFor={`${idPrefix}-content`}>
        {t('conversation.save.content')}
      </label>
      <textarea
        id={`${idPrefix}-content`}
        className={`${formStyles.textarea} ${styles.saveTextarea}`}
        value={value}
        rows={12}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={error === null ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
      />
      {error === null ? null : (
        <p id={errorId} className={formStyles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

export type SavedLinkProps = {
  readonly href: string;
  readonly name: string | null;
  readonly t: Translate;
  readonly linkRef?: Ref<HTMLAnchorElement>;
};

/**
 * Story 5.4 part A: what the card becomes once the draft is saved: "Salvo como artefato: «name»", a link to the
 * artifact's page ("Salvo como artefato" while its name is not known here).
 */
export function SavedLink({ href, name, t, linkRef }: SavedLinkProps) {
  return (
    <p className={styles.savedLine} data-testid="saved-link">
      <Link ref={linkRef} className={styles.savedLink} href={href}>
        {name === null ? t('conversation.save.savedPlain') : t('conversation.save.saved', { name })}
      </Link>
    </p>
  );
}
