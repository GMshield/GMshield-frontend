import Link from 'next/link';

import { translator, type Language } from '@/messages';
import { pageHref, pageWindow, type Paging } from '@/paging';

import { NamedIcon } from './Icons';
import styles from './Pager.module.css';

export type PagerProps = {
  /** Where the page shown stands in its list. */
  readonly paging: Paging;
  /** The list's address without its page, and the other fields of its query (a filter, a tab), kept by every link. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  /** The query field that carries the page; `page` unless a screen pages two things. */
  readonly field?: string;
  readonly language: Language;
  /** The navigation's accessible name, when "Paginação" alone would not tell two pagers of one screen apart. */
  readonly label?: string;
  /**
   * A small pager, for a list's toolbar and for a list inside a card (a material's outline): the rows shown and the two
   * arrows, with no page numbers and no words on the arrows. Turning a page with it keeps the reader where they are
   * instead of going back to the top.
   */
  readonly compact?: boolean;
};

/**
 * The pages of a list (usability pass, third round, 2026-11-21): which rows are shown ("11–20 de 61"), then the way to
 * the previous page, the page numbers and the next page. Every control is a link, so a page can be opened in a new tab,
 * linked and reached without JavaScript; the current page says so (`aria-current`), and at an end the arrow that leads
 * nowhere stays in place, dimmed, so the others do not move under the pointer. On a phone the numbers give way to
 * "Página 2 de 7". A list of one page shows only how many rows it has (and a compact pager nothing at all).
 */
export function Pager({ paging, path, query = {}, field = 'page', language, label, compact = false }: PagerProps) {
  const t = translator(language);
  const { page, pages, total, from, to } = paging;
  if (total === 0 || (compact && pages === 1)) {
    return null;
  }
  const href = (number: number) => pageHref(path, query, number, field);
  const summary =
    pages === 1
      ? t(total === 1 ? 'paging.totalOne' : 'paging.totalOther', { total })
      : t('paging.range', { from, to, total });
  const step = (direction: 'previous' | 'next') => {
    const target = direction === 'previous' ? page - 1 : page + 1;
    const content = (
      <>
        {direction === 'previous' ? <NamedIcon name="previous" size={18} /> : null}
        <span className={compact ? styles.hidden : styles.stepWord}>{t(`paging.${direction}`)}</span>
        {direction === 'next' ? <NamedIcon name="forward" size={18} /> : null}
      </>
    );
    return target < 1 || target > pages ? (
      // Not a link at an end: it leads nowhere. It keeps its place, and assistive technology hears that it is off.
      <span className={styles.step} aria-disabled="true">
        {content}
      </span>
    ) : (
      <Link className={styles.step} href={href(target)} rel={direction === 'previous' ? 'prev' : 'next'} scroll={!compact}>
        {content}
      </Link>
    );
  };
  return (
    <div className={styles.pager} data-compact={compact ? 'true' : undefined}>
      <p className={styles.summary}>
        {summary}
        {paging.complete ? null : <span className={styles.capped}> {t('paging.capped')}</span>}
      </p>
      {pages === 1 ? null : (
        <nav aria-label={label ?? t('paging.label')}>
          <ul className={styles.steps}>
            <li>{step('previous')}</li>
            {compact
              ? null
              : pageWindow(page, pages).map((number, index) =>
                  number === null ? (
                    <li key={`gap-${index}`} className={styles.number} aria-hidden="true">
                      <span className={styles.gap}>…</span>
                    </li>
                  ) : (
                    <li key={number} className={styles.number}>
                      <Link
                        className={styles.page}
                        href={href(number)}
                        aria-label={t(number === page ? 'paging.current' : 'paging.page', { page: number })}
                        aria-current={number === page ? 'page' : undefined}
                      >
                        {number}
                      </Link>
                    </li>
                  ),
                )}
            {compact ? null : <li className={styles.position}>{t('paging.position', { page, pages })}</li>}
            <li>{step('next')}</li>
          </ul>
        </nav>
      )}
    </div>
  );
}
