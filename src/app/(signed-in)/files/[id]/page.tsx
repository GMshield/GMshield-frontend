import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { StatePill } from '@/components/StatePill';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { getMaterial } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import styles from './page.module.css';

/**
 * A material's page (Story 1.14), minimal for now: its name and the state of its newest version. Another owner's id,
 * an unknown one or a malformed one shows the single "Não encontrado." page. The quality report and its actions come
 * with Story 1.20.
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
  return (
    <>
      <h1 className={styles.heading}>{material.data.name}</h1>
      <p className={styles.state}>
        <span className={styles.label}>{t('material.stateLabel')}</span>
        <StatePill state={material.data.state} word={t(`material.state.${material.data.state}`)} />
      </p>
    </>
  );
}
