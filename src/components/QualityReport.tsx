import Link from 'next/link';

import { translator, type Language, type MessagePath } from '@/messages';
import type { Material, MaterialReport } from '@/server/materials';

import styles from './QualityReport.module.css';

/** The deepest outline level indented apart: deeper headings share its indent. */
const DEEPEST = 6;

type Warning = MaterialReport['warnings'][number];
type Pages = NonNullable<Material['pages']>;

/** The words of a warning the backend found, or null for a code this release does not know (never the code). */
function warningText(warning: Warning, language: Language): string | null {
  const t = translator(language);
  const reason = warning.code.startsWith('report.') ? warning.code.slice('report.'.length) : '';
  if (!['pages_unreadable', 'pages_unopened', 'outline_empty'].includes(reason)) {
    return null;
  }
  const form = warning.count === 1 ? 'one' : 'other';
  return t(`material.report.warning.${reason}.${form}` as MessagePath, { count: warning.count });
}

/**
 * The quality report of a material's version (Story 1.20), for a version that needs review and, read-only, for a
 * ready one: three large numerals (the pages processed, read by OCR and unreadable), the outline as a plain list
 * indented by level through classes, the warnings written as facts, and the unreadable pages as links to their page.
 * No chart. Titles are React text, never HTML.
 */
export function QualityReport({
  materialId,
  pages,
  report,
  language,
}: {
  readonly materialId: string;
  readonly pages: Pages | undefined;
  readonly report: MaterialReport;
  readonly language: Language;
}) {
  const t = translator(language);
  const numerals = [
    { key: 'done', value: pages?.done ?? 0 },
    { key: 'readByOcr', value: pages?.readByOcr ?? 0 },
    { key: 'unreadable', value: pages?.unreadable ?? 0 },
  ] as const;
  const shallowest = report.outline.reduce((least, section) => Math.min(least, section.level), Number.POSITIVE_INFINITY);
  const warnings = report.warnings.map((warning) => warningText(warning, language)).filter((text) => text !== null);
  const base = `/files/${encodeURIComponent(materialId)}/pages`;
  return (
    <section className={styles.report} aria-labelledby="quality-report">
      <h2 id="quality-report" className={styles.heading}>
        {t('material.report.label')}
      </h2>
      <dl className={styles.numerals}>
        {numerals.map(({ key, value }) => (
          <div key={key} className={styles.numeral} data-numeral={key}>
            <dt className={styles.meta}>{t(`material.report.${key}`)}</dt>
            <dd className={styles.value}>{value}</dd>
          </div>
        ))}
      </dl>
      {warnings.length === 0 ? null : (
        <section className={styles.part} aria-labelledby="report-warnings">
          <h3 id="report-warnings" className={styles.meta}>
            {t('material.report.warnings')}
          </h3>
          <ul className={styles.warnings}>
            {warnings.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      {report.unreadable.length === 0 ? null : (
        <section className={styles.part} aria-labelledby="report-unreadable">
          <h3 id="report-unreadable" className={styles.meta}>
            {t('material.report.unreadablePages')}
          </h3>
          <ul className={styles.runs}>
            {report.unreadable.map((run) => (
              <li key={run.firstPage}>
                <Link className={styles.run} href={`${base}/${run.firstPage}`}>
                  {run.firstPage === run.lastPage
                    ? t('material.report.page', { page: run.firstPage })
                    : t('material.report.run', { first: run.firstPage, last: run.lastPage })}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.outline.length === 0 ? null : (
        <section className={styles.part} aria-labelledby="report-outline">
          <h3 id="report-outline" className={styles.meta}>
            {t('material.report.outline')}
          </h3>
          <ul className={styles.outline}>
            {report.outline.map((section, index) => (
              <li
                key={index}
                className={styles[`level${Math.min(section.level - shallowest, DEEPEST)}`]}
                data-level={section.level}
              >
                <Link className={styles.section} href={`${base}/${section.page}`}>
                  {section.title}
                </Link>
                <span className={styles.sectionPage}>{section.page}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
