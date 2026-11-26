import { correctionTexts } from '@/app/(signed-in)/records/correction';
import type { ArtifactFormTexts } from '@/components/ArtifactForm';
import type { EditorTypeOption } from '@/components/RecordFieldsEditor';
import type { Translate } from '@/messages';
import { recordTypeName } from '@/record-types';
import type { RecordType } from '@/server/library';

/**
 * Every text of a new artifact's form (Story 5.1), in the page's language: the record's editable body says what a
 * record's correction says (Story 4.5), and the form adds its content, its pills and its name.
 */
export function artifactFormTexts(t: Translate): ArtifactFormTexts {
  const record = correctionTexts(t);
  return {
    name: record.name,
    type: record.type,
    fields: record.fields,
    fieldName: record.fieldName,
    fieldValue: record.fieldValue,
    fieldNameOf: record.fieldNameOf,
    fieldValueOf: record.fieldValueOf,
    noFields: record.noFields,
    addField: record.addField,
    removeField: record.removeField,
    removeFieldOf: record.removeFieldOf,
    form: t('artifacts.form.title'),
    content: t('artifacts.form.content'),
    save: t('artifacts.form.save'),
    cancel: t('artifacts.form.cancel'),
  };
}

/** The record types a new artifact may have: the campaign's system's, core and approved, in its order, as named here. */
export function artifactTypeOptions(types: readonly RecordType[], t: Translate): EditorTypeOption[] {
  return types.map((type) => ({ key: type.key, label: recordTypeName(type, t) }));
}

/** The one page an artifact's pages may lead back to besides its campaign's tab (`from=characters`): "Personagens". */
export const FROM_CHARACTERS = 'characters';

/** Where an artifact's pages were opened from: "Personagens" when `from` says so, else nowhere in particular (null). */
export function fromOf(value: unknown): typeof FROM_CHARACTERS | null {
  return value === FROM_CHARACTERS ? FROM_CHARACTERS : null;
}

/**
 * The way back of a new artifact's form and of an artifact's page (Story 5.1): to "Personagens" when they were opened
 * from it, else to the campaign's artifacts tab, labelled "Artefatos".
 */
export function artifactBack(campaignId: string, from: typeof FROM_CHARACTERS | null, t: Translate): { href: string; label: string } {
  return from === FROM_CHARACTERS
    ? { href: '/characters', label: t('shell.entries.characters') }
    : { href: `/campaigns/${encodeURIComponent(campaignId)}?tab=artifacts`, label: t('campaigns.page.artifacts') };
}
