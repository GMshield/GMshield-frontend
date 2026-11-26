'use client';

import { startTransition, useActionState, useId, useState } from 'react';

import { uploadDay } from '@/dates';
import { translator, type Language, type Translate } from '@/messages';

import { ConfirmationDialog } from './ConfirmationDialog';
import { PillButton } from './PillButton';
import styles from './SupersededVersions.module.css';
import { formatSize } from './uploads/types';

/** What a removal left to say: the text of the backend's refusal, or nothing. */
export type VersionRemoveState = { readonly error: string | null };

const INITIAL: VersionRemoveState = { error: null };

/** A superseded version of the material, as the backend names it (`Material.superseded`). */
export type SupersededVersion = {
  readonly id: string;
  readonly createdAt: string;
  /** Its page total; null when not known. */
  readonly pages: number | null;
  /** Its size in bytes; null when not known. */
  readonly size: number | null;
};

export type SupersededVersionsProps = {
  readonly materialId: string;
  /** Newest first, as the backend sends them; the card is not shown when there is none. */
  readonly versions: readonly SupersededVersion[];
  readonly language: Language;
  readonly action: (previous: VersionRemoveState, form: FormData) => Promise<VersionRemoveState>;
};

/** The day a version was uploaded (Story 5.2: moved to `@/dates`, which a server page can call too). */
export { uploadDay };

/** A version's row: "Enviada em {date} · {pages} páginas · {size}", each part only once it is known. */
export function versionRow(version: SupersededVersion, t: Translate, language: Language): string {
  const parts = [t('material.superseded.row', { date: uploadDay(version.createdAt, language) })];
  if (version.pages !== null) {
    parts.push(version.pages === 1 ? t('material.pageCount.one') : t('material.pageCount.other', { count: version.pages }));
  }
  if (version.size !== null) {
    parts.push(formatSize(version.size, language));
  }
  return parts.join(' · ');
}

/** The dialog's consequence: the pages of that version that go, or the version in words when its pages are not known. */
export function versionRemovalConsequence(t: Translate, pages: number | null): string {
  if (pages === null || pages < 1) {
    return t('material.superseded.consequenceNoPages');
  }
  return pages === 1 ? t('material.superseded.consequenceOne') : t('material.superseded.consequenceOther', { pages });
}

/**
 * "Versões anteriores" on a material's page (Story 3.4 part B): a card in the facts column, one row per superseded
 * version, newest first ("Enviada em 10 de nov. de 2026 · 320 páginas · 134,2 MB"), each with a danger pill
 * "Remover". It opens the one confirmation (dialogs never stack), which names the pages that go; "Remover versão" posts
 * the material and the version to the Server Action, which removes it and refreshes the page. A refusal shows as an
 * alert under the rows. While a removal runs every pill stays focusable but ignores clicks (`aria-disabled`), and the
 * one pressed shows the spinner; focus goes back to it when the dialog closes.
 */
export function SupersededVersions({ materialId, versions, language, action }: SupersededVersionsProps) {
  const t = translator(language);
  const headingId = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState<SupersededVersion | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  if (versions.length === 0) {
    return null;
  }
  const confirm = () => {
    const version = confirming;
    setConfirming(null);
    if (version === null) {
      return;
    }
    const data = new FormData();
    data.set('id', materialId);
    data.set('versionId', version.id);
    setPressed(version.id);
    startTransition(() => formAction(data));
  };
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {t('material.superseded.label')}
      </h2>
      <ul className={styles.list}>
        {versions.map((version) => (
          <li key={version.id} className={styles.row} data-version={version.id}>
            <span className={styles.text}>{versionRow(version, t, language)}</span>
            <PillButton
              variant="danger"
              aria-haspopup="dialog"
              aria-label={t('material.superseded.removeLabel', { date: uploadDay(version.createdAt, language) })}
              aria-disabled={pending}
              pending={pending && pressed === version.id}
              onClick={() => {
                if (!pending) {
                  setConfirming(version);
                }
              }}
            >
              {t('material.superseded.remove')}
            </PillButton>
          </li>
        ))}
      </ul>
      {state.error === null ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <ConfirmationDialog
        open={confirming !== null}
        title={t('material.superseded.title')}
        consequence={versionRemovalConsequence(t, confirming?.pages ?? null)}
        confirmLabel={t('material.superseded.confirm')}
        language={language}
        onConfirm={confirm}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}
