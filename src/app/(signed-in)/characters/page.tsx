import type { Metadata } from 'next';

import { placeholderPage } from '@/components/Placeholder';

import { sectionMetadata } from '../section-metadata';

/** The page's title, after its sidebar entry (usability pass, 2026-11-21). */
export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('characters');
}

/** Built in a later story: the page says what will be here. */
export default function CharactersPage() {
  return placeholderPage('characters');
}
