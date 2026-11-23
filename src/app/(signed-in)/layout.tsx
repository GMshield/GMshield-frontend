import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { IndexingNotice } from '@/components/IndexingNotice';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { errorText, problemFields, translator } from '@/messages';
import { currentPreferences, currentSidebar } from '@/preferences';
import { currentAccount } from '@/server/accounts';
import { currentConversation } from '@/server/conversations';
import { currentCampaign, getCampaignScope, listAllCampaigns, listAllSystems } from '@/server/library';
import { listMaterials, TRAY_STATES } from '@/server/materials';
import { currentPath, currentSessionToken, endedPath, renewPath } from '@/server/session-cookies';

import { systemLabel } from './campaigns/rows';

/**
 * Every signed-in page (Story 1.11): the shell around it, with the account and its current campaign. Signed out,
 * the sign-in screen at `/`. An ended session goes through `/sign-in/ended` and a seal version that rose through
 * `/session/renew`, both coming back to this page, as `/` does. Any other failure of the account shows on the
 * sign-in screen; a current campaign that cannot be loaded shows a notice in the main column.
 *
 * Story 1.14: the upload tray's rows are read here too, so that `router.refresh()` brings fresh ones; when they cannot
 * be loaded the tray shows this tab's uploads only. The current campaign and its system go to the guided upload with
 * their ids.
 *
 * Story 1.20 showed a dismissible warning across every page for the newest material that needs review. From the
 * usability pass (2026-11-21) that is the bell's: each material that needs review or failed is listed under it with a
 * link to its page and counted on it, and a toast says so when one appears during the visit. A notice across every page
 * is kept for the state of the whole page (a campaign that cannot be loaded, the indexing of the sources).
 *
 * The indexing notice: while the current conversation counts passages still being prepared for search (`indexing`), a
 * warning that cannot be dismissed says how many are left ("Preparando as fontes para busca: faltam 2000 trechos").
 * While some could not be prepared (`indexingFailed`), a second line says how many: a warning while a retry remains,
 * an error once none does. From those first values, `IndexingNotice` keeps its lines current on its own (it reads them
 * again every 5 s while anything is pending or a retry remains, and goes once nothing is left); the page is never
 * refreshed for it. When the conversation cannot be loaded there is no such notice.
 *
 * The notices stack, one line each, in this order: a campaign that cannot be loaded, then the indexing notice.
 *
 * Story 3.2: the campaigns in use (the first 50, newest first) are read here too, for the campaign switcher under the
 * logo and in the context bar; when they cannot be loaded the switcher offers only "Ver todas as mesas" and "Nova
 * campanha". The current campaign is always the backend's.
 *
 * Usability pass (2026-11-21): every material that needs review or failed (of that list) is listed under the bell in the
 * bar above the page, with a link to its page, and counted on it; the tray keeps only the files in motion (being sent,
 * waiting, being read), so one that waits for the GM is not also shown as "in progress".
 *
 * Story 3.3: every campaign in use and every system are read here (50 a page, all the pages), for the guided upload's
 * "where it belongs", which chooses the current campaign first; the switcher still shows the first 50 campaigns. When
 * the systems cannot be loaded the upload offers the campaigns alone, and with neither, "nowhere yet".
 *
 * Story 3.6: the current campaign's scope settings are read as soon as the campaign is known, for the context bar's
 * summary and its popover. When they cannot be read the bar shows system › campaign without a summary, and the page
 * still renders.
 */
/**
 * The states the upload tray shows (usability pass, 2026-11-21): a file being sent, waiting its turn or being read. One
 * that needs review or failed is no longer "in progress": it waits for the GM, under the bell and in the notice.
 */
const IN_MOTION: ReadonlySet<string> = new Set(['uploading', 'waiting', 'processing']);

export default async function SignedInLayout({ children }: { readonly children: ReactNode }) {
  const token = await currentSessionToken();
  if (token === null) {
    redirect('/');
  }
  const [preferences, sidebar, here] = await Promise.all([currentPreferences(), currentSidebar(), currentPath()]);
  const [account, [campaign, scope], materials, conversation, campaigns, systems] = await Promise.all([
    currentAccount(token),
    currentCampaign(token).then(async (found) => [found, found.ok ? await getCampaignScope(token, found.data.id) : null] as const),
    listMaterials(token, TRAY_STATES, { limit: 50 }),
    currentConversation(token),
    listAllCampaigns(token),
    listAllSystems(token),
  ]);
  for (const result of [account, campaign, materials]) {
    if (result.ok) {
      continue;
    }
    const { code } = problemFields(result.problem);
    if (code === 'session.required') {
      redirect(endedPath(here));
    }
    if (code === 'session.renewal_required') {
      redirect(renewPath(here));
    }
  }
  if (!account.ok) {
    // The sign-in screen says what happened (it asks the backend again, and keeps the cookie).
    redirect('/');
  }
  const t = translator(preferences.language);
  const notices: ReactNode[] = [];
  if (!campaign.ok && problemFields(campaign.problem).code !== 'request.not_found') {
    notices.push(
      <Notice key="campaign" status="danger" language={preferences.language} message={errorText(campaign.problem, preferences.language)} />,
    );
  }
  // Under the bell: every material that waits for the GM, the ones to review first, then the ones that failed.
  const waiting = materials.ok ? materials.data.items : [];
  const attention = [
    ...waiting
      .filter((item) => item.state === 'needs_review')
      .map((item) => ({
        id: item.id,
        status: 'warning' as const,
        message: t('material.notice.needsReview', { name: item.name }),
        link: { href: `/files/${encodeURIComponent(item.id)}`, label: t('material.notice.review') },
      })),
    ...waiting
      .filter((item) => item.state === 'failed')
      .map((item) => ({
        id: item.id,
        status: 'danger' as const,
        message: t('material.notice.failed', { name: item.name }),
        link: { href: `/files/${encodeURIComponent(item.id)}`, label: t('material.notice.open') },
      })),
  ];
  const remaining = conversation.ok ? (conversation.data.indexing?.remaining ?? null) : null;
  const failed = conversation.ok ? (conversation.data.indexingFailed ?? null) : null;
  if (remaining !== null || failed !== null) {
    notices.push(
      <IndexingNotice key="indexing" remaining={remaining} failed={failed} language={preferences.language} />,
    );
  }
  const current = campaign.ok ? { id: campaign.data.id, system: campaign.data.system.name, campaign: campaign.data.name } : null;
  const choices = campaigns.ok
    ? campaigns.data.slice(0, 50).map((item) => ({
        id: item.id,
        name: item.name,
        system: systemLabel(item.system, t),
      }))
    : [];
  const belonging = {
    campaigns: campaigns.ok
      ? campaigns.data.map((item) => ({ id: item.id, name: item.name, system: { id: item.system.id, name: systemLabel(item.system, t) } }))
      : [],
    systems: systems.ok ? systems.data.map((item) => ({ id: item.id, name: systemLabel(item, t) })) : [],
    current: campaign.ok ? campaign.data.id : null,
  };
  return (
    <Shell
      preferences={preferences}
      username={account.data.username}
      current={current}
      campaigns={choices}
      scope={scope?.ok ? scope.data : null}
      sidebar={sidebar}
      notices={notices}
      attention={attention}
      belonging={belonging}
      trayRows={waiting.filter((item) => IN_MOTION.has(item.state))}
    >
      {children}
    </Shell>
  );
}
