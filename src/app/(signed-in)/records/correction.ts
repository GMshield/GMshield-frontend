import type { RecordCorrectionTexts, RecordDeleteTexts, RecordTypeOption } from '@/components/RecordCorrection';
import type { Translate } from '@/messages';
import { recordTypeName } from '@/record-types';
import type { RecordType } from '@/server/library';

/** Every text of a record's correction (Story 4.5), in the page's language. */
export function correctionTexts(t: Translate): RecordCorrectionTexts {
  const text = (key: keyof RecordCorrectionTexts) => t(`systems.records.correct.${key}`);
  return {
    open: text('open'),
    form: text('form'),
    name: text('name'),
    type: text('type'),
    fields: text('fields'),
    fieldName: text('fieldName'),
    fieldValue: text('fieldValue'),
    fieldNameOf: text('fieldNameOf'),
    fieldValueOf: text('fieldValueOf'),
    noFields: text('noFields'),
    addField: text('addField'),
    removeField: text('removeField'),
    removeFieldOf: text('removeFieldOf'),
    save: text('save'),
    cancel: text('cancel'),
    stale: text('stale'),
    viewCurrent: text('viewCurrent'),
    keepMine: text('keepMine'),
  };
}

/** Every text of a record's delete (Story 4.5 part B), in the page's language. */
export function deletionTexts(t: Translate): RecordDeleteTexts {
  return {
    open: t('systems.records.delete.open'),
    title: t('systems.records.delete.title'),
    consequence: t('systems.records.delete.consequence'),
    confirm: t('systems.records.delete.confirm'),
  };
}

/**
 * The record types a correction offers (Story 4.5): the system's, core and approved, in its order, each named as this
 * interface names it. The record's own type comes first when the list could not be read or lacks it.
 */
export function typeOptions(
  types: readonly RecordType[],
  current: { readonly key: string; readonly name: string; readonly core?: string | null },
  t: Translate,
): RecordTypeOption[] {
  const options = types.map((type) => ({ key: type.key, label: recordTypeName(type, t) }));
  return options.some((option) => option.key === current.key) ? options : [{ key: current.key, label: recordTypeName(current, t) }, ...options];
}
