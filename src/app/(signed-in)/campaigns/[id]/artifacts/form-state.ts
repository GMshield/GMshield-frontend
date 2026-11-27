import type { OverrideActionState } from '@/components/artifacts/ArtifactOverride';
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

/**
 * What an artifact's edit answered (Story 5.2); `serial` counts the answers. `saved`: the backend stored the next
 * version, `currentVersion`. `stale`: the artifact changed in another tab and its newest version, `currentVersion`, was
 * read again, so "Manter a minha como nova versão" sends the GM's draft (still in the form) again on that version.
 * Otherwise `error` is a refusal's text and `field` its part (null for one about the whole form).
 */
export type ArtifactEditState = {
  readonly serial: number;
  readonly saved: boolean;
  readonly error: string | null;
  readonly field: ArtifactFormField | null;
  readonly stale: boolean;
  readonly currentVersion: number | null;
};

export const NO_ARTIFACT_EDIT: ArtifactEditState = { serial: 0, saved: false, error: null, field: null, stale: false, currentVersion: null };

/**
 * What a restore of an earlier version answered (Story 5.2), as an edit's answer reads: `saved` with the new
 * `currentVersion`, or `stale` with the newest version read again (the same restore may be sent again on it), or a
 * refusal's `error`. `number` is the version the restore was about.
 */
export type ArtifactRestoreState = {
  readonly serial: number;
  readonly number: number | null;
  readonly saved: boolean;
  readonly error: string | null;
  readonly stale: boolean;
  readonly currentVersion: number | null;
};

export const NO_ARTIFACT_RESTORE: ArtifactRestoreState = { serial: 0, number: null, saved: false, error: null, stale: false, currentVersion: null };

/** What a mark's change left to say (Story 5.5 part A): whether it was stored, else the refusal's text. */
export type ArtifactOverrideState = OverrideActionState;

/** How many records a page of the override picker holds (Story 5.5 part A). */
export const OVERRIDE_PAGE_SIZE = 6;

/** What a relation's change left to say (Story 5.5 part B): whether it was stored, else the refusal's text. */
export type ArtifactRelationState = OverrideActionState;

/** How many records a page of the related mode's picker holds (Story 5.5 part B), as the override picker's. */
export const RELATION_PAGE_SIZE = OVERRIDE_PAGE_SIZE;

