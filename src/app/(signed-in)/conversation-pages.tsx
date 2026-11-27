import { redirect } from 'next/navigation';

import { notFoundFor } from '@/app/not-found';
import { CampaignForm } from '@/components/CampaignForm';
import { Conversation, NoCampaignConversation } from '@/components/conversation/Conversation';
import { ItemList, type ListRow } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { EmptyState, PageHeader } from '@/components/PageHeader';
import { PillLink } from '@/components/PillLink';
import { errorText, problemFields, translator, type Language, type Translate } from '@/messages';
import { currentPreferences, currentViews } from '@/preferences';
import { pageParam } from '@/paging';
import {
  conversationDeletion,
  conversationTurns,
  currentConversation,
  getConversation,
  isId,
  listConversations,
  type Area,
  type ConversationSummary,
  type StoredTurn,
} from '@/server/conversations';
import type { NamedRecordType } from '@/record-types';
import type { EditorTypeOption } from '@/components/RecordFieldsEditor';
import { getArtifact } from '@/server/artifacts';
import { getCampaign } from '@/server/library';
import { listPage } from '@/server/list-page';
import { listMaterials } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import { artifactTypeOptions } from './campaigns/[id]/artifacts/texts';
import { deleteConversationAction, renameConversationAction } from './conversation-actions';
import { systemRecordTypes } from './systems/rows';

/**
 * The pages of the two conversation areas, Consultas (`/questions`) and Criação de Regras (`/rules`) (Story 3.10): the
 * area's list of the current campaign's conversations, a new conversation (`/{area}/new`), an opened one
 * (`/{area}/[id]`) and its rename (`/{area}/[id]/edit`). Each area's route files call these with their area.
 */

/** A date as a list row shows it: day, short month and year, in the interface's language. */
function dateOf(value: string, language: Language): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** A row of an area's list (Story 3.10): the conversation's name, then "N perguntas · última em <date>"; it opens it. */
export function conversationListRow(conversation: ConversationSummary, area: Area, t: Translate, language: Language): ListRow {
  const questions = conversation.questions === 1
    ? t('conversations.questionsOne')
    : t('conversations.questionsOther', { count: conversation.questions });
  return {
    id: conversation.id,
    label: conversation.name,
    detail: t('conversations.detail', { questions, last: t('conversations.lastAsked', { date: dateOf(conversation.lastAskedAt, language) }) }),
    href: `/${area}/${encodeURIComponent(conversation.id)}`,
    state: null,
  };
}

/**
 * An area's list (Story 3.10): its title and "Nova conversa" (the one solid pill), then the current campaign's
 * conversations of the area, the most recently asked first, paged (`?page=`) with the "Exibição" menu. An empty list
 * says so in one sentence, with "Nova conversa". With no campaign, the sentence says one is needed and links to a new
 * campaign. A list that cannot be loaded says why.
 */
export async function conversationListPage(area: Area, searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>) {
  const [query, { language }, views, token] = await Promise.all([searchParams, currentPreferences(), currentViews(), currentSessionToken()]);
  const t = translator(language);
  const newConversation = (
    <PillLink href={`/${area}/new`} solid>
      {t('conversations.new')}
    </PillLink>
  );
  const header = <PageHeader title={t(`shell.entries.${area}`)} actions={newConversation} />;
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const current = await currentConversation(token ?? '');
  if (!current.ok && problemFields(current.problem).code === 'request.not_found') {
    return (
      <>
        <PageHeader title={t(`shell.entries.${area}`)} />
        <EmptyState icon={area} text={t('conversation.noCampaign')}>
          <PillLink href="/campaigns/new">{t('conversation.newCampaign')}</PillLink>
        </EmptyState>
      </>
    );
  }
  const list = current.ok
    ? await listPage((ask) => listConversations(token ?? '', current.data.campaignId, area, ask), pageParam(query.page), views.conversations.size)
    : current;
  if (!list.ok) {
    return (
      <>
        {header}
        <Notice status="danger" language={language} message={errorText(list.problem, language)} dismissible={false} />
      </>
    );
  }
  const page = list.data;
  if (page.paging.total === 0) {
    return (
      <>
        {header}
        {/* The sentence's own action is outlined: the header's pill stays the screen's one solid pill. */}
        <EmptyState icon={area} text={t(area === 'rules' ? 'conversations.emptyRules' : 'conversations.emptyQuestions')}>
          <PillLink href={`/${area}/new`}>{t('conversations.new')}</PillLink>
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {header}
      <ItemList
        label={t(area === 'rules' ? 'conversations.listRules' : 'conversations.listQuestions')}
        rows={page.rows.map((conversation) => conversationListRow(conversation, area, t, language))}
        pages={{ paging: page.paging, path: `/${area}` }}
        icon={area}
        viewKey="conversations"
        view={views.conversations}
        language={language}
      />
    </>
  );
}

/** The newest material that needs review, for the no-source line's link; null when there is none. */
async function reviewLink(token: string): Promise<{ readonly href: string; readonly name: string } | null> {
  const materials = await listMaterials(token, ['needs_review'], { limit: 1 });
  const newest = materials.ok ? materials.data.items[0] : undefined;
  return newest === undefined ? null : { href: `/files/${encodeURIComponent(newest.id)}`, name: newest.name };
}

/**
 * The record types of the campaign's system, read once: those the GM approved (Story 4.4 part B), which name a cited
 * record's key (a core key needs none: the interface translates it); and (Story 5.4 part A) every core and approved type,
 * named as here, which a draft's save card offers. None when the campaign or the list cannot be read: a key then shows
 * as it is, and the card offers no type.
 */
async function campaignRecordTypes(
  token: string,
  campaignId: string,
  t: Translate,
): Promise<{ readonly named: NamedRecordType[]; readonly options: EditorTypeOption[] }> {
  const campaign = await getCampaign(token, campaignId);
  if (!campaign.ok) {
    return { named: [], options: [] };
  }
  const types = await systemRecordTypes(token, campaign.data.system.id);
  return {
    named: types.filter((type) => type.core === null).map((type) => ({ key: type.key, name: type.name })),
    options: artifactTypeOptions(types, t),
  };
}

/**
 * Story 5.4 part A: the names of the artifacts the stored drafts were saved as, by id, for their links ("Salvo como
 * artefato: «name»"); one that cannot be read is left out (its link then says only "Salvo como artefato").
 */
async function savedArtifactNames(token: string, campaignId: string, turns: readonly StoredTurn[]): Promise<Record<string, string>> {
  const ids = turns.flatMap((turn) => (turn.saving?.state === 'saved' && turn.saving.artifactId ? [turn.saving.artifactId] : []));
  const read = await Promise.all(ids.map((id) => getArtifact(token, campaignId, id)));
  const names: Record<string, string> = {};
  read.forEach((artifact, index) => {
    if (artifact.ok) {
      names[ids[index]!] = artifact.data.name;
    }
  });
  return names;
}

/**
 * A new conversation of the area (Story 3.10): the current campaign's conversation screen with nothing asked yet (the
 * area's intro and examples, the cursor in the composer); its first question makes the conversation, which can then be
 * deleted (Story 3.10 part B; its dialog in words, as no count was read). With no campaign the composer is disabled with
 * the reason (Story 3.2).
 */
export async function newConversationPage(area: Area) {
  const [{ language }, token] = await Promise.all([currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // Story 4.4 part B: the campaign's record types are read as soon as its id is known, beside the other reads.
  const reading = currentConversation(token ?? '');
  const [current, review, recordTypes] = await Promise.all([
    reading,
    reviewLink(token ?? ''),
    reading.then((found) => (found.ok ? campaignRecordTypes(token ?? '', found.data.campaignId, t) : { named: [], options: [] })),
  ]);
  if (!current.ok && problemFields(current.problem).code === 'request.not_found') {
    return <NoCampaignConversation language={language} area={area} />;
  }
  if (!current.ok) {
    return <Notice status="danger" language={language} message={errorText(current.problem, language)} />;
  }
  return (
    <Conversation
      key={`${current.data.campaignId}:new`}
      language={language}
      campaignId={current.data.campaignId}
      hasSources={current.data.hasSources}
      review={review}
      recordTypes={recordTypes.named}
      saveTypes={recordTypes.options}
      area={area}
      deleteAction={deleteConversationAction}
    />
  );
}

/**
 * An opened conversation (Story 3.10): its stored turns with their answers and references, and the composer, which
 * continues it. Another account's id, an unknown one or a malformed one is the single "Não encontrado." page; a
 * conversation of the other area opens under its own area's address. Story 3.10 part B: how many questions its deletion
 * takes is read with it, for "Excluir"'s dialog; a count that cannot be read leaves the dialog in words. Story 3.12: a
 * `turn` (the `?turn=` of a saved item's "Ir") opens it scrolled to that answer, with focus on it; anything that is not
 * an id is ignored, and a turn not among those loaded leaves it at its last turn.
 */
export async function openedConversationPage(area: Area, id: string, turn?: string | string[]) {
  const [{ language }, token] = await Promise.all([currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  if (!isId(id)) {
    notFoundFor({ code: 'request.not_found' });
  }
  // Story 4.4 part B: the campaign's record types are read as soon as the conversation names its campaign.
  const opened = getConversation(token ?? '', id);
  const storedTurns = conversationTurns(token ?? '', id);
  const [conversation, turns, current, review, deletion, recordTypes, savedNames] = await Promise.all([
    opened,
    storedTurns,
    currentConversation(token ?? ''),
    reviewLink(token ?? ''),
    conversationDeletion(token ?? '', id),
    opened.then((found) => (found.ok ? campaignRecordTypes(token ?? '', found.data.campaignId, t) : { named: [], options: [] })),
    // Story 5.4 part A: the saved drafts' artifacts, named for their links.
    Promise.all([opened, storedTurns]).then(([found, read]) =>
      found.ok && read.ok ? savedArtifactNames(token ?? '', found.data.campaignId, read.data.items) : {},
    ),
  ]);
  if (!conversation.ok) {
    notFoundFor(conversation.problem);
    return <Notice status="danger" language={language} message={errorText(conversation.problem, language)} />;
  }
  const focusTurn = typeof turn === 'string' && isId(turn) ? turn : null;
  if (conversation.data.area !== area) {
    redirect(`/${conversation.data.area}/${encodeURIComponent(conversation.data.id)}${focusTurn === null ? '' : `?turn=${focusTurn}`}`);
  }
  if (!turns.ok) {
    notFoundFor(turns.problem);
    return <Notice status="danger" language={language} message={errorText(turns.problem, language)} />;
  }
  // The no-source line speaks of the current campaign: a conversation of another campaign does not show it.
  const sameCampaign = current.ok && current.data.campaignId === conversation.data.campaignId;
  return (
    <Conversation
      key={`${conversation.data.id}:${focusTurn ?? ''}`}
      language={language}
      campaignId={conversation.data.campaignId}
      hasSources={sameCampaign ? current.data.hasSources : true}
      review={sameCampaign ? review : null}
      area={area}
      conversationId={conversation.data.id}
      focusTurn={focusTurn}
      name={conversation.data.name}
      stored={turns.data.items}
      questions={deletion.ok ? deletion.data.questions : null}
      deleteAction={deleteConversationAction}
      recordTypes={recordTypes.named}
      saveTypes={recordTypes.options}
      savedNames={savedNames}
    />
  );
}

/**
 * A conversation's rename page (Story 3.10), as a campaign's: the form with its name and the version it was read at;
 * saving opens the conversation again, with a toast naming it. Anything that is not the account's conversation is the
 * single "Não encontrado." page.
 */
export async function renameConversationPage(area: Area, id: string) {
  const [{ language }, token] = await Promise.all([currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  if (!isId(id)) {
    notFoundFor({ code: 'request.not_found' });
  }
  const conversation = await getConversation(token ?? '', id);
  if (!conversation.ok) {
    notFoundFor(conversation.problem);
    return <Notice status="danger" language={language} message={errorText(conversation.problem, language)} dismissible={false} />;
  }
  if (conversation.data.area !== area) {
    redirect(`/${conversation.data.area}/${encodeURIComponent(conversation.data.id)}/edit`);
  }
  const { name, version } = conversation.data;
  const opened = `/${area}/${encodeURIComponent(conversation.data.id)}`;
  return (
    <>
      <PageHeader title={t('conversations.form.renameTitle')} back={{ href: opened, label: name }} />
      <CampaignForm
        labels={{
          name: t('conversations.form.name'),
          system: '',
          submit: t('conversations.form.save'),
          cancel: t('conversations.form.cancel'),
        }}
        initial={{ values: { name, systemId: '' }, version, error: null, field: null, stale: false }}
        id={conversation.data.id}
        cancelHref={opened}
        action={renameConversationAction}
      />
    </>
  );
}
