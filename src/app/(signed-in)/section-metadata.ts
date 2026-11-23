import type { Metadata } from 'next';

import type { PageEntryKey } from '@/components/shell-entries';
import { translator } from '@/messages';
import { currentPreferences } from '@/preferences';

/**
 * The document title of a section's pages (usability pass, 2026-11-21): the sidebar entry's name in the interface's
 * language, which the root layout's template follows with "· GMshield". A section's pages share it: naming the item
 * too would ask the backend for it a second time.
 */
export async function sectionMetadata(entry: PageEntryKey): Promise<Metadata> {
  const { language } = await currentPreferences();
  return { title: translator(language)(`shell.entries.${entry}`) };
}
