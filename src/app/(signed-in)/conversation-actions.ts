'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ConversationDeleteState } from '@/components/conversation/ConversationDeleteAction';
import { errorText, problemFields, translator, type Language } from '@/messages';
import { currentPreferences } from '@/preferences';
import { deleteConversation, getConversation, renameConversation } from '@/server/conversations';
import { flash } from '@/server/flash';
import { currentSessionToken } from '@/server/session-cookies';

import type { CampaignFormState } from './campaigns/form-state';

/**
 * "Salvar" on a conversation's rename page (Story 3.10), as a campaign's rename (Story 3.2): the conversation again,
 * with a toast naming it, or the form again with the refusal under the name or the form. A stale version brings the
 * conversation's current name and version into the form, and says so. The layout is revalidated before the redirect,
 * so nothing it shows keeps the old name. The proxy (src/proxy.ts) and Next.js refuse a cross-origin post before this
 * runs.
 */

/** An id as the backend mints it; anything else is an item nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** At most 15 digits: always a safe integer. */
const VERSION = /^(?:0|[1-9]\d{0,14})$/;
/** Far past the limit, so the backend still sees a name too long and names it; only a runaway post is cut. */
const MOST = 10_000;

function invalid(language: Language): string {
  return errorText({ category: 'request', code: 'request.invalid' }, language);
}

export async function renameConversationAction(previous: CampaignFormState, form: FormData): Promise<CampaignFormState> {
  const { language } = await currentPreferences();
  const typed = form.get('name');
  const values = { name: typeof typed === 'string' ? typed.slice(0, MOST) : '', systemId: '' };
  const id = form.get('id');
  const version = form.get('version');
  if (typeof id !== 'string' || !ID.test(id) || typeof version !== 'string' || !VERSION.test(version)) {
    return { values, version: previous.version, error: invalid(language), field: null, stale: false };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await renameConversation(token, id, { version: Number(version), name: values.name });
  if (result.ok) {
    await flash('success', translator(language)('feedback.conversationRenamed', { name: result.data.name }));
    revalidatePath('/', 'layout');
    redirect(`/${result.data.area}/${encodeURIComponent(id)}`);
  }
  const code = problemFields(result.problem).code;
  if (code === 'request.stale_version') {
    const current = await getConversation(token, id);
    if (current.ok) {
      return {
        values: { name: current.data.name, systemId: '' },
        version: current.data.version,
        error: translator(language)('conversations.form.stale'),
        field: null,
        stale: true,
      };
    }
    return { values, version: Number(version), error: errorText(current.problem, language), field: null, stale: false };
  }
  const field = code === 'request.conversation_name_invalid' ? 'name' : null;
  return { values, version: Number(version), error: errorText(result.problem, language), field, stale: false };
}

/** The most saved artifacts a conversation's deletion takes (Story 5.4 part B, as the backend's limit). */
const MOST_ARTIFACTS = 64;

/**
 * "Excluir conversa" in a conversation's confirmation (Story 3.10 part B): the conversation is read for its name and
 * area, the backend deletes it (its questions, answers and references go in the background), the toast names it, the
 * shared layout is rendered again, and the area's list opens without it. A refusal comes back as its text; a malformed
 * id never reaches the backend. From Story 5.4 part B the ticked saved artifacts (`artifactIds`, repeated) go with it,
 * in the same request; one that is not an id, or more than {@link MOST_ARTIFACTS}, is refused before the backend. The
 * proxy (src/proxy.ts) and Next.js refuse a cross-origin post before this runs.
 */
export async function deleteConversationAction(_previous: ConversationDeleteState, form: FormData): Promise<ConversationDeleteState> {
  const { language } = await currentPreferences();
  const id = form.get('id');
  const ticked = form.getAll('artifactIds');
  const artifactIds = ticked.filter((artifactId): artifactId is string => typeof artifactId === 'string' && ID.test(artifactId));
  if (typeof id !== 'string' || !ID.test(id) || artifactIds.length !== ticked.length || ticked.length > MOST_ARTIFACTS) {
    return { error: invalid(language) };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const conversation = await getConversation(token, id);
  if (!conversation.ok) {
    return { error: errorText(conversation.problem, language) };
  }
  const result = await deleteConversation(token, id, [...new Set(artifactIds)]);
  if (result.ok) {
    await flash('success', translator(language)('feedback.conversationDeleted', { name: conversation.data.name }));
    revalidatePath('/', 'layout');
    redirect(`/${conversation.data.area}`);
  }
  return { error: errorText(result.problem, language) };
}
