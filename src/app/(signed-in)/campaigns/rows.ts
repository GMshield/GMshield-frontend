import 'server-only';

import type { ListRow } from '@/components/ItemList';
import type { Translate } from '@/messages';
import { typeLabel, type NamedRecordType } from '@/record-types';
import type { ArtifactSummary, CampaignItem } from '@/server/artifacts';
import type { CampaignSummary } from '@/server/library';
import type { NoteSummary, Shield } from '@/server/shields';

import type { ArtifactFrom } from './[id]/artifacts/texts';

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
  from?: ArtifactFrom,
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

/**
 * A row of a campaign's item encyclopedia (Story 7.2), under `campaignPath`, each opening with `from=items` so its page
 * leads back to the tab:
 * - an extracted record: its tier pill ("Campanha", "Sistema", "Outros"), the detail "{material}, p. {page}", and its
 *   campaign record page;
 * - an artifact: the pill "Personalizado", the detail "por {username}" (the session's GM; an artifact shared in is the
 *   same GM's), then "Substitui {name}" when it overrides a record and "Compartilhado de {A}" when it is shared in, and
 *   its artifact page.
 */
export function itemRow(item: CampaignItem, campaignPath: string, username: string | null, t: Translate): ListRow {
  if (item.kind === 'record') {
    const detail =
      item.materialName === null ? null : item.page === null ? item.materialName : t('items.source', { material: item.materialName, page: item.page });
    return {
      id: item.id,
      label: item.name,
      detail,
      href: `${campaignPath}/records/${encodeURIComponent(item.id)}?from=items`,
      state: null,
      tier: item.tier,
    };
  }
  const parts = [
    username === null ? null : t('items.by', { username }),
    item.overrides === null ? null : t('items.replaces', { name: item.overrides.name }),
    item.sharedFrom === null ? null : t('artifacts.share.listedFrom', { campaign: item.sharedFrom.name }),
  ].filter((part): part is string => part !== null);
  return {
    id: item.id,
    label: item.name,
    detail: parts.length === 0 ? null : parts.join(' · '),
    href: `${campaignPath}/artifacts/${encodeURIComponent(item.id)}?from=items`,
    state: null,
    tier: 'custom',
  };
}

/**
 * A Shield's name as the screens show it (Story 6.1): its own, or for the campaign's first Shield, unnamed until the GM
 * renames it, "Escudo do Mestre" / "GM's Shield" in the interface's language.
 */
export function shieldName(shield: Pick<Shield, 'name'>, t: Translate): string {
  return shield.name ?? t('shields.defaultName');
}

/** A row of a campaign's Shields (Story 6.1): the Shield's name; it opens the Shield's screen under `campaignPath`. */
export function shieldRow(shield: Shield, campaignPath: string, t: Translate): ListRow {
  return {
    id: shield.id,
    label: shieldName(shield, t),
    detail: null,
    href: `${campaignPath}/shields/${encodeURIComponent(shield.id)}`,
    state: null,
  };
}

/** A row of a Shield's notes (Story 6.2): the note's title; it opens the note's artifact page under `campaignPath`. */
export function noteRow(note: Pick<NoteSummary, 'id' | 'name'>, campaignPath: string): ListRow {
  return {
    id: note.id,
    label: note.name,
    detail: null,
    href: `${campaignPath}/artifacts/${encodeURIComponent(note.id)}`,
    state: null,
  };
}
