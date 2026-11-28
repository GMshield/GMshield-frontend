// Types for the tests of the stand-in backend (server.mjs is plain JavaScript run by Node alone).
import type { Server } from 'node:http';

export type Contract = { info: { version: string }; paths?: Record<string, Record<string, unknown>>; [key: string]: unknown };
export type Answer = { status: number; type: string | null; body: unknown; headers?: Record<string, string> };

export const EXAMPLES: Readonly<Record<string, unknown>>;
/** Story 3.1: the starter system, as the systems list and the current campaign answer it. */
export const STARTER_SYSTEM: { id: string; name: string; edition: null; description: null; version: number };
export const PICTURE: Buffer;
/** Story 3.6: a campaign's starting scope, with a few materials in each tier. */
export const STARTING_SCOPE: {
  version: number;
  campaignTier: boolean;
  systemTier: boolean;
  otherTier: boolean;
  modelKnowledge: boolean;
  materials: { id: string; name: string; tier: 'campaign' | 'system' | 'other'; on: boolean }[];
};
export type StandInReference = {
  number: number;
  /** Story 4.3 part C: a cited place's, or a cited record's (with its id, core type, name and fields). */
  kind: 'passage' | 'record';
  recordId?: string;
  recordType?: string;
  name?: string;
  fields?: { name: string; value: string }[];
  materialName: string;
  sectionPath: string[];
  page: number;
  passageIds: string[];
  removed: boolean;
  /** Story 3.7: the tier its source had when the answer was written. */
  tier?: 'campaign' | 'system' | 'other';
};
export const ANSWER_DONE: { stopped: boolean; silent: boolean; references: StandInReference[] };
/** Story 4.3 part C: the record the stand-in answer cites. */
export const ANSWER_RECORD_ID: string;
/** Story 2.7: the pages of the stand-in answer's references 2 (a picture page) and 1 (a text page). */
export const REFERENCE_PAGE: unknown;
export const REFERENCE_TEXT_PAGE: {
  page: number;
  pageTotal: number;
  picture: null;
  lines: unknown[];
  text: string;
  passages: { id: string; range: [number, number] }[];
  outcome: string;
};
export const ANSWER_EVENTS: string;
/** Story 3.9: the versions of the two materials the stand-in search finds, the search's id, and the search done. */
export const NOTES_VERSION: string;
export const BOOK_VERSION: string;
export const SEARCH_ID: string;
export type StandInSearchResult = {
  kind: 'passage' | 'record';
  passageId?: string;
  recordId?: string;
  versionId: string;
  materialName: string;
  sectionPath: string[];
  page: number;
  firstWords?: string;
  name?: string;
  recordType?: string;
  passageIds?: string[];
  tier: 'campaign' | 'system' | 'other';
};
export const SEARCH_DONE: {
  id: string;
  campaignId: string;
  query: string;
  tier: null;
  materialId: null;
  recordType: null;
  state: 'done';
  results: StandInSearchResult[];
};
/** Story 3.7: the stand-in answer's two versions, the campaign's house rule, then the book's rule. */
export const HOUSE_RULE: string;
export const BOOK_RULE: string;
export function loadContract(path: string): Contract;
export function exampleOf(contract: unknown, schema: unknown, depth?: number): unknown;
/** Story 5.7 part A: `search` is the query (`?ids=…&format=…`), read by an export only. */
export function answer(contract: unknown, method: string, pathname: string, traceId: string, search?: string): Answer;
/** Story 5.7 part A: an export's answer, by its query; an 8 x 8 JPEG, a one-page PDF and a stored zip of files. */
export function exportAnswer(search: string, traceId: string): Answer;
export const EXPORT_JPEG: Buffer;
export function tinyPdf(text: string): Buffer;
export function storedZip(files: readonly { name: string; bytes: Buffer }[]): Buffer;
export function attachment(name: string): string;
export function createStandInServer(contract: Contract, options?: { quiet?: boolean }): Server;
/** Story 3.10: the starter campaign's questions conversation, its id, and its one stored turn with its events. */
export const CONVERSATION_ID: string;
export const CONVERSATION: { id: string; campaignId: string; area: 'questions' | 'rules'; name: string; version: number };
export const STORED_TURN: {
  id: string;
  question: string;
  language: string | null;
  createdAt: string;
  events: { sequence: number; type: string; data: unknown }[];
  bookmarked: boolean;
  kind: 'question' | 'draft';
  /** Story 5.4 part A: present on an offered draft only. */
  saving?: { state: 'offered' | 'declined' | 'saved'; artifactId: string | null };
};
/**
 * Story 5.3 part A: a cited draft stored in the same conversation, and the heading its text opens with. Story 5.4 part
 * A: its text, its proposal, and its save state (offered).
 */
export const DRAFT_HEADING: string;
export const DRAFT_TEXT: string;
export const DRAFT_PROPOSAL: { name: string; recordType: string | null };
export const STORED_DRAFT: typeof STORED_TURN;
/** Story 4.3: a record type's records, one record as its system shows it, and that record's id. */
export const RECORD_ID: string;
export const RECORD_PAGE: { items: { id: string; name: string; materialName: string; page: number }[]; total: number };
export const RECORD: {
  id: string;
  name: string;
  recordType: { id: string; core: string; name: string };
  fields: { name: string; value: string }[];
  references: { versionId: string; materialName: string; sectionPath: string[]; page: number; passageIds: string[] }[];
  version: number;
};
/** Story 4.5: a record's correction as both routes answer it, its version raised by one. */
export const CORRECTED_RECORD: typeof RECORD;
/** Story 5.1: the starter campaign's artifacts (two character sheets and an item), and one of them. */
export const ARTIFACT: {
  id: string;
  campaignId: string;
  recordType: string;
  name: string;
  fields: { name: string; value: string }[];
  content: string | null;
  version: number;
  currentVersion: number;
  createdAt: string;
  /** Story 5.4 part A: the conversation a saved draft came from (null: written by hand), and its references. */
  conversationId: string | null;
  references: unknown[];
  /** Story 5.6 part A: the campaigns it is shared with, and (read in another campaign) the one it is shared from. */
  sharedWith: { campaignId: string; name: string; archived: boolean }[];
  sharedFrom: { campaignId: string; name: string } | null;
  /** Story 6.2 part A: the Shield holding a note (null: none). */
  shieldId: string | null;
};
/** Story 5.6 part A: "Mesa de quinta", a sharing's answer, and the artifact as another campaign reads it. */
export const SECOND_CAMPAIGN_ID: string;
export const SHARED_ARTIFACT: typeof ARTIFACT;
export const SHARED_FROM_ARTIFACT: typeof ARTIFACT;
/** Story 5.4 part A: the stored draft saved as an artifact of its conversation. */
export const SAVED_DRAFT: typeof ARTIFACT;
/** Story 5.6 part B: the starter campaign's shared row ("Escudo de Lyra" of "Mesa de quinta") and its read there. */
export const SHARED_INTO_ID: string;
export const SHARED_INTO_ARTIFACT: typeof ARTIFACT;
export const ARTIFACT_PAGE: {
  items: {
    id: string;
    recordType: string;
    name: string;
    version: number;
    createdAt: string;
    sharedFrom: { campaignId: string; name: string } | null;
    shieldId: string | null;
  }[];
  total: number;
  types: { key: string; count: number }[];
};
/** Story 6.1 part A: the starter campaign's Shields (its unnamed first one, then "Combate") and a rename's answer. */
export type StandInShield = { id: string; name: string | null; version: number };
export const FIRST_SHIELD: StandInShield;
export const COMBAT_SHIELD: StandInShield;
export const SHIELD_PAGE: { items: StandInShield[]; total: number };
export const RENAMED_SHIELD: StandInShield;
/** Story 6.1 part B: a Shield's deletion preview (from Story 6.2 part B one note, from Story 6.4 one roll; not the last). */
export const SHIELD_DELETION: { notes: number; rolls: number; last: boolean };
/** Story 6.2 part A: the first Shield's one note ("Pistas da cripta") and the Shield's notes list. */
export const SHIELD_NOTE: typeof ARTIFACT;
export const SHIELD_NOTES: { items: (typeof ARTIFACT_PAGE)['items']; total: number };
/** Story 6.2 part B: a note's move answers the note held by "Combate". */
export const MOVED_NOTE: typeof ARTIFACT;
/** Story 6.4 part A: a Shield's one stored roll ("2d6+3", "Iniciativa"), its log, and a roll sent answers it (201). */
export type StandInRoll = {
  id: string;
  key: string;
  formula: string;
  results: number[];
  total: number;
  label: string | null;
  rolledAt: string;
};
export const STORED_ROLL: StandInRoll;
export const ROLL_PAGE: { items: StandInRoll[]; total: number };
/** Story 5.2: an edit's and a restore's answer (version 2), and an artifact's versions (its one version 1). */
export const EDITED_ARTIFACT: typeof ARTIFACT;
export const ARTIFACT_VERSIONS: {
  items: { number: number; recordType: string; name: string; createdAt: string }[];
  total: number;
};
