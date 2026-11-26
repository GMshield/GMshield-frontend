import type { CorrectionField } from '@/components/RecordCorrection';

/** The part of a new artifact's form a refusal is about (Story 5.1): a record's part, or the content. */
export type ArtifactFormField = CorrectionField | 'content';

/** What the form holds: the record type's key, the name, the fields in order and the content. */
export type ArtifactFormValues = {
  readonly recordType: string;
  readonly name: string;
  readonly fields: readonly { readonly name: string; readonly value: string }[];
  readonly content: string;
};

/**
 * What a new artifact's form shows after a try (Story 5.1); `serial` counts the answers. A saved artifact opens its page,
 * so the form only ever comes back refused: `error` is the refusal's text and `field` its part (null for one about the
 * whole form), with the values typed kept.
 */
export type ArtifactFormState = {
  readonly serial: number;
  readonly values: ArtifactFormValues;
  readonly error: string | null;
  readonly field: ArtifactFormField | null;
};
