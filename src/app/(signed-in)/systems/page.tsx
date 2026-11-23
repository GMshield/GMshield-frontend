import { EmptyState, PageHeader } from '@/components/PageHeader';
import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { errorText, translator } from '@/messages';
import { currentPreferences, currentViews } from '@/preferences';
import { pageParam } from '@/paging';
import { listSystems } from '@/server/library';
import { listPage } from '@/server/list-page';
import { currentSessionToken } from '@/server/session-cookies';

import { systemRow } from './rows';

/**
 * "Sistemas" (Story 3.1): the GM's systems, newest first, each row with its name and edition, opening the system's
 * page; "Novo sistema" is the one solid pill. With no system, one sentence says what a system holds, and "Novo
 * sistema" is the only action. A list that cannot be loaded says why. Third round of the usability pass: the list is
 * paged (`?page=`) instead of growing with "Carregar mais".
 */
export default async function SystemsPage({
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
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const list = await listPage((ask) => listSystems(token ?? '', ask), pageParam(query.page), views.systems.size);
  const page = list.ok ? list.data : null;
  return (
    <>
      <PageHeader
        title={t('shell.entries.systems')}
        actions={
          <PillLink href="/systems/new" solid>
            {t('systems.new')}
          </PillLink>
        }
      />
      {!list.ok || page === null ? (
        <Notice status="danger" language={language} message={errorText(list.ok ? null : list.problem, language)} dismissible={false} />
      ) : page.paging.total === 0 ? (
        <EmptyState icon="systems" text={t('systems.empty')} />
      ) : (
        <ItemList
          label={t('systems.list')}
          rows={page.rows.map(systemRow)}
          pages={{ paging: page.paging, path: '/systems' }}
          icon="systems"
          viewKey="systems"
          view={views.systems}
          language={language}
        />
      )}
    </>
  );
}
