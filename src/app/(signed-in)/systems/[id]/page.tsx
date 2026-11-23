import { EmptyState, PageHeader, PageSubtitle, Tabs } from '@/components/PageHeader';
import { notFoundFor } from '@/app/not-found';
import type { IconName } from '@/components/Icons';
import { ItemList, type ListRow } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { SystemActions } from '@/components/SystemActions';
import { errorText, translator, type MessagePath } from '@/messages';
import { currentPreferences, currentViews } from '@/preferences';
import { pageParam, type Paging } from '@/paging';
import { getSystem, listCampaigns, listRecordTypes, systemDeletion } from '@/server/library';
import { listPage } from '@/server/list-page';
import { listMaterials } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';
import type { ViewList } from '@/view-cookie';

import { previewPageAction } from '../../files/actions';
import { deleteSystemAction } from '../actions';
import { SYSTEM_MATERIAL_STATES, campaignRow, materialRow, recordTypeRow } from '../rows';
import styles from '../systems.module.css';

const TABS = ['campaigns', 'materials', 'records', 'proposals'] as const;
type Tab = (typeof TABS)[number];
/** The tabs that list something: all but the ontology proposals, which have nothing to list before Story 4.4. */
type ListedTab = Exclude<Tab, 'proposals'>;

/** What each listing tab shows: its list's accessible name, its rows' icon, its display options and its empty text. */
const LISTS: Readonly<Record<ListedTab, { label: MessagePath; icon: IconName; view: ViewList; empty: MessagePath }>> = {
  campaigns: { label: 'systems.page.campaignList', icon: 'campaigns', view: 'campaigns', empty: 'systems.page.noCampaigns' },
  materials: { label: 'systems.page.materialList', icon: 'file', view: 'files', empty: 'systems.page.noMaterials' },
  records: { label: 'systems.page.recordTypeList', icon: 'rules', view: 'recordTypes', empty: 'systems.page.noRecordTypes' },
};

/** One page of a listing tab's rows, the backend's refusal, or nothing for a tab that lists nothing. */
type TabPage =
  | { readonly ok: true; readonly tab: ListedTab; readonly rows: readonly ListRow[]; readonly paging: Paging }
  | { readonly ok: false; readonly problem: unknown }
  | null;

/**
 * A system's page (Story 3.1): its name, edition and description, "Editar" (the one solid pill), and two tabs,
 * campaigns (the default) and materials, chosen by `?tab=`. The campaigns tab lists the system's campaigns in use, each
 * opening its page (Story 3.2); the materials tab lists the materials attached to the system or to one of its
 * campaigns, each opening its page and naming where it belongs (Story 3.3: "Sistema", "Campanha X", or the names of its
 * systems). Each tab is paged (`?page=`, third round of the usability pass), or says in one sentence that it is empty.
 * Another owner's id, an unknown one or a malformed one shows the single "Não encontrado." page.
 *
 * Story 3.1 part B: "Excluir", a danger pill next to "Editar" ({@link SystemActions}), whose confirmation names what
 * goes with the counts the backend gives for this system; without them it names what goes in words.
 *
 * Story 4.1: two more tabs after materials. "Registros" lists the system's record types (the eight core types first,
 * each by this interface's name for it, with its record count), paged like the others, with no action on a row; from
 * Story 4.3 a row opens the type's records list. "Propostas de ontologia" says in one sentence that there is nothing to
 * review yet (Story 4.4 fills it). Every tab is a link, so each is reached and opened from the keyboard.
 */
export default async function SystemPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ id }, query, { language }, views, token] = await Promise.all([
    params,
    searchParams,
    currentPreferences(),
    currentViews(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  const tab: Tab = TABS.find((key) => key !== 'campaigns' && key === query.tab) ?? 'campaigns';
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const system = await getSystem(token ?? '', id);
  if (!system.ok) {
    notFoundFor(system.problem);
    return <Notice status="danger" language={language} message={errorText(system.problem, language)} dismissible={false} />;
  }
  const { name, edition, description } = system.data;
  const here = `/systems/${encodeURIComponent(system.data.id)}`;
  const at = pageParam(query.page);
  const loadTab = async (): Promise<TabPage> => {
    switch (tab) {
      case 'campaigns': {
        const result = await listPage((ask) => listCampaigns(token ?? '', { system: system.data.id, ...ask }), at, views.campaigns.size);
        return result.ok ? { ok: true, tab, rows: result.data.rows.map(campaignRow), paging: result.data.paging } : result;
      }
      case 'materials': {
        const result = await listPage(
          (ask) => listMaterials(token ?? '', SYSTEM_MATERIAL_STATES, { system: system.data.id, ...ask }),
          at,
          views.files.size,
        );
        return result.ok
          ? { ok: true, tab, rows: result.data.rows.map((material) => materialRow(material, t, language, system.data.id)), paging: result.data.paging }
          : result;
      }
      case 'records': {
        const result = await listPage((ask) => listRecordTypes(token ?? '', system.data.id, ask), at, views.recordTypes.size);
        return result.ok ? { ok: true, tab, rows: result.data.rows.map((type) => recordTypeRow(type, t, system.data.id)), paging: result.data.paging } : result;
      }
      case 'proposals':
        // Nothing is proposed before Story 4.4: the tab reads nothing.
        return null;
    }
  };
  const [page, deletion] = await Promise.all([loadTab(), systemDeletion(token ?? '', system.data.id)]);
  return (
    <>
      <PageHeader
        title={name}
        back={{ href: '/systems', label: t('shell.entries.systems') }}
        actions={
          <>
            <PillLink href={`${here}/edit`} solid>
              {t('systems.page.edit')}
            </PillLink>
            <SystemActions
              id={system.data.id}
              counts={deletion.ok ? deletion.data : null}
              language={language}
              action={deleteSystemAction}
            />
          </>
        }
      >
        {edition ? <PageSubtitle>{t('systems.edition', { edition })}</PageSubtitle> : null}
        {description ? <p className={styles.description}>{description}</p> : null}
      </PageHeader>
      <Tabs
        label={t('systems.page.sections')}
        tabs={TABS.map((key) => ({ key, href: `${here}?tab=${key}`, label: t(`systems.page.${key}`), current: key === tab }))}
      />
      {page === null ? (
        <EmptyState icon="rules" text={t('systems.page.noProposals')} />
      ) : !page.ok ? (
        <Notice status="danger" language={language} message={errorText(page.problem, language)} dismissible={false} />
      ) : page.paging.total === 0 ? (
        page.tab === 'campaigns' ? (
          <EmptyState icon="campaigns" text={t('systems.page.noCampaigns')}>
            <PillLink href={`/campaigns/new?system=${encodeURIComponent(system.data.id)}`}>{t('campaigns.new')}</PillLink>
          </EmptyState>
        ) : (
          <EmptyState icon={LISTS[page.tab].icon} text={t(LISTS[page.tab].empty)} />
        )
      ) : (
        <ItemList
          key={page.tab}
          label={t(LISTS[page.tab].label)}
          rows={page.rows}
          pages={{ paging: page.paging, path: here, query: { tab: page.tab } }}
          icon={LISTS[page.tab].icon}
          viewKey={LISTS[page.tab].view}
          view={views[LISTS[page.tab].view]}
          language={language}
          preview={page.tab === 'materials' ? { load: previewPageAction, label: t('preview.open') } : undefined}
        />
      )}
    </>
  );
}
