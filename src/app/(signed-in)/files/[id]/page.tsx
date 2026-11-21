import Link from 'next/link';

import { notFoundFor } from '@/app/not-found';
import { MaterialActions } from '@/components/MaterialActions';
import { MaterialPlace } from '@/components/MaterialPlace';
import { MaterialRefresher } from '@/components/MaterialRefresher';
import { Notice } from '@/components/Notice';
import { QualityReport } from '@/components/QualityReport';
import { StatePill } from '@/components/StatePill';
import { placeOfBelonging, progressOf } from '@/components/uploads/types';
import { errorText, failureText, messagesFor, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { listAllCampaigns, listAllSystems } from '@/server/library';
import { getMaterial, getReport } from '@/server/materials';
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
 */
export default async function MaterialPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const [{ id }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
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
  return (
    <>
      <h1 className={styles.heading}>{material.data.name}</h1>
      <p className={styles.state}>
        <span className={styles.label}>{t('material.stateLabel')}</span>
        <StatePill state={state} word={word} detail={detail} />
      </p>
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
          <h2 id="material-counts" className={styles.label}>
            {t('material.counts.label')}
          </h2>
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
      {state === 'failed' ? <p className={styles.failure}>{failureText(failure, language)}</p> : null}
      <MaterialActions
        id={material.data.id}
        name={material.data.name}
        actions={actions}
        pages={pages?.done}
        language={language}
        action={materialAction}
      />
      {reviewed ? (
        <p className={styles.pages}>
          <Link className={styles.pagesLink} href={`/files/${encodeURIComponent(material.data.id)}/pages/1`}>
            {t('material.viewPages')}
          </Link>
        </p>
      ) : null}
      {report === null ? null : report.ok ? (
        <QualityReport materialId={material.data.id} pages={pages} report={report.data} language={language} />
      ) : (
        <p className={styles.failure}>{errorText(report.problem, language)}</p>
      )}
      <MaterialRefresher state={state} />
    </>
  );
}
