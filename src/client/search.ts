import type { components } from '@/server/backend/generated/public';

import { isSourcePage, type SourcePage, type Tier } from './conversation';

/**
 * The browser's side of a search of the library (Story 3.9), towards this site only: a search is started with
 * `POST /api/v1/campaigns/{id}/searches`, read with `GET /api/v1/searches/{id}` until it is done or failed, and a
 * result's page is read on the ground of the campaign's current scope from
 * `GET /api/v1/campaigns/{id}/sources/{versionId}/pages/{page}`, its picture from `.../picture`. The relays reach the
 * backend; the browser never does. From Story 4.3 part B a search may be narrowed to a record type, and a result is a
 * passage or a record (`kind`).
 */

/** A search as the relay answers it. */
export type Search = components['schemas']['Search'];
export type SearchResult = components['schemas']['SearchResult'];
/**
 * A record type's key, as a search's filter and a record result name it (Story 4.3 part B): a core key, or from Story
 * 4.4 part B (public contract 1.39.0) the key of a type the GM approved, so any text of the key pattern.
 */
export type RecordTypeKey = NonNullable<components['schemas']['NewSearch']['recordType']>;

/** A passage result: its id and first words. */
export type PassageResult = SearchResult & { readonly kind: 'passage'; readonly passageId: string; readonly firstWords: string };
/** A record result (Story 4.3 part B): its id, name, type key and its passages on its first page. */
export type RecordResult = SearchResult & {
  readonly kind: 'record';
  readonly recordId: string;
  readonly name: string;
  readonly recordType: RecordTypeKey;
  readonly passageIds: string[];
};

/** What a search may be narrowed to: a tier of the scope, a material, a record type key; each null for none. */
export type SearchFilters = { readonly tier: Tier | null; readonly materialId: string | null; readonly recordType?: RecordTypeKey | null };

/** Whether a result is a record (Story 4.3 part B); else it is a passage. */
export function isRecordResult(result: SearchResult): result is RecordResult {
  return result.kind === 'record';
}

/** A result's own id: the passage's or the record's. */
export function resultId(result: SearchResult): string {
  return (isRecordResult(result) ? result.recordId : result.passageId) ?? '';
}

/** The problem used when the relay does not answer or answers something else: the generic "unavailable" text. */
const UNAVAILABLE = { status: 503, category: 'server', code: 'server.unavailable', params: {} } as const;

export type Started = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly status: number; readonly problem: unknown };

export type Read = { readonly ok: true; readonly search: Search } | { readonly ok: false; readonly status: number; readonly problem: unknown };

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

const TIER_WORDS: readonly string[] = ['campaign', 'system', 'other'];

/** Whether a result is a well-formed passage (Story 3.9) or record (Story 4.3 part B) result. */
function isResult(value: unknown): value is SearchResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  const common = typeof result.versionId === 'string' && typeof result.materialName === 'string' && isStrings(result.sectionPath)
    && Number.isInteger(result.page) && (result.page as number) >= 1
    && typeof result.tier === 'string' && TIER_WORDS.includes(result.tier);
  if (result.kind === 'passage') {
    return common && typeof result.passageId === 'string' && typeof result.firstWords === 'string';
  }
  if (result.kind === 'record') {
    return common && typeof result.recordId === 'string' && typeof result.name === 'string'
      && typeof result.recordType === 'string' && isStrings(result.passageIds);
  }
  return false;
}

/** Whether the relay's answer is a search; a result that is not well formed makes it none. */
function isSearch(value: unknown): value is Search {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const search = value as Record<string, unknown>;
  return typeof search.id === 'string' && typeof search.campaignId === 'string' && typeof search.query === 'string'
    && (search.state === 'pending' || search.state === 'done' || search.state === 'failed')
    && (search.code === undefined || typeof search.code === 'string')
    && Array.isArray(search.results) && search.results.every(isResult);
}

/** Starts a search of the campaign's scope narrowed by `filters`; answers its id, or the problem the relay answered. */
export async function startSearch(campaignId: string, query: string, filters: SearchFilters): Promise<Started> {
  try {
    const response = await fetch(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, tier: filters.tier, materialId: filters.materialId, recordType: filters.recordType ?? null }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 202 && typeof (body as { id?: unknown } | null)?.id === 'string') {
      return { ok: true, id: (body as { id: string }).id };
    }
    return { ok: false, status: response.status, problem: body ?? UNAVAILABLE };
  } catch {
    return { ok: false, status: UNAVAILABLE.status, problem: UNAVAILABLE };
  }
}

/** Reads a search; the problem the relay answered (404 for one that is not the account's), or "unavailable". */
export async function readSearch(searchId: string, signal?: AbortSignal): Promise<Read> {
  try {
    const response = await fetch(`/api/v1/searches/${encodeURIComponent(searchId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 200 && isSearch(body)) {
      return { ok: true, search: body };
    }
    return { ok: false, status: response.status === 200 ? UNAVAILABLE.status : response.status, problem: body ?? UNAVAILABLE };
  } catch {
    return { ok: false, status: UNAVAILABLE.status, problem: UNAVAILABLE };
  }
}

/** The relay's path of a page of the campaign's current scope, under `/api/v1/` (the callers write that prefix). */
function scopePagePath(campaignId: string, versionId: string, page: number): string {
  return `campaigns/${encodeURIComponent(campaignId)}/sources/${encodeURIComponent(versionId)}/pages/${page}`;
}

/** The address of the picture of a page of the campaign's current scope, through the picture relay. */
export function scopePictureUrl(campaignId: string, versionId: string, page: number): string {
  return `/api/v1/${scopePagePath(campaignId, versionId, page)}/picture`;
}

/**
 * Reads a page of the campaign's current scope (a search result's page): the page, or null when the relay refused it
 * (a source out of the scope since, a page that is not one, no session) or did not answer one.
 */
export async function fetchScopePage(campaignId: string, versionId: string, page: number, signal?: AbortSignal): Promise<SourcePage | null> {
  try {
    const response = await fetch(`/api/v1/${scopePagePath(campaignId, versionId, page)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return response.status === 200 && isSourcePage(body) ? body : null;
  } catch {
    return null;
  }
}
