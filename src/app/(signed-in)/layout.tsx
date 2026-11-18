import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { errorText, problemFields, translator } from '@/messages';
import { currentPreferences, currentSidebar } from '@/preferences';
import { currentAccount } from '@/server/accounts';
import { currentCampaign } from '@/server/library';
import { listMaterials, TRAY_STATES } from '@/server/materials';
import { currentPath, currentSessionToken, endedPath, renewPath } from '@/server/session-cookies';

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
 * Story 1.20: when no campaign notice is shown, a dismissible warning names the newest material that needs review and
 * links to its page ("Bestiário.pdf precisa de revisão."), from the same list.
 */
export default async function SignedInLayout({ children }: { readonly children: ReactNode }) {
  const token = await currentSessionToken();
  if (token === null) {
    redirect('/');
  }
  const [preferences, sidebar, here] = await Promise.all([currentPreferences(), currentSidebar(), currentPath()]);
  const [account, campaign, materials] = await Promise.all([
    currentAccount(token),
    currentCampaign(token),
    listMaterials(token, TRAY_STATES, { limit: 50 }),
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
  let notice: ReactNode = null;
  if (!campaign.ok && problemFields(campaign.problem).code !== 'request.not_found') {
    notice = <Notice status="danger" language={preferences.language} message={errorText(campaign.problem, preferences.language)} />;
  }
  const review = materials.ok ? materials.data.items.find((item) => item.state === 'needs_review') : undefined;
  if (notice === null && review !== undefined) {
    const t = translator(preferences.language);
    notice = (
      <Notice
        status="warning"
        language={preferences.language}
        message={t('material.notice.needsReview', { name: review.name })}
        link={{ href: `/files/${encodeURIComponent(review.id)}`, label: t('material.notice.review') }}
      />
    );
  }
  const current = campaign.ok ? { system: campaign.data.system.name, campaign: campaign.data.name } : null;
  const belonging = campaign.ok
    ? { campaign: { id: campaign.data.id, name: campaign.data.name }, system: { id: campaign.data.system.id, name: campaign.data.system.name } }
    : null;
  return (
    <Shell
      preferences={preferences}
      username={account.data.username}
      current={current}
      sidebar={sidebar}
      notice={notice}
      belonging={belonging}
      trayRows={materials.ok ? materials.data.items : []}
    >
      {children}
    </Shell>
  );
}
