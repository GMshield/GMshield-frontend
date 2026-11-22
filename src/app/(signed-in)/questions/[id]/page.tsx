import type { Metadata } from 'next';

import { openedConversationPage } from '../../conversation-pages';
import { sectionMetadata } from '../../section-metadata';

export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('questions');
}

/** A conversation of Consultas (Story 3.10), opened with its turns; from Story 3.12 at the answer `?turn=` names. */
export default async function QuestionsConversationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams?: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams ?? Promise.resolve({} as Readonly<Record<string, string | string[] | undefined>>)]);
  // Story 3.12: `?turn=` opens it at that answer (a saved item's "Ir").
  return openedConversationPage('questions', id, query.turn);
}
