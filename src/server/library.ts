import 'server-only';

import { call, type CallOptions, type Result } from './accounts';
import type { components, operations } from './backend/generated/public';
import { everyPage, type Every } from './every-page';

/**
 * The signed-in account's library through the backend (Story 1.11). The backend takes the owner from the session
 * token alone; another owner's item answers `request.not_found`, like an unknown one. Nothing here logs a name.
 *
 * Story 3.1: the list of systems by page, one system, a new one, an edit by its version (`request.stale_version` when
 * the system changed elsewhere, `request.system_name_taken` for a name and edition the account has, a field's own
 * `request.system_*_invalid`), and a system's campaigns by page.
 *
 * Story 3.1 part B: what a system's deletion takes with it (`{campaigns, conversations, materials}`), and the deletion
 * itself (202, no body). From the delete on, the system and its campaigns are `request.not_found` everywhere.
 *
 * Story 3.2: every campaign of the account (`system` optional, the archived ones with `archived: true`), one campaign,
 * a new one (it becomes the current one), a rename, archive or restore by its version (`request.stale_version`,
 * `request.campaign_name_taken`, `request.campaign_name_invalid`), and the choice of the current campaign (an archived
 * one is `request.not_found`). The current campaign is the backend's: nothing about it is kept in the browser.
 *
 * Story 3.2 part B: what a campaign's deletion takes with it (`{conversations, materials}`), and the deletion itself
 * (202, no body). From the delete on, the campaign is `request.not_found` everywhere, and the current campaign falls back.
 *
 * Story 3.6: a campaign's scope settings as the backend resolves them (its three tier switches, model knowledge, their
 * version and every material of its tiers, each with whether it is on), and a change of them on the version read
 * (`request.stale_version` when they changed elsewhere, `scope.material_unknown` for a material in none of its tiers).
 * Only the backend works out what a campaign may use; nothing here filters or computes a scope.
 *
 * Story 4.1: a system's record types by page (`{items, total}`, the eight core types first in their fixed order), each
 * with its record count. A core type is named by its `core` key, which the screen translates; its stored `name` is never
 * shown.
 */
type Schemas = components['schemas'];
export type Campaign = Schemas['Campaign'];
export type GameSystem = Schemas['System'];
export type SystemPage = Schemas['SystemPage'];
export type NewSystem = Schemas['NewSystem'];
export type SystemChange = Schemas['SystemChange'];
export type CampaignSummary = Schemas['CampaignSummary'];
export type CampaignPage = Schemas['CampaignPage'];
export type SystemDeletion = Schemas['SystemDeletion'];
export type CampaignDeletion = Schemas['CampaignDeletion'];
export type NewCampaign = Schemas['NewCampaign'];
export type CampaignChange = Schemas['CampaignChange'];
export type Scope = Schemas['Scope'];
export type ScopeChange = Schemas['ScopeChange'];
export type ScopeMaterial = Schemas['ScopeMaterial'];
export type RecordType = Schemas['RecordType'];
export type RecordTypePage = Schemas['RecordTypePage'];
/** The key of a core record type (Story 4.1): the same eight in every system. */
export type CoreRecordType = NonNullable<RecordType['core']>;
type PageQuery = NonNullable<operations['listSystems']['parameters']['query']>;
type RecordTypeQuery = NonNullable<operations['listRecordTypes']['parameters']['query']>;
export type CampaignQuery = NonNullable<operations['listCampaigns']['parameters']['query']>;

const session = (sessionToken: string) => ({ 'X-Session-Token': sessionToken });

/** The current campaign with its system; `request.not_found` when the account has none. */
export function currentCampaign(sessionToken: string, options: CallOptions = {}): Promise<Result<Campaign>> {
  return call('library.current_campaign', options, (client) =>
    client.GET('/api/v1/campaigns/current', { params: { header: session(sessionToken) } }),
  );
}

/** The account's systems, newest first, a page at a time (`cursor`: the previous page's `nextCursor`). */
export function listSystems(sessionToken: string, query: PageQuery = {}, options: CallOptions = {}): Promise<Result<SystemPage>> {
  return call('library.systems', options, (client) =>
    client.GET('/api/v1/systems', { params: { header: session(sessionToken), query } }),
  );
}

/** One of the account's systems; `request.not_found` for any other id. */
export function getSystem(sessionToken: string, id: string, options: CallOptions = {}): Promise<Result<GameSystem>> {
  return call('library.system', options, (client) =>
    client.GET('/api/v1/systems/{id}', { params: { header: session(sessionToken), path: { id } } }),
  );
}

/**
 * The record types of one of the account's systems, a page at a time (Story 4.1): the core types first, in their fixed
 * order, each with its record count; `request.not_found` for any other system.
 */
export function listRecordTypes(
  sessionToken: string,
  id: string,
  query: RecordTypeQuery = {},
  options: CallOptions = {},
): Promise<Result<RecordTypePage>> {
  return call('ontology.record_types', options, (client) =>
    client.GET('/api/v1/systems/{id}/record-types', { params: { header: session(sessionToken), path: { id }, query } }),
  );
}

/** A new system of the account; `request.system_name_taken` when it has one with the same name and edition. */
export function createSystem(sessionToken: string, body: NewSystem, options: CallOptions = {}): Promise<Result<GameSystem>> {
  return call('library.system_create', options, (client) =>
    client.POST('/api/v1/systems', { params: { header: session(sessionToken) }, body }),
  );
}

/** An edit of one of the account's systems on the version it names; `request.stale_version` when it moved on. */
export function changeSystem(sessionToken: string, id: string, body: SystemChange, options: CallOptions = {}): Promise<Result<GameSystem>> {
  return call('library.system_change', options, (client) =>
    client.PATCH('/api/v1/systems/{id}', { params: { header: session(sessionToken), path: { id } }, body }),
  );
}

/**
 * The account's campaigns, newest first, a page at a time: of one system with `system` (`request.not_found` for another
 * system), the archived ones with `archived: true`, else those in use.
 */
export function listCampaigns(sessionToken: string, query: CampaignQuery = {}, options: CallOptions = {}): Promise<Result<CampaignPage>> {
  return call('library.campaigns', options, (client) =>
    client.GET('/api/v1/campaigns', { params: { header: session(sessionToken), query } }),
  );
}

/** Every system of the account, newest first, and whether the list was read to its end (the "Sistemas" pages). */
export function everySystem(sessionToken: string, options: CallOptions = {}): Promise<Result<Every<GameSystem>>> {
  return everyPage((cursor) => listSystems(sessionToken, { limit: 50, ...(cursor === undefined ? {} : { cursor }) }, options));
}

/**
 * Every campaign of the account that `query` asks for (of one system, the archived ones), newest first, and whether
 * the list was read to its end (the pages of "Minhas Mesas" and of a system's campaigns).
 */
export function everyCampaign(
  sessionToken: string,
  query: Omit<CampaignQuery, 'limit' | 'cursor'> = {},
  options: CallOptions = {},
): Promise<Result<Every<CampaignSummary>>> {
  return everyPage((cursor) => listCampaigns(sessionToken, { ...query, limit: 50, ...(cursor === undefined ? {} : { cursor }) }, options));
}

/** A whole list as its items alone. */
async function itemsOf<T>(list: Promise<Result<Every<T>>>): Promise<Result<T[]>> {
  const result = await list;
  return result.ok ? { ok: true, data: result.data.items } : result;
}

/** Every system of the account, newest first (Story 3.3), 50 a page. */
export function listAllSystems(sessionToken: string, options: CallOptions = {}): Promise<Result<GameSystem[]>> {
  return itemsOf(everySystem(sessionToken, options));
}

/** Every campaign in use of the account (not archived), newest first (Story 3.3), 50 a page. */
export function listAllCampaigns(sessionToken: string, options: CallOptions = {}): Promise<Result<CampaignSummary[]>> {
  return itemsOf(everyCampaign(sessionToken, {}, options));
}

/** One of the account's campaigns, archived or not, with its system and version; `request.not_found` for any other id. */
export function getCampaign(sessionToken: string, id: string, options: CallOptions = {}): Promise<Result<Campaign>> {
  return call('library.campaign', options, (client) =>
    client.GET('/api/v1/campaigns/{id}', { params: { header: session(sessionToken), path: { id } } }),
  );
}

/** A new campaign of one of the account's systems, which becomes the current one; `request.campaign_name_taken`. */
export function createCampaign(sessionToken: string, body: NewCampaign, options: CallOptions = {}): Promise<Result<Campaign>> {
  return call('library.campaign_create', options, (client) =>
    client.POST('/api/v1/campaigns', { params: { header: session(sessionToken) }, body }),
  );
}

/** A rename, archive or restore of one of the account's campaigns on the version it names. */
export function changeCampaign(sessionToken: string, id: string, body: CampaignChange, options: CallOptions = {}): Promise<Result<Campaign>> {
  return call('library.campaign_change', options, (client) =>
    client.PATCH('/api/v1/campaigns/{id}', { params: { header: session(sessionToken), path: { id } }, body }),
  );
}

/** Makes one of the account's campaigns the current one; `request.not_found` for an archived one or any other id. */
export function chooseCampaign(sessionToken: string, campaignId: string, options: CallOptions = {}): Promise<Result<Campaign>> {
  return call('library.campaign_choose', options, (client) =>
    client.PUT('/api/v1/campaigns/current', { params: { header: session(sessionToken) }, body: { campaignId } }),
  );
}

/** What goes with one of the account's systems if it is deleted; `request.not_found` for any other id. */
export function systemDeletion(sessionToken: string, id: string, options: CallOptions = {}): Promise<Result<SystemDeletion>> {
  return call('library.system_deletion', options, (client) =>
    client.GET('/api/v1/systems/{id}/deletion', { params: { header: session(sessionToken), path: { id } } }),
  );
}

/**
 * Deletes one of the account's systems with its campaigns, their conversations and the materials attached only to it
 * (202, no body: the removal runs in the backend); `request.not_found` for any other id, one already deleted included.
 */
export function deleteSystem(sessionToken: string, id: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('library.system_delete', options, (client) =>
    client.DELETE('/api/v1/systems/{id}', { params: { header: session(sessionToken), path: { id } } }),
  );
}

/** What goes with one of the account's campaigns if it is deleted; `request.not_found` for any other id. */
export function campaignDeletion(sessionToken: string, id: string, options: CallOptions = {}): Promise<Result<CampaignDeletion>> {
  return call('library.campaign_deletion', options, (client) =>
    client.GET('/api/v1/campaigns/{id}/deletion', { params: { header: session(sessionToken), path: { id } } }),
  );
}

/**
 * Deletes one of the account's campaigns with its conversation and the materials attached to it (202, no body: the
 * removal runs in the backend); `request.not_found` for any other id, one already deleted included.
 */
export function deleteCampaign(sessionToken: string, id: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('library.campaign_delete', options, (client) =>
    client.DELETE('/api/v1/campaigns/{id}', { params: { header: session(sessionToken), path: { id } } }),
  );
}

/** One of the account's campaigns' scope settings, with the materials of every tier; `request.not_found` for any other id. */
export function getCampaignScope(sessionToken: string, id: string, options: CallOptions = {}): Promise<Result<Scope>> {
  return call('scope.campaign', options, (client) =>
    client.GET('/api/v1/campaigns/{id}/scope', { params: { header: session(sessionToken), path: { id } } }),
  );
}

/**
 * A change of one of the account's campaigns' scope settings on the version it names, from the next question on: the
 * switches replaced and the materials off exactly those listed. `request.stale_version` when they moved on.
 */
export function changeCampaignScope(sessionToken: string, id: string, body: ScopeChange, options: CallOptions = {}): Promise<Result<Scope>> {
  return call('scope.campaign_change', options, (client) =>
    client.PUT('/api/v1/campaigns/{id}/scope', { params: { header: session(sessionToken), path: { id } }, body }),
  );
}
