'use client';

import type { Messages } from '@/messages';

import styles from './PlacePicker.module.css';
import { placeChoices, type Belonging, type BelongingChoice, type CampaignOption, type PlaceDraft } from './uploads/types';

export type PlacePickerTexts = Messages['upload']['dialog']['belonging'];

export type PlacePickerProps = {
  /** What can be picked: the campaigns in use, the systems, and the current campaign. */
  readonly places: Belonging;
  readonly draft: PlaceDraft;
  readonly onChange: (draft: PlaceDraft) => void;
  /** Its texts, in the interface's language (the guided upload's own). */
  readonly texts: PlacePickerTexts;
  /** The radio group's name, unique on the page; a form posts it, with `campaign`, `system` and `systems`. */
  readonly name: string;
  /**
   * Whether "Em nenhum lugar" is offered when there is nothing to pick (the guided upload); a material's place never
   * goes back to none, so its page leaves it out.
   */
  readonly allowNone?: boolean;
};

/** The campaigns by system, in the order of their first campaign (Story 3.3: "a select of campaigns grouped by system"). */
function bySystem(campaigns: readonly CampaignOption[]): { readonly id: string; readonly name: string; readonly campaigns: CampaignOption[] }[] {
  const groups: { id: string; name: string; campaigns: CampaignOption[] }[] = [];
  for (const campaign of campaigns) {
    const group = groups.find((found) => found.id === campaign.system.id);
    if (group === undefined) {
      groups.push({ id: campaign.system.id, name: campaign.system.name, campaigns: [campaign] });
    } else {
      group.campaigns.push(campaign);
    }
  }
  return groups;
}

/**
 * Where a material belongs (Story 3.3), as the guided upload and the material page ask it: three full-width choice
 * rows, each with its explanation and its picker: "Uma campanha" (a select of the campaigns in use, grouped by system),
 * "Um sistema" (a select) and "Vários sistemas" (checkboxes). A row shows only when it has something to pick; with no
 * campaign and no system, the one row says it stays nowhere for now (unless `allowNone` is false). Picking in a row's
 * picker chooses that row. Each row keeps its own value while another is chosen; a select with nothing picked shows
 * "Escolha". Its fields are named for a form (the radio as `name`, `campaign`, `system` and each `systems` checkbox),
 * but it is a controlled component: it needs JavaScript.
 */
export function PlacePicker({ places, draft, onChange, texts, name, allowNone = true }: PlacePickerProps) {
  const choices = placeChoices(places).filter((choice) => allowNone || choice !== 'none');
  const choose = (choice: BelongingChoice) => onChange({ ...draft, choice });
  const toggle = (id: string, on: boolean) => {
    const systems = on ? [...draft.systems.filter((other) => other !== id), id] : draft.systems.filter((other) => other !== id);
    onChange({ ...draft, choice: 'systems', systems: places.systems.map((system) => system.id).filter((other) => systems.includes(other)) });
  };
  return (
    <ul className={styles.choices}>
      {choices.map((choice) => (
        <li key={choice} className={styles.row}>
          <label className={styles.choice}>
            <input type="radio" name={name} value={choice} checked={draft.choice === choice} onChange={() => choose(choice)} />
            <span className={styles.choiceLabel}>{texts[choice].label}</span>
            <span className={styles.choiceDescription}>{texts[choice].description}</span>
          </label>
          {choice === 'campaign' ? (
            <label className={styles.picker}>
              <span className={styles.pickerLabel}>{texts.campaignField}</span>
              <select
                className={styles.select}
                name="campaign"
                value={draft.campaign}
                onChange={(event) => onChange({ ...draft, choice: 'campaign', campaign: event.target.value })}
              >
                {draft.campaign === '' ? <option value="">{texts.pick}</option> : null}
                {bySystem(places.campaigns).map((group) => (
                  <optgroup key={group.id} label={group.name}>
                    {group.campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : null}
          {choice === 'system' ? (
            <label className={styles.picker}>
              <span className={styles.pickerLabel}>{texts.systemField}</span>
              <select
                className={styles.select}
                name="system"
                value={draft.system}
                onChange={(event) => onChange({ ...draft, choice: 'system', system: event.target.value })}
              >
                {draft.system === '' ? <option value="">{texts.pick}</option> : null}
                {places.systems.map((system) => (
                  <option key={system.id} value={system.id}>
                    {system.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {choice === 'systems' ? (
            <fieldset className={styles.picker}>
              <legend className={styles.pickerLabel}>{texts.systemsField}</legend>
              <ul className={styles.checks}>
                {places.systems.map((system) => (
                  <li key={system.id}>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        name="systems"
                        value={system.id}
                        checked={draft.systems.includes(system.id)}
                        onChange={(event) => toggle(system.id, event.target.checked)}
                      />
                      <span>{system.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
