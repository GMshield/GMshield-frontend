import 'server-only';

import { call, type CallOptions, type Result } from './accounts';
import type { components } from './backend/generated/public';

/**
 * The signed-in account's library through the backend (Story 1.11): read only until Epic 3. The backend takes
 * the owner from the session token alone; another owner's item answers `request.not_found`, like an unknown
 * one. Nothing here logs a name.
 */
type Schemas = components['schemas'];
export type Campaign = Schemas['Campaign'];
export type GameSystem = Schemas['System'];

/** The current campaign with its system; `request.not_found` when the account has none. */
export function currentCampaign(sessionToken: string, options: CallOptions = {}): Promise<Result<Campaign>> {
  return call('library.current_campaign', options, (client) =>
    client.GET('/api/v1/campaigns/current', { params: { header: { 'X-Session-Token': sessionToken } } }),
  );
}
