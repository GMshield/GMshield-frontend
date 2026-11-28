import { correctionTexts } from '@/app/(signed-in)/records/correction';
import type { ArtifactEditorTexts } from '@/components/ArtifactEditor';
import type { ArtifactOverrideTexts } from '@/components/artifacts/ArtifactOverride';
import type { ArtifactRelationsTexts } from '@/components/artifacts/ArtifactRelations';
import type { ArtifactSharingTexts } from '@/components/artifacts/ArtifactSharing';
import type { ArtifactFormTexts } from '@/components/ArtifactForm';
import type { ArtifactVersionsTexts } from '@/components/ArtifactVersions';
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

/**
 * Every text of an artifact's edit (Story 5.2), in the page's language: the editable body, the content and the stale
 * notice say what a new artifact's form and a record's correction say; the edit adds its pills, its name and its
 * saved line.
 */
export function artifactEditorTexts(t: Translate): ArtifactEditorTexts {
  const record = correctionTexts(t);
  const form = artifactFormTexts(t);
  return {
    name: form.name,
    type: form.type,
    fields: form.fields,
    fieldName: form.fieldName,
    fieldValue: form.fieldValue,
    fieldNameOf: form.fieldNameOf,
    fieldValueOf: form.fieldValueOf,
    noFields: form.noFields,
    addField: form.addField,
    removeField: form.removeField,
    removeFieldOf: form.removeFieldOf,
    content: form.content,
    open: t('artifacts.edit.open'),
    form: t('artifacts.edit.form'),
    save: t('artifacts.edit.save'),
    cancel: t('artifacts.edit.cancel'),
    stale: record.stale,
    viewCurrent: record.viewCurrent,
    keepMine: record.keepMine,
    saved: t('artifacts.edit.saved'),
    offline: t('artifacts.edit.offline'),
  };
}

/**
 * Every text of an artifact's "Versões" (Story 5.2), in the page's language: a stale restore says what a stale edit
 * says, and its second choice restores the same version anyway (it has no draft of the GM's own to keep).
 */
export function artifactVersionsTexts(t: Translate): ArtifactVersionsTexts {
  const record = correctionTexts(t);
  return {
    title: t('artifacts.versions.title'),
    list: t('artifacts.versions.list'),
    current: t('artifacts.versions.current'),
    restore: t('artifacts.versions.restore'),
    restoreOf: t('artifacts.versions.restoreOf'),
    stale: record.stale,
    viewCurrent: record.viewCurrent,
    restoreAnyway: t('artifacts.versions.restoreAnyway'),
  };
}

/** Every text of an artifact's "Substituição" and its picker (Story 5.5 part A), in the page's language. */
export function artifactOverrideTexts(t: Translate): ArtifactOverrideTexts {
  return {
    heading: t('artifacts.override.title'),
    none: t('artifacts.override.none'),
    open: t('artifacts.override.open'),
    replaces: t('artifacts.override.replaces'),
    removed: t('artifacts.override.removed'),
    remove: t('artifacts.override.remove'),
    title: t('artifacts.override.dialogTitle'),
    intro: t('artifacts.override.dialogIntro'),
    type: t('artifacts.override.type'),
    filter: t('artifacts.override.filter'),
    list: t('artifacts.override.list'),
    empty: t('artifacts.override.empty'),
    emptyFiltered: t('artifacts.override.emptyFiltered'),
    loading: t('artifacts.override.loading'),
    pages: t('artifacts.override.pages'),
    confirm: t('artifacts.override.confirm'),
    cancel: t('artifacts.override.cancel'),
    pick: t('artifacts.override.pick'),
  };
}

/** Every text of an artifact's "Relacionados" and its picker's related mode (Story 5.5 part B), in the page's language. */
export function artifactRelationsTexts(t: Translate): ArtifactRelationsTexts {
  return {
    heading: t('artifacts.relations.title'),
    none: t('artifacts.relations.none'),
    rows: t('artifacts.relations.list'),
    open: t('artifacts.relations.open'),
    removed: t('artifacts.relations.removed'),
    remove: t('artifacts.relations.remove'),
    // A template the section fills with each row's name (functions do not cross to a client component).
    removeLabel: t('artifacts.relations.removeLabel', { name: '{name}' }),
    title: t('artifacts.relations.dialogTitle'),
    intro: t('artifacts.relations.dialogIntro'),
    type: t('artifacts.relations.type'),
    filter: t('artifacts.relations.filter'),
    list: t('artifacts.relations.records'),
    empty: t('artifacts.relations.empty'),
    emptyFiltered: t('artifacts.relations.emptyFiltered'),
    loading: t('artifacts.relations.loading'),
    pages: t('artifacts.relations.pages'),
    confirm: t('artifacts.relations.confirm'),
    cancel: t('artifacts.relations.cancel'),
    pick: t('artifacts.relations.pick'),
  };
}

/** Every text of an artifact's "Compartilhamento" (Story 5.6 part A), in the page's language. */
export function artifactSharingTexts(t: Translate): ArtifactSharingTexts {
  return {
    heading: t('artifacts.share.title'),
    intro: t('artifacts.share.intro'),
    legend: t('artifacts.share.legend'),
    none: t('artifacts.share.none'),
    newCampaign: t('artifacts.share.newCampaign'),
    archived: t('artifacts.share.archived'),
    save: t('artifacts.share.save'),
  };
}

/** The record types a new artifact may have: the campaign's system's, core and approved, in its order, as named here. */
export function artifactTypeOptions(types: readonly RecordType[], t: Translate): EditorTypeOption[] {
  return types.map((type) => ({ key: type.key, label: recordTypeName(type, t) }));
}

/** The one page an artifact's pages may lead back to besides its campaign's tab (`from=characters`): "Personagens". */
export const FROM_CHARACTERS = 'characters';

/** Story 7.2: the campaign's item encyclopedia tab (`from=items`), "Enciclopédia de itens". */
export const FROM_ITEMS = 'items';

/** Where an artifact's pages may have been opened from, besides the campaign's artifacts tab. */
export type ArtifactFrom = typeof FROM_CHARACTERS | typeof FROM_ITEMS;

/**
 * Where an artifact's pages were opened from: "Personagens" or (Story 7.2) the item encyclopedia when `from` says so,
 * else nowhere in particular (null).
 */
export function fromOf(value: unknown): ArtifactFrom | null {
  return value === FROM_CHARACTERS || value === FROM_ITEMS ? value : null;
}

/**
 * The way back of a new artifact's form and of an artifact's page (Story 5.1): to "Personagens" when they were opened
 * from it, (Story 7.2) to the campaign's item encyclopedia when opened from there, else to the campaign's artifacts
 * tab, labelled "Artefatos".
 */
export function artifactBack(campaignId: string, from: ArtifactFrom | null, t: Translate): { href: string; label: string } {
  if (from === FROM_CHARACTERS) {
    return { href: '/characters', label: t('shell.entries.characters') };
  }
  const tab = from === FROM_ITEMS ? 'items' : 'artifacts';
  return { href: `/campaigns/${encodeURIComponent(campaignId)}?tab=${tab}`, label: t(`campaigns.page.${tab}`) };
}
