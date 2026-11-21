import 'server-only';

import type { ListRow } from '@/components/ItemList';
import { formatSize } from '@/components/uploads/types';
import type { Language, Translate } from '@/messages';
import type { Material, MaterialBelonging } from '@/server/materials';

/** Names in the interface's language: "A, B e C". */
export function nameList(names: readonly string[], language: Language): string {
  return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(names);
}

/**
 * Where a material belongs, as a row names it (Story 3.3): "Campanha X", "Sistema Y", or the names of its systems; on a
 * system's own page (`here`, its id), a material of that system alone is "Sistema". A material with no place says so.
 */
export function placeLabel(belonging: MaterialBelonging, t: Translate, language: Language, here: string | null = null): string {
  if (belonging.campaign) {
    return t('material.place.campaign', { campaign: belonging.campaign.name });
  }
  const [only, ...more] = belonging.systems;
  if (only === undefined) {
    return t('material.place.none');
  }
  if (more.length === 0) {
    return only.id === here ? t('material.place.thisSystem') : t('material.place.system', { system: only.name });
  }
  return nameList(belonging.systems.map((system) => system.name), language);
}

/** Where a material belongs, as its page says it in a sentence (Story 3.3). */
export function belongingText(belonging: MaterialBelonging, t: Translate, language: Language): string {
  if (belonging.campaign) {
    return t('material.belonging.campaign', { campaign: belonging.campaign.name, system: belonging.campaign.system.name });
  }
  if (belonging.systems.length === 1) {
    return t('material.belonging.system', { system: belonging.systems[0]?.name ?? '' });
  }
  if (belonging.systems.length > 1) {
    return t('material.belonging.systems', { systems: nameList(belonging.systems.map((system) => system.name), language) });
  }
  return t('material.belonging.none');
}

/**
 * A material's row (Story 3.3): its name, its state pill, then its size (once known), its pages (once known) and where
 * it belongs, one after another ("1,2 MB · 320 páginas · Campanha X"); it opens the material's page. `here`: the system
 * whose page lists it.
 */
export function fileRow(material: Material, t: Translate, language: Language, here: string | null = null): ListRow {
  const parts: string[] = [];
  if (material.size !== undefined) {
    parts.push(formatSize(material.size, language));
  }
  if (material.pages !== undefined) {
    parts.push(material.pages.total === 1 ? t('material.pageCount.one') : t('material.pageCount.other', { count: material.pages.total }));
  }
  parts.push(placeLabel(material.belonging, t, language, here));
  return {
    id: material.id,
    label: material.name,
    detail: parts.join(' · '),
    href: `/files/${encodeURIComponent(material.id)}`,
    state: { state: material.state, word: t(`material.state.${material.state}`) },
  };
}
