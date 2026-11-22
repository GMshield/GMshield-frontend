import type { Translate } from '@/messages';
import type { components } from '@/server/backend/generated/public';

/** A campaign's scope settings as the backend answers them (Story 3.5): switches, version and every tier's materials. */
export type Scope = components['schemas']['Scope'];
export type ScopeMaterial = components['schemas']['ScopeMaterial'];
export type ScopeTier = ScopeMaterial['tier'];

/** The three tiers in the order the backend lists them, each with the switch that turns it on. */
export const SCOPE_TIERS = [
  { tier: 'campaign', key: 'campaignTier' },
  { tier: 'system', key: 'systemTier' },
  { tier: 'other', key: 'otherTier' },
] as const satisfies readonly { readonly tier: ScopeTier; readonly key: keyof Scope }[];

/**
 * The context bar's scope summary (Story 3.6): the tiers that are on, named and joined by " + " ("Campanha + Sistema"),
 * or "Nenhuma fonte" when none is, then whether model knowledge is on ("· conhecimento do modelo desligado"). It says
 * what the switches the backend answered say; it works nothing out.
 */
export function scopeSummary(scope: Pick<Scope, 'campaignTier' | 'systemTier' | 'otherTier' | 'modelKnowledge'>, t: Translate): string {
  const on = SCOPE_TIERS.filter(({ key }) => scope[key]).map(({ tier }) => t(`shell.scope.${tier}`));
  return t('shell.scope.summary', {
    tiers: on.length === 0 ? t('shell.scope.none') : on.join(' + '),
    model: t(scope.modelKnowledge ? 'shell.scope.modelOn' : 'shell.scope.modelOff'),
  });
}
