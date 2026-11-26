import 'server-only';

import { call, type CallOptions, type Result } from './accounts';
import type { components, operations } from './backend/generated/public';
import { listPage, type ListPage } from './list-page';

/**
 * A campaign's artifacts through the backend (Story 5.1 part A, public contract 1.42.0): what the GM writes and keeps in
 * a campaign. The backend takes the owner from the session token alone; another owner's campaign or artifact, and an
 * artifact of another campaign, answer `request.not_found`, like an unknown one. Nothing here logs a name or a field.
 *
 * - {@link createArtifact}: a new artifact (its record type's key, name, fields and optional content), answered as
 *   stored, version 1. A value outside its limits is `request.invalid` with `params.field` naming it.
 * - {@link listArtifacts}: the campaign's artifacts, newest first, a page at a time (`limit` and `offset`, or `cursor`),
 *   of one record type when `recordType` is given, with the list's `total` and the record types in use (`types`).
 * - {@link getArtifact}: one artifact with its newest version.
 */
type Schemas = components['schemas'];
export type Artifact = Schemas['Artifact'];
export type ArtifactField = Schemas['ArtifactField'];
export type ArtifactSummary = Schemas['ArtifactSummary'];
export type ArtifactPage = Schemas['ArtifactPage'];
export type ArtifactTypeCount = Schemas['ArtifactTypeCount'];
export type NewArtifact = Schemas['NewArtifact'];
export type ArtifactQuery = NonNullable<operations['listArtifacts']['parameters']['query']>;

const session = (sessionToken: string) => ({ 'X-Session-Token': sessionToken });

/** A new artifact of one of the account's campaigns, written by hand: the artifact as stored, version 1. */
export function createArtifact(sessionToken: string, campaignId: string, body: NewArtifact, options: CallOptions = {}): Promise<Result<Artifact>> {
  return call('artifacts.create', options, (client) =>
    client.POST('/api/v1/campaigns/{campaignId}/artifacts', {
      params: { header: session(sessionToken), path: { campaignId } },
      body,
    }),
  );
}

/** One of the account's campaigns' artifacts, newest first, a page at a time; `request.not_found` for any other campaign. */
export function listArtifacts(
  sessionToken: string,
  campaignId: string,
  query: ArtifactQuery = {},
  options: CallOptions = {},
): Promise<Result<ArtifactPage>> {
  return call('artifacts.list', options, (client) =>
    client.GET('/api/v1/campaigns/{campaignId}/artifacts', { params: { header: session(sessionToken), path: { campaignId }, query } }),
  );
}

/** One artifact of one of the account's campaigns; `request.not_found` for any other campaign or artifact. */
export function getArtifact(sessionToken: string, campaignId: string, artifactId: string, options: CallOptions = {}): Promise<Result<Artifact>> {
  return call('artifacts.read', options, (client) =>
    client.GET('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}', {
      params: { header: session(sessionToken), path: { campaignId, artifactId } },
    }),
  );
}

/**
 * Page `page` of a campaign's artifacts, `size` rows a page, of the type key `recordType` when it is not null, as a
 * screen shows it ({@link listPage}), with the record types in use in the whole campaign that the same answer named.
 */
export async function artifactsPage(
  sessionToken: string,
  campaignId: string,
  recordType: string | null,
  page: number,
  size: number,
): Promise<Result<{ readonly list: ListPage<ArtifactSummary>; readonly types: readonly ArtifactTypeCount[] }>> {
  let types: readonly ArtifactTypeCount[] = [];
  const list = await listPage(
    async (ask) => {
      const read = await listArtifacts(sessionToken, campaignId, recordType === null ? ask : { ...ask, recordType });
      if (read.ok) {
        types = read.data.types;
      }
      return read;
    },
    page,
    size,
  );
  return list.ok ? { ok: true, data: { list: list.data, types } } : list;
}
