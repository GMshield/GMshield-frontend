import Link from 'next/link';

import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { listCampaigns } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import styles from '../systems/systems.module.css';

import { moreCampaignsAction } from './actions';
import { campaignListRow } from './rows';

/**
 * "Minhas Mesas" (Story 3.2): the GM's campaigns in use, newest first, each row with its name and system, opening the
 * campaign's page; "Nova campanha" is the one solid pill. The filter "Arquivadas" (`?archived=true`) lists the archived
 * ones instead. More rows come with "Carregar mais", never on scrolling. An empty list says so in one sentence (for
 * campaigns in use, what a campaign holds, with "Nova campanha" the only action). A list that cannot be loaded says why.
 */
export default async function CampaignsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [query, { language }, token] = await Promise.all([searchParams, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  const archived = query.archived === 'true';
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const page = await listCampaigns(token ?? '', { archived });
  const filters = [
    { key: 'inUse', href: '/campaigns', on: !archived },
    { key: 'archived', href: '/campaigns?archived=true', on: archived },
  ] as const;
  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.heading}>{t('shell.entries.campaigns')}</h1>
        <PillLink href="/campaigns/new" solid>
          {t('campaigns.new')}
        </PillLink>
      </div>
      <nav className={styles.tabs} aria-label={t('campaigns.filters')}>
        <ul className={styles.tabList}>
          {filters.map(({ key, href, on }) => (
            <li key={key}>
              <Link className={styles.tab} href={href} aria-current={on ? 'page' : undefined}>
                {t(`campaigns.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!page.ok ? (
        <div className={styles.notice}>
          <Notice status="danger" language={language} message={errorText(page.problem, language)} dismissible={false} />
        </div>
      ) : page.data.items.length === 0 ? (
        <p className={styles.empty}>{t(archived ? 'campaigns.emptyArchived' : 'campaigns.empty')}</p>
      ) : (
        <ItemList
          // A new first page (another filter, another render in place) starts again without the rows added before.
          key={`${archived ? 'archived' : 'inUse'}:${page.data.items[0]?.id ?? ''}:${page.data.nextCursor ?? ''}`}
          label={t(archived ? 'campaigns.archivedList' : 'campaigns.list')}
          rows={page.data.items.map((campaign) => campaignListRow(campaign, t))}
          nextCursor={page.data.nextCursor ?? null}
          loadMore={t('campaigns.loadMore')}
          added={{ one: t('campaigns.addedOne'), other: t('campaigns.addedOther') }}
          action={moreCampaignsAction}
          fields={{ archived: archived ? 'true' : 'false' }}
        />
      )}
    </>
  );
}
