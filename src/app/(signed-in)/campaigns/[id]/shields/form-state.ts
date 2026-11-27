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
