import { ArtifactExportDialog } from '@/components/artifacts/ArtifactExportDialog';
import { NamedIcon } from '@/components/Icons';
import { ItemList, type ListRow } from '@/components/ItemList';
import { EmptyState, PageHeader, PageSubtitle, Tabs } from '@/components/PageHeader';
import Form from 'next/form';
import Link from 'next/link';

import { notFoundFor } from '@/app/not-found';
import { CampaignAction } from '@/components/CampaignAction';
import { CampaignDeleteAction } from '@/components/CampaignDeleteAction';
import { Notice } from '@/components/Notice';
import { PartyForm } from '@/components/PartyForm';
import { PillButton } from '@/components/PillButton';
import { PillLink } from '@/components/PillLink';
import { ScopeControls } from '@/components/ScopeControls';
import { errorText, translator, type Language, type Translate } from '@/messages';
import { pageParam } from '@/paging';
import { currentPreferences, currentViews } from '@/preferences';
import { isRecordTypeKey, typeLabel } from '@/record-types';
import { requestAccount } from '@/server/accounts';
import { artifactsPage, itemsPage, type ArtifactSummary, type ArtifactTypeCount } from '@/server/artifacts';
import { AREAS, listConversations } from '@/server/conversations';
import { campaignDeletion, currentCampaign, getCampaign, getCampaignScope, type Scope } from '@/server/library';
import { shieldsPage, type Shield } from '@/server/shields';
import type { ListPage } from '@/server/list-page';
import { currentSessionToken } from '@/server/session-cookies';
import type { ListView } from '@/view-cookie';

import { systemRecordTypes } from '../../systems/rows';
import styles from '../../systems/systems.module.css';
import {
  archiveCampaignAction,
  changePartyAction,
  changeScopeAction,
  chooseCampaignAction,
  deleteCampaignAction,
  openConversationAction,
} from '../actions';
import { artifactRow, itemRow, shieldRow, systemLabel } from '../rows';

const TABS = ['overview', 'scope', 'shields', 'conversations', 'artifacts', 'items'] as const;
type Tab = (typeof TABS)[number];

function tabOf(value: unknown): Tab {
  return TABS.find((tab) => tab === value) ?? 'overview';
}

/** The longest name filter the backend takes (Story 7.2), in code points. */
const MOST_QUERY = 200;

/** The encyclopedia's name filter from `?q=` (Story 7.2): trimmed, at most {@link MOST_QUERY} code points, else empty. */
function queryOf(value: unknown): string {
  return typeof value === 'string' ? [...value.trim()].slice(0, MOST_QUERY).join('').trim() : '';
}

/**
 * The scope an empty encyclopedia searched (Story 7.2), named in its sentence: "no escopo desta campanha (Campanha e
 * Sistema)", each tier that is on by its word ("Nenhuma fonte" with none), or without them when the scope cannot be read.
 */
function scopeText(scope: Scope | null, language: Language, t: Translate): string {
  if (scope === null) {
    return t('items.scopeUnread');
  }
  const words = [scope.campaignTier ? t('shell.scope.campaign') : null, scope.systemTier ? t('shell.scope.system') : null, scope.otherTier ? t('shell.scope.other') : null].filter(
    (word): word is string => word !== null,
  );
  const tiers = words.length === 0 ? t('shell.scope.none') : new Intl.ListFormat(language, { type: 'conjunction' }).format(words);
  return t('items.scope', { tiers });
}

/**
 * A campaign's page (Story 3.2): its name, then "Usar esta campanha" (the one solid pill, when it is in use and not the
 * current one; the current one says so instead), "Renomear" and "Arquivar" or "Restaurar" (reversible, so with no
 * confirmation), and three tabs chosen by `?tab=`:
 * - overview (the default): the name, the system (a link to its page), "Arquivada" when archived, and from Story 7.1
 *   "Jogadores" and "Nível do grupo" ("Não definido" while not set), then, while either is not set, one sentence on
 *   what they are for, and "Alterar", which opens the party form in place ({@link PartyForm});
 * - scope (Story 3.6): the scope controls inline, the same as the context bar's popover ({@link ScopeControls}): the
 *   three tier switches, the materials of each tier that is on with a switch each, and the model-knowledge switch (disabled until
 *   Story 3.8); a press saves at once. When the scope cannot be read, a notice says why;
 * - conversations: from Story 3.10 one row per area (Consultas, Criação de Regras) with how many conversations the
 *   campaign has there and "Abrir", which makes the campaign current and opens that area's list (for an archived
 *   campaign, which cannot be current, a sentence asks to restore it instead); one sentence when it has none in either.
 * - artifacts (Story 5.1): the campaign's artifacts, newest first, paged (`?page=`, rows a page from the "Exibição"
 *   menu), each opening its page and named by its name with its record type under it; the type chips ("Todos", then
 *   each record type in use, with its count) narrow the list (`?type=`); "Novo artefato" (a solid pill) opens the form.
 *   A campaign without artifacts says so in one sentence with "Novo artefato"; a type with none leads back to all.
 * - shields (Story 6.1): the campaign's Shields, oldest first, paged (`?page=`, rows a page from the "Exibição" menu),
 *   each opening its screen and named by its name (the first one, unnamed until renamed, as "Escudo do Mestre");
 *   "Novo escudo" (a solid pill) opens the form. Every campaign has at least one Shield.
 * - items (Story 7.2, the last tab, "Enciclopédia de itens"): every item the campaign may use, as its scope holds them
 *   ({@link ItemsTab}): the books' item records and the campaign's item artifacts (own and shared in) in one
 *   alphabetical, paged list, filtered by name (`?q=`, kept by every page link).
 * An archived campaign still opens here. Another owner's id, an unknown one or a malformed one shows the single
 * "Não encontrado." page.
 *
 * Story 3.2 part B: "Excluir", a danger pill last in the header ({@link CampaignDeleteAction}), for any campaign
 * (archived, current or the last one), whose confirmation names what goes with the counts the backend gives for this
 * campaign; without them it names what goes in words.
 */
export default async function CampaignPage({
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
  const tab = tabOf(query.tab);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const [campaign, current, deletion] = await Promise.all([
    getCampaign(token ?? '', id),
    currentCampaign(token ?? ''),
    campaignDeletion(token ?? '', id),
  ]);
  if (!campaign.ok) {
    notFoundFor(campaign.problem);
    return <Notice status="danger" language={language} message={errorText(campaign.problem, language)} dismissible={false} />;
  }
  const { name, system, archived, version } = campaign.data;
  // Story 7.1: null while not set (and from a backend that does not send them).
  const partySize = campaign.data.partySize ?? null;
  const partyLevel = campaign.data.partyLevel ?? null;
  const campaignId = campaign.data.id;
  const isCurrent = current.ok && current.data.id === campaignId;
  const here = `/campaigns/${encodeURIComponent(campaignId)}`;
  const type = typeof query.type === 'string' && isRecordTypeKey(query.type) ? query.type : null;
  const q = tab === 'items' ? queryOf(query.q) : '';
  const [areas, scope, artifacts, recordTypes, shields, items, account] = await Promise.all([
    tab === 'conversations'
      ? Promise.all(AREAS.map(async (area) => ({ area, list: await listConversations(token ?? '', campaignId, area, { limit: 1 }) })))
      : null,
    // Story 7.2: the encyclopedia's empty sentences name the scope it searched.
    tab === 'scope' || tab === 'items' ? getCampaignScope(token ?? '', campaignId) : null,
    tab === 'artifacts' ? artifactsPage(token ?? '', campaignId, type, pageParam(query.page), views.artifacts.size) : null,
    // The record types name the rows' types and the chips (an approved type by the name its system gives it).
    tab === 'artifacts' ? systemRecordTypes(token ?? '', system.id) : [],
    tab === 'shields' ? shieldsPage(token ?? '', campaignId, pageParam(query.page), views.shields.size) : null,
    tab === 'items' ? itemsPage(token ?? '', campaignId, q, pageParam(query.page), views.items.size) : null,
    // Story 7.2: a custom item's detail names its author, the session's GM ("por {username}"); the layout read it too.
    tab === 'items' ? requestAccount(token ?? '') : null,
  ]);
  const refused = areas?.map(({ list }) => list).find((list) => !list.ok);
  const counted = areas?.map(({ area, list }) => ({ area, total: list.ok ? list.data.total : 0 })) ?? [];
  return (
    <>
      <PageHeader
        title={name}
        back={{ href: archived ? '/campaigns?archived=true' : '/campaigns', label: t('shell.entries.campaigns') }}
        actions={
          <>
            {isCurrent || archived ? null : (
              <CampaignAction label={t('campaigns.page.use')} variant="solid" fields={{ id: campaignId }} action={chooseCampaignAction} />
            )}
            <PillLink href={`${here}/edit`}>{t('campaigns.page.rename')}</PillLink>
            <CampaignAction
              // Keyed by the campaign alone: the refresh after the action keeps the pill, so a refusal's alert stays shown.
              key={campaignId}
              label={t(archived ? 'campaigns.page.restore' : 'campaigns.page.archive')}
              fields={{ id: campaignId, version: String(version), archived: archived ? 'false' : 'true' }}
              action={archiveCampaignAction}
            />
            <CampaignDeleteAction
              key={`delete-${campaignId}`}
              id={campaignId}
              counts={deletion.ok ? deletion.data : null}
              language={language}
              action={deleteCampaignAction}
            />
          </>
        }
      >
        {archived ? <PageSubtitle>{t('campaigns.page.archived')}</PageSubtitle> : null}
        {isCurrent ? (
          <PageSubtitle>
            <span className={styles.badge}>
              <NamedIcon name="check" size={14} />
              {t('campaigns.page.isCurrent')}
            </span>
          </PageSubtitle>
        ) : null}
      </PageHeader>
      <Tabs
        label={t('campaigns.page.sections')}
        tabs={TABS.map((key) => ({ key, href: `${here}?tab=${key}`, label: t(`campaigns.page.${key}`), current: key === tab }))}
      />
      {tab === 'overview' ? (
        <dl className={styles.details}>
          <div className={styles.detail}>
            <dt>{t('campaigns.page.name')}</dt>
            <dd>{name}</dd>
          </div>
          <div className={styles.detail}>
            <dt>{t('campaigns.page.system')}</dt>
            <dd>
              <Link className={styles.inlineLink} href={`/systems/${encodeURIComponent(system.id)}`}>
                {systemLabel(system, t)}
              </Link>
            </dd>
          </div>
          {archived ? (
            <div className={styles.detail}>
              <dt>{t('campaigns.page.state')}</dt>
              <dd>{t('campaigns.page.archived')}</dd>
            </div>
          ) : null}
          <div className={styles.detail}>
            <dt>{t('campaigns.page.partySize')}</dt>
            <dd className={partySize === null ? styles.unset : undefined}>{partySize ?? t('campaigns.page.notSet')}</dd>
          </div>
          <div className={styles.detail}>
            <dt>{t('campaigns.page.partyLevel')}</dt>
            <dd className={partyLevel === null ? styles.unset : undefined}>{partyLevel ?? t('campaigns.page.notSet')}</dd>
          </div>
        </dl>
      ) : null}
      {tab === 'overview' ? (
        <PartyForm
          // Keyed by the campaign alone: the refresh after a save keeps the form's answer, so its focus goes back.
          key={`party-${campaignId}`}
          id={campaignId}
          version={version}
          size={partySize}
          level={partyLevel}
          purpose={partySize === null || partyLevel === null ? t('campaigns.page.partyPurpose') : null}
          texts={{
            label: t('campaigns.party.label'),
            change: t('campaigns.party.change'),
            formLabel: t('campaigns.party.formLabel'),
            size: t('campaigns.party.size'),
            level: t('campaigns.party.level'),
            emptyHint: t('campaigns.party.emptyHint'),
            levelHint: t('campaigns.party.levelHint'),
            save: t('campaigns.party.save'),
            cancel: t('campaigns.party.cancel'),
          }}
          action={changePartyAction}
        />
      ) : null}
      {scope === null || tab !== 'scope' ? null : scope.ok ? (
        <section className={`${styles.panel} ${styles.scope}`} aria-label={t('shell.scope.panel')}>
          <p className={styles.description}>{t('campaigns.scope.intro')}</p>
          <ScopeControls key={campaignId} campaignId={campaignId} scope={scope.data} language={language} action={changeScopeAction} />
        </section>
      ) : (
        <Notice status="danger" language={language} message={errorText(scope.problem, language)} dismissible={false} />
      )}
      {areas === null ? null : refused !== undefined && !refused.ok ? (
        <Notice status="danger" language={language} message={errorText(refused.problem, language)} dismissible={false} />
      ) : counted.every(({ total }) => total === 0) ? (
        <EmptyState icon="questions" text={t('campaigns.page.noConversation')} />
      ) : (
        <ul className={styles.conversations} aria-label={t('campaigns.page.conversationList')}>
          {counted.map(({ area, total }) => (
            <li key={area} className={styles.conversation}>
              <span className={styles.conversationName}>{t(`shell.entries.${area}`)}</span>
              <span className={styles.count}>
                {total === 1 ? t('campaigns.page.conversationsOne') : t('campaigns.page.conversationsOther', { count: total })}
              </span>
              {archived ? (
                <span className={styles.count}>{t('campaigns.page.restoreToOpen')}</span>
              ) : (
                <CampaignAction label={t('campaigns.page.open')} fields={{ id: campaignId, area }} action={openConversationAction} />
              )}
            </li>
          ))}
        </ul>
      )}
      {shields === null ? null : !shields.ok ? (
        <Notice status="danger" language={language} message={errorText(shields.problem, language)} dismissible={false} />
      ) : (
        <ShieldsTab
          here={here}
          page={shields.data}
          labels={{ list: t('shields.list'), new: t('shields.new') }}
          rows={shields.data.rows.map((shield) => shieldRow(shield, here, t))}
          view={views.shields}
          language={language}
        />
      )}
      {artifacts === null ? null : !artifacts.ok ? (
        <Notice status="danger" language={language} message={errorText(artifacts.problem, language)} dismissible={false} />
      ) : (
        <ArtifactsTab
          campaignId={campaignId}
          here={here}
          type={type}
          page={artifacts.data.list}
          inUse={artifacts.data.types}
          labels={{ all: t('artifacts.all'), types: t('artifacts.types'), list: t('artifacts.list'), new: t('artifacts.new') }}
          empty={{ all: t('artifacts.empty'), type: t('view.emptyFilter'), clear: t('view.clearFilter') }}
          rows={artifacts.data.list.rows.map((artifact) => artifactRow(artifact, here, recordTypes, t))}
          typeName={(key) => typeLabel(key, recordTypes, t)}
          view={views.artifacts}
          language={language}
        />
      )}
      {items === null ? null : !items.ok ? (
        <Notice status="danger" language={language} message={errorText(items.problem, language)} dismissible={false} />
      ) : (
        <ItemsTab
          here={here}
          q={q}
          page={items.data}
          rows={items.data.rows.map((item) => itemRow(item, here, account?.ok ? account.data.username : null, t))}
          scope={scopeText(scope?.ok ? scope.data : null, language, t)}
          t={t}
          view={views.items}
          language={language}
        />
      )}
    </>
  );
}

/**
 * The Shields tab (Story 6.1): "Novo escudo", then the list with its pages. A campaign always has a Shield (the backend
 * gives one to a campaign that has none when the list is read), so there is no empty state.
 */
function ShieldsTab({
  here,
  page,
  labels,
  rows,
  view,
  language,
}: {
  readonly here: string;
  readonly page: ListPage<Shield>;
  readonly labels: { readonly list: string; readonly new: string };
  readonly rows: readonly ListRow[];
  readonly view: ListView;
  readonly language: Language;
}) {
  return (
    <>
      <div className={styles.tabActions}>
        <PillLink href={`${here}/shields/new`} solid>
          {labels.new}
        </PillLink>
      </div>
      <ItemList
        label={labels.list}
        rows={rows}
        pages={{ paging: page.paging, path: here, query: { tab: 'shields' } }}
        icon="shield"
        viewKey="shields"
        view={view}
        language={language}
      />
    </>
  );
}

/**
 * The artifacts tab (Story 5.1): "Novo artefato", then the list with its type chips and its pages, or the one sentence
 * of an empty campaign, or of a type with no artifact (which leads back to all).
 *
 * Story 5.7 part B: beside "Novo artefato", "Exportar" ({@link ArtifactExportDialog}) offers the rows of the page shown,
 * in list order with the type filter applied; it is left out while the list shows no row.
 */
function ArtifactsTab({
  campaignId,
  here,
  type,
  page,
  inUse,
  labels,
  empty,
  rows,
  typeName,
  view,
  language,
}: {
  readonly campaignId: string;
  readonly here: string;
  readonly type: string | null;
  readonly page: ListPage<ArtifactSummary>;
  readonly inUse: readonly ArtifactTypeCount[];
  readonly labels: { readonly all: string; readonly types: string; readonly list: string; readonly new: string };
  readonly empty: { readonly all: string; readonly type: string; readonly clear: string };
  readonly rows: readonly ListRow[];
  readonly typeName: (key: string) => string;
  readonly view: ListView;
  readonly language: Language;
}) {
  const tabHref = `${here}?tab=artifacts`;
  const newHref = `${here}/artifacts/new${type === null ? '' : `?type=${encodeURIComponent(type)}`}`;
  const create = (
    <PillLink href={newHref} solid>
      {labels.new}
    </PillLink>
  );
  const chips = (
    <Tabs
      variant="chips"
      label={labels.types}
      tabs={[
        { key: 'all', href: tabHref, label: labels.all, current: type === null },
        ...inUse.map((used) => ({
          key: used.key,
          href: `${tabHref}&type=${encodeURIComponent(used.key)}`,
          label: `${typeName(used.key)} (${used.count})`,
          current: used.key === type,
        })),
      ]}
    />
  );
  if (page.paging.total === 0 && type === null) {
    return <EmptyState icon="rules" text={empty.all}>{create}</EmptyState>;
  }
  return (
    <>
      <div className={styles.tabActions}>
        {create}
        {page.paging.total > 0 && rows.length > 0 ? (
          <ArtifactExportDialog
            campaignId={campaignId}
            rows={rows.map((row) => ({ id: row.id, label: row.label, detail: row.detail }))}
            language={language}
          />
        ) : null}
      </div>
      {page.paging.total === 0 ? (
        <>
          {chips}
          <EmptyState icon="rules" text={empty.type}>
            <PillLink href={tabHref}>{empty.clear}</PillLink>
          </EmptyState>
        </>
      ) : (
        <ItemList
          label={labels.list}
          rows={rows}
          pages={{ paging: page.paging, path: here, query: type === null ? { tab: 'artifacts' } : { tab: 'artifacts', type } }}
          icon="rules"
          viewKey="artifacts"
          view={view}
          language={language}
          toolbar={chips}
        />
      )}
    </>
  );
}

/**
 * The item encyclopedia tab (Story 7.2): the name filter (a bordered search field and "Filtrar", a GET form that keeps
 * `q` in the address) in the list's toolbar, then the entries with their pages, each with its tier pill ("Personalizado"
 * for an artifact) and its detail. A campaign with no item says so in one sentence naming the scope searched, with
 * "Novo artefato" (an item, leading back here); a filter with no match says so naming the scope, with "Limpar filtro".
 */
function ItemsTab({
  here,
  q,
  page,
  rows,
  scope,
  t,
  view,
  language,
}: {
  readonly here: string;
  readonly q: string;
  readonly page: ListPage<unknown>;
  readonly rows: readonly ListRow[];
  /** The scope searched, as the empty sentences name it ("no escopo desta campanha (Campanha e Sistema)"). */
  readonly scope: string;
  readonly t: Translate;
  readonly view: ListView;
  readonly language: Language;
}) {
  const tabHref = `${here}?tab=items`;
  if (page.paging.total === 0 && q === '') {
    return (
      <EmptyState icon="rules" text={t('items.empty', { scope })}>
        <PillLink href={`${here}/artifacts/new?type=item&from=items`} solid>
          {t('artifacts.new')}
        </PillLink>
      </EmptyState>
    );
  }
  const filter = (
    // Keyed by the filter: "Limpar filtro" and a new filter start the field from the address again.
    <Form key={q} role="search" action={here} className={styles.itemFilter} aria-label={t('items.filter')}>
      <input type="hidden" name="tab" value="items" />
      <label className={styles.itemFilterLabel} htmlFor="items-filter">
        {t('items.filter')}
      </label>
      <input
        id="items-filter"
        className={styles.itemFilterInput}
        type="search"
        name="q"
        defaultValue={q}
        autoComplete="off"
        enterKeyHint="search"
      />
      <PillButton type="submit">{t('items.apply')}</PillButton>
    </Form>
  );
  if (page.paging.total === 0) {
    return (
      <>
        <div className={styles.tabActions}>{filter}</div>
        <EmptyState icon="search" text={t('items.noMatch', { query: q, scope })}>
          <PillLink href={tabHref}>{t('items.clear')}</PillLink>
        </EmptyState>
      </>
    );
  }
  return (
    <ItemList
      label={t('items.list')}
      rows={rows}
      pages={{ paging: page.paging, path: here, query: q === '' ? { tab: 'items' } : { tab: 'items', q } }}
      icon="rules"
      viewKey="items"
      view={view}
      language={language}
      toolbar={filter}
    />
  );
}
