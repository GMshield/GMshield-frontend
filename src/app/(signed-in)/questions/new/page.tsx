import type { Metadata } from 'next';

import { newConversationPage } from '../../conversation-pages';
import { sectionMetadata } from '../../section-metadata';

export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('questions');
}

/** A new conversation of Consultas (Story 3.10): made by its first question. */
export default function NewQuestionsConversationPage() {
  return newConversationPage('questions');
}
