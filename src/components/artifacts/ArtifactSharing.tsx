'use client';

import { startTransition, useActionState, useId, useState } from 'react';

import { PillButton } from '../PillButton';
import { PillLink } from '../PillLink';
import styles from './ArtifactSharing.module.css';
import type { OverrideActionState } from './ArtifactOverride';

const INITIAL: OverrideActionState = { serial: 0, done: false, error: null };

/**
 * Another campaign of the artifact's system, as "Compartilhamento" lists it: its id, its name, whether it is archived
 * (listed only while the artifact is shared with it) and whether the artifact is shared with it now.
 */
export type SharingCampaign = {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly shared: boolean;
};

export type ArtifactSharingTexts = {
  readonly heading: string;
  /** What sharing does, above the boxes. */
  readonly intro: string;
  /** The boxes' group name. */
  readonly legend: string;
  /** The one sentence shown when the system has no other campaign. */
  readonly none: string;
  readonly newCampaign: string;
  /** The mark of an archived campaign's row. */
  readonly archived: string;
  readonly save: string;
};

export type ArtifactSharingProps = {
  readonly campaignId: string;
  readonly artifactId: string;
  /** The other campaigns of the system, in the order shown. */
  readonly campaigns: readonly SharingCampaign[];
  /** Where "Nova campanha" leads (the new campaign's form, on the artifact's system). */
  readonly newCampaignHref: string;
  readonly texts: ArtifactSharingTexts;
  readonly action: (previous: OverrideActionState, form: FormData) => Promise<OverrideActionState>;
};

/**
 * "Compartilhamento" on an artifact's page (Story 5.6 part A), after "Relacionados": one checkbox per other campaign of
 * the artifact's system (the campaigns in use, and an archived one only while the artifact is shared with it, marked
 * "Arquivada"), each a bordered row as in a conversation's deletion dialog, ticked when the artifact is shared with it,
 * and "Salvar", which sends the whole set ticked through its Server Action (none unshares it from every campaign); its
 * toast says the sharing was saved and applies from the next question, and a refusal shows here as an alert. With no
 * other campaign, one sentence says so beside "Nova campanha". Every box and "Salvar" are reached with Tab. The page
 * mounts it again (a new key) once a save is read back, so the boxes start from what is stored.
 */
export function ArtifactSharing({ campaignId, artifactId, campaigns, newCampaignHref, texts, action }: ArtifactSharingProps) {
  const headingId = useId();
  const introId = useId();
  const [state, formAction, saving] = useActionState(action, INITIAL);
  const [ticked, setTicked] = useState<readonly string[]>(() => campaigns.filter((campaign) => campaign.shared).map((campaign) => campaign.id));

  const toggle = (id: string, on: boolean) =>
    setTicked((current) => (on ? [...current.filter((one) => one !== id), id] : current.filter((one) => one !== id)));
  const save = () => {
    if (saving) {
      return;
    }
    const data = new FormData();
    data.set('campaignId', campaignId);
    data.set('artifactId', artifactId);
    // In the order shown, so the request does not depend on the order the boxes were ticked.
    campaigns.filter((campaign) => ticked.includes(campaign.id)).forEach((campaign) => data.append('campaignIds', campaign.id));
    startTransition(() => formAction(data));
  };
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {texts.heading}
      </h2>
      {campaigns.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.text}>{texts.none}</p>
          <PillLink href={newCampaignHref}>{texts.newCampaign}</PillLink>
        </div>
      ) : (
        <>
          <p id={introId} className={styles.text}>
            {texts.intro}
          </p>
          <fieldset className={styles.campaigns} aria-describedby={introId}>
            <legend className={styles.legend}>{texts.legend}</legend>
            <ul className={styles.rows}>
              {campaigns.map((campaign) => (
                <li key={campaign.id} className={styles.row}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      name="campaignIds"
                      value={campaign.id}
                      checked={ticked.includes(campaign.id)}
                      onChange={(event) => toggle(campaign.id, event.target.checked)}
                    />
                    <span className={styles.name}>{campaign.name}</span>
                    {campaign.archived ? <span className={styles.archived}>{texts.archived}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className={styles.actions}>
            <PillButton aria-disabled={saving || undefined} pending={saving} onClick={save}>
              {texts.save}
            </PillButton>
          </div>
        </>
      )}
      {state.error === null || state.serial === 0 ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
    </section>
  );
}
