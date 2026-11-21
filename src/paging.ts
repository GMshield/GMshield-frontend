/**
 * A list a page at a time (usability pass, third round, 2026-11-21): a long list is paged, never one growing column.
 * The page is in the address (`?page=3`), so it can be linked, reloaded and reached without JavaScript; how many rows a
 * page holds is one of the display options ({@link PAGE_SIZES}, kept with the list's view).
 */
export const PAGE_SIZES = [10, 20, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 10;

/** Where a page stands in its list: rows `from` to `to` (from 1) of `total`, page `page` of `pages`. */
export type Paging = {
  readonly page: number;
  readonly pages: number;
  readonly total: number;
  readonly from: number;
  readonly to: number;
  /** False when the list was longer than the server reads at once: `total` is then the part that was read. */
  readonly complete: boolean;
};

/** A page number from 1: no sign, no leading zero, at most 6 digits. */
const PAGE = /^[1-9]\d{0,5}$/;

/** The page a `?page=` value asks for; 1 for anything that is not a page number. */
export function pageParam(value: unknown): number {
  return typeof value === 'string' && PAGE.test(value) ? Number(value) : 1;
}

/**
 * Page `page` of `items`, `size` a page. A page past the end is the last one (a list that lost rows since the link was
 * made still shows something); an empty list is one empty page.
 */
export function pageOf<T>(items: readonly T[], page: number, size: number, complete = true): { readonly rows: readonly T[]; readonly paging: Paging } {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  const start = (at - 1) * size;
  const rows = items.slice(start, start + size);
  return { rows, paging: { page: at, pages, total, from: rows.length === 0 ? 0 : start + 1, to: start + rows.length, complete } };
}

/**
 * The page numbers a pager shows around `page`: the first, the last, the current one and its neighbours, with `null`
 * where numbers are left out ("1 … 4 5 6 … 12"). Seven or fewer pages show every number.
 */
export function pageWindow(page: number, pages: number): readonly (number | null)[] {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, index) => index + 1);
  }
  const shown = new Set([1, pages, page - 1, page, page + 1]);
  // Near an end, the run is as long as in the middle, so the pager keeps its width while pages are turned.
  if (page <= 3) {
    [2, 3, 4].forEach((number) => shown.add(number));
  }
  if (page >= pages - 2) {
    [pages - 3, pages - 2, pages - 1].forEach((number) => shown.add(number));
  }
  const numbers = [...shown].filter((number) => number >= 1 && number <= pages).sort((a, b) => a - b);
  const window: (number | null)[] = [];
  numbers.forEach((number, index) => {
    const before = numbers[index - 1];
    if (before !== undefined && number - before > 1) {
      // One number left out is shown as itself, never as a gap that hides a single page.
      window.push(number - before === 2 ? number - 1 : null);
    }
    window.push(number);
  });
  return window;
}

/** The address of page `page` of the list at `path` with the other `query` fields kept; page 1 has no `page` field. */
export function pageHref(path: string, query: Readonly<Record<string, string>>, page: number, field = 'page'): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (name !== field) {
      params.set(name, value);
    }
  }
  if (page > 1) {
    params.set(field, String(page));
  }
  const text = params.toString();
  return text === '' ? path : `${path}?${text}`;
}
