import Link from 'next/link';

import { notFoundFor } from '@/app/not-found';
import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { SystemActions } from '@/components/SystemActions';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { getSystem, listCampaigns, systemDeletion } from '@/server/library';
import { listMaterials } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import { deleteSystemAction, moreCampaigns, moreMaterials } from '../actions';
import { SYSTEM_MATERIAL_STATES, campaignRow, materialRow } from '../rows';
import styles from '../systems.module.css';

const TABS = ['campaigns', 'materials'] as const;
type Tab = (typeof TABS)[number];

/**
 * A system's page (Story 3.1): its name, edition and description, "Editar" (the one solid pill), and two tabs,
 * campaigns (the default) and materials, chosen by `?tab=`. The campaigns tab lists the system's campaigns, which open
 * nothing yet (Story 3.2); the materials tab lists the materials attached to the system or to one of its campaigns, each
 * opening its page. Each tab adds rows with "Carregar mais", or says in one sentence that it is empty. Another owner's
 * id, an unknown one or a malformed one shows the single "Não encontrado." page.
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
  const [{ id }, query, { language }, token] = await Promise.all([params, searchParams, currentPreferences(), currentSessionToken()]);
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
  const [page, deletion] = await Promise.all([
    tab === 'campaigns'
      ? listCampaigns(token ?? '', system.data.id).then((result) =>
          result.ok ? { ok: true as const, rows: result.data.items.map(campaignRow), nextCursor: result.data.nextCursor ?? null } : result,
        )
      : listMaterials(token ?? '', SYSTEM_MATERIAL_STATES, { system: system.data.id }).then((result) =>
          result.ok
            ? { ok: true as const, rows: result.data.items.map((material) => materialRow(material, t)), nextCursor: result.data.nextCursor ?? null }
            : result,
        ),
    systemDeletion(token ?? '', system.data.id),
  ]);
  return (
    <>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>{name}</h1>
          {edition ? <p className={styles.edition}>{t('systems.edition', { edition })}</p> : null}
        </div>
        <div className={styles.headerActions}>
          <PillLink href={`${here}/edit`} solid>
            {t('systems.page.edit')}
          </PillLink>
          <SystemActions
            id={system.data.id}
            counts={deletion.ok ? deletion.data : null}
            language={language}
            action={deleteSystemAction}
          />
        </div>
      </div>
      {description ? <p className={styles.description}>{description}</p> : null}
      <nav className={styles.tabs} aria-label={t('systems.page.sections')}>
        <ul className={styles.tabList}>
          {TABS.map((key) => (
            <li key={key}>
              <Link className={styles.tab} href={`${here}?tab=${key}`} aria-current={key === tab ? 'page' : undefined}>
                {t(`systems.page.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!page.ok ? (
        <div className={styles.notice}>
          <Notice status="danger" language={language} message={errorText(page.problem, language)} dismissible={false} />
        </div>
      ) : page.rows.length === 0 ? (
        <p className={styles.empty}>{t(tab === 'campaigns' ? 'systems.page.noCampaigns' : 'systems.page.noMaterials')}</p>
      ) : (
        <ItemList
          key={tab}
          label={t(tab === 'campaigns' ? 'systems.page.campaignList' : 'systems.page.materialList')}
          rows={page.rows}
          nextCursor={page.nextCursor}
          loadMore={t('systems.loadMore')}
          added={{ one: t('systems.addedOne'), other: t('systems.addedOther') }}
          action={tab === 'campaigns' ? moreCampaigns : moreMaterials}
          fields={{ system: system.data.id }}
        />
      )}
    </>
  );
}
