import 'server-only';

import type { ListRow } from '@/components/ItemList';
import type { Translate } from '@/messages';
import type { CampaignSummary } from '@/server/library';

/** A campaign's system as a row shows it: its name, and its edition after it when it has one. */
export function systemLabel(system: CampaignSummary['system'], t: Translate): string {
  return system.edition ? t('campaigns.systemEdition', { name: system.name, edition: system.edition }) : system.name;
}

/** A row of "Minhas Mesas" (Story 3.2): the campaign's name and its system; it opens the campaign's page. */
export function campaignListRow(campaign: CampaignSummary, t: Translate): ListRow {
  return {
    id: campaign.id,
    label: campaign.name,
    detail: systemLabel(campaign.system, t),
    href: `/campaigns/${encodeURIComponent(campaign.id)}`,
    state: null,
  };
}
