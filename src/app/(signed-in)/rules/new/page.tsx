import type { Metadata } from 'next';

import { newConversationPage } from '../../conversation-pages';
import { sectionMetadata } from '../../section-metadata';

export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('rules');
}

/** A new conversation of Criação de Regras (Story 3.10): made by its first question. */
export default function NewRulesConversationPage() {
  return newConversationPage('rules');
}
