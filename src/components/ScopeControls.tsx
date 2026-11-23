'use client';

import { startTransition, useActionState, useOptimistic, useState } from 'react';

import { translator, type Language } from '@/messages';
import { pageOf } from '@/paging';

import { Pager } from './Pager';
import { SCOPE_TIERS, type Scope, type ScopeMaterial, type ScopeTier } from './scope';
import styles from './ScopeControls.module.css';
import { Switch } from './Switch';

/**
 * What the scope controls show after a press (Story 3.6): the settings the backend answered (saved, or read again after
 * a stale save), the refusal's or the stale line's text, and whether the save went through. After any other refusal the
 * settings shown stay as they were.
 */
export type ScopeFormState = {
  readonly scope: Scope | null;
  readonly error: string | null;
  readonly saved: boolean;
};

export const NO_SCOPE_ANSWER: ScopeFormState = { scope: null, error: null, saved: false };

/** How many of a tier's materials show at once; the rest are a page away. */
export const MATERIALS_PER_PAGE = 10;

export type ScopeControlsProps = {
  /** The campaign whose scope this is. A parent keys the controls by it, so another campaign starts them again. */
  readonly campaignId: string;
  /** Its scope settings as the page read them. */
  readonly scope: Scope;
  readonly language: Language;
  readonly action: (previous: ScopeFormState, form: FormData) => Promise<ScopeFormState>;
};

/**
 * A campaign's scope controls (Story 3.6), the same in the context bar's popover and in the campaign page's scope tab:
 * the three tier switches, the materials of each tier that is on indented under it (newest first, as the backend lists them, ten a
 * page) with a switch each, and the model-knowledge switch (Story 3.8: it lets the model add its own knowledge, each such
 * part under its label and with no reference). A press saves at once: the full settings go to the Server Action on the version last read, the switch
 * shows its new state while the save runs, and every switch waits (`aria-busy`). Once saved, one polite line says
 * "Vale a partir da próxima pergunta.". A stale save shows the settings as they are now, with a danger line; any other
 * refusal shows its text and the switches go back to what is stored. Nothing here decides what the campaign may use:
 * the switches say what the backend answered (AD-9).
 */
export function ScopeControls({ campaignId, scope, language, action }: ScopeControlsProps) {
  const t = translator(language);
  const [state, formAction, pending] = useActionState(action, NO_SCOPE_ANSWER);
  // The newest settings in hand: the ones the last answer brought, unless the page has since read newer ones.
  const stored = state.scope !== null && state.scope.version >= scope.version ? state.scope : scope;
  const [shown, propose] = useOptimistic(stored, (_current: Scope, next: Scope) => next);
  const states = { on: t('campaigns.scope.on'), off: t('campaigns.scope.off') };

  function save(next: Scope) {
    if (pending) {
      return;
    }
    const form = new FormData();
    form.set('campaign', campaignId);
    form.set('version', String(stored.version));
    form.set('campaignTier', String(next.campaignTier));
    form.set('systemTier', String(next.systemTier));
    form.set('otherTier', String(next.otherTier));
    form.set('modelKnowledge', String(next.modelKnowledge));
    for (const id of new Set(next.materials.filter((material) => !material.on).map((material) => material.id))) {
      form.append('materialsOff', id);
    }
    startTransition(() => {
      propose(next);
      formAction(form);
    });
  }

  function turnMaterial(id: string, on: boolean) {
    save({ ...shown, materials: shown.materials.map((material) => (material.id === id ? { ...material, on } : material)) });
  }

  return (
    <div className={styles.controls} aria-busy={pending}>
      <p role="status" className={styles.status}>
        {state.saved && !pending ? t('material.belonging.saved') : ''}
      </p>
      {state.error === null || pending ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <ul className={styles.tiers}>
        {SCOPE_TIERS.map(({ tier, key }) => {
          const label = t(`campaigns.scope.${tier}`);
          return (
            <li key={tier} className={styles.tier}>
              <Switch label={label} checked={shown[key]} states={states} disabled={pending} onChange={(on) => save({ ...shown, [key]: on })} />
              {shown[key] ? (
                <TierMaterials
                  tier={tier}
                  label={label}
                  materials={shown.materials.filter((material) => material.tier === tier)}
                  language={language}
                  pending={pending}
                  onTurn={turnMaterial}
                />
              ) : null}
            </li>
          );
        })}
        <li className={styles.tier}>
          <Switch
            label={t('campaigns.scope.modelKnowledge')}
            checked={shown.modelKnowledge}
            states={states}
            disabled={pending}
            onChange={(on) => save({ ...shown, modelKnowledge: on })}
          />
        </li>
      </ul>
    </div>
  );
}

type TierMaterialsProps = {
  readonly tier: ScopeTier;
  readonly label: string;
  readonly materials: readonly ScopeMaterial[];
  readonly language: Language;
  readonly pending: boolean;
  readonly onTurn: (id: string, on: boolean) => void;
};

/** The materials of a tier that is on, indented, ten a page with a compact pager that turns pages here (no second scroll area). */
function TierMaterials({ tier, label, materials, language, pending, onTurn }: TierMaterialsProps) {
  const t = translator(language);
  const [page, setPage] = useState(1);
  if (materials.length === 0) {
    return <p className={styles.empty}>{t('campaigns.scope.noMaterials')}</p>;
  }
  const { rows, paging } = pageOf(materials, page, MATERIALS_PER_PAGE);
  const states = { on: t('campaigns.scope.on'), off: t('campaigns.scope.off') };
  return (
    <div className={styles.materials} data-tier={tier}>
      <ul className={styles.materialList} aria-label={t('campaigns.scope.materials', { tier: label })}>
        {rows.map((material) => (
          <li key={material.id}>
            <Switch label={material.name} checked={material.on} states={states} disabled={pending} onChange={(on) => onTurn(material.id, on)} />
          </li>
        ))}
      </ul>
      <Pager compact paging={paging} onPage={setPage} language={language} label={t('campaigns.scope.pages', { tier: label })} />
    </div>
  );
}
