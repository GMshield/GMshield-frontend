// Types for the tests of the stand-in backend (server.mjs is plain JavaScript run by Node alone).
import type { Server } from 'node:http';

export type Contract = { info: { version: string }; paths?: Record<string, Record<string, unknown>>; [key: string]: unknown };
export type Answer = { status: number; type: string | null; body: unknown; headers?: Record<string, string> };

export const EXAMPLES: Readonly<Record<string, unknown>>;
/** Story 3.1: the starter system, as the systems list and the current campaign answer it. */
export const STARTER_SYSTEM: { id: string; name: string; edition: null; description: null; version: number };
export const PICTURE: Buffer;
export type StandInReference = {
  number: number;
  materialName: string;
  sectionPath: string[];
  page: number;
  passageIds: string[];
  removed: boolean;
};
export const ANSWER_DONE: { stopped: boolean; silent: boolean; references: StandInReference[] };
/** Story 2.7: the pages of the stand-in answer's references 1 (a picture page) and 2 (a text page). */
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
export function loadContract(path: string): Contract;
export function exampleOf(contract: unknown, schema: unknown, depth?: number): unknown;
export function answer(contract: unknown, method: string, pathname: string, traceId: string): Answer;
export function createStandInServer(contract: Contract, options?: { quiet?: boolean }): Server;
