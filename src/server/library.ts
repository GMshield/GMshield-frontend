import 'server-only';

import { call, type CallOptions, type Result } from './accounts';
import type { components, operations } from './backend/generated/public';

/**
 * The signed-in account's library through the backend (Story 1.11). The backend takes the owner from the session
 * token alone; another owner's item answers `request.not_found`, like an unknown one. Nothing here logs a name.
 *
 * Story 3.1: the list of systems by page, one system, a new one, an edit by its version (`request.stale_version` when
 * the system changed elsewhere, `request.system_name_taken` for a name and edition the account has, a field's own
 * `request.system_*_invalid`), and a system's campaigns by page.
 */
type Schemas = components['schemas'];
export type Campaign = Schemas['Campaign'];
export type GameSystem = Schemas['System'];
export type SystemPage = Schemas['SystemPage'];
export type NewSystem = Schemas['NewSystem'];
export type SystemChange = Schemas['SystemChange'];
export type CampaignSummary = Schemas['CampaignSummary'];
export type CampaignPage = Schemas['CampaignPage'];
type PageQuery = NonNullable<operations['listSystems']['parameters']['query']>;

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

/** The campaigns of one of the account's systems, newest first, a page at a time; `request.not_found` for another system. */
export function listCampaigns(
  sessionToken: string,
  system: string,
  query: PageQuery = {},
  options: CallOptions = {},
): Promise<Result<CampaignPage>> {
  return call('library.campaigns', options, (client) =>
    client.GET('/api/v1/campaigns', { params: { header: session(sessionToken), query: { system, ...query } } }),
  );
}
