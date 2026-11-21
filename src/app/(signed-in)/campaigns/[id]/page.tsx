import { NamedIcon } from '@/components/Icons';
import { EmptyState, PageHeader, PageSubtitle, Tabs } from '@/components/PageHeader';
import Link from 'next/link';

import { notFoundFor } from '@/app/not-found';
import { CampaignAction } from '@/components/CampaignAction';
import { CampaignDeleteAction } from '@/components/CampaignDeleteAction';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { errorText, problemFields, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { campaignConversation } from '@/server/conversations';
import { campaignDeletion, currentCampaign, getCampaign } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import styles from '../../systems/systems.module.css';
import { archiveCampaignAction, chooseCampaignAction, deleteCampaignAction, openConversationAction } from '../actions';
import { systemLabel } from '../rows';

const TABS = ['overview', 'scope', 'conversations'] as const;
type Tab = (typeof TABS)[number];

function tabOf(value: unknown): Tab {
  return TABS.find((tab) => tab === value) ?? 'overview';
}

/**
 * A campaign's page (Story 3.2): its name, then "Usar esta campanha" (the one solid pill, when it is in use and not the
 * current one; the current one says so instead), "Renomear" and "Arquivar" or "Restaurar" (reversible, so with no
 * confirmation), and three tabs chosen by `?tab=`:
 * - overview (the default): the name, the system (a link to its page) and "Arquivada" when archived;
 * - scope: the four settings in words, read-only until Story 3.6 (every campaign has the starting scope until 3.5);
 * - conversations: the campaign's one conversation with its question count and "Abrir", which makes the campaign current
 *   and opens Consultas (for an archived campaign, which cannot be current, a sentence asks to restore it instead); one
 *   sentence when there is none.
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
  const [{ id }, query, { language }, token] = await Promise.all([params, searchParams, currentPreferences(), currentSessionToken()]);
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
  const campaignId = campaign.data.id;
  const isCurrent = current.ok && current.data.id === campaignId;
  const here = `/campaigns/${encodeURIComponent(campaignId)}`;
  const conversation = tab === 'conversations' ? await campaignConversation(token ?? '', campaignId) : null;
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
        </dl>
      ) : null}
      {tab === 'scope' ? (
        <div className={styles.panel}>
          <p className={styles.description}>{t('campaigns.page.scopeStarting')}</p>
        </div>
      ) : null}
      {conversation === null ? null : conversation.ok ? (
        <ul className={styles.conversations} aria-label={t('campaigns.page.conversationList')}>
          <li className={styles.conversation}>
            <span className={styles.conversationName}>{t('shell.entries.questions')}</span>
            <span className={styles.count}>
              {conversation.data.questions === 1
                ? t('campaigns.page.questionsOne')
                : t('campaigns.page.questionsOther', { count: conversation.data.questions })}
            </span>
            {archived ? (
              <span className={styles.count}>{t('campaigns.page.restoreToOpen')}</span>
            ) : (
              <CampaignAction label={t('campaigns.page.open')} fields={{ id: campaignId }} action={openConversationAction} />
            )}
          </li>
        </ul>
      ) : problemFields(conversation.problem).code === 'request.not_found' ? (
        <EmptyState icon="questions" text={t('campaigns.page.noConversation')} />
      ) : (
        <Notice status="danger" language={language} message={errorText(conversation.problem, language)} dismissible={false} />
      )}
    </>
  );
}
