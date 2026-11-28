/** A campaign's fields as the form holds them (Story 3.2): its name, and its system on a new campaign. */
export type CampaignFormValues = { readonly name: string; readonly systemId: string };

/** The field a refusal is about, shown under it; null for a refusal about the whole form. */
export type CampaignField = 'name' | 'systemId';

/**
 * What the campaign form shows after a try: the values to show, the version a rename is made on (null for a new
 * campaign), the refusal's text and its field, and whether the campaign changed elsewhere (the name is then its current
 * one).
 */
export type CampaignFormState = {
  readonly values: CampaignFormValues;
  readonly version: number | null;
  readonly error: string | null;
  readonly field: CampaignField | null;
  readonly stale: boolean;
};

/**
 * What an action on a campaign left to say (Story 3.2): a refusal's text, or nothing; and how many choices of a current
 * campaign succeeded, so the switcher closes after one.
 */
export type CampaignActionState = { readonly error: string | null; readonly done: number };

export const CAMPAIGN_ACTION_START: CampaignActionState = { error: null, done: 0 };

/** The party field a refusal is about (Story 7.1), shown beside it; null for a refusal about the whole form. */
export type PartyField = 'size' | 'level';

/**
 * What the party form shows after a save (Story 7.1): the version the next save names (null before any answer), the
 * values to start the fields from after a stale save (the campaign's current ones; null for not set), the refusal's
 * text and its field, whether the save was stale or went through, and a count of answers.
 */
export type PartyFormState = {
  readonly version: number | null;
  readonly size: number | null;
  readonly level: number | null;
  readonly error: string | null;
  readonly field: PartyField | null;
  readonly stale: boolean;
  readonly saved: boolean;
  readonly serial: number;
};

export const NO_PARTY_ANSWER: PartyFormState = {
  version: null,
  size: null,
  level: null,
  error: null,
  field: null,
  stale: false,
  saved: false,
  serial: 0,
};
