import 'server-only';

import { pagesOf, pagingOf, type Paging } from '../paging';

import type { Result } from './accounts';

/** The furthest position the backend lets a list page start at (its `offset`, public contract 1.22.0). */
export const MOST_OFFSET = 100_000;

/** What a list endpoint is asked for one page: how many rows, and how many of the newest to skip. */
export type PageQuery = { readonly limit: number; readonly offset?: number };

/** One page of a list as a screen shows it: its rows, and where they stand in the whole list. */
export type ListPage<T> = { readonly rows: readonly T[]; readonly paging: Paging };

/**
 * Page `page` of a list the backend pages, `size` rows a page: one call with `limit` and `offset`, and the list's
 * `total` from the answer (public contract 1.22.0), so the pager can number the pages without reading the whole list.
 * A page past the end (rows were deleted since the link was made) is asked again as the last page, so the screen still
 * shows something. The first page sends no `offset`. A refusal is the answer.
 */
export async function listPage<T>(
  load: (query: PageQuery) => Promise<Result<{ items: T[]; total: number }>>,
  page: number,
  size: number,
): Promise<Result<ListPage<T>>> {
  const ask = async (start: number) => {
    const result = await load(start === 0 ? { limit: size } : { limit: size, offset: start });
    return result.ok ? { ok: true as const, start, items: result.data.items, total: result.data.total } : result;
  };
  const wanted = Math.min((Math.max(1, Math.trunc(page) || 1) - 1) * size, MOST_OFFSET - (MOST_OFFSET % size));
  let answer = await ask(wanted);
  if (answer.ok && answer.items.length === 0 && answer.total > 0 && wanted > 0) {
    answer = await ask(Math.min((pagesOf(answer.total, size) - 1) * size, wanted));
  }
  if (!answer.ok) {
    return answer;
  }
  // An empty list is its one empty first page, whatever page was asked for.
  const start = answer.total === 0 ? 0 : answer.start;
  return { ok: true, data: { rows: answer.items, paging: pagingOf(answer.total, start, answer.items.length, size) } };
}
