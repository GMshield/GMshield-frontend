// Types for the tests of the stand-in backend (server.mjs is plain JavaScript run by Node alone).
import type { Server } from 'node:http';

export type Contract = { info: { version: string }; paths?: Record<string, Record<string, unknown>>; [key: string]: unknown };
export type Answer = { status: number; type: string | null; body: unknown };

export function loadContract(path: string): Contract;
export function exampleOf(contract: unknown, schema: unknown, depth?: number): unknown;
export function answer(contract: unknown, method: string, pathname: string, traceId: string): Answer;
export function createStandInServer(contract: Contract, options?: { quiet?: boolean }): Server;
