import { EmptyState, PageHeader, Tabs } from '@/components/PageHeader';
import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { errorText, translator } from '@/messages';
import { currentPreferences, currentViews } from '@/preferences';
import { pageParam } from '@/paging';
import { listCampaigns } from '@/server/library';
import { listPage } from '@/server/list-page';
import { currentSessionToken } from '@/server/session-cookies';

import { campaignListRow } from './rows';

/**
 * "Minhas Mesas" (Story 3.2): the GM's campaigns in use, newest first, each row with its name and system, opening the
 * campaign's page; "Nova campanha" is the one solid pill. The filter "Arquivadas" (`?archived=true`) lists the archived
 * ones instead. An empty list says so in one sentence (for campaigns in use, what a campaign holds, with "Nova
 * campanha" the only action). A list that cannot be loaded says why. Third round of the usability pass: the list is
 * paged (`?page=`, within the filter) instead of growing with "Carregar mais".
 */
export default async function CampaignsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [query, { language }, views, token] = await Promise.all([searchParams, currentPreferences(), currentViews(), currentSessionToken()]);
  const t = translator(language);
  const archived = query.archived === 'true';
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const list = await listPage(
    (ask) => listCampaigns(token ?? '', { archived, ...ask }),
    pageParam(query.page),
    views.campaigns.size,
  );
  const page = list.ok ? list.data : null;
  const filters = [
    { key: 'inUse', href: '/campaigns', on: !archived },
    { key: 'archived', href: '/campaigns?archived=true', on: archived },
  ] as const;
  const chips = (
    <Tabs
      variant="chips"
      label={t('campaigns.filters')}
      tabs={filters.map(({ key, href, on }) => ({ key, href, label: t(`campaigns.${key}`), current: on }))}
    />
  );
  return (
    <>
      <PageHeader
        title={t('shell.entries.campaigns')}
        actions={
          <PillLink href="/campaigns/new" solid>
            {t('campaigns.new')}
          </PillLink>
        }
      />
      {!list.ok || page === null ? (
        <>
          {chips}
          <Notice status="danger" language={language} message={errorText(list.ok ? null : list.problem, language)} dismissible={false} />
        </>
      ) : page.paging.total === 0 ? (
        <>
          {chips}
          <EmptyState icon="campaigns" text={t(archived ? 'campaigns.emptyArchived' : 'campaigns.empty')} />
        </>
      ) : (
        <ItemList
          label={t(archived ? 'campaigns.archivedList' : 'campaigns.list')}
          rows={page.rows.map((campaign) => campaignListRow(campaign, t))}
          pages={{ paging: page.paging, path: '/campaigns', query: archived ? { archived: 'true' } : {} }}
          icon="campaigns"
          viewKey="campaigns"
          view={views.campaigns}
          language={language}
          toolbar={chips}
        />
      )}
    </>
  );
}
