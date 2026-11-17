import { notFoundFor } from '@/app/not-found';
import { MaterialRefresher } from '@/components/MaterialRefresher';
import { Notice } from '@/components/Notice';
import { StatePill } from '@/components/StatePill';
import { progressOf } from '@/components/uploads/types';
import { errorText, failureText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { getMaterial } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import styles from './page.module.css';

/**
 * A material's page (Story 1.14), minimal for now: its name and the state of its newest version. Another owner's id,
 * an unknown one or a malformed one shows the single "Não encontrado." page. Since Story 1.15 the pill shows the pages
 * done of the total while processing, a failed material says why under it, and the page refreshes itself every 5 s
 * while its state is moving and the tab is visible. Since Story 1.17 the pill names what is being read ("lendo texto ·
 * 40 de 364 páginas", "lendo por OCR · 12 de 80 páginas"), and while processing or needing review the page lists the
 * pages read directly, read by OCR and still waiting, and the unreadable ones when there are any. The quality report and
 * its actions come with Story 1.20.
 */
export default async function MaterialPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const [{ id }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const material = await getMaterial(token ?? '', id);
  if (!material.ok) {
    notFoundFor(material.problem);
    return <Notice status="danger" language={language} message={errorText(material.problem, language)} />;
  }
  const { state, pages, failure } = material.data;
  const progress = state === 'processing' && pages !== undefined ? progressOf(pages) : null;
  const word = progress?.phase ? t(`material.phase.${progress.phase}`) : t(`material.state.${state}`);
  const detail = progress === null ? undefined : t('material.pages', { done: progress.done, total: progress.total });
  const counts =
    pages !== undefined && (state === 'processing' || state === 'needs_review')
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
      <MaterialRefresher state={state} />
    </>
  );
}
