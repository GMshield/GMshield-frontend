'use server';

import type { MoreState } from '@/components/ItemList';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { FILE_STATES, listMaterials } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import { fileRow } from './rows';

/** An id as the backend mints it; anything else is a cursor nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;

/**
 * "Carregar mais" under "Meus Arquivos" (Story 3.3): the next page after the form's `cursor`, appended to the rows
 * already added; the rows stay when it is refused, with the refusal as text. The proxy (src/proxy.ts) and Next.js refuse
 * a cross-origin post before this runs.
 */
export async function moreFiles(previous: MoreState, form: FormData): Promise<MoreState> {
  const { language } = await currentPreferences();
  const cursor = form.get('cursor');
  if (typeof cursor !== 'string' || !ID.test(cursor)) {
    return { ...previous, error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  const page = await listMaterials((await currentSessionToken()) ?? '', FILE_STATES, { cursor });
  if (!page.ok) {
    return { ...previous, error: errorText(page.problem, language) };
  }
  const t = translator(language);
  const rows = page.data.items.map((material) => fileRow(material, t, language));
  return { rows: [...previous.rows, ...rows], nextCursor: page.data.nextCursor ?? null, error: null, added: rows.length };
}
