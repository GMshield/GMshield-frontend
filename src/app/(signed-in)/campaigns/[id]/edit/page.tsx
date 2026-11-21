import { notFoundFor } from '@/app/not-found';
import { CampaignForm } from '@/components/CampaignForm';
import { Notice } from '@/components/Notice';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { getCampaign } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import styles from '../../../systems/systems.module.css';
import { renameCampaignAction } from '../../actions';

/**
 * A campaign's rename page (Story 3.2): the form with the campaign's name and the version it was read at (its system
 * never changes, so there is no choice of it); saving opens the campaign's page. Another owner's id, an unknown one or
 * a malformed one shows the single "Não encontrado." page.
 */
export default async function RenameCampaignPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const [{ id }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  const campaign = await getCampaign(token ?? '', id);
  if (!campaign.ok) {
    notFoundFor(campaign.problem);
    return <Notice status="danger" language={language} message={errorText(campaign.problem, language)} dismissible={false} />;
  }
  const { name, version } = campaign.data;
  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.heading}>{t('campaigns.form.renameTitle')}</h1>
      </div>
      <CampaignForm
        labels={{
          name: t('campaigns.form.name'),
          system: t('campaigns.form.system'),
          submit: t('campaigns.form.save'),
          cancel: t('campaigns.form.cancel'),
        }}
        initial={{ values: { name, systemId: '' }, version, error: null, field: null, stale: false }}
        id={campaign.data.id}
        cancelHref={`/campaigns/${encodeURIComponent(campaign.data.id)}`}
        action={renameCampaignAction}
      />
    </>
  );
}
