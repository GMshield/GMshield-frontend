import { EmptyState, PageHeader, PageSubtitle, Tabs } from '@/components/PageHeader';
import { notFoundFor } from '@/app/not-found';
import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { SystemActions } from '@/components/SystemActions';
import { errorText, translator } from '@/messages';
import { currentPreferences, currentViews } from '@/preferences';
import { pageParam } from '@/paging';
import { getSystem, listCampaigns, systemDeletion } from '@/server/library';
import { listPage } from '@/server/list-page';
import { listMaterials } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import { previewPageAction } from '../../files/actions';
import { deleteSystemAction } from '../actions';
import { SYSTEM_MATERIAL_STATES, campaignRow, materialRow } from '../rows';
import styles from '../systems.module.css';

const TABS = ['campaigns', 'materials'] as const;
type Tab = (typeof TABS)[number];

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
  const tab: Tab = query.tab === 'materials' ? 'materials' : 'campaigns';
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const system = await getSystem(token ?? '', id);
  if (!system.ok) {
    notFoundFor(system.problem);
    return <Notice status="danger" language={language} message={errorText(system.problem, language)} dismissible={false} />;
  }
  const { name, edition, description } = system.data;
  const here = `/systems/${encodeURIComponent(system.data.id)}`;
  const at = pageParam(query.page);
  const [page, deletion] = await Promise.all([
    tab === 'campaigns'
      ? listPage((ask) => listCampaigns(token ?? '', { system: system.data.id, ...ask }), at, views.campaigns.size).then(
          (result) => (result.ok ? { ok: true as const, rows: result.data.rows.map(campaignRow), paging: result.data.paging } : result),
        )
      : listPage(
          (ask) => listMaterials(token ?? '', SYSTEM_MATERIAL_STATES, { system: system.data.id, ...ask }),
          at,
          views.files.size,
        ).then((result) =>
          result.ok
            ? {
                ok: true as const,
                rows: result.data.rows.map((material) => materialRow(material, t, language, system.data.id)),
                paging: result.data.paging,
              }
            : result,
        ),
    systemDeletion(token ?? '', system.data.id),
  ]);
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
      {!page.ok ? (
        <Notice status="danger" language={language} message={errorText(page.problem, language)} dismissible={false} />
      ) : page.paging.total === 0 ? (
        tab === 'campaigns' ? (
          <EmptyState icon="campaigns" text={t('systems.page.noCampaigns')}>
            <PillLink href={`/campaigns/new?system=${encodeURIComponent(system.data.id)}`}>{t('campaigns.new')}</PillLink>
          </EmptyState>
        ) : (
          <EmptyState icon="files" text={t('systems.page.noMaterials')} />
        )
      ) : (
        <ItemList
          key={tab}
          label={t(tab === 'campaigns' ? 'systems.page.campaignList' : 'systems.page.materialList')}
          rows={page.rows}
          pages={{ paging: page.paging, path: here, query: { tab } }}
          icon={tab === 'campaigns' ? 'campaigns' : 'file'}
          viewKey={tab === 'campaigns' ? 'campaigns' : 'files'}
          view={tab === 'campaigns' ? views.campaigns : views.files}
          language={language}
          preview={tab === 'materials' ? { load: previewPageAction, label: t('preview.open') } : undefined}
        />
      )}
    </>
  );
}
