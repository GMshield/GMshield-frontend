import type { Metadata } from 'next';

import type { Tier } from '@/client/conversation';
import { EmptyState, PageHeader, PageSubtitle } from '@/components/PageHeader';
import { PillLink } from '@/components/PillLink';
import { SearchPage } from '@/components/search/SearchPage';
import { translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { pageParam } from '@/paging';
import { currentCampaign, getCampaignScope } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

/** The page's title (Story 3.9): "Busca". */
export async function generateMetadata(): Promise<Metadata> {
  const { language } = await currentPreferences();
  return { title: translator(language)('search.title') };
}

type Query = Readonly<Record<string, string | string[] | undefined>>;

const ID = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
const TIERS: readonly Tier[] = ['campaign', 'system', 'other'];

/** One value of the address's query: the first when it is repeated, empty when absent. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** An id of the address, or null for anything that cannot be one. */
function idOf(value: string | string[] | undefined): string | null {
  const text = one(value);
  return ID.test(text) ? text : null;
}

/**
 * The search page (Story 3.9): `/search?q=…&s=…&tier=…&material=…&page=…`. The header says what the search covers; the
 * body (`SearchPage`, in the browser) has the page's own field, prefilled with the query, the filters, and the results of
 * the stored search, which it starts and reads through this site's relays. The current campaign's scope settings are
 * read here, for the tier chips, the material select and the sentence of a search that found nothing; when they cannot
 * be read the page still searches, with no filter. With no campaign there is nothing to search: one sentence and the
 * way to make one.
 */
export default async function Search({ searchParams }: { readonly searchParams?: Promise<Query> } = {}) {
  const [query, { language }, token] = await Promise.all([
    searchParams ?? Promise.resolve<Query>({}),
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
  const scope = await getCampaignScope(token ?? '', campaign.data.id);
  const tier = TIERS.find((word) => word === one(query.tier)) ?? null;
  return (
    <>
      {header}
      <SearchPage
        key={campaign.data.id}
        language={language}
        campaignId={campaign.data.id}
        query={one(query.q)}
        searchId={idOf(query.s)}
        tier={tier}
        materialId={idOf(query.material)}
        page={pageParam(one(query.page))}
        scope={scope.ok ? scope.data : null}
      />
    </>
  );
}
