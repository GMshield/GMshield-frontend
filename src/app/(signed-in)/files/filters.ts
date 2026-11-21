import { FILE_STATES, type MaterialState } from '@/server/materials';

/**
 * The state filters of "Meus Arquivos" (usability pass, 2026-11-21), as `?state=` names them, each with the states the
 * backend is asked for: everything but a discarded material, the ready ones, the ones to review, the ones still being
 * sent or read, and the failed ones.
 */
export const FILE_FILTERS = ['all', 'ready', 'review', 'progress', 'failed'] as const;
export type FileFilter = (typeof FILE_FILTERS)[number];

const STATES: Readonly<Record<FileFilter, readonly MaterialState[]>> = {
  all: FILE_STATES,
  ready: ['ready'],
  review: ['needs_review'],
  progress: ['uploading', 'waiting', 'processing'],
  failed: ['failed'],
};

/** The filter a query or a form names; every state for anything else. */
export function filterOf(value: unknown): FileFilter {
  return FILE_FILTERS.find((filter) => filter === value) ?? 'all';
}

/** The states a filter asks the backend for. */
export function statesOf(value: unknown): readonly MaterialState[] {
  return STATES[filterOf(value)];
}
