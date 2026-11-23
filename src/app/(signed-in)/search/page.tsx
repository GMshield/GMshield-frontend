import type { Metadata } from 'next';

import { EmptyState, PageHeader, PageSubtitle } from '@/components/PageHeader';
import { PillLink } from '@/components/PillLink';
import { searchAddressOf, type SearchParams } from '@/components/search/search-params';
import { SearchPage } from '@/components/search/SearchPage';
import { translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { currentCampaign, getCampaignScope } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import { systemRecordTypes } from '../systems/rows';

/** The page's title (Story 3.9): "Busca". */
export async function generateMetadata(): Promise<Metadata> {
  const { language } = await currentPreferences();
  return { title: translator(language)('search.title') };
}

/**
 * The search page (Story 3.9): `/search?q=…&s=…&tier=…&material=…&type=…&page=…` (`type`, a record type key, from
 * Story 4.3 part B; from Story 4.4 part B the campaign's system's types, read here, name the filter's options). The header says what the search covers; the body (`SearchPage`, in the browser) has the page's own
 * field, prefilled with the query, the filters, and the results of the stored search, which it starts and reads through
 * this site's relays. The current campaign's scope settings are read here, for the tier chips, the material select and
 * the sentence of a search that found nothing; when they cannot be read the page still searches, with no filter. With
 * no campaign there is nothing to search: one sentence and the way to make one.
 */
export default async function Search({ searchParams }: { readonly searchParams?: Promise<SearchParams> } = {}) {
  const [query, { language }, token] = await Promise.all([
    searchParams ?? Promise.resolve<SearchParams>({}),
    currentPreferences(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const campaign = await currentCampaign(token ?? '');
  const header = (
    <PageHeader title={t('search.title')}>
      <PageSubtitle>{t('search.subtitle')}</PageSubtitle>
    </PageHeader>
  );
  if (!campaign.ok) {
    return (
      <>
        {header}
        <EmptyState icon="search" text={t('search.noCampaign')}>
          <PillLink href="/campaigns/new">{t('search.newCampaign')}</PillLink>
        </EmptyState>
      </>
    );
  }
  // Story 4.4 part B: the campaign's system's record types, which the type filter offers and which name a result.
  const [scope, recordTypes] = await Promise.all([
    getCampaignScope(token ?? '', campaign.data.id),
    systemRecordTypes(token ?? '', campaign.data.system.id),
  ]);
  const address = searchAddressOf(query);
  return (
    <>
      {header}
      <SearchPage
        key={campaign.data.id}
        language={language}
        campaignId={campaign.data.id}
        query={address.query}
        searchId={address.searchId}
        tier={address.tier}
        materialId={address.materialId}
        recordType={address.recordType}
        recordTypes={recordTypes.map((type) => ({ key: type.key, name: type.name }))}
        page={address.page}
        scope={scope.ok ? scope.data : null}
      />
    </>
  );
}
