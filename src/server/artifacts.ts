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
 * - {@link getArtifact}: one artifact with its newest version, or (Story 5.2) one of its versions by number, as a
 *   reference that cited it opens it; `currentVersion` names the newest either way.
 * - Story 5.2 (contract 1.44.0): {@link updateArtifact} (the GM's edit) and {@link restoreArtifact} (an earlier version
 *   copied as the newest) each store the next version and name the newest version the GM saw (`version`); a stale one
 *   is `request.stale_version`. {@link artifactVersions} lists the versions newest first, a page at a time.
 */
type Schemas = components['schemas'];
export type Artifact = Schemas['Artifact'];
export type ArtifactField = Schemas['ArtifactField'];
export type ArtifactSummary = Schemas['ArtifactSummary'];
export type ArtifactPage = Schemas['ArtifactPage'];
export type ArtifactTypeCount = Schemas['ArtifactTypeCount'];
export type NewArtifact = Schemas['NewArtifact'];
export type ArtifactQuery = NonNullable<operations['listArtifacts']['parameters']['query']>;
export type ArtifactEdit = Schemas['ArtifactEdit'];
export type ArtifactVersionSummary = Schemas['ArtifactVersionSummary'];
export type ArtifactVersionPage = Schemas['ArtifactVersionPage'];
export type ArtifactVersionQuery = NonNullable<operations['listArtifactVersions']['parameters']['query']>;

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

/**
 * One artifact of one of the account's campaigns, with its newest version, or with the version `version` when it is
 * given (Story 5.2); `request.not_found` for any other campaign or artifact, and for a number the artifact lacks.
 */
export function getArtifact(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  version?: number | null,
  options: CallOptions = {},
): Promise<Result<Artifact>> {
  if (version !== undefined && version !== null) {
    return call('artifacts.readVersion', options, (client) =>
      client.GET('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}/versions/{number}', {
        params: { header: session(sessionToken), path: { campaignId, artifactId, number: version } },
      }),
    );
  }
  return call('artifacts.read', options, (client) =>
    client.GET('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}', {
      params: { header: session(sessionToken), path: { campaignId, artifactId } },
    }),
  );
}

/** The GM's edit of one of the account's campaigns' artifacts (Story 5.2): its next version, as stored. */
export function updateArtifact(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  body: ArtifactEdit,
  options: CallOptions = {},
): Promise<Result<Artifact>> {
  return call('artifacts.update', options, (client) =>
    client.PATCH('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}', {
      params: { header: session(sessionToken), path: { campaignId, artifactId } },
      body,
    }),
  );
}

/** An earlier version `number` restored as the artifact's next version (Story 5.2), on the newest version `version`. */
export function restoreArtifact(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  number: number,
  version: number,
  options: CallOptions = {},
): Promise<Result<Artifact>> {
  return call('artifacts.restore', options, (client) =>
    client.POST('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}/versions/{number}/restore', {
      params: { header: session(sessionToken), path: { campaignId, artifactId, number } },
      body: { version },
    }),
  );
}

/** An artifact's versions, newest first, a page at a time (Story 5.2); `request.not_found` for any other artifact. */
export function artifactVersions(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  query: ArtifactVersionQuery = {},
  options: CallOptions = {},
): Promise<Result<ArtifactVersionPage>> {
  return call('artifacts.versions', options, (client) =>
    client.GET('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}/versions', {
      params: { header: session(sessionToken), path: { campaignId, artifactId }, query },
    }),
  );
}

/** Page `page` of an artifact's versions, `size` rows a page, as a screen shows it ({@link listPage}). */
export function artifactVersionsPage(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  page: number,
  size: number,
): Promise<Result<ListPage<ArtifactVersionSummary>>> {
  return listPage((ask) => artifactVersions(sessionToken, campaignId, artifactId, ask), page, size);
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
