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
type ListQuery = NonNullable<operations['listMaterials']['parameters']['query']>;

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
