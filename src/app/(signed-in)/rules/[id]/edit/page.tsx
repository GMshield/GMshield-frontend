import type { Metadata } from 'next';

import { renameConversationPage } from '../../../conversation-pages';
import { sectionMetadata } from '../../../section-metadata';

export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('rules');
}

/** The rename of a conversation of Criação de Regras (Story 3.10). */
export default async function RenameRulesConversationPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return renameConversationPage('rules', id);
}
