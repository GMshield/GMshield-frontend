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
export function answer(contract: unknown, method: string, pathname: string, traceId: string): Answer;
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
};
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
  createdAt: string;
};
export const ARTIFACT_PAGE: {
  items: { id: string; recordType: string; name: string; version: number; createdAt: string }[];
  total: number;
  types: { key: string; count: number }[];
};
