import type { Translate } from '@/messages';
import type { RecordField } from '@/server/library';

import styles from './RecordFields.module.css';

/** Each field with a key of its own: fields are as extracted, so two may share a name and a value. */
function keyed(fields: readonly RecordField[]): { readonly key: string; readonly field: RecordField }[] {
  const seen = new Map<string, number>();
  return fields.map((field) => {
    const base = `${field.name}\u0000${field.value}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { key: `${base}\u0000${count}`, field };
  });
}

/**
 * A record's fields (Story 4.3): a two-column list (the field's name in label type, its value in body type), in stored
 * order and closed by a rule. A record without fields draws nothing: no empty list and no rule. Shared by the record's
 * page on its system and (Story 4.3 part B) in a campaign's search; (Story 4.3 part C) an answer's record entry draws
 * the list without its rule (`rule` false), its source line following it in the references list.
 */
export function RecordFields({
  fields,
  t,
  rule = true,
}: {
  readonly fields: readonly RecordField[];
  readonly t: Translate;
  readonly rule?: boolean;
}) {
  if (fields.length === 0) {
    return null;
  }
  return (
    <>
      <dl className={styles.details} aria-label={t('systems.records.fields')}>
        {keyed(fields).map(({ key, field }) => (
          <div key={key} className={styles.detail}>
            <dt>{field.name}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      {rule ? <hr className={styles.rule} /> : null}
    </>
  );
}
