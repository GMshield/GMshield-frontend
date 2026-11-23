import type { MessagePath } from '@/messages';
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
