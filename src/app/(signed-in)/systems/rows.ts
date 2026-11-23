import 'server-only';

import type { ListRow } from '@/components/ItemList';
import type { ProposalItem } from '@/components/ProposalList';
import type { Language, Translate } from '@/messages';
import { recordTypeName } from '@/record-types';
import type { Result } from '@/server/accounts';
import { everyPage } from '@/server/every-page';
import {
  listRecordTypes,
  listTerms,
  type CampaignSummary,
  type GameSystem,
  type Proposal,
  type ProposalKind,
  type RecordSummary,
  type RecordType,
  type Term,
} from '@/server/library';
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

/** What a proposal of each kind may be merged into (Story 4.4): the system's record types, or its terms. */
export type MergeTargets = Readonly<Record<ProposalKind, readonly { readonly id: string; readonly label: string }[]>>;

/** A page of the record types or terms a merge's choice reads: the backend's largest. */
const TARGET_PAGE = 50;

/**
 * Every page of a list the backend pages by offset (`{items, total}`), through {@link everyPage}: the offset of the next
 * page is its cursor.
 */
function everyOffsetPage<T>(
  load: (query: { limit: number; offset?: number }) => Promise<Result<{ items: T[]; total: number }>>,
) {
  return everyPage<T>(async (cursor) => {
    const offset = cursor === undefined ? 0 : Number(cursor);
    const result = await load(offset === 0 ? { limit: TARGET_PAGE } : { limit: TARGET_PAGE, offset });
    if (!result.ok) {
      return result;
    }
    const next = offset + result.data.items.length;
    return {
      ok: true,
      data: { items: result.data.items, ...(result.data.items.length > 0 && next < result.data.total ? { nextCursor: String(next) } : {}) },
    };
  });
}

/**
 * The record types and terms of the system a proposal of it may be merged into (Story 4.4), every page of each, each
 * named as this interface names it (a core type by its translation). A list that cannot be read offers nothing.
 */
export async function mergeTargets(token: string, systemId: string, t: Translate): Promise<MergeTargets> {
  const [types, terms] = await Promise.all([
    everyOffsetPage((query) => listRecordTypes(token, systemId, query)),
    everyOffsetPage((query) => listTerms(token, systemId, query)),
  ]);
  return {
    record_type: types.ok ? types.data.items.map((type) => ({ id: type.id, label: recordTypeName(type, t) })) : [],
    term: terms.ok ? terms.data.items.map((term) => ({ id: term.id, label: term.name })) : [],
  };
}

/**
 * A pending proposal's row (Story 4.4): its name, its kind in words, where it comes from (its material, or "material
 * removido"; with `system`, the system it was proposed to, for a material in several), its definition and its examples
 * with their pages, and what it may be merged into.
 */
export function proposalItem(proposal: Proposal, t: Translate, targets: MergeTargets, system: string | null = null): ProposalItem {
  const material = proposal.materialName ?? t('systems.proposals.materialRemoved');
  return {
    id: proposal.id,
    version: proposal.version,
    kind: proposal.kind,
    name: proposal.name,
    kindLabel: t(`systems.proposals.kind.${proposal.kind}`),
    detail: system === null ? t('systems.proposals.from', { material }) : t('systems.proposals.fromIn', { material, system }),
    definition: proposal.definition,
    examples: proposal.examples.map((example) => t('systems.proposals.example', { quote: example.quote, page: example.page })),
    targets: targets[proposal.kind],
  };
}

/**
 * An approved term's row on its system's "Ontologia" tab (Story 4.4): its name, then its definition, its other names
 * and where it came from (its material, or "material removido"). It opens no page.
 */
export function termRow(term: Term, t: Translate): ListRow {
  const material = term.origin.materialName ?? t('systems.proposals.materialRemoved');
  const parts = [term.definition, t('systems.proposals.from', { material })];
  if (term.aliases.length > 0) {
    parts.splice(1, 0, t('systems.proposals.aliases', { aliases: term.aliases.join(', ') }));
  }
  return { id: term.id, label: term.name, detail: parts.join(' · '), href: null, state: null };
}
