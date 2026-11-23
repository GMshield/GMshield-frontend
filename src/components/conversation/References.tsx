import type { ReactNode } from 'react';

import { isRecordReference, type RecordReference, type SourceReference } from '@/client/conversation';
import type { Translate } from '@/messages';
import { coreTypeName, isCoreKey } from '@/record-types';

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

/** Story 4.3 part C: a record type's name: a core key by its own translation, any other key as it is. */
export function referenceTypeName(type: string, t: Translate): string {
  return isCoreKey(type) ? coreTypeName(type, t) : type;
}

/** Story 4.3 part C: a cited record's name and its record type's name, as a reader hears its entry begin. */
export function recordHeading(reference: RecordReference, t: Translate): string {
  return `${reference.name}, ${referenceTypeName(reference.recordType, t)}`;
}

export type ReferencesProps = {
  readonly references: readonly SourceReference[];
  readonly t: Translate;
  /** Story 2.7: opens a reference's page in the source view; `button` is where focus goes back when it closes. */
  readonly onOpen?: (reference: SourceReference, button: HTMLButtonElement) => void;
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
 */
export function References({ references, t, onOpen }: ReferencesProps) {
  return (
    <ol className={styles.references} aria-label={t('conversation.references')}>
      {references.map((reference) => {
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
                <span className={styles.recordType}>{referenceTypeName(reference.recordType, t)}</span>
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
