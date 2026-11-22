import type { Metadata } from 'next';

import { conversationListPage } from '../conversation-pages';
import { sectionMetadata } from '../section-metadata';

/** The page's title, after its sidebar entry (usability pass, 2026-11-21). */
export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('questions');
}

/** Consultas (Story 3.10): the current campaign's conversations of this area, the most recently asked first. */
export default function QuestionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  return conversationListPage('questions', searchParams);
}
