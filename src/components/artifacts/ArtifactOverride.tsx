'use client';

import Link from 'next/link';
import { startTransition, useActionState, useId, useState } from 'react';

import type { ArtifactFrom } from '@/app/(signed-in)/campaigns/[id]/artifacts/texts';
import type { Language } from '@/messages';

import { PillButton } from '../PillButton';
import styles from './ArtifactOverride.module.css';
import { OverridePicker, type LoadOverrideTargets, type OverridePickerTexts } from './OverridePicker';

/** What a mark's change left to say: whether it was stored, else the refusal's text. */
export type OverrideActionState = { readonly serial: number; readonly done: boolean; readonly error: string | null };

const INITIAL: OverrideActionState = { serial: 0, done: false, error: null };

/** The record an artifact overrides, as its page shows it: its id, name, type's label and whether it has no effect. */
export type ShownOverride = {
  readonly recordId: string;
  readonly name: string;
  readonly typeLabel: string;
  readonly removed: boolean;
};

export type ArtifactOverrideTexts = OverridePickerTexts & {
  readonly heading: string;
  readonly none: string;
  readonly open: string;
  readonly replaces: string;
  readonly removed: string;
  readonly remove: string;
};

export type ArtifactOverrideProps = {
  readonly campaignId: string;
  readonly artifactId: string;
  /** Story 7.2: where the artifact's page was opened from ("Personagens", the item encyclopedia), kept by the record's link. */
  readonly from?: ArtifactFrom | null;
  readonly override: ShownOverride | null;
  /** The record types of the campaign's system, as the page names them; the picker's select. */
  readonly types: readonly { readonly key: string; readonly label: string }[];
  /** The artifact's own type: the picker's first choice. */
  readonly recordType: string;
  readonly texts: ArtifactOverrideTexts;
  readonly language: Language;
  readonly setAction: (previous: OverrideActionState, form: FormData) => Promise<OverrideActionState>;
  readonly removeAction: (previous: OverrideActionState, form: FormData) => Promise<OverrideActionState>;
  readonly load: LoadOverrideTargets;
};

/**
 * The address of the record an artifact overrides (Story 7.2): the campaign's record page, which leads back to the
 * artifact (`artifact=`), keeping where the artifact's page was opened from (`from=characters` or `from=items`).
 */
export function overriddenRecordHref(campaignId: string, recordId: string, artifactId: string, from: ArtifactFrom | null): string {
  const query = new URLSearchParams();
  if (from !== null) {
    query.set('from', from);
  }
  query.set('artifact', artifactId);
  return `/campaigns/${encodeURIComponent(campaignId)}/records/${encodeURIComponent(recordId)}?${query.toString()}`;
}

/**
 * "Substituição" on an artifact's page (Story 5.5 part A), between its fields and "Fontes". With no mark it says the
 * artifact overrides no record and offers "Substituir um registro", which opens the {@link OverridePicker}; with one it
 * names the record as a link to its page with its type (from Story 7.2 the campaign's record page,
 * {@link overriddenRecordHref}, whose way back is this artifact), says when the mark has no effect (the
 * record deleted or out of the campaign's scope; no link then), and offers "Remover substituição". Each change goes
 * through its Server Action, whose toast says it applies from the next question; a refusal shows as an alert here, or
 * in the picker for "Substituir".
 */
export function ArtifactOverride({
  campaignId,
  artifactId,
  from = null,
  override,
  types,
  recordType,
  texts,
  language,
  setAction,
  removeAction,
  load,
}: ArtifactOverrideProps) {
  const headingId = useId();
  const [set, setFormAction, setting] = useActionState(setAction, INITIAL);
  const [removed, removeFormAction, removing] = useActionState(removeAction, INITIAL);
  // Each opening mounts a fresh picker (its own key), so it starts on the artifact's type with nothing picked.
  const [opening, setOpening] = useState(0);
  // The answer the picker opened after (null: closed): a mark stored since then closes it, and the page, read
  // again, shows the record; a refusal since then shows in it.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const open = openedAt !== null && !(set.done && set.serial > openedAt);
  const refusal = openedAt !== null && set.serial > openedAt && !set.done ? set.error : null;

  const form = (more: Record<string, string> = {}) => {
    const data = new FormData();
    data.set('campaignId', campaignId);
    data.set('artifactId', artifactId);
    for (const [key, value] of Object.entries(more)) {
      data.set(key, value);
    }
    return data;
  };
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {texts.heading}
      </h2>
      {override === null ? (
        <p className={styles.text}>{texts.none}</p>
      ) : (
        <>
          <p className={styles.text}>
            {texts.replaces}{' '}
            {override.removed ? (
              <span className={styles.target}>{override.name}</span>
            ) : (
              <Link className={styles.link} href={overriddenRecordHref(campaignId, override.recordId, artifactId, from)}>
                {override.name}
              </Link>
            )}
            <span className={styles.type}> · {override.typeLabel}</span>
          </p>
          {override.removed ? <p className={styles.removed}>{texts.removed}</p> : null}
        </>
      )}
      <div className={styles.actions}>
        {override === null ? (
          <PillButton
            aria-haspopup="dialog"
            onClick={() => {
              setOpening((count) => count + 1);
              setOpenedAt(set.serial);
            }}
          >
            {texts.open}
          </PillButton>
        ) : (
          <PillButton
            aria-disabled={removing || undefined}
            pending={removing}
            onClick={() => {
              if (!removing) {
                startTransition(() => removeFormAction(form()));
              }
            }}
          >
            {texts.remove}
          </PillButton>
        )}
      </div>
      {removed.error === null || removed.serial === 0 ? null : (
        <p role="alert" className={styles.error}>
          {removed.error}
        </p>
      )}
      {opening === 0 ? null : (
        <OverridePicker
          key={opening}
          open={open}
          campaignId={campaignId}
          types={types}
          defaultType={recordType}
          texts={texts}
          language={language}
          load={load}
          pending={setting}
          error={refusal}
          onConfirm={(recordId) => startTransition(() => setFormAction(form({ recordId })))}
          onCancel={() => setOpenedAt(null)}
        />
      )}
    </section>
  );
}
