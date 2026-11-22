import type { Tier } from '@/client/conversation';
import type { Translate } from '@/messages';

import styles from './TierLabel.module.css';

/** What a reader hears between a tier's word and the text after it (visually hidden). */
export const TIER_SEPARATOR = ': ';

/** The word of a tier, as the scope names it ("Campanha", "Sistema", "Outros"). */
export function tierWord(tier: Tier, t: Translate): string {
  return t(`shell.scope.${tier}`);
}

/**
 * The tier a version of an answer or a source reference comes from (Story 3.7), as the backend labelled it: an outlined
 * pill with the tier's word, then a visually hidden ": " so a reader never runs the word into what follows. It is not
 * focusable and has no role of its own, so a reader reads its word where it stands.
 */
export function TierLabel({ tier, t, className }: { readonly tier: Tier; readonly t: Translate; readonly className?: string }) {
  return (
    <>
      <span className={className === undefined ? styles.pill : `${styles.pill} ${className}`} data-tier={tier}>
        {tierWord(tier, t)}
      </span>
      <span className={styles.separator}>{TIER_SEPARATOR}</span>
    </>
  );
}
