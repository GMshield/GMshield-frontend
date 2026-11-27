import 'server-only';

import type { ListRow } from '@/components/ItemList';
import type { Translate } from '@/messages';
import { typeLabel, type NamedRecordType } from '@/record-types';
import type { ArtifactSummary } from '@/server/artifacts';
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

/**
 * A row of a campaign's artifacts (Story 5.1): the artifact's name, its record type as this interface names it (`types`:
 * the campaign's system's record types, which name an approved one); it opens the artifact's page under `campaignPath`.
 * With `types` null the type is left out (a list of one type, such as "Personagens"); `from` names the page the row's
 * artifact page leads back to (`characters`: "Personagens").
 *
 * Story 5.6 part B: an artifact of another campaign shared into this one (`sharedFrom`, contract 1.53.0) is marked in
 * its detail, "{type} · Compartilhado de {campaign}" (the mark alone when the type is left out), so the mark is read as
 * part of the row's link. It opens the same address, where the backend answers the artifact read-only (Story 5.6 part
 * A). A row with no `sharedFrom` (null) is the campaign's own.
 */
export function artifactRow(
  artifact: ArtifactSummary,
  campaignPath: string,
  types: readonly NamedRecordType[] | null,
  t: Translate,
  from?: 'characters',
): ListRow {
  const type = types === null ? null : typeLabel(artifact.recordType, types, t);
  const shared = artifact.sharedFrom ? t('artifacts.share.listedFrom', { campaign: artifact.sharedFrom.name }) : null;
  return {
    id: artifact.id,
    label: artifact.name,
    detail: shared === null ? type : type === null ? shared : `${type} · ${shared}`,
    href: `${campaignPath}/artifacts/${encodeURIComponent(artifact.id)}${from === undefined ? '' : `?from=${from}`}`,
    state: null,
  };
}
