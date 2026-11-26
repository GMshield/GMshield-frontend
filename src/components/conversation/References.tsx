import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  isArtifactReference,
  isRecordReference,
  type ArtifactReference,
  type RecordReference,
  type SourceReference,
  type TurnReference,
} from '@/client/conversation';
import type { Translate } from '@/messages';
import { typeLabel, type NamedRecordType } from '@/record-types';

import { RecordFields } from '../RecordFields';
import { TierLabel } from '../TierLabel';
import styles from './Conversation.module.css';

/** One reference as one line: the material's name, the section path joined with " › ", and "p. N". */
export function referenceLine(reference: SourceReference, t: Translate): string {
  const parts = [reference.materialName];
  if (reference.sectionPath.length > 0) {
    parts.push(reference.sectionPath.join(' › '));
  }
  parts.push(t('conversation.page', { page: reference.page }));
  const line = parts.join(', ');
  return reference.removed ? `${line} — ${t('conversation.sourceRemoved')}` : line;
}

/**
 * Story 4.3 part C: a record type's name: a core key by its own translation; from Story 4.4 part B any other key by the
 * name of the campaign's system's type with that key (`types`), else as it is.
 */
export function referenceTypeName(type: string, t: Translate, types: readonly NamedRecordType[] = []): string {
  return typeLabel(type, types, t);
}

/** Story 4.3 part C: a cited record's name and its record type's name, as a reader hears its entry begin. */
export function recordHeading(reference: RecordReference | ArtifactReference, t: Translate, types: readonly NamedRecordType[] = []): string {
  return `${reference.name}, ${referenceTypeName(reference.recordType, t, types)}`;
}

/** Story 5.1 part B: a cited artifact's source line: the campaign's artifact and the version the answer cited. */
export function artifactLine(reference: ArtifactReference, t: Translate): string {
  return t('conversation.artifactSource', { version: reference.artifactVersion });
}

/**
 * Story 5.1 part B: the address of a cited artifact's page, in the conversation's own campaign. Story 5.2: on the
 * version the answer cited (`?version=`), which the page shows as it was, with a link to the newest.
 */
export function artifactHref(campaignId: string, reference: ArtifactReference): string {
  return `/campaigns/${encodeURIComponent(campaignId)}/artifacts/${encodeURIComponent(reference.artifactId)}?version=${encodeURIComponent(String(reference.artifactVersion))}`;
}

export type ReferencesProps = {
  readonly references: readonly TurnReference[];
  /** Story 5.1 part B: the conversation's campaign, whose artifact page a cited artifact's line opens. */
  readonly campaignId: string;
  readonly t: Translate;
  /** Story 2.7: opens a reference's page in the source view; `button` is where focus goes back when it closes. */
  readonly onOpen?: (reference: SourceReference, button: HTMLButtonElement) => void;
  /** Story 4.4 part B: the campaign's system's record types, which name a cited record's key; none by default. */
  readonly recordTypes?: readonly NamedRecordType[];
};

/**
 * The numbered source references under a finished answer (Story 2.5), in label type, one line each. A removed source is
 * struck through and followed by "fonte removida". Only what the backend sent is shown. Story 2.7: the line of a
 * reference that is not removed is a button, named by its line, that opens its page in the source view; a removed one
 * stays struck through and opens nothing. Story 3.7: a reference stored with its tier shows that tier's pill before its
 * line (frozen when the answer was written; a removed source keeps it); one stored before then shows none.
 *
 * Story 4.3 part C: a cited record is an entry of its own, under its number: its tier's pill, its name and its record
 * type, then its fields as the two-column list (names in label type, values in body type, as the record's page shows
 * them, without the closing rule), then its source line, which alone opens the source view (at the record's first page,
 * its passages there marked, on the turn's ground); the name opens nothing. A removed source's line is struck through
 * as a place's, and the fields stay as they were when the answer was written.
 *
 * Story 5.1 part B: a cited artifact is an entry like a record's (its tier's pill, its name, its record type and its
 * fields as they were when the answer was written), whose source line is a link to the artifact's page in the
 * conversation's campaign, naming the version cited. It never opens the source view.
 */
export function References({ references, campaignId, t, onOpen, recordTypes = [] }: ReferencesProps) {
  return (
    <ol className={styles.references} aria-label={t('conversation.references')}>
      {references.map((reference) => {
        if (isArtifactReference(reference)) {
          return <ArtifactEntry key={reference.number} reference={reference} campaignId={campaignId} t={t} recordTypes={recordTypes} />;
        }
        const line = referenceLine({ ...reference, removed: false }, t);
        let shown: ReactNode = line;
        if (reference.removed) {
          shown = (
            <>
              <s className={styles.removed}>{line}</s>
              {` — ${t('conversation.sourceRemoved')}`}
            </>
          );
        } else if (onOpen !== undefined) {
          shown = (
            <button type="button" className={styles.reference} aria-haspopup="dialog" onClick={(event) => onOpen(reference, event.currentTarget)}>
              {line}
            </button>
          );
        }
        const tier = reference.tier === undefined ? null : <TierLabel tier={reference.tier} t={t} className={styles.referenceTier} />;
        if (isRecordReference(reference)) {
          return (
            <li key={reference.number} value={reference.number} className={styles.recordEntry} data-kind="record">
              <span className={styles.recordHead}>
                {tier}
                <span className={styles.recordName}>{reference.name}</span>
                <span className={styles.visuallyHidden}>{', '}</span>
                <span className={styles.recordType}>{referenceTypeName(reference.recordType, t, recordTypes)}</span>
              </span>
              {reference.fields.length === 0 ? null : (
                <div className={styles.recordFields}>
                  <RecordFields fields={reference.fields} t={t} rule={false} />
                </div>
              )}
              <span className={styles.recordSource}>{shown}</span>
            </li>
          );
        }
        return (
          <li key={reference.number} value={reference.number}>
            {tier}
            {shown}
          </li>
        );
      })}
    </ol>
  );
}

type ArtifactEntryProps = {
  readonly reference: ArtifactReference;
  readonly campaignId: string;
  readonly t: Translate;
  readonly recordTypes: readonly NamedRecordType[];
};

/** Story 5.1 part B: a cited artifact's entry, as {@link References} says. */
function ArtifactEntry({ reference, campaignId, t, recordTypes }: ArtifactEntryProps) {
  return (
    <li value={reference.number} className={styles.recordEntry} data-kind="artifact">
      <span className={styles.recordHead}>
        {reference.tier === undefined ? null : <TierLabel tier={reference.tier} t={t} className={styles.referenceTier} />}
        <span className={styles.recordName}>{reference.name}</span>
        <span className={styles.visuallyHidden}>{', '}</span>
        <span className={styles.recordType}>{referenceTypeName(reference.recordType, t, recordTypes)}</span>
      </span>
      {reference.fields.length === 0 ? null : (
        <div className={styles.recordFields}>
          <RecordFields fields={reference.fields} t={t} rule={false} />
        </div>
      )}
      <span className={styles.recordSource}>
        <Link className={styles.reference} href={artifactHref(campaignId, reference)}>
          {artifactLine(reference, t)}
        </Link>
      </span>
    </li>
  );
}
