import Link from 'next/link';

import { notFoundFor } from '@/app/not-found';
import { CampaignAction } from '@/components/CampaignAction';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { errorText, problemFields, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { campaignConversation } from '@/server/conversations';
import { currentCampaign, getCampaign } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import styles from '../../systems/systems.module.css';
import { archiveCampaignAction, chooseCampaignAction, openConversationAction } from '../actions';
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
  const [campaign, current] = await Promise.all([getCampaign(token ?? '', id), currentCampaign(token ?? '')]);
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
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>{name}</h1>
          {archived ? <p className={styles.edition}>{t('campaigns.page.archived')}</p> : null}
          {isCurrent ? <p className={styles.edition}>{t('campaigns.page.isCurrent')}</p> : null}
        </div>
        <div className={styles.headerActions}>
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
        </div>
      </div>
      <nav className={styles.tabs} aria-label={t('campaigns.page.sections')}>
        <ul className={styles.tabList}>
          {TABS.map((key) => (
            <li key={key}>
              <Link className={styles.tab} href={`${here}?tab=${key}`} aria-current={key === tab ? 'page' : undefined}>
                {t(`campaigns.page.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
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
      {tab === 'scope' ? <p className={styles.description}>{t('campaigns.page.scopeStarting')}</p> : null}
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
        <p className={styles.empty}>{t('campaigns.page.noConversation')}</p>
      ) : (
        <div className={styles.notice}>
          <Notice status="danger" language={language} message={errorText(conversation.problem, language)} dismissible={false} />
        </div>
      )}
    </>
  );
}
