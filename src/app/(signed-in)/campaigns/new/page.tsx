import { EmptyState, PageHeader } from '@/components/PageHeader';
import { CampaignForm } from '@/components/CampaignForm';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { listSystems } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import { createCampaignAction } from '../actions';
import { systemLabel } from '../rows';

/**
 * "Nova campanha" (Story 3.2): the form as a page of the main column, with the name and the choice of the campaign's
 * system (`?system=` chooses one at the start; otherwise the newest). Once it is saved, the new campaign is the current
 * one and its page opens. With no system, one sentence says a campaign belongs to a system, and the only action is a
 * link to `/systems/new`. Systems that cannot be loaded say why.
 */
export default async function NewCampaignPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [query, { language }, token] = await Promise.all([searchParams, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const systems = await listSystems(token ?? '', { limit: 50 });
  const heading = (
    <PageHeader title={t('campaigns.form.newTitle')} back={{ href: '/campaigns', label: t('shell.entries.campaigns') }} />
  );
  if (!systems.ok) {
    return (
      <>
        {heading}
        <Notice status="danger" language={language} message={errorText(systems.problem, language)} dismissible={false} />
      </>
    );
  }
  if (systems.data.items.length === 0) {
    return (
      <>
        {heading}
        <EmptyState icon="systems" text={t('campaigns.form.noSystem')}>
          <PillLink href="/systems/new" solid>
            {t('campaigns.form.createSystem')}
          </PillLink>
        </EmptyState>
      </>
    );
  }
  const choices = systems.data.items.map((system) => ({
    id: system.id,
    label: systemLabel(system, t),
  }));
  const asked = typeof query.system === 'string' ? query.system : '';
  const chosen = choices.some((choice) => choice.id === asked) ? asked : (choices[0]?.id ?? '');
  return (
    <>
      {heading}
      <CampaignForm
        labels={{
          name: t('campaigns.form.name'),
          system: t('campaigns.form.system'),
          submit: t('campaigns.form.create'),
          cancel: t('campaigns.form.cancel'),
        }}
        initial={{ values: { name: '', systemId: chosen }, version: null, error: null, field: null, stale: false }}
        systems={choices}
        cancelHref="/campaigns"
        action={createCampaignAction}
      />
    </>
  );
}
