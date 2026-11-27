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
 * - Story 5.2 part B (contract 1.45.0): {@link deleteArtifact} starts the artifact's deletion with every version.
 * - Story 5.5 part A (contract 1.50.0): {@link setOverride} marks the artifact as overriding one record of its
 *   campaign's system (or points its mark to another), {@link removeOverride} drops the mark (safe to repeat), and
 *   {@link overrideTargets} lists the records it can override, alphabetical, by type and name. A record that is no
 *   target is `artifact.override_target`; one another artifact of the campaign overrides is `artifact.override_taken`.
 * - Story 5.5 part B (contract 1.51.0): {@link relate} relates the artifact to a record of its campaign's scope or to
 *   another artifact of the campaign, {@link unrelate} removes a relation from either side (safe to repeat), and
 *   {@link relationTargets} lists the records it can be related to, each with its tier. A record that is no target is
 *   `artifact.relation_target`; a 51st relation is `artifact.relations_full`. A relation changes no answer.
 * - Story 5.6 part A (contract 1.52.0): {@link share} sets the whole set of the account's other campaigns of the
 *   artifact's system it is shared with (empty unshares it from all); a campaign that is no target is
 *   `artifact.share_target`. Every artifact carries `sharedWith` (by name) and `sharedFrom`: {@link getArtifact} also
 *   answers, read-only, an artifact shared into the campaign asked, `sharedFrom` naming its own campaign; every other
 *   call here answers it `request.not_found` there.
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
export type ArtifactOverride = Schemas['ArtifactOverride'];
export type OverrideTarget = Schemas['OverrideTarget'];
export type OverrideTargetPage = Schemas['OverrideTargetPage'];
export type ArtifactRelated = Schemas['ArtifactRelated'];
export type RelationTarget = Schemas['RelationTarget'];
export type RelationTargetPage = Schemas['RelationTargetPage'];
export type ArtifactSharedWith = Schemas['ArtifactSharedWith'];
export type ArtifactSharedFrom = Schemas['ArtifactSharedFrom'];

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

/**
 * Deletes one of the account's campaigns' artifacts with every version (Story 5.2 part B; 202, no body: its versions,
 * index rows and index points go in the backend). It leaves every list and every question at once; answers that cited
 * it show "fonte removida". `request.not_found` for any other campaign or artifact, one already being deleted included.
 */
export function deleteArtifact(sessionToken: string, campaignId: string, artifactId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('artifacts.delete', options, (client) =>
    client.DELETE('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}', {
      params: { header: session(sessionToken), path: { campaignId, artifactId } },
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

/**
 * The GM marks one of the account's campaigns' artifacts as overriding the record `recordId` of its campaign's system
 * (Story 5.5 part A): the artifact with its mark. It applies from the next question.
 */
export function setOverride(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  recordId: string,
  options: CallOptions = {},
): Promise<Result<Artifact>> {
  return call('artifacts.override', options, (client) =>
    client.PUT('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}/override', {
      params: { header: session(sessionToken), path: { campaignId, artifactId } },
      body: { recordId },
    }),
  );
}

/** The GM removes an artifact's mark (Story 5.5 part A; 204, no body, also when it had none). */
export function removeOverride(sessionToken: string, campaignId: string, artifactId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('artifacts.removeOverride', options, (client) =>
    client.DELETE('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}/override', {
      params: { header: session(sessionToken), path: { campaignId, artifactId } },
    }),
  );
}

/**
 * The records an artifact of the campaign can override (Story 5.5 part A): of the type key `recordType`, whose name
 * contains `q` (case and accents ignored), from `offset`, at most `limit`, alphabetical, with how many match in all.
 */
export function overrideTargets(
  sessionToken: string,
  campaignId: string,
  query: { readonly recordType: string; readonly q?: string; readonly offset?: number; readonly limit?: number },
  options: CallOptions = {},
): Promise<Result<OverrideTargetPage>> {
  return call('artifacts.overrideTargets', options, (client) =>
    client.GET('/api/v1/campaigns/{campaignId}/override-targets', {
      params: { header: session(sessionToken), path: { campaignId }, query: { ...query } },
    }),
  );
}

/**
 * The GM relates one of the account's campaigns' artifacts to the record `recordId` (Story 5.5 part B): an extracted
 * record of the campaign's scope or another artifact of the campaign. The artifact with its relations; a relation that
 * exists already, from either side, is kept as it is.
 */
export function relate(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  recordId: string,
  options: CallOptions = {},
): Promise<Result<Artifact>> {
  return call('artifacts.relate', options, (client) =>
    client.POST('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}/relations', {
      params: { header: session(sessionToken), path: { campaignId, artifactId } },
      body: { recordId },
    }),
  );
}

/**
 * The GM shares one of the account's campaigns' artifacts with exactly the campaigns `campaignIds` (Story 5.6 part A):
 * the account's other campaigns of its system, the whole set (empty unshares it from every campaign). The artifact with
 * its `sharedWith`; `artifact.share_target` when any id is no target, and nothing is stored then.
 */
export function share(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  campaignIds: readonly string[],
  options: CallOptions = {},
): Promise<Result<Artifact>> {
  return call('artifacts.share', options, (client) =>
    client.PUT('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}/sharing', {
      params: { header: session(sessionToken), path: { campaignId, artifactId } },
      body: { campaignIds: [...campaignIds] },
    }),
  );
}

/** The GM removes the relation between an artifact and a record (Story 5.5 part B; 204, also when there was none). */
export function unrelate(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  recordId: string,
  options: CallOptions = {},
): Promise<Result<undefined>> {
  return call('artifacts.unrelate', options, (client) =>
    client.DELETE('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}/relations/{recordId}', {
      params: { header: session(sessionToken), path: { campaignId, artifactId, recordId } },
    }),
  );
}

/**
 * The records an artifact can be related to (Story 5.5 part B): of the type key `recordType`, whose name contains `q`
 * (case and accents ignored), from `offset`, at most `limit`, alphabetical, each with its tier, with how many match in
 * all. The artifact itself and the records it is related to already are left out.
 */
export function relationTargets(
  sessionToken: string,
  campaignId: string,
  artifactId: string,
  query: { readonly recordType: string; readonly q?: string; readonly offset?: number; readonly limit?: number },
  options: CallOptions = {},
): Promise<Result<RelationTargetPage>> {
  return call('artifacts.relationTargets', options, (client) =>
    client.GET('/api/v1/campaigns/{campaignId}/artifacts/{artifactId}/relation-targets', {
      params: { header: session(sessionToken), path: { campaignId, artifactId }, query: { ...query } },
    }),
  );
}
