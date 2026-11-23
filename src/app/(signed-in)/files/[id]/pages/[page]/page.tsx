import { PageHeader } from '@/components/PageHeader';
import { PillButton } from '@/components/PillButton';
import { PillLink } from '@/components/PillLink';
import Form from 'next/form';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { notFoundFor } from '@/app/not-found';
import { FullScreenButton } from '@/components/FullScreen';
import { Notice } from '@/components/Notice';
import { PageView, pictureUrl } from '@/components/PageView';
import { ZoomablePage } from '@/components/PageZoom';
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
 * material or with no view) shows the single "Não encontrado." page. Since Story 1.20 a picture page sits beside a
 * "Texto extraído" column, which holds its lines' text or says that none was extracted, and an unreadable page whose
 * reading crashed (no picture and no text) says it could not be opened.
 *
 * Usability pass, third round (2026-11-21): the header turns the page and jumps to any page by its number. On a wide
 * screen the picture is as tall as the window leaves room for, and the extracted text beside it scrolls within the
 * same height, so the whole page is seen at once and nothing is turned by scrolling; the links under the page stay for
 * a narrow screen, where the picture and the text are one column. The header says "Página 13 de 364" once, so the
 * picture carries no second caption.
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
  const previous = view.page > 1 ? `${base}/pages/${view.page - 1}` : null;
  const next = view.page < view.pageTotal ? `${base}/pages/${view.page + 1}` : null;
  return (
    <>
      <PageHeader
        title={t('pageView.position', { page: view.page, total: view.pageTotal })}
        back={material.ok ? { href: base, label: material.data.name } : { href: '/files', label: t('shell.entries.files') }}
        // Usability pass: the page is turned from the top, without scrolling past a tall picture to reach the links, and
        // any page is one number away ("Ir para a página"), not hundreds of presses of "Próxima página".
        actions={
          <>
            {view.page > 1 ? <PillLink href={`${base}/pages/${view.page - 1}`}>{t('pageView.previous')}</PillLink> : null}
            {view.pageTotal > 1 ? (
              // next/form: a GET form that turns the page in the browser (so full screen stays on), and a plain form
              // without JavaScript.
              <Form className={styles.jump} action={`${base}/pages`}>
                <label className={styles.jumpLabel} htmlFor="page-jump">
                  {t('paging.goTo')}
                </label>
                <input
                  id="page-jump"
                  className={styles.jumpInput}
                  type="number"
                  name="page"
                  min={1}
                  max={view.pageTotal}
                  defaultValue={view.page}
                  inputMode="numeric"
                  required
                />
                <PillButton type="submit">{t('paging.go')}</PillButton>
              </Form>
            ) : null}
            {view.page < view.pageTotal ? <PillLink href={`${base}/pages/${view.page + 1}`}>{t('pageView.next')}</PillLink> : null}
            <FullScreenButton enter={t('pageView.fullScreen')} leave={t('pageView.leaveFullScreen')} previous={previous} next={next} />
          </>
        }
      />
      {view.picture === null && view.text === null ? (
        <figure className={styles.unopened}>
          <p className={styles.unopenedText}>{t('pageView.unopened')}</p>
          <figcaption className={styles.caption}>{t('pageView.position', { page: view.page, total: view.pageTotal })}</figcaption>
        </figure>
      ) : view.picture === null ? (
        <PageView page={view} pictureSrc={pictureUrl(id, view.page)} language={language} caption={false} />
      ) : (
        <div className={styles.beside}>
          <ZoomablePage
            page={view}
            pictureSrc={pictureUrl(id, view.page)}
            language={language}
            caption={false}
            labels={{ group: t('pageView.zoom'), zoomIn: t('pageView.zoomIn'), zoomOut: t('pageView.zoomOut'), fit: t('pageView.zoomFit') }}
          />
          <section className={styles.extracted} aria-labelledby="extracted-text">
            <h2 id="extracted-text" className={styles.extractedHeading}>
              {t('pageView.extracted')}
            </h2>
            {view.lines.length === 0 ? (
              <p className={styles.noText}>{t('pageView.noText')}</p>
            ) : (
              <div className={styles.extractedText}>{view.lines.map((line) => line.text).join('\n')}</div>
            )}
          </section>
        </div>
      )}
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
