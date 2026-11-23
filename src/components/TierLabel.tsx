import { MODEL_TIER, type TurnTier } from '@/client/conversation';
import type { Translate } from '@/messages';

import styles from './TierLabel.module.css';

/** What a reader hears between a tier's word and the text after it (visually hidden). */
export const TIER_SEPARATOR = ': ';

/**
 * The word of a tier, as the scope names it ("Campanha", "Sistema", "Outros"); from Story 3.8 the model's own knowledge
 * reads as its scope switch does ("Conhecimento do modelo").
 */
export function tierWord(tier: TurnTier, t: Translate): string {
  return tier === MODEL_TIER ? t('campaigns.scope.modelKnowledge') : t(`shell.scope.${tier}`);
}

/**
 * What a reader hears for a tier's pill, in place of its word and the separator: null for a tier of the scope (the word,
 * then ": "); for the model's own knowledge (Story 3.8) the whole sentence "Do conhecimento do modelo, sem fonte.", which
 * also closes that part of an answer as a muted line.
 */
export function tierSpoken(tier: TurnTier, t: Translate): string | null {
  return tier === MODEL_TIER ? t('conversation.modelSource') : null;
}

/**
 * The tier a version of an answer or a source reference comes from (Story 3.7), as the backend labelled it: an outlined
 * pill with the tier's word, then a visually hidden ": " so a reader never runs the word into what follows. It is not
 * focusable and has no role of its own, so a reader reads its word where it stands. The model's own knowledge (Story
 * 3.8) is heard as its sentence (`tierSpoken`) instead of the word shown.
 */
export function TierLabel({ tier, t, className }: { readonly tier: TurnTier; readonly t: Translate; readonly className?: string }) {
  const spoken = tierSpoken(tier, t);
  return (
    <>
      <span className={className === undefined ? styles.pill : `${styles.pill} ${className}`} data-tier={tier} aria-hidden={spoken === null ? undefined : true}>
        {tierWord(tier, t)}
      </span>
      <span className={styles.separator}>{spoken === null ? TIER_SEPARATOR : `${spoken} `}</span>
    </>
  );
}
