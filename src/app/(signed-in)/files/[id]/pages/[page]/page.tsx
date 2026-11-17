import Link from 'next/link';
import { notFound } from 'next/navigation';

import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { PageView } from '@/components/PageView';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { getMaterial, getPage } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import styles from './page.module.css';

/** A page number from 1: no sign, no leading zero. Anything else is a page nowhere. */
const PAGE = /^[1-9]\d{0,6}$/;

/**
 * One page of a material while its owner reviews it (Story 1.19): the material's name (back to its page), the page as
 * `PageView` shows it with "Página 13 de 364", and links to the previous and next pages, each hidden at the first and
 * the last page. A page the backend does not serve (another owner's, a version not under review, a page outside the
 * material or with no view) shows the single "Não encontrado." page.
 */
export default async function MaterialPageView({
  params,
}: {
  readonly params: Promise<{ readonly id: string; readonly page: string }>;
}) {
  const [{ id, page }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  if (!PAGE.test(page)) {
    notFound();
  }
  const t = translator(language);
  const number = Number(page);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const [found, material] = await Promise.all([getPage(token ?? '', id, number), getMaterial(token ?? '', id)]);
  if (!found.ok) {
    notFoundFor(found.problem);
    return <Notice status="danger" language={language} message={errorText(found.problem, language)} />;
  }
  const view = found.data;
  const base = `/files/${encodeURIComponent(id)}`;
  return (
    <>
      <h1 className={styles.heading}>
        {material.ok ? (
          <Link className={styles.back} href={base}>
            {material.data.name}
          </Link>
        ) : (
          t('pageView.position', { page: view.page, total: view.pageTotal })
        )}
      </h1>
      <PageView page={view} materialId={id} language={language} />
      <nav className={styles.nav} aria-label={t('pageView.navigation')}>
        {view.page > 1 ? (
          <Link className={styles.step} href={`${base}/pages/${view.page - 1}`} rel="prev">
            {t('pageView.previous')}
          </Link>
        ) : null}
        {view.page < view.pageTotal ? (
          <Link className={styles.step} href={`${base}/pages/${view.page + 1}`} rel="next">
            {t('pageView.next')}
          </Link>
        ) : null}
      </nav>
    </>
  );
}
