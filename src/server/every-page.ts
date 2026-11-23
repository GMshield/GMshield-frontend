import 'server-only';

import type { Result } from './accounts';

/** The most calls one list takes: 20 pages of 50, so 1,000 items, far past any library. */
export const MOST_LIST_CALLS = 20;

/** A whole list, and whether it was read to its end (`complete: false`: only its first 1,000 items). */
export type Every<T> = { readonly items: T[]; readonly complete: boolean };

/**
 * Every page of a list the backend gives by cursor, read one after another, 50 a call: for what needs a whole list
 * (the campaigns and systems a material can be given, the campaign switcher). A screen that shows one page of a list
 * asks for that page alone ({@link import('./list-page').listPage}). A refusal on the way is the answer.
 */
export async function everyPage<T>(
  load: (cursor: string | undefined) => Promise<Result<{ items: T[]; nextCursor?: string }>>,
): Promise<Result<Every<T>>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let call = 0; call < MOST_LIST_CALLS; call++) {
    const result = await load(cursor);
    if (!result.ok) {
      return result;
    }
    items.push(...result.data.items);
    cursor = result.data.nextCursor;
    if (cursor === undefined) {
      return { ok: true, data: { items, complete: true } };
    }
  }
  return { ok: true, data: { items, complete: false } };
}
