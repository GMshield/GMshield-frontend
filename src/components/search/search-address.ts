import type { Tier } from '@/client/conversation';

/**
 * The search page's address (Story 3.9): `/search?q=…`, then the stored search once it exists (`s`, so a reload or a page
 * turned reads it instead of searching again), its filters (`tier`, `material`) and the page of its results (`page`,
 * left out for the first). Shared by the context bar's field and the search page.
 */
export type SearchAddress = {
  readonly query: string;
  readonly searchId?: string | null;
  readonly tier?: Tier | null;
  readonly materialId?: string | null;
  readonly page?: number;
};

/** The query fields of a search's address, in a fixed order, the empty ones left out. */
export function searchQuery({ query, searchId, tier, materialId }: SearchAddress): Record<string, string> {
  const fields: Record<string, string> = {};
  if (query !== '') {
    fields.q = query;
  }
  if (searchId !== undefined && searchId !== null) {
    fields.s = searchId;
  }
  if (tier !== undefined && tier !== null) {
    fields.tier = tier;
  }
  if (materialId !== undefined && materialId !== null) {
    fields.material = materialId;
  }
  return fields;
}

/** `/search` with the address's fields; the page only past the first. */
export function searchHref(address: SearchAddress): string {
  const fields = new URLSearchParams(searchQuery(address));
  if (address.page !== undefined && address.page > 1) {
    fields.set('page', String(address.page));
  }
  const query = fields.toString();
  return query === '' ? '/search' : `/search?${query}`;
}

/** Whether the element is one where `/` is typed or handled: a field, an editable text, or inside a dialog. */
function takesTyping(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }
  return element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"]') !== null;
}

/** Whether the field can be seen: one hidden by CSS (the bar's field on a phone) is skipped. */
function shown(field: HTMLInputElement): boolean {
  return typeof field.checkVisibility !== 'function' || field.checkVisibility();
}

/**
 * The `/` key of the search (Story 3.9): when no field, editable text or dialog has focus, focuses the first search field
 * that can be seen (the context bar's, else the search page's own on a phone) and answers true, so the caller keeps the
 * `/` from being typed. Any other key, `/` with Ctrl, Meta or Alt, or one already handled, answers false.
 */
export function focusSearchField(event: KeyboardEvent, document: Document): boolean {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) {
    return false;
  }
  if (takesTyping(document.activeElement)) {
    return false;
  }
  const field = [...document.querySelectorAll<HTMLInputElement>('input[data-search-field]')].find(shown);
  if (field === undefined) {
    return false;
  }
  field.focus();
  field.select();
  return true;
}
