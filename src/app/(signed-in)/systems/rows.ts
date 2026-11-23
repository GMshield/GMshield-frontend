import 'server-only';

import type { ListRow } from '@/components/ItemList';
import type { Language, Translate } from '@/messages';
import type { CampaignSummary, CoreRecordType, GameSystem, RecordSummary, RecordType } from '@/server/library';
import type { Material, MaterialState } from '@/server/materials';
import { CORE_NAMES } from '@/record-types';

import { placeLabel, previewOf } from '../files/rows';

/** The states a system's materials tab lists (Story 3.1): every one but those the GM has left behind. */
export const SYSTEM_MATERIAL_STATES: readonly MaterialState[] = ['uploading', 'waiting', 'processing', 'needs_review', 'ready', 'failed'];

/** A system's row: its name and edition; it opens the system's page. */
export function systemRow(system: GameSystem): ListRow {
  return { id: system.id, label: system.name, detail: system.edition ?? null, href: `/systems/${encodeURIComponent(system.id)}`, state: null };
}

/** A campaign's row on its system's page: its name only; it opens the campaign's page (Story 3.2). */
export function campaignRow(campaign: CampaignSummary): ListRow {
  return { id: campaign.id, label: campaign.name, detail: null, href: `/campaigns/${encodeURIComponent(campaign.id)}`, state: null };
}

/**
 * A material's row on its system's page: its name, its state and where it belongs (Story 3.3: "Sistema" for this
 * system alone, "Campanha X", or the names of its systems); it opens the material's page.
 */
export function materialRow(material: Material, t: Translate, language: Language, system: string): ListRow {
  return {
    id: material.id,
    label: material.name,
    detail: placeLabel(material.belonging, t, language, system),
    href: `/files/${encodeURIComponent(material.id)}`,
    state: { state: material.state, word: t(`material.state.${material.state}`) },
    ...previewOf(material),
  };
}

/**
 * A record type's row on its system's page (Story 4.1): a core type by this interface's own name for its key (its
 * stored name is never shown), another by its name; its record count as the detail. A core key this frontend does not
 * know yet (a newer backend) shows the stored name rather than failing the page. From Story 4.3 it opens the type's
 * records list; it offers no action: a core type can be neither renamed nor removed.
 */
export function recordTypeRow(type: RecordType, t: Translate, systemId: string): ListRow {
  return {
    id: type.id,
    label: recordTypeName(type, t),
    detail: type.records === 1 ? t('systems.page.recordsOne') : t('systems.page.recordsOther', { count: type.records }),
    href: `/systems/${encodeURIComponent(systemId)}/record-types/${encodeURIComponent(type.id)}`,
    state: null,
  };
}

/** A record type's name as this interface shows it: a core key by its own translation, else the stored name. */
export function recordTypeName(type: { readonly name: string; readonly core?: string | null }, t: Translate): string {
  const core = type.core ?? null;
  const known = core !== null && Object.hasOwn(CORE_NAMES, core) ? CORE_NAMES[core as CoreRecordType] : null;
  return known === null ? type.name : t(known);
}

/**
 * A record's row on its type's list (Story 4.3): its name, with the material it was read from and its first page as
 * the detail; it opens the record's page.
 */
export function recordRow(record: RecordSummary, t: Translate, systemId: string): ListRow {
  return {
    id: record.id,
    label: record.name,
    detail: t('systems.records.from', { material: record.materialName, page: record.page }),
    href: `/systems/${encodeURIComponent(systemId)}/records/${encodeURIComponent(record.id)}`,
    state: null,
  };
}
