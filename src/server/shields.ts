import 'server-only';

import { call, type CallOptions, type Result } from './accounts';
import type { components, operations } from './backend/generated/public';
import { everyPage, type Every } from './every-page';
import { listPage, type ListPage } from './list-page';

/**
 * A campaign's Shields through the backend (Story 6.1, public contracts 1.55.0 and, for the deletion, 1.56.0): the GM's private space in a
 * campaign, for notes (6.2) and dice (6.3, 6.4). Every campaign has at least one: the first is unnamed (`name` null)
 * until the GM renames it, and the screens show it as "Escudo do Mestre" / "GM's Shield". The backend takes the owner
 * from the session token alone; another owner's campaign or Shield, a Shield of another campaign and a campaign being
 * deleted answer `request.not_found`, like an unknown one. Nothing here logs a name.
 *
 * - {@link listShields}: the campaign's Shields, oldest first, a page at a time (`limit` and `offset`, or `cursor`), with
 *   the list's `total`; {@link shieldsPage} reads one numbered page of it, and {@link everyShield} the whole list (Story
 *   6.2 part B: the Shields a note can move to).
 * - {@link getShield}: one Shield (`{id, name, version}`).
 * - {@link createShield}: a new Shield with a typed name, answered as stored (201, version 0).
 * - {@link renameShield}: a rename on the version the GM read (`request.stale_version` when it changed elsewhere).
 *
 * - {@link shieldDeletion}: what goes with a Shield if it is deleted (`{notes, rolls, last}`; part B, contract 1.56.0;
 *   from Story 6.2 part B, contract 1.58.0, `notes` counts its live notes).
 * - {@link deleteShield}: starts a Shield's deletion (202 from contract 1.58.0, 204 before: the Shield and its notes are
 *   not found at once and go in the background); the campaign's only Shield is `request.last_shield`.
 *
 * A name outside 1 to 120 characters is `request.shield_name_invalid`; a name another Shield of the campaign has
 * (trimmed, whatever the case) is `request.shield_name_taken`.
 *
 * Story 6.2 part A (contract 1.57.0), a Shield's notes. A note is an artifact of the campaign of record type `note` that
 * names its Shield (`shieldId`); it opens, changes and is deleted through `./artifacts`.
 * - {@link listShieldNotes}: the Shield's notes, newest first, a page at a time, with the list's `total`;
 *   {@link shieldNotesPage} reads one numbered page of it.
 * - {@link createShieldNote}: a new note (`{name, content}`), answered as the artifact stored (201, version 1). A title
 *   outside 1 to 200 characters or a text over 20,000 is `request.invalid` naming its field.
 */
type Schemas = components['schemas'];
export type Shield = Schemas['Shield'];
export type ShieldPage = Schemas['ShieldPage'];
export type NewShield = Schemas['NewShield'];
export type ShieldRename = Schemas['ShieldRename'];
export type ShieldDeletion = Schemas['ShieldDeletion'];
export type ShieldQuery = NonNullable<operations['listShields']['parameters']['query']>;
export type NotePage = Schemas['NotePage'];
export type NoteSummary = NotePage['items'][number];
export type NewNote = Schemas['NewNote'];
export type NoteQuery = NonNullable<operations['listShieldNotes']['parameters']['query']>;
export type Note = Schemas['Artifact'];

const session = (sessionToken: string) => ({ 'X-Session-Token': sessionToken });

/** The Shields of one of the account's campaigns, oldest first, a page at a time; `request.not_found` for any other. */
export function listShields(
  sessionToken: string,
  campaignId: string,
  query: ShieldQuery = {},
  options: CallOptions = {},
): Promise<Result<ShieldPage>> {
  return call('shields.list', options, (client) =>
    client.GET('/api/v1/campaigns/{id}/shields', { params: { header: session(sessionToken), path: { id: campaignId }, query } }),
  );
}

/** Page `page` of a campaign's Shields, `size` a page, with where it stands in the whole list. */
export function shieldsPage(sessionToken: string, campaignId: string, page: number, size: number): Promise<Result<ListPage<Shield>>> {
  return listPage((ask) => listShields(sessionToken, campaignId, ask), page, size);
}

/** Every Shield of one of the account's campaigns, oldest first, 50 a call (Story 6.2 part B). */
export function everyShield(sessionToken: string, campaignId: string, options: CallOptions = {}): Promise<Result<Every<Shield>>> {
  return everyPage((cursor) => listShields(sessionToken, campaignId, { limit: 50, ...(cursor === undefined ? {} : { cursor }) }, options));
}

/** One Shield of one of the account's campaigns; `request.not_found` for any other id. */
export function getShield(sessionToken: string, campaignId: string, shieldId: string, options: CallOptions = {}): Promise<Result<Shield>> {
  return call('shields.read', options, (client) =>
    client.GET('/api/v1/campaigns/{id}/shields/{shieldId}', {
      params: { header: session(sessionToken), path: { id: campaignId, shieldId } },
    }),
  );
}

/** A new Shield of one of the account's campaigns, named by the GM: the Shield as stored, version 0. */
export function createShield(sessionToken: string, campaignId: string, body: NewShield, options: CallOptions = {}): Promise<Result<Shield>> {
  return call('shields.create', options, (client) =>
    client.POST('/api/v1/campaigns/{id}/shields', { params: { header: session(sessionToken), path: { id: campaignId } }, body }),
  );
}

/** A Shield renamed on the version the GM read: the Shield as stored, its version raised by one. */
export function renameShield(
  sessionToken: string,
  campaignId: string,
  shieldId: string,
  body: ShieldRename,
  options: CallOptions = {},
): Promise<Result<Shield>> {
  return call('shields.rename', options, (client) =>
    client.PATCH('/api/v1/campaigns/{id}/shields/{shieldId}', {
      params: { header: session(sessionToken), path: { id: campaignId, shieldId } },
      body,
    }),
  );
}

/**
 * What goes with one Shield of one of the account's campaigns if it is deleted: its live notes (from contract 1.58.0)
 * and stored rolls (0 until they exist), and whether it is the campaign's only Shield (`last`); `request.not_found` for
 * any other id.
 */
export function shieldDeletion(sessionToken: string, campaignId: string, shieldId: string, options: CallOptions = {}): Promise<Result<ShieldDeletion>> {
  return call('shields.deletion', options, (client) =>
    client.GET('/api/v1/campaigns/{id}/shields/{shieldId}/deletion', {
      params: { header: session(sessionToken), path: { id: campaignId, shieldId } },
    }),
  );
}

/**
 * Starts the deletion of one Shield of one of the account's campaigns (202 from contract 1.58.0, 204 before; no body
 * either way, and `call` reads both as done): the Shield and its notes are not found at once, and the notes go in the
 * background with their index points. `request.last_shield` for the campaign's only Shield, `request.not_found` for any
 * other id, one already deleted included.
 */
export function deleteShield(sessionToken: string, campaignId: string, shieldId: string, options: CallOptions = {}): Promise<Result<undefined>> {
  return call('shields.delete', options, (client) =>
    client.DELETE('/api/v1/campaigns/{id}/shields/{shieldId}', {
      params: { header: session(sessionToken), path: { id: campaignId, shieldId } },
    }),
  );
}

/** The notes one Shield of one of the account's campaigns holds, newest first, a page at a time; `request.not_found` for any other. */
export function listShieldNotes(
  sessionToken: string,
  campaignId: string,
  shieldId: string,
  query: NoteQuery = {},
  options: CallOptions = {},
): Promise<Result<NotePage>> {
  return call('shields.notes', options, (client) =>
    client.GET('/api/v1/campaigns/{id}/shields/{shieldId}/notes', {
      params: { header: session(sessionToken), path: { id: campaignId, shieldId }, query },
    }),
  );
}

/** Page `page` of a Shield's notes, `size` a page, with where it stands in the whole list. */
export function shieldNotesPage(
  sessionToken: string,
  campaignId: string,
  shieldId: string,
  page: number,
  size: number,
): Promise<Result<ListPage<NoteSummary>>> {
  return listPage((ask) => listShieldNotes(sessionToken, campaignId, shieldId, ask), page, size);
}

/** A new note written in one Shield of one of the account's campaigns: the artifact as stored, of type `note`, version 1. */
export function createShieldNote(
  sessionToken: string,
  campaignId: string,
  shieldId: string,
  body: NewNote,
  options: CallOptions = {},
): Promise<Result<Note>> {
  return call('shields.createNote', options, (client) =>
    client.POST('/api/v1/campaigns/{id}/shields/{shieldId}/notes', {
      params: { header: session(sessionToken), path: { id: campaignId, shieldId } },
      body,
    }),
  );
}
