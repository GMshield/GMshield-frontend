import { notFoundFor } from '@/app/not-found';
import { MaterialRefresher } from '@/components/MaterialRefresher';
import { Notice } from '@/components/Notice';
import { StatePill } from '@/components/StatePill';
import { errorText, failureText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { getMaterial } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import styles from './page.module.css';

/**
 * A material's page (Story 1.14), minimal for now: its name and the state of its newest version. Another owner's id,
 * an unknown one or a malformed one shows the single "Não encontrado." page. Since Story 1.15 the pill shows the pages
 * done of the total while processing, a failed material says why under it, and the page refreshes itself every 5 s
 * while its state is moving and the tab is visible. The quality report and its actions come with Story 1.20.
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
  const detail = state === 'processing' && pages !== undefined ? t('material.pages', { done: pages.done, total: pages.total }) : undefined;
  return (
    <>
      <h1 className={styles.heading}>{material.data.name}</h1>
      <p className={styles.state}>
        <span className={styles.label}>{t('material.stateLabel')}</span>
        <StatePill state={state} word={t(`material.state.${state}`)} detail={detail} />
      </p>
      {state === 'failed' ? <p className={styles.failure}>{failureText(failure, language)}</p> : null}
      <MaterialRefresher state={state} />
    </>
  );
}
