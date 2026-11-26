import type { Metadata } from 'next';

import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { EmptyState, PageHeader, PageSubtitle } from '@/components/PageHeader';
import { PillLink } from '@/components/PillLink';
import { errorText, problemFields, translator } from '@/messages';
import { pageParam } from '@/paging';
import { currentPreferences, currentViews } from '@/preferences';
import { listArtifacts } from '@/server/artifacts';
import { currentCampaign } from '@/server/library';
import { listPage } from '@/server/list-page';
import { currentSessionToken } from '@/server/session-cookies';

import { artifactRow } from '../campaigns/rows';
import { sectionMetadata } from '../section-metadata';

/** The record type whose artifacts this page lists. */
const CHARACTER_SHEET = 'character_sheet';

/** The page's title, after its sidebar entry (usability pass, 2026-11-21). */
export function generateMetadata(): Promise<Metadata> {
  return sectionMetadata('characters');
}

/**
 * "Personagens" (Story 5.1): the current campaign's character sheet artifacts, newest first, paged (`?page=`, rows a
 * page from the "Exibição" menu, the campaign artifacts tab's view), each opening the artifact's page; "Nova ficha" (the
 * one solid pill) opens a new artifact's form with the character sheet type chosen. Both carry `from=characters`, so
 * the form's "Cancelar" and the artifact page's way back (after a save too) lead back here. The campaign is named under the
 * title. A campaign without sheets says so in one sentence with "Nova ficha"; with no current campaign, one sentence
 * says a campaign is needed and links to the campaigns. A list that cannot be loaded says why.
 */
export default async function CharactersPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Readonly<Record<string, string | string[] | undefined>>>;
} = {}) {
  const [query, { language }, views, token] = await Promise.all([
    searchParams ?? Promise.resolve<Readonly<Record<string, string | string[] | undefined>>>({}),
    currentPreferences(),
    currentViews(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  const title = t('shell.entries.characters');
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const campaign = await currentCampaign(token ?? '');
  if (!campaign.ok && problemFields(campaign.problem).code === 'request.not_found') {
    return (
      <>
        <PageHeader title={title} />
        <EmptyState icon="characters" text={t('characters.noCampaign')}>
          <PillLink href="/campaigns">{t('characters.campaigns')}</PillLink>
        </EmptyState>
      </>
    );
  }
  if (!campaign.ok) {
    return (
      <>
        <PageHeader title={title} />
        <Notice status="danger" language={language} message={errorText(campaign.problem, language)} dismissible={false} />
      </>
    );
  }
  const here = `/campaigns/${encodeURIComponent(campaign.data.id)}`;
  const newSheet = (
    <PillLink href={`${here}/artifacts/new?type=${CHARACTER_SHEET}&from=characters`} solid>
      {t('characters.new')}
    </PillLink>
  );
  const list = await listPage(
    (ask) => listArtifacts(token ?? '', campaign.data.id, { ...ask, recordType: CHARACTER_SHEET }),
    pageParam(query.page),
    views.artifacts.size,
  );
  const empty = list.ok && list.data.paging.total === 0;
  return (
    <>
      <PageHeader title={title} actions={list.ok && !empty ? newSheet : undefined}>
        <PageSubtitle>{t('characters.campaign', { name: campaign.data.name })}</PageSubtitle>
      </PageHeader>
      {!list.ok ? (
        <Notice status="danger" language={language} message={errorText(list.problem, language)} dismissible={false} />
      ) : empty ? (
        <EmptyState icon="characters" text={t('characters.empty')}>
          {newSheet}
        </EmptyState>
      ) : (
        <ItemList
          label={t('characters.list', { campaign: campaign.data.name })}
          rows={list.data.rows.map((artifact) => artifactRow(artifact, here, null, t, 'characters'))}
          pages={{ paging: list.data.paging, path: '/characters' }}
          icon="characters"
          viewKey="artifacts"
          view={views.artifacts}
          language={language}
        />
      )}
    </>
  );
}
