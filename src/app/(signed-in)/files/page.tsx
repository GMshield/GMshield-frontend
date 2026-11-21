import { AddFileButton } from '@/components/AddFileButton';
import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { EmptyState, PageHeader, Tabs } from '@/components/PageHeader';
import { PillLink } from '@/components/PillLink';
import { errorText, translator } from '@/messages';
import { currentPreferences, currentViews } from '@/preferences';
import { pageParam } from '@/paging';
import { listPage } from '@/server/list-page';
import { listMaterials } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import { previewPageAction } from './actions';
import { FILE_FILTERS, filterOf, statesOf } from './filters';
import { fileRow } from './rows';

/**
 * "Meus Arquivos" (Story 3.3): every material of the GM but a discarded one, newest first, in the shape of every list
 * page. "Adicionar Arquivo" is the one solid pill, and opens the guided upload. Each row names the material, its state,
 * its size, its pages and where it belongs ("Pronto · 1,2 MB · 320 páginas · Campanha X"), and opens its page. More
 * rows come with "Carregar mais", never on scrolling. An empty list says so in one sentence, with the one action; a
 * first page the backend left empty (every material on it was leaving) with a next page still offers "Carregar mais".
 * A list that cannot be loaded says why.
 *
 * Usability pass (2026-11-21): the list's toolbar filters it by state (`?state=`: all, ready, to review, in progress,
 * failed; the backend filters) and holds the "Exibição" menu (list or grid, comfortable or compact, rows a page,
 * thumbnails). A material with pages shows its first page as a thumbnail and offers a preview
 * in a panel at the right. A filter with nothing in it says so and leads back to every file.
 *
 * Third round: the list is paged (`?page=`, 10 rows unless the view says 20 or 50) instead of growing with "Carregar
 * mais"; the pager under the rows says which rows are shown and of how many, and the filter stays while pages turn.
 */
export default async function FilesPage({
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
  const filter = filterOf(query.state);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const list = await listPage(
    (ask) => listMaterials(token ?? '', statesOf(filter), ask),
    pageParam(query.page),
    views.files.size,
  );
  const page = list.ok ? list.data : null;
  const filters = (
    <Tabs
      variant="chips"
      label={t('view.filter')}
      tabs={FILE_FILTERS.map((key) => ({
        key,
        href: key === 'all' ? '/files' : `/files?state=${key}`,
        label: t(`view.states.${key}`),
        current: key === filter,
      }))}
    />
  );
  const none = page !== null && page.paging.total === 0;
  return (
    <>
      <PageHeader title={t('shell.entries.files')} actions={<AddFileButton label={t('shell.entries.addFile')} />} />
      {!list.ok || page === null ? (
        <Notice status="danger" language={language} message={errorText(list.ok ? null : list.problem, language)} dismissible={false} />
      ) : none && filter === 'all' ? (
        <EmptyState icon="files" text={t('files.empty')} />
      ) : none ? (
        <>
          {filters}
          <EmptyState icon="files" text={t('view.emptyFilter')}>
            <PillLink href="/files">{t('view.clearFilter')}</PillLink>
          </EmptyState>
        </>
      ) : (
        <ItemList
          label={t('files.list')}
          rows={page.rows.map((material) => fileRow(material, t, language))}
          pages={{ paging: page.paging, path: '/files', query: filter === 'all' ? {} : { state: filter } }}
          icon="file"
          viewKey="files"
          view={views.files}
          language={language}
          toolbar={filters}
          preview={{ load: previewPageAction, label: t('preview.open') }}
        />
      )}
    </>
  );
}
