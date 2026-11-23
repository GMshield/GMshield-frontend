import { savePreferences } from '@/app/preferences-action';
import { LANGUAGES, translator } from '@/messages';
import { THEMES, type Preferences, type Theme } from '@/preferences';

import { NamedIcon, type IconName } from './Icons';
import styles from './PreferencesForm.module.css';

const THEME_ICONS: Readonly<Record<Theme, IconName>> = { illustrated: 'picture', dark: 'moon', light: 'sun' };

export type PreferencesFormProps = Preferences & {
  /**
   * `stack` (the default): each group under its label, for the account menu. `inline`: the two groups side by side
   * with their labels spoken and not shown, for the top of the sign-in screen.
   */
  readonly layout?: 'stack' | 'inline';
};

/**
 * The theme and the language (Story 1.8), posted to a Server Action that sets the cookies. A Server Component with no
 * client script, used by the account menu and by the sign-in screen.
 *
 * Usability pass (2026-11-21): each group is a segmented control of buttons, the current choice pressed
 * (`aria-pressed`) and filled. A press applies that one choice at once: each button submits the form with its own
 * name and value, so there is no "Aplicar" step, the other preference is untouched, and it still works without
 * JavaScript. A theme carries an icon beside its name.
 */
export function PreferencesForm({ theme, language, layout = 'stack' }: PreferencesFormProps) {
  const t = translator(language);
  return (
    <form action={savePreferences} className={styles.form} data-layout={layout} aria-label={t('preferences.title')}>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t('preferences.theme')}</legend>
        <div className={styles.segments}>
          {THEMES.map((value) => (
            <button key={value} type="submit" name="theme" value={value} className={styles.segment} aria-pressed={value === theme}>
              <NamedIcon name={THEME_ICONS[value]} size={18} />
              {t(`preferences.themes.${value}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t('preferences.language')}</legend>
        <div className={styles.segments}>
          {LANGUAGES.map((value) => (
            <button key={value} type="submit" name="language" value={value} className={styles.segment} aria-pressed={value === language} lang={value}>
              {t(`preferences.languages.${value}`)}
            </button>
          ))}
        </div>
      </fieldset>
    </form>
  );
}
