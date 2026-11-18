import { savePreferences } from '@/app/preferences-action';
import { LANGUAGES, translator } from '@/messages';
import { THEMES, type Preferences } from '@/preferences';

import { PillButton } from './PillButton';
import styles from './PreferencesForm.module.css';

/**
 * The theme and language switcher before sign-in: two labelled radio groups and an "Aplicar" pill,
 * posted to a Server Action that sets the cookies. A Server Component with no client script; the
 * placeholder home page hosts it now, and sign-in, the shell and the landing page reuse it.
 */
export function PreferencesForm({ theme, language }: Preferences) {
  const t = translator(language);
  return (
    <form action={savePreferences} className={styles.form} aria-label={t('preferences.title')}>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t('preferences.theme')}</legend>
        <div className={styles.options}>
          {THEMES.map((value) => (
            <label key={value} className={styles.option}>
              <input type="radio" name="theme" value={value} defaultChecked={value === theme} />
              {t(`preferences.themes.${value}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t('preferences.language')}</legend>
        <div className={styles.options}>
          {LANGUAGES.map((value) => (
            <label key={value} className={styles.option} lang={value}>
              <input type="radio" name="language" value={value} defaultChecked={value === language} />
              {t(`preferences.languages.${value}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <PillButton type="submit">{t('preferences.apply')}</PillButton>
    </form>
  );
}
