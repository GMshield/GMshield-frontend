/**
 * The browser's side of an artifacts export (Story 5.7 part A), towards this site only: the file is read from
 * `GET /api/v1/campaigns/{id}/artifacts/export?ids=a,b&format=...`, whose relay adds the visitor's language and reaches
 * the backend; the browser never does.
 */

/** An export's formats, in the order the menu offers them. */
export const EXPORT_FORMATS = ['pdf', 'txt', 'markdown', 'jpg'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The problem used when the relay does not answer or answers something else: the generic "unavailable" text. */
const UNAVAILABLE = { status: 503, category: 'server', code: 'server.unavailable', params: {} } as const;

export type Exported =
  | { readonly ok: true; readonly file: Blob; readonly name: string }
  | { readonly ok: false; readonly status: number; readonly problem: unknown };

/**
 * The file's name from its `Content-Disposition`: the UTF-8 `filename*` (RFC 6266), else the plain `filename`, else
 * `fallback`. Only the last path segment is kept.
 */
export function exportFileName(disposition: string | null, fallback: string): string {
  if (disposition === null) {
    return fallback;
  }
  let name: string | null = null;
  const encoded = /filename\*=UTF-8''([^;\s]+)/i.exec(disposition);
  if (encoded !== null) {
    try {
      name = decodeURIComponent(encoded[1] ?? '');
    } catch {
      name = null;
    }
  }
  if (name === null) {
    const plain = /filename="([^"]*)"/i.exec(disposition);
    name = plain === null ? null : (plain[1] ?? null);
  }
  const last = name?.split(/[\\/]/).pop()?.trim() ?? '';
  return last === '' ? fallback : last;
}

/**
 * Reads the export of the campaign `campaignId`'s artifacts `ids` (in that order) as `format`: the file and its name, or
 * the relay's problem (the generic "unavailable" one when it did not answer one).
 */
export async function fetchExport(campaignId: string, ids: readonly string[], format: ExportFormat, fallbackName: string): Promise<Exported> {
  const query = new URLSearchParams({ ids: ids.join(','), format });
  let response: Response;
  try {
    response = await fetch(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/artifacts/export?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: UNAVAILABLE.status, problem: UNAVAILABLE };
  }
  if (response.status !== 200) {
    const problem: unknown = await response.json().catch(() => UNAVAILABLE);
    return { ok: false, status: response.status, problem };
  }
  try {
    const file = await response.blob();
    return { ok: true, file, name: exportFileName(response.headers.get('content-disposition'), fallbackName) };
  } catch {
    return { ok: false, status: UNAVAILABLE.status, problem: UNAVAILABLE };
  }
}
