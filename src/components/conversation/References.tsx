import type { ReactNode } from 'react';

import type { SourceReference } from '@/client/conversation';
import type { Translate } from '@/messages';

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
        return (
          <li key={reference.number} value={reference.number}>
            {reference.tier === undefined ? null : <TierLabel tier={reference.tier} t={t} className={styles.referenceTier} />}
            {shown}
          </li>
        );
      })}
    </ol>
  );
}
