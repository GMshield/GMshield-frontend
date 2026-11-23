import 'server-only';

import type { ListRow } from '@/components/ItemList';
import type { Language, MessagePath, Translate } from '@/messages';
import type { CampaignSummary, CoreRecordType, GameSystem, RecordType } from '@/server/library';
import type { Material, MaterialState } from '@/server/materials';

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
 * The message of each core record type's name (Story 4.1). Typed by the contract's core keys, so a key the contract
 * gains fails the type check until it is here and in both message files.
 */
const CORE_NAMES: Readonly<Record<CoreRecordType, MessagePath>> = {
  rule: 'systems.recordTypes.rule',
  spell: 'systems.recordTypes.spell',
  item: 'systems.recordTypes.item',
  creature: 'systems.recordTypes.creature',
  character_sheet: 'systems.recordTypes.character_sheet',
  encounter: 'systems.recordTypes.encounter',
  dungeon: 'systems.recordTypes.dungeon',
  note: 'systems.recordTypes.note',
};

/**
 * A record type's row on its system's page (Story 4.1): a core type by this interface's own name for its key (its
 * stored name is never shown), another by its name; its record count as the detail. A core key this frontend does not
 * know yet (a newer backend) shows the stored name rather than failing the page. It opens nothing until the records
 * list exists (Story 4.3), and it offers no action: a core type can be neither renamed nor removed.
 */
export function recordTypeRow(type: RecordType, t: Translate): ListRow {
  const core: string | null = type.core;
  const known = core !== null && Object.hasOwn(CORE_NAMES, core) ? CORE_NAMES[core as CoreRecordType] : null;
  return {
    id: type.id,
    label: known === null ? type.name : t(known),
    detail: type.records === 1 ? t('systems.page.recordsOne') : t('systems.page.recordsOther', { count: type.records }),
    href: null,
    state: null,
  };
}
