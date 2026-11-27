'use client';

import Link from 'next/link';
import { startTransition, useActionState, useCallback, useId, useState } from 'react';

import type { TurnTier } from '@/client/conversation';
import { translator, type Language } from '@/messages';

import { PillButton } from '../PillButton';
import { TierLabel } from '../TierLabel';
import styles from './ArtifactRelations.module.css';
import type { OverrideActionState } from './ArtifactOverride';
import { RecordPicker, type OverrideTargetsPage, type RecordPickerTexts } from './OverridePicker';

const INITIAL: OverrideActionState = { serial: 0, done: false, error: null };

/**
 * A record an artifact is related to, as its page shows it: its id, name, type's label and tier (null for none), the
 * address of its page (another artifact's page, or `/search/records/{id}` for an extracted record), and whether it no
 * longer shows in the campaign (then no link).
 */
export type ShownRelation = {
  readonly recordId: string;
  readonly name: string;
  readonly typeLabel: string;
  readonly tier: TurnTier | null;
  readonly href: string;
  readonly removed: boolean;
};

export type ArtifactRelationsTexts = RecordPickerTexts & {
  readonly heading: string;
  readonly none: string;
  /** The list's accessible name. */
  readonly rows: string;
  readonly open: string;
  readonly removed: string;
  readonly remove: string;
  /** "Remover"'s accessible name, `{name}` standing for the row's name. */
  readonly removeLabel: string;
};

/** How the related mode reads a page: the campaign, the artifact, the type's key, the name filter and the page. */
export type LoadRelationTargets = (
  campaignId: string,
  artifactId: string,
  recordType: string,
  query: string,
  page: number,
) => Promise<OverrideTargetsPage>;

export type ArtifactRelationsProps = {
  readonly campaignId: string;
  readonly artifactId: string;
  readonly related: readonly ShownRelation[];
  /** The record types of the campaign's system, as the page names them; the picker's select. */
  readonly types: readonly { readonly key: string; readonly label: string }[];
  /** The artifact's own type: the picker's first choice. */
  readonly recordType: string;
  readonly texts: ArtifactRelationsTexts;
  readonly language: Language;
  readonly relateAction: (previous: OverrideActionState, form: FormData) => Promise<OverrideActionState>;
  readonly unrelateAction: (previous: OverrideActionState, form: FormData) => Promise<OverrideActionState>;
  readonly load: LoadRelationTargets;
};

/**
 * "Relacionados" on an artifact's page (Story 5.5 part B), after "Substituição". It lists each record the artifact is
 * related to, from either side, oldest first: another artifact links to its page, an extracted record to
 * `/search/records/{id}`, each with its type and its tier's pill; a record that left the campaign's scope or was
 * deleted shows its name with no link and says so. Each row has "Remover". "Relacionar um registro" opens the
 * {@link RecordPicker} in its related mode, whose rows show their tier too. Each change goes through its Server Action,
 * whose toast says it was saved or removed; a refusal shows as an alert here, or in the picker for "Relacionar".
 */
export function ArtifactRelations({
  campaignId,
  artifactId,
  related,
  types,
  recordType,
  texts,
  language,
  relateAction,
  unrelateAction,
  load,
}: ArtifactRelationsProps) {
  const headingId = useId();
  const t = translator(language);
  const [set, setFormAction, setting] = useActionState(relateAction, INITIAL);
  const [removed, removeFormAction, removing] = useActionState(unrelateAction, INITIAL);
  // The row whose "Remover" was pressed last: it alone shows it is busy.
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Each opening mounts a fresh picker (its own key), so it starts on the artifact's type with nothing picked.
  const [opening, setOpening] = useState(0);
  // The answer the picker opened after (null: closed): a relation stored since then closes it, and the page, read
  // again, lists the record; a refusal since then shows in it.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const open = openedAt !== null && !(set.done && set.serial > openedAt);
  const refusal = openedAt !== null && set.serial > openedAt && !set.done ? set.error : null;
  // The picker asks again whenever its loader changes: one loader for the artifact, kept across renders.
  const loadTargets = useCallback(
    (campaign: string, type: string, query: string, page: number) => load(campaign, artifactId, type, query, page),
    [load, artifactId],
  );

  const form = (recordId: string) => {
    const data = new FormData();
    data.set('campaignId', campaignId);
    data.set('artifactId', artifactId);
    data.set('recordId', recordId);
    return data;
  };
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {texts.heading}
      </h2>
      {related.length === 0 ? (
        <p className={styles.text}>{texts.none}</p>
      ) : (
        <ul className={styles.rows} aria-label={texts.rows}>
          {related.map((row) => (
            <li key={row.recordId} className={styles.row}>
              <span className={styles.what}>
                {row.tier === null ? null : <TierLabel tier={row.tier} t={t} className={styles.tier} />}
                {row.removed ? (
                  <span className={styles.target}>{row.name}</span>
                ) : (
                  <Link className={styles.link} href={row.href}>
                    {row.name}
                  </Link>
                )}
                <span className={styles.type}> · {row.typeLabel}</span>
                {row.removed ? <span className={styles.removed}> · {texts.removed}</span> : null}
              </span>
              <PillButton
                aria-label={texts.removeLabel.replace('{name}', () => row.name)}
                aria-disabled={removing || undefined}
                pending={removing && removingId === row.recordId}
                onClick={() => {
                  if (!removing) {
                    setRemovingId(row.recordId);
                    startTransition(() => removeFormAction(form(row.recordId)));
                  }
                }}
              >
                {texts.remove}
              </PillButton>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <PillButton
          aria-haspopup="dialog"
          onClick={() => {
            setOpening((count) => count + 1);
            setOpenedAt(set.serial);
          }}
        >
          {texts.open}
        </PillButton>
      </div>
      {removed.error === null || removed.serial === 0 ? null : (
        <p role="alert" className={styles.error}>
          {removed.error}
        </p>
      )}
      {opening === 0 ? null : (
        <RecordPicker
          key={opening}
          open={open}
          campaignId={campaignId}
          types={types}
          defaultType={recordType}
          texts={texts}
          language={language}
          load={loadTargets}
          pending={setting}
          error={refusal}
          onConfirm={(recordId) => startTransition(() => setFormAction(form(recordId)))}
          onCancel={() => setOpenedAt(null)}
        />
      )}
    </section>
  );
}
