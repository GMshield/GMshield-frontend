import 'server-only';

import { call, type CallOptions, type Result } from './accounts';
import type { components, operations } from './backend/generated/public';

/**
 * The signed-in account's materials through the backend (Story 1.14): the list behind the upload tray and one
 * material for its page. The backend takes the owner from the session token alone; another owner's material
 * answers `request.not_found`, like an unknown one. Nothing here logs a name.
 */
type Schemas = components['schemas'];
export type Material = Schemas['Material'];
export type MaterialPage = Schemas['MaterialPage'];
export type MaterialState = Material['state'];
export type MaterialPageView = Schemas['MaterialPageView'];
export type MaterialReport = Schemas['MaterialReport'];
export type MaterialAction = Material['actions'][number];
type ListQuery = NonNullable<operations['listMaterials']['parameters']['query']>;

/** The GM's actions on a material's newest version (Story 1.20), in the order the page shows them. */
export const MATERIAL_ACTIONS: readonly MaterialAction[] = ['accept', 'reprocess', 'retry', 'discard'];

/** The states the tray lists: everything not yet ready, and what needs the GM. */
export const TRAY_STATES: readonly MaterialState[] = ['uploading', 'waiting', 'processing', 'needs_review', 'failed'];

/** The account's materials whose newest version is in one of `states`, newest first. */
export function listMaterials(
  sessionToken: string,
  states: readonly MaterialState[],
  query: Omit<ListQuery, 'state'> = {},
  options: CallOptions = {},
): Promise<Result<MaterialPage>> {
  return call('materials.list', options, (client) =>
    client.GET('/api/v1/materials', {
      params: { header: { 'X-Session-Token': sessionToken }, query: { state: [...states], ...query } },
    }),
  );
}

/** One of the account's materials; `request.not_found` for any other id. */
export function getMaterial(sessionToken: string, id: string, options: CallOptions = {}): Promise<Result<Material>> {
  return call('materials.get', options, (client) =>
    client.GET('/api/v1/materials/{id}', { params: { header: { 'X-Session-Token': sessionToken }, path: { id } } }),
  );
}

/**
 * Page `page` of one of the account's materials, on the ground `review`: its picture's size and lines, or its text,
 * and its passages' places. `request.not_found` for another owner's material, a version that is not reviewable, a page
 * outside the material or one with no view.
 */
export function getPage(
  sessionToken: string,
  id: string,
  page: number,
  options: CallOptions = {},
): Promise<Result<MaterialPageView>> {
  return call('materials.page', options, (client) =>
    client.GET('/api/v1/materials/{id}/pages/{page}', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { id, page }, query: { ground: 'review' } },
    }),
  );
}

/**
 * The quality report of one of the account's materials (Story 1.20): its newest version's outline, unreadable pages
 * as runs, and warnings, while that version needs review or is ready. `request.not_found` in any other state, for
 * another owner's material and for an unknown one.
 */
export function getReport(sessionToken: string, id: string, options: CallOptions = {}): Promise<Result<MaterialReport>> {
  return call('materials.report', options, (client) =>
    client.GET('/api/v1/materials/{id}/report', { params: { header: { 'X-Session-Token': sessionToken }, path: { id } } }),
  );
}

/**
 * One of the GM's actions on a material's newest version (Story 1.20): the material as it is after it. A state that
 * does not allow it is `material.action_unavailable`; too many steps for a reprocess or a retry is
 * `ingestion.too_many_steps`; another owner's material is `request.not_found`.
 */
export function actOnMaterial(
  sessionToken: string,
  id: string,
  action: MaterialAction,
  options: CallOptions = {},
): Promise<Result<Material>> {
  const params = { params: { header: { 'X-Session-Token': sessionToken }, path: { id } } };
  return call(`materials.${action}`, options, (client) => {
    switch (action) {
      case 'accept':
        return client.POST('/api/v1/materials/{id}/accept', params);
      case 'reprocess':
        return client.POST('/api/v1/materials/{id}/reprocess', params);
      case 'retry':
        return client.POST('/api/v1/materials/{id}/retry', params);
      case 'discard':
        return client.POST('/api/v1/materials/{id}/discard', params);
    }
  });
}
