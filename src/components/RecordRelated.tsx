import Link from 'next/link';

import styles from './RecordRelated.module.css';

/** An artifact of the campaign related to a record, as its page lists it: its page's address, its name and type. */
export type RecordRelatedRow = {
  readonly artifactId: string;
  readonly href: string;
  readonly name: string;
  readonly typeLabel: string;
};

export type RecordRelatedProps = {
  readonly rows: readonly RecordRelatedRow[];
  readonly heading: string;
  /** The list's accessible name. */
  readonly label: string;
};

/**
 * "Relacionados" on a campaign's record page (Story 5.5 part B), before "Fontes": the artifacts of the current
 * campaign related to the record, oldest relation first, each a link to its page with its type, in label type as the
 * references read. Nothing at all when there are none.
 */
export function RecordRelated({ rows, heading, label }: RecordRelatedProps) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className={styles.related} aria-labelledby="record-related">
      <h2 id="record-related" className={styles.heading}>
        {heading}
      </h2>
      <ul className={styles.list} aria-label={label}>
        {rows.map((row) => (
          <li key={row.artifactId}>
            <Link className={styles.link} href={row.href}>
              {row.name}
            </Link>
            <span className={styles.type}> · {row.typeLabel}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
