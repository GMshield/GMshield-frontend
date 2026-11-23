import type { MessagePath, Translate } from '@/messages';
import type { CoreRecordType } from '@/server/library';

/**
 * The message of each core record type's name (Story 4.1). Typed by the contract's core keys, so a key the contract
 * gains fails the type check until it is here and in both message files. Shared by the system page's records tab and,
 * from Story 4.2, the quality report, which names its records by type with them.
 */
export const CORE_NAMES: Readonly<Record<CoreRecordType, MessagePath>> = {
  rule: 'systems.recordTypes.rule',
  spell: 'systems.recordTypes.spell',
  item: 'systems.recordTypes.item',
  creature: 'systems.recordTypes.creature',
  character_sheet: 'systems.recordTypes.character_sheet',
  encounter: 'systems.recordTypes.encounter',
  dungeon: 'systems.recordTypes.dungeon',
  note: 'systems.recordTypes.note',
};

/** The eight core keys in their fixed order (Story 4.3 part B: the search's record-type select lists them so). */
export const CORE_KEYS: readonly CoreRecordType[] = Object.keys(CORE_NAMES) as CoreRecordType[];

/** Whether a text is a core key (a search's `type=` in the address, Story 4.3 part B). */
export function isCoreKey(value: string): value is CoreRecordType {
  return Object.hasOwn(CORE_NAMES, value);
}

/**
 * A record type's name as this interface shows it: a core key by its own translation, else the stored name. Shared by
 * the system's records (Story 4.3) and, from Story 4.3 part B, a search's record results, which name a core key only.
 */
export function recordTypeName(type: { readonly name: string; readonly core?: string | null }, t: Translate): string {
  const core = type.core ?? null;
  return core !== null && isCoreKey(core) ? t(CORE_NAMES[core]) : type.name;
}

/** A core key's name as this interface shows it (Story 4.3 part B: a search's record result and its type select). */
export function coreTypeName(key: CoreRecordType, t: Translate): string {
  return t(CORE_NAMES[key]);
}

/** What a record type key looks like (Story 4.4 part B, public contract 1.39.0): a core key or an approved type's. */
const RECORD_TYPE_KEY = /^[a-z][a-z0-9_]{0,31}$/;

/** Whether a text is a record type key (a search's `type=` in the address, from Story 4.4 part B any key). */
export function isRecordTypeKey(value: string): boolean {
  return RECORD_TYPE_KEY.test(value);
}

/** A record type as {@link typeLabel} names a key by it: its key and its stored name. */
export type NamedRecordType = { readonly key: string; readonly name: string };

/**
 * A record type key's name as this interface shows it (Story 4.4 part B): a core key by its own translation, else the
 * name of the type with that key in `types` (the system's record types, which name a type the GM approved), else the
 * key itself. No contract field carries a type's name: a search result, a cited record and the quality report name a
 * key, and the screen names it from the list it reads.
 */
export function typeLabel(key: string, types: readonly NamedRecordType[], t: Translate): string {
  if (isCoreKey(key)) {
    return coreTypeName(key, t);
  }
  return types.find((type) => type.key === key)?.name ?? key;
}
