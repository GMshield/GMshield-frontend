/** A system's fields as the form holds them (Story 3.1): an empty edition or description is none. */
export type SystemFormValues = { readonly name: string; readonly edition: string; readonly description: string };

/** The field a refusal is about, shown under it; null for a refusal about the whole form. */
export type SystemField = 'name' | 'edition' | 'description';

/**
 * What the system form shows after a try: the values to show, the version an edit is made on (null for a new system),
 * the refusal's text and its field, and whether the system changed elsewhere (the values are then its current ones).
 */
export type SystemFormState = {
  readonly values: SystemFormValues;
  readonly version: number | null;
  readonly error: string | null;
  readonly field: SystemField | null;
  readonly stale: boolean;
};

export const EMPTY_SYSTEM: SystemFormValues = { name: '', edition: '', description: '' };
