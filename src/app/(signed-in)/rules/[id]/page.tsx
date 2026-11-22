import type { Metadata } from 'next';

import { openedConversationPage } from '../../conversation-pages';
import { sectionMetadata } from '../../section-metadata';

export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('rules');
}

/** A conversation of Criação de Regras (Story 3.10), opened with its turns. */
export default async function RulesConversationPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return openedConversationPage('rules', id);
}
