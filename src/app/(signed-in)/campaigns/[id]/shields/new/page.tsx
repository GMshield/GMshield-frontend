import type { Metadata } from 'next';

import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { ShieldForm } from '@/components/ShieldForm';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { getCampaign } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import { createShieldAction } from '../actions';

/** The page's title: "Novo escudo". */
export async function generateMetadata(): Promise<Metadata> {
  const { language } = await currentPreferences();
  return { title: translator(language)('shields.form.newTitle') };
}

/**
 * "Novo escudo" (Story 6.1): the form as a page of the main column, under the way back to the campaign's Shields tab
 * ({@link ShieldForm}): the name, then "Criar escudo". Once it is saved, the new Shield's screen opens with a toast.
 * Another owner's campaign, an unknown one or a malformed one shows the single "Não encontrado." page; another failure
 * is a notice.
 */
export default async function NewShieldPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const [{ id }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const campaign = await getCampaign(token ?? '', id);
  if (!campaign.ok) {
    notFoundFor(campaign.problem);
    return <Notice status="danger" language={language} message={errorText(campaign.problem, language)} dismissible={false} />;
  }
  const back = `/campaigns/${encodeURIComponent(campaign.data.id)}?tab=shields`;
  return (
    <>
      <PageHeader title={t('shields.form.newTitle')} back={{ href: back, label: t('campaigns.page.shields') }} />
      <ShieldForm
        labels={{ name: t('shields.form.name'), submit: t('shields.form.create'), cancel: t('shields.form.cancel') }}
        initial={{ values: { name: '' }, version: null, error: null, field: null, stale: false }}
        campaignId={campaign.data.id}
        cancelHref={back}
        action={createShieldAction}
      />
    </>
  );
}
