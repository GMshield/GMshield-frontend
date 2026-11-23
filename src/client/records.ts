import { isSourcePage, type SourcePage } from './conversation';

/**
 * The browser's side of a record's references (Story 4.3), towards this site only: a page of the version a record was
 * read from is read on the record's ground from `GET /api/v1/systems/{id}/records/{recordId}/pages/{page}`, its picture
 * from `.../picture`. The relays reach the backend; the browser never does.
 */

function recordPagePath(systemId: string, recordId: string, page: number): string {
  return `systems/${encodeURIComponent(systemId)}/records/${encodeURIComponent(recordId)}/pages/${page}`;
}

/** The address of the picture of a page of a record's version, through the picture relay. */
export function recordPictureUrl(systemId: string, recordId: string, page: number): string {
  return `/api/v1/${recordPagePath(systemId, recordId, page)}/picture`;
}

/**
 * Reads a page of a record's version: the page, or null when the relay refused it (a record the system no longer
 * shows, a page that is not one, no session) or did not answer one.
 */
export async function fetchRecordPage(systemId: string, recordId: string, page: number, signal?: AbortSignal): Promise<SourcePage | null> {
  try {
    const response = await fetch(`/api/v1/${recordPagePath(systemId, recordId, page)}`, {
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
