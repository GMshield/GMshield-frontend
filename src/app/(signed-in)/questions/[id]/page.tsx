import type { Metadata } from 'next';

import { openedConversationPage } from '../../conversation-pages';
import { sectionMetadata } from '../../section-metadata';

export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('questions');
}

/** A conversation of Consultas (Story 3.10), opened with its turns. */
export default async function QuestionsConversationPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return openedConversationPage('questions', id);
}
