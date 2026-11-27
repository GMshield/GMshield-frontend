/** A Shield's field as the form holds it (Story 6.1): its name. */
export type ShieldFormValues = { readonly name: string };

/**
 * What the Shield form shows after a try (Story 6.1): the value to show, the version a rename is made on (null for a new
 * Shield), the refusal's text and whether it is about the name (else about the whole form), and whether the Shield
 * changed elsewhere (the name is then its current one).
 */
export type ShieldFormState = {
  readonly values: ShieldFormValues;
  readonly version: number | null;
  readonly error: string | null;
  readonly field: 'name' | null;
  readonly stale: boolean;
};

/** A note's fields as its form holds them (Story 6.2): its title and its text. */
export type NoteFormValues = { readonly name: string; readonly content: string };

/**
 * What a new note's form shows after a try (Story 6.2); `serial` counts the answers. A saved note opens its page, so the
 * form only ever comes back refused: `error` is the refusal's text and `field` its part (null for one about the whole
 * form), with the values typed kept.
 */
export type NoteFormState = {
  readonly serial: number;
  readonly values: NoteFormValues;
  readonly error: string | null;
  readonly field: 'name' | 'content' | null;
};

export const NO_NOTE: NoteFormState = { serial: 0, values: { name: '', content: '' }, error: null, field: null };
