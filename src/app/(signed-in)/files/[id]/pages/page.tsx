import { notFound, redirect } from 'next/navigation';

import { notFoundFor } from '@/app/not-found';
import { pageParam } from '@/paging';
import { getMaterial } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

/**
 * "Ir para a página" (usability pass, third round, 2026-11-21): the page view's jump form posts the number it was
 * given here (`?page=`), and this answers with that page's own address, so the form works without JavaScript. A number
 * past the material's last page is its last page, and anything that is not a page number is page 1: someone who types
 * 999 in a book of 364 pages lands on a page, never on "Não encontrado.". Another owner's material, or one that does
 * not exist, is the single not-found page.
 */
export default async function MaterialPagesIndex({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ id }, query, token] = await Promise.all([params, searchParams, currentSessionToken()]);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const material = await getMaterial(token ?? '', id);
  if (!material.ok) {
    notFoundFor(material.problem);
    notFound();
  }
  const total = material.data.pages?.total ?? 1;
  const page = Math.min(pageParam(query.page), Math.max(total, 1));
  redirect(`/files/${encodeURIComponent(material.data.id)}/pages/${page}`);
}
