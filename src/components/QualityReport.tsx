import Link from 'next/link';

import { translator, type Language, type MessagePath } from '@/messages';
import { pageOf } from '@/paging';
import type { Material, MaterialReport } from '@/server/materials';

import { Pager } from './Pager';
import styles from './QualityReport.module.css';

/** How many sections of the outline, and how many runs of unreadable pages, show at a time. */
export const OUTLINE_PAGE_SIZE = 10;
export const UNREADABLE_PAGE_SIZE = 12;

/** The query fields that carry the page of the outline and of the unreadable pages. */
export const OUTLINE_FIELD = 'outline';
export const UNREADABLE_FIELD = 'unreadable';

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
 *
 * Usability pass, third round (2026-11-21): a book has hundreds of sections and a poor scan dozens of unreadable runs,
 * and the report used to list them all, so the material's page grew to many screens. The outline now shows ten
 * sections at a time and the unreadable pages twelve runs, each with a small pager beside its heading (`?outline=`,
 * `?unreadable=`); turning one keeps the other and the place on the screen. Indents come from the whole outline, so a
 * section sits at the same depth on every page.
 */
export function QualityReport({
  materialId,
  pages,
  report,
  language,
  outlinePage = 1,
  unreadablePage = 1,
}: {
  readonly materialId: string;
  readonly pages: Pages | undefined;
  readonly report: MaterialReport;
  readonly language: Language;
  /** Which page of the outline and of the unreadable pages to show, from the address. */
  readonly outlinePage?: number;
  readonly unreadablePage?: number;
}) {
  const t = translator(language);
  const numerals = [
    { key: 'done', value: pages?.done ?? 0 },
    { key: 'readByOcr', value: pages?.readByOcr ?? 0 },
    { key: 'unreadable', value: pages?.unreadable ?? 0 },
  ] as const;
  const shallowest = report.outline.reduce((least, section) => Math.min(least, section.level), Number.POSITIVE_INFINITY);
  const warnings = report.warnings.map((warning) => warningText(warning, language)).filter((text) => text !== null);
  const here = `/files/${encodeURIComponent(materialId)}`;
  const base = `${here}/pages`;
  const outline = pageOf(
    report.outline.map((section, index) => ({ section, index })),
    outlinePage,
    OUTLINE_PAGE_SIZE,
  );
  const unreadable = pageOf(report.unreadable, unreadablePage, UNREADABLE_PAGE_SIZE);
  // Each pager keeps the other list's page.
  const query: Record<string, string> = {};
  if (outline.paging.page > 1) {
    query[OUTLINE_FIELD] = String(outline.paging.page);
  }
  if (unreadable.paging.page > 1) {
    query[UNREADABLE_FIELD] = String(unreadable.paging.page);
  }
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
          <div className={styles.partHead}>
            <h3 id="report-unreadable" className={styles.meta}>
              {t('material.report.unreadablePages')}
            </h3>
            <Pager
              paging={unreadable.paging}
              path={here}
              query={query}
              field={UNREADABLE_FIELD}
              language={language}
              label={t('paging.unreadable')}
              compact
            />
          </div>
          <ul className={styles.runs}>
            {unreadable.rows.map((run) => (
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
          <div className={styles.partHead}>
            <h3 id="report-outline" className={styles.meta}>
              {t('material.report.outline')}
            </h3>
            <Pager
              paging={outline.paging}
              path={here}
              query={query}
              field={OUTLINE_FIELD}
              language={language}
              label={t('paging.outline')}
              compact
            />
          </div>
          <ul className={styles.outline}>
            {outline.rows.map(({ section, index }) => (
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
