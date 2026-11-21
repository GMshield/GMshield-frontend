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
/** Where a material belongs (Story 3.3): its campaign with its system, or its systems; both empty for none. */
export type MaterialBelonging = Schemas['MaterialBelonging'];
export type MaterialChange = Schemas['MaterialChange'];
/** Story 3.4: the ready version that keeps serving while a new one is on its way (`Material.serving`). */
export type MaterialServing = Schemas['MaterialServing'];
type ListQuery = NonNullable<operations['listMaterials']['parameters']['query']>;

/**
 * The GM's actions on a material's current version (Story 1.20), in the order the page shows them. From Story 3.4 the
 * current version is the newest one not discarded, and `reprocess` on a ready material reads a new version.
 */
export const MATERIAL_ACTIONS: readonly MaterialAction[] = ['accept', 'reprocess', 'retry', 'discard'];

/** The states the tray lists: everything not yet ready, and what needs the GM. */
export const TRAY_STATES: readonly MaterialState[] = ['uploading', 'waiting', 'processing', 'needs_review', 'failed'];

/** The states "Meus Arquivos" lists (Story 3.3): every one but a discarded material's. */
export const FILE_STATES: readonly MaterialState[] = ['uploading', 'waiting', 'processing', 'needs_review', 'ready', 'superseded', 'failed'];

/**
 * The account's materials whose newest version is in one of `states`, newest first. From Story 3.3 each carries its
 * version, size and where it belongs, and a material whose every place is being deleted is left out.
 */
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
 * Where one of the account's materials belongs, changed on the version it names (Story 3.3): one campaign or one or
 * more systems; the material as stored, its version raised by one. `request.stale_version` when it changed elsewhere,
 * `material.belonging_invalid` for a place that is not the account's (or both, or neither), `request.not_found` for
 * any other material. It applies from the next question.
 */
export function changeMaterial(sessionToken: string, id: string, body: MaterialChange, options: CallOptions = {}): Promise<Result<Material>> {
  return call('materials.change', options, (client) =>
    client.PATCH('/api/v1/materials/{id}', { params: { header: { 'X-Session-Token': sessionToken }, path: { id } }, body }),
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
 * One of the GM's actions on a material's current version (Story 1.20): the material as it is after it. A state that
 * does not allow it is `material.action_unavailable`; too many steps for a reprocess or a retry is
 * `ingestion.too_many_steps`; another owner's material is `request.not_found`. From Story 3.4 a reprocess of a ready
 * material answers it with a new version `waiting` and the ready one as `serving`; `material.version_in_progress` when
 * another version got there first.
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

/** An image set as the backend minted it (Story 1.21): its id, its material, its images' uploads in order. */
export type ImageSet = Schemas['ImageSet'];
export type ImageSetRequest = Schemas['ImageSetRequest'];
export type ImageSetImage = Schemas['ImageSetImage'];
export type ImageSetReplacement = Schemas['ImageSetReplacement'];
export type UploadCompletion = Schemas['UploadCompletion'];

/**
 * Creates an ordered set of images, its order confirmed (Story 1.21): one material whose pages they become, and one tus
 * upload per image, sent through the upload relay. Past 500 images or 2 GiB in all, `upload.set_too_large`. From Story
 * 3.4, with `material` (and no kind, language or place), the set is a new version of that material:
 * `material.version_in_progress` or `material.not_ready` (409) when it cannot get one now.
 */
export function createImageSet(sessionToken: string, body: ImageSetRequest, options: CallOptions = {}): Promise<Result<ImageSet>> {
  return call('materials.image_set', options, (client) =>
    client.POST('/api/v1/image-sets', { params: { header: { 'X-Session-Token': sessionToken } }, body }),
  );
}

/** A new upload for the failed image at `position` of one of the account's sets; `upload.image_not_failed` otherwise. */
export function replaceSetImage(
  sessionToken: string,
  id: string,
  position: number,
  body: ImageSetImage,
  options: CallOptions = {},
): Promise<Result<ImageSetReplacement>> {
  return call('materials.image_replace', options, (client) =>
    client.POST('/api/v1/image-sets/{id}/images/{position}', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { id, position } },
      body,
    }),
  );
}

/** Leaves out the failed image at `position` of one of the account's sets: the set as it is now. */
export function dropSetImage(sessionToken: string, id: string, position: number, options: CallOptions = {}): Promise<Result<UploadCompletion>> {
  return call('materials.image_drop', options, (client) =>
    client.DELETE('/api/v1/image-sets/{id}/images/{position}', {
      params: { header: { 'X-Session-Token': sessionToken }, path: { id, position } },
    }),
  );
}
