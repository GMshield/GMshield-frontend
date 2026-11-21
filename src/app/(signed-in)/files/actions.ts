'use server';

import { getPage, type MaterialPageView } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

/** An id as the backend mints it; anything else is a material nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;

/** The most pages a material may have, as far as a preview asks: at most 6 digits. */
const MOST_PAGES = 999_999;

/**
 * One page of a material for the preview panel (usability pass, 2026-11-21): the page as the review ground shows it,
 * or null for an id or a number that cannot be one, another owner's material, a page it does not have, or a backend
 * that does not answer. Read on request, never stored. The proxy (src/proxy.ts) and Next.js refuse a cross-origin post
 * before this runs.
 */
export async function previewPageAction(id: string, page: number): Promise<MaterialPageView | null> {
  if (typeof id !== 'string' || !ID.test(id) || !Number.isInteger(page) || page < 1 || page > MOST_PAGES) {
    return null;
  }
  const result = await getPage((await currentSessionToken()) ?? '', id, page);
  return result.ok ? result.data : null;
}
