import styles from './StatePill.module.css';

/** A version's state, as the API names it. */
export type PillState = 'uploading' | 'waiting' | 'processing' | 'needs_review' | 'ready' | 'superseded' | 'failed' | 'discarded';

/**
 * A material's state as a pill (Story 1.14): the word, with its colour in a mark beside it, never instead of it.
 * Ready is the success colour, needs review the warning colour, failed the danger colour; the others are plain text.
 */
export function StatePill({ state, word }: { readonly state: PillState; readonly word: string }) {
  return (
    <span className={styles.pill} data-state={state}>
      <span className={styles.mark} aria-hidden="true" />
      {word}
    </span>
  );
}
