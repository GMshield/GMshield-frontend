import { PreferencesForm } from '@/components/PreferencesForm';
import { translator } from '@/messages';
import { currentPreferences } from '@/preferences';

import styles from './page.module.css';

export default async function HomePage() {
  const preferences = await currentPreferences();
  const t = translator(preferences.language);
  return (
    <main className={styles.main}>
      <h1 className={styles.heading}>{t('home.heading')}</h1>
      <p className={styles.lead}>{t('home.lead')}</p>
      <PreferencesForm theme={preferences.theme} language={preferences.language} />
    </main>
  );
}
