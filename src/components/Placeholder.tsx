import { translator, type Language } from '@/messages';
import { currentPreferences } from '@/preferences';

import { EmptyState, PageHeader } from './PageHeader';
import type { PageEntryKey } from './shell-entries';

/** The page of an entry built in a later story: its name, and one sentence saying what will be there. */
export function Placeholder({ entry, language }: { readonly entry: PageEntryKey; readonly language: Language }) {
  const t = translator(language);
  return (
    <>
      <PageHeader title={t(`shell.entries.${entry}`)} />
      <EmptyState icon={entry} text={t(`placeholder.${entry}`)} />
    </>
  );
}

/** An entry page built in a later story, in the interface's language. */
export async function placeholderPage(entry: PageEntryKey) {
  const { language } = await currentPreferences();
  return <Placeholder entry={entry} language={language} />;
}
