import type { Metadata } from 'next';

import { renameConversationPage } from '../../../conversation-pages';
import { sectionMetadata } from '../../../section-metadata';

export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('questions');
}

/** The rename of a conversation of Consultas (Story 3.10). */
export default async function RenameQuestionsConversationPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return renameConversationPage('questions', id);
}
