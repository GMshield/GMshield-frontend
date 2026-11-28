'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';

import type { LabelTier } from '@/client/conversation';
import { translator, type Language } from '@/messages';
import { pageHref, type Paging } from '@/paging';
import { DEFAULT_VIEW, viewCookieLine, viewsIn, type ListView, type ViewList } from '@/view-cookie';

import { NamedIcon, type IconName } from './Icons';
import styles from './ItemList.module.css';
import { LinkPending } from './LinkPending';
import { MaterialPreview, type LoadPreviewPage } from './MaterialPreview';
import { Pager } from './Pager';
import { ShellPanel } from './ShellPanel';
import { StatePill, type PillState } from './StatePill';
import { Thumbnail } from './Thumbnail';
import { TierLabel } from './TierLabel';
import { ViewMenu } from './ViewMenu';

/**
 * One row of a list (Story 3.1): its text, an optional muted detail, the page it opens, and a material's state. From
 * the usability pass (2026-11-21) a material that has pages also carries the address of its first page's picture
 * (`thumbnail`) and how many pages a preview may turn (`pages`). From Story 7.2 an entry of the item encyclopedia
 * carries its tier (`tier`), drawn before its name as a tier pill ({@link TierLabel}: "Sistema", "Personalizado"...).
 */
export type ListRow = {
  readonly id: string;
  readonly label: string;
  readonly detail: string | null;
  readonly href: string | null;
  readonly state: { readonly state: PillState; readonly word: string } | null;
  readonly thumbnail?: string | null;
  readonly pages?: number | null;
  readonly tier?: LabelTier | null;
};

/**
 * Which page of the whole list the rows are, and the list's address: its path and the other fields of its query (a
 * filter, a tab), which every page link keeps.
 */
export type ListPaging = {
  readonly paging: Paging;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  /** The query field that carries the page (Story 4.4: `page` unless the screen pages two lists). */
  readonly field?: string;
};

export type ItemListProps = {
  /** The list's accessible name. */
  readonly label: string;
  /** The rows of the page shown, read by the server. */
  readonly rows: readonly ListRow[];
  /** Where those rows stand in the whole list; without it the list is not paged. */
  readonly pages?: ListPaging;
  /** The icon that leads a row without a thumbnail: what kind of thing the list holds. */
  readonly icon?: IconName;
  /**
   * The display options (usability pass): which list this is, how the server read it from the cookie, and the
   * interface's language for the "Exibição" menu. Without them the list is a plain comfortable list with no menu.
   */
  readonly viewKey?: ViewList;
  readonly view?: ListView;
  readonly language?: Language;
  /** What sits at the left of the toolbar, such as the filters. */
  readonly toolbar?: ReactNode;
  /** Reads one page of a material for the preview panel; with it, a row that has pages offers "Pré-visualizar". */
  readonly preview?: { readonly load: LoadPreviewPage; readonly label: string };
};

/**
 * A list page's rows (Story 3.1): each row opens its page when it has one, with a material's state pill and a muted
 * detail (a system's edition; from Story 3.3 a material's size, pages and place, after its state).
 *
 * Usability pass (2026-11-21):
 * - A row reads in two lines: its name, then its detail, with an icon or a thumbnail before them and its state at the
 *   right, so names line up and a state is found by scanning one column.
 * - A toolbar above the rows holds the page's filters and the "Exibição" menu: list or grid, comfortable or compact,
 *   rows a page, thumbnails or not. The choice applies at once and is kept in a cookie, so the server renders it next
 *   time.
 * - A material with pages shows its first page as a thumbnail and offers a preview: a panel at the right with its
 *   pages, without leaving the list.
 * - Third round: a long list is paged ({@link Pager} under the rows) instead of growing with "Carregar mais", so a
 *   list never becomes one long column to scroll, and a page can be linked. Choosing how many rows a page holds starts
 *   again from the first page.
 */
export function ItemList({
  label,
  rows,
  pages: listPages,
  icon = 'file',
  viewKey,
  view: initialView = DEFAULT_VIEW,
  language,
  toolbar,
  preview,
}: ItemListProps) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [previewing, setPreviewing] = useState<ListRow | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const shown = rows;
  const change = (next: ListView) => {
    setView(next);
    if (viewKey !== undefined) {
      // The other lists keep what the cookie already holds for them.
      document.cookie = viewCookieLine({ ...viewsIn(document.cookie), [viewKey]: next });
    }
    if (next.size !== view.size && listPages !== undefined) {
      // Another number of rows a page: the server cuts the pages again, from the first one.
      if (listPages.paging.page > 1) {
        router.replace(pageHref(listPages.path, listPages.query ?? {}, 1, listPages.field));
      } else {
        router.refresh();
      }
    }
  };
  const closePreview = () => {
    setPreviewing(null);
    const button = opener.current;
    opener.current = null;
    // Once the panel has gone: focus goes back to the control that opened it.
    queueMicrotask(() => button?.focus());
  };
  const hasThumbnails = shown.some((row) => typeof row.thumbnail === 'string');
  // Story 7.2: a row's tier pill needs the interface's words; a list without a language shows none.
  const t = language === undefined ? null : translator(language);
  const menu =
    viewKey === undefined || language === undefined ? null : (
      <ViewMenu view={view} language={language} previews={hasThumbnails} sizes={listPages !== undefined} onChange={change} />
    );
  return (
    <>
      {toolbar === undefined && menu === null ? null : (
        <div className={styles.toolbar}>
          <div className={styles.toolbarStart}>{toolbar}</div>
          <div className={styles.toolbarEnd}>
            {/* The pages can be turned from above the rows too, without scrolling to the pager under them. */}
            {listPages === undefined || language === undefined ? null : (
              <Pager
                paging={listPages.paging}
                path={listPages.path}
                query={listPages.query}
                field={listPages.field}
                language={language}
                label={translator(language)('paging.labelTop')}
                compact
              />
            )}
            {menu}
          </div>
        </div>
      )}
      <ul className={styles.list} aria-label={label} data-layout={view.layout} data-density={view.density}>
        {shown.map((row) => {
          const thumbnail = view.previews && typeof row.thumbnail === 'string' ? row.thumbnail : null;
          const content = (
            <>
              <span className={styles.lead} data-kind={thumbnail === null ? 'icon' : 'thumbnail'}>
                {thumbnail === null ? <NamedIcon name={icon} size={22} /> : <Thumbnail src={thumbnail} icon={icon} />}
              </span>
              <span className={styles.label}>
                {row.tier === undefined || row.tier === null || t === null ? null : <TierLabel tier={row.tier} t={t} className={styles.tier} />}
                {row.label}
              </span>
              {row.state === null ? null : (
                <span className={styles.state}>
                  <StatePill state={row.state.state} word={row.state.word} />
                </span>
              )}
              {row.detail === null ? null : <span className={styles.detail}>{row.detail}</span>}
              {row.href === null ? null : (
                <span className={styles.chevron}>
                  {/* The arrow gives way to a spinner while the row's page is on its way. */}
                  <LinkPending>
                    <NamedIcon name="forward" size={18} />
                  </LinkPending>
                </span>
              )}
            </>
          );
          const pageCount = row.pages ?? 0;
          return (
            <li key={row.id} className={styles.item}>
              {row.href === null ? (
                <span className={styles.row}>{content}</span>
              ) : (
                <Link className={`${styles.row} ${styles.link}`} href={row.href}>
                  {content}
                </Link>
              )}
              {preview === undefined || pageCount < 1 ? null : (
                <button
                  type="button"
                  className={styles.preview}
                  aria-label={preview.label.replace('{name}', row.label)}
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setPreviewing(row);
                  }}
                >
                  <NamedIcon name="eye" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {listPages === undefined || language === undefined ? null : (
        <Pager paging={listPages.paging} path={listPages.path} query={listPages.query} field={listPages.field} language={language} />
      )}
      {previewing === null || preview === undefined || language === undefined ? null : (
        <ShellPanel
          onReplaced={() => {
            // Story 3.12: another right panel took the slot; focus stays with it.
            opener.current = null;
            setPreviewing(null);
          }}
        >
          <MaterialPreview
            key={previewing.id}
            id={previewing.id}
            name={previewing.label}
            href={previewing.href}
            pages={previewing.pages ?? 1}
            language={language}
            load={preview.load}
            onClose={closePreview}
          />
        </ShellPanel>
      )}
    </>
  );
}
