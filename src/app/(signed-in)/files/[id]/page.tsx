import Link from 'next/link';

import { notFoundFor } from '@/app/not-found';
import { MaterialActions } from '@/components/MaterialActions';
import { MaterialPlace } from '@/components/MaterialPlace';
import { MaterialRefresher } from '@/components/MaterialRefresher';
import { PageHeader, PageSubtitle } from '@/components/PageHeader';
import { PageView, pictureUrl } from '@/components/PageView';
import { Notice } from '@/components/Notice';
import { OUTLINE_FIELD, QualityReport, UNREADABLE_FIELD } from '@/components/QualityReport';
import { StatePill } from '@/components/StatePill';
import { placeOfBelonging, progressOf } from '@/components/uploads/types';
import { errorText, failureText, messagesFor, translator } from '@/messages';
import { pageParam } from '@/paging';
import { currentPreferences } from '@/preferences';
import { listAllCampaigns, listAllSystems } from '@/server/library';
import { getMaterial, getPage, getReport } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import { systemLabel } from '../../campaigns/rows';
import { belongingText } from '../rows';

import { changePlaceAction, materialAction } from './actions';
import styles from './page.module.css';

/**
 * A material's page (Story 1.14), minimal for now: its name and the state of its newest version. Another owner's id,
 * an unknown one or a malformed one shows the single "Não encontrado." page. Since Story 1.15 the pill shows the pages
 * done of the total while processing, a failed material says why under it, and the page refreshes itself every 5 s
 * while its state is moving and the tab is visible. Since Story 1.17 the pill names what is being read ("lendo texto ·
 * 40 de 364 páginas", "lendo por OCR · 12 de 80 páginas"), and while processing or needing review the page lists the
 * pages read directly, read by OCR and still waiting, and the unreadable ones when there are any. Since Story 1.19 a
 * material that needs review or is ready links to its first page ("Ver páginas"). Since Story 1.20 a material that
 * needs review shows its quality report (the counts as numerals, the outline, the warnings and the unreadable pages)
 * and the actions the backend allows (Aceitar, Reprocessar páginas com falha, Descartar); a ready one shows the report
 * read-only; a failed one says why, then offers Tentar de novo and Descartar. The pages read directly, by OCR and still
 * waiting are listed while processing only.
 *
 * Story 3.3: "Onde pertence" says where the material belongs, in a sentence, and "Alterar" opens a form to change it
 * ({@link MaterialPlace}): one of the campaigns in use, one system or several systems, read here with the material.
 * Once saved, the page shows the new place and "Vale a partir da próxima pergunta.".
 *
 * Usability pass (2026-11-21): the page has the shared header (the way back to "Meus Arquivos", the name, the state
 * under it), then the actions the backend allows, then two columns: the facts on the left (where it belongs, the page
 * counts, the quality report) and, once the material needs review or is ready and has pages, a preview of its first
 * page on the right with "Ver páginas" under it. A failed material says why in a notice under the header.
 *
 * Third round: the report's outline and unreadable pages are paged (`?outline=`, `?unreadable=`), so a long book no
 * longer makes this page many screens long; the first page's preview is no taller than the window leaves room for.
 */
export default async function MaterialPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams?: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ id }, query, { language }, token] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<Readonly<Record<string, string | string[] | undefined>>>({}),
    currentPreferences(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const [material, campaigns, systems] = await Promise.all([
    getMaterial(token ?? '', id),
    listAllCampaigns(token ?? ''),
    listAllSystems(token ?? ''),
  ]);
  if (!material.ok) {
    notFoundFor(material.problem);
    return <Notice status="danger" language={language} message={errorText(material.problem, language)} />;
  }
  const places = {
    campaigns: campaigns.ok
      ? campaigns.data.map((item) => ({ id: item.id, name: item.name, system: { id: item.system.id, name: systemLabel(item.system, t) } }))
      : [],
    systems: systems.ok ? systems.data.map((item) => ({ id: item.id, name: systemLabel(item, t) })) : [],
    current: null,
  };
  const belongingTexts = messagesFor(language).material.belonging;
  // Nothing to pick because the lists could not be loaded: the page says why instead of offering "Alterar".
  const failed = [campaigns, systems].find((result) => !result.ok);
  const unavailable =
    places.campaigns.length === 0 && places.systems.length === 0 && failed !== undefined && !failed.ok
      ? errorText(failed.problem, language)
      : null;
  const { state, pages, failure } = material.data;
  const actions = material.data.actions ?? [];
  const reviewed = state === 'needs_review' || state === 'ready';
  const report = reviewed ? await getReport(token ?? '', id) : null;
  const progress = state === 'processing' && pages !== undefined ? progressOf(pages) : null;
  const word = progress?.phase ? t(`material.phase.${progress.phase}`) : t(`material.state.${state}`);
  const detail = progress === null ? undefined : t('material.pages', { done: progress.done, total: progress.total });
  const counts =
    pages !== undefined && state === 'processing'
      ? [
          { key: 'readDirectly', value: pages.readDirectly },
          { key: 'readByOcr', value: pages.readByOcr },
          { key: 'waiting', value: Math.max(pages.total - pages.done, 0) },
          ...(pages.unreadable > 0 ? [{ key: 'unreadable', value: pages.unreadable }] : []),
        ]
      : [];
  const first = reviewed && (pages?.total ?? 0) > 0 ? await getPage(token ?? '', id, 1) : null;
  const firstPage = first !== null && first.ok ? first.data : null;
  const pagesHref = `/files/${encodeURIComponent(material.data.id)}/pages/1`;
  return (
    <>
      <PageHeader title={material.data.name} back={{ href: '/files', label: t('shell.entries.files') }}>
        <PageSubtitle>
          <span className={styles.label}>{t('material.stateLabel')}</span>
          <StatePill state={state} word={word} detail={detail} />
        </PageSubtitle>
      </PageHeader>
      {state === 'failed' ? (
        <Notice status="danger" language={language} message={failureText(failure, language)} dismissible={false} />
      ) : null}
      <MaterialActions
        id={material.data.id}
        name={material.data.name}
        actions={actions}
        pages={pages?.done}
        language={language}
        action={materialAction}
      />
      <div className={styles.columns} data-preview={firstPage === null ? 'none' : 'shown'}>
        <div className={styles.facts}>
          <MaterialPlace
            id={material.data.id}
            version={material.data.version}
            summary={belongingText(material.data.belonging, t, language)}
            place={placeOfBelonging(material.data.belonging)}
            places={places}
            unavailable={unavailable}
            texts={{
              label: belongingTexts.label,
              change: belongingTexts.change,
              formLabel: belongingTexts.formLabel,
              save: belongingTexts.save,
              cancel: belongingTexts.cancel,
              saved: belongingTexts.saved,
              picker: messagesFor(language).upload.dialog.belonging,
            }}
            action={changePlaceAction}
          />
          {counts.length === 0 ? null : (
            <section className={styles.counts} aria-labelledby="material-counts">
              <h2 id="material-counts" className={styles.sectionHeading}>
                {t('material.counts.label')}
              </h2>
              {progress === null ? null : (
                <progress
                  className={styles.progress}
                  value={progress.done}
                  max={Math.max(progress.total, 1)}
                  aria-label={t('material.pages', { done: progress.done, total: progress.total })}
                />
              )}
              <dl className={styles.countList}>
                {counts.map(({ key, value }) => (
                  <div key={key} className={styles.count} data-count={key}>
                    <dt>{t(`material.counts.${key as 'readDirectly' | 'readByOcr' | 'waiting' | 'unreadable'}`)}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {report === null ? null : report.ok ? (
            <QualityReport
              materialId={material.data.id}
              pages={pages}
              report={report.data}
              language={language}
              outlinePage={pageParam(query[OUTLINE_FIELD])}
              unreadablePage={pageParam(query[UNREADABLE_FIELD])}
            />
          ) : (
            <p className={styles.failure}>{errorText(report.problem, language)}</p>
          )}
        </div>
        {firstPage === null ? null : (
          <section className={styles.preview} aria-labelledby="material-preview">
            <h2 id="material-preview" className={styles.sectionHeading}>
              {t('preview.heading')}
            </h2>
            {firstPage.picture === null && firstPage.text === null ? (
              <p className={styles.note}>{t('preview.none')}</p>
            ) : (
              <div className={styles.previewPage}>
                <PageView page={firstPage} pictureSrc={pictureUrl(material.data.id, 1)} language={language} caption={false} />
              </div>
            )}
            <p className={styles.pages}>
              <Link className={styles.pagesLink} href={pagesHref}>
                {t('material.viewPages')}
              </Link>
            </p>
          </section>
        )}
      </div>
      {reviewed && firstPage === null ? (
        <p className={styles.pages}>
          <Link className={styles.pagesLink} href={pagesHref}>
            {t('material.viewPages')}
          </Link>
        </p>
      ) : null}
      <MaterialRefresher state={state} />
    </>
  );
}
