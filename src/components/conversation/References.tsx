import type { SourceReference } from '@/client/conversation';
import type { Translate } from '@/messages';

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
};

/**
 * The numbered source references under a finished answer (Story 2.5), in label type, one line each. A removed source is
 * struck through and followed by "fonte removida". Only what the backend sent is shown, and nothing opens yet (Story
 * 2.7 opens the cited page).
 */
export function References({ references, t }: ReferencesProps) {
  return (
    <ol className={styles.references} aria-label={t('conversation.references')}>
      {references.map((reference) => {
        const line = referenceLine({ ...reference, removed: false }, t);
        return (
          <li key={reference.number} value={reference.number}>
            {reference.removed ? (
              <>
                <s className={styles.removed}>{line}</s>
                {` — ${t('conversation.sourceRemoved')}`}
              </>
            ) : (
              line
            )}
          </li>
        );
      })}
    </ol>
  );
}
