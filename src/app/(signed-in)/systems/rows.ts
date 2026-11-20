import 'server-only';

import type { ListRow } from '@/components/ItemList';
import type { Translate } from '@/messages';
import type { CampaignSummary, GameSystem } from '@/server/library';
import type { Material, MaterialState } from '@/server/materials';


/** The states a system's materials tab lists (Story 3.1): every one but those the GM has left behind. */
export const SYSTEM_MATERIAL_STATES: readonly MaterialState[] = ['uploading', 'waiting', 'processing', 'needs_review', 'ready', 'failed'];

/** A system's row: its name and edition; it opens the system's page. */
export function systemRow(system: GameSystem): ListRow {
  return { id: system.id, label: system.name, detail: system.edition ?? null, href: `/systems/${encodeURIComponent(system.id)}`, state: null };
}

/** A campaign's row: its name only; it opens nothing until campaigns have pages (Story 3.2). */
export function campaignRow(campaign: CampaignSummary): ListRow {
  return { id: campaign.id, label: campaign.name, detail: null, href: null, state: null };
}

/** A material's row: its name and state; it opens the material's page. */
export function materialRow(material: Material, t: Translate): ListRow {
  return {
    id: material.id,
    label: material.name,
    detail: null,
    href: `/files/${encodeURIComponent(material.id)}`,
    state: { state: material.state, word: t(`material.state.${material.state}`) },
  };
}
