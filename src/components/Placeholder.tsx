import { translator, type Language } from '@/messages';
import { currentPreferences } from '@/preferences';

import styles from './Placeholder.module.css';
import type { EntryKey } from './shell-entries';

/** The page of an entry built in a later story: its name, and one sentence saying what will be there. */
export function Placeholder({ entry, language }: { readonly entry: EntryKey; readonly language: Language }) {
  const t = translator(language);
  return (
    <>
      <h1 className={styles.heading}>{t(`shell.entries.${entry}`)}</h1>
      <p className={styles.text}>{t(`placeholder.${entry}`)}</p>
    </>
  );
}

/** An entry page built in a later story, in the interface's language. */
export async function placeholderPage(entry: EntryKey) {
  const { language } = await currentPreferences();
  return <Placeholder entry={entry} language={language} />;
}
