import type { CorrectionField, CorrectionValues } from '@/components/RecordCorrection';
import { problemFields } from '@/messages';

/**
 * What a record's form posts, read the same way by a record's correction (Story 4.5) and a new artifact (Story 5.1): its
 * name, its type's key and its fields in order (`fieldName` and `fieldValue`, one of each per field), and the part of
 * the form a backend refusal is about. Not a Server Action module: its functions are plain helpers of the actions.
 */

/**
 * Far past every limit (past twice the 8,000 code points of a field's value, each up to two UTF-16 units), so the
 * backend still sees a value too long and names it; only a runaway post is cut.
 */
const MOST = 20_000;
/** Far past the 64 fields a record may have, so the backend still names too many; only a runaway post is cut. */
const MOST_FIELDS = 200;

/**
 * A text as typed, its line breaks as LF: a textarea posts CRLF, which the backend would count and store twice. Cut at
 * `most` UTF-16 units, far past what the backend takes.
 */
export function typedText(value: FormDataEntryValue | null, most: number = MOST): string | null {
  return typeof value === 'string' ? value.replaceAll('\r\n', '\n').slice(0, most) : null;
}

/** The values the form posted, or null when they are not what the form posts (a name and a value per field). */
export function valuesOf(form: FormData): CorrectionValues | null {
  const name = typedText(form.get('name'));
  const recordType = typedText(form.get('recordType'));
  const names = form.getAll('fieldName').slice(0, MOST_FIELDS + 1);
  const values = form.getAll('fieldValue').slice(0, MOST_FIELDS + 1);
  if (name === null || recordType === null || names.length !== values.length) {
    return null;
  }
  const fields: { name: string; value: string }[] = [];
  for (let index = 0; index < names.length; index++) {
    const fieldName = typedText(names[index] ?? null);
    const value = typedText(values[index] ?? null);
    if (fieldName === null || value === null) {
      return null;
    }
    fields.push({ name: fieldName, value });
  }
  return { name, recordType, fields };
}

/** The part a field's problem names, by its kind and its position from 0 (none: the fields as a whole). */
function part(kind: 'name' | 'recordType' | 'fields' | 'fieldName' | 'fieldValue', index: number | null): CorrectionField {
  switch (kind) {
    case 'fieldName':
      return index === null ? 'fields' : `fieldName:${index}`;
    case 'fieldValue':
      return index === null ? 'fields' : `fieldValue:${index}`;
    default:
      return kind;
  }
}

/**
 * The part of the form a backend problem is about, or null for one about the whole form: a correction's `record.*`
 * problems (Story 4.5), and from Story 5.1 `request.invalid` naming its `params.field` (an artifact's).
 */
export function fieldOf(problem: unknown): CorrectionField | null {
  const { code, params } = problemFields(problem);
  const index = typeof params.index === 'number' && Number.isInteger(params.index) && params.index >= 0 ? params.index : null;
  switch (code) {
    case 'record.name_invalid':
      return 'name';
    case 'record.type_invalid':
      return 'recordType';
    case 'record.fields_invalid':
      return 'fields';
    case 'record.field_name_invalid':
      return part('fieldName', index);
    case 'record.field_value_invalid':
      return part('fieldValue', index);
    case 'request.invalid':
      switch (params.field) {
        case 'name':
        case 'recordType':
        case 'fields':
        case 'fieldName':
        case 'fieldValue':
          return part(params.field, index);
        default:
          return null;
      }
    default:
      return null;
  }
}
