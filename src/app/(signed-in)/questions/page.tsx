import { Conversation, NoCampaignConversation } from '@/components/conversation/Conversation';
import { Notice } from '@/components/Notice';
import { errorText, problemFields } from '@/messages';
import { currentPreferences } from '@/preferences';
import { currentConversation } from '@/server/conversations';
import { listMaterials } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

/**
 * The conversation screen (Story 2.4): the current campaign's conversation, with whether it has an accepted source,
 * and the newest material that needs review for the empty state's link. Only the turns asked since the page opened
 * are shown: past turns are stored, and listed from Story 3.10. A conversation that cannot be loaded shows a notice.
 * Story 3.2: with no campaign (every one archived or gone, `request.not_found`), the composer shows disabled, with the
 * reason and a link to `/campaigns/new`.
 */
export default async function QuestionsPage() {
  const [{ language }, token] = await Promise.all([currentPreferences(), currentSessionToken()]);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const [conversation, materials] = await Promise.all([
    currentConversation(token ?? ''),
    listMaterials(token ?? '', ['needs_review'], { limit: 1 }),
  ]);
  if (!conversation.ok && problemFields(conversation.problem).code === 'request.not_found') {
    return <NoCampaignConversation language={language} />;
  }
  if (!conversation.ok) {
    return <Notice status="danger" language={language} message={errorText(conversation.problem, language)} />;
  }
  const newest = materials.ok ? materials.data.items[0] : undefined;
  const review = newest === undefined ? null : { href: `/files/${encodeURIComponent(newest.id)}`, name: newest.name };
  return (
    <Conversation
      key={conversation.data.campaignId}
      language={language}
      campaignId={conversation.data.campaignId}
      hasSources={conversation.data.hasSources}
      review={review}
    />
  );
}
