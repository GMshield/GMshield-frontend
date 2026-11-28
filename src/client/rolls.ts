import type { components } from '@/server/backend/generated/public';

/**
 * The browser's side of a Shield's stored rolls (Story 6.4 part A), towards this site only: a roll is sent with
 * `POST /api/v1/campaigns/{id}/shields/{shieldId}/rolls`, the log is read a page at a time with `GET` on the same path,
 * and cleared with `DELETE`. The relay reaches the backend; the browser never does, and nothing is kept in browser
 * storage (part B adds the pending list). Any answer but the expected one, a refusal or no answer at all (none within
 * {@link ROLL_REQUEST_TIMEOUT_MS} included), is "not saved".
 */

/** A stored roll, as the relay answers it. */
export type StoredRoll = components['schemas']['Roll'];
/** A page of the log, newest first. */
export type RollPage = components['schemas']['RollPage'];
/** A roll made in the browser, as it is sent. */
export type NewRoll = components['schemas']['NewRoll'];

/**
 * How many rolls the Shield's log shows at first, and how many more each "Mostrar mais" shows: the page the Shield's
 * screen reads on the server and each later read here. A plain module, so the server page and the client roller share it.
 */
export const ROLL_LOG_PAGE = 10;

/**
 * How long a request may take before it counts as unanswered ("não foi possível salvar"), so a stalled connection never
 * leaves a roll "ainda não salva" for good.
 */
export const ROLL_REQUEST_TIMEOUT_MS = 15_000;

/** The problem used when the relay does not answer or answers something else: the generic "unavailable" text. */
const UNAVAILABLE = { status: 503, category: 'server', code: 'server.unavailable', params: {} } as const;

type Refused = { readonly ok: false; readonly status: number; readonly problem: unknown };

export type Kept = { readonly ok: true; readonly roll: StoredRoll; readonly created: boolean } | Refused;
export type Listed = { readonly ok: true; readonly page: RollPage } | Refused;
export type Cleared = { readonly ok: true } | Refused;

/** Whether a value is a well-formed stored roll. */
export function isStoredRoll(value: unknown): value is StoredRoll {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const roll = value as Record<string, unknown>;
  return (
    typeof roll.id === 'string' &&
    typeof roll.key === 'string' &&
    typeof roll.formula === 'string' &&
    Array.isArray(roll.results) &&
    roll.results.every((result) => Number.isInteger(result)) &&
    Number.isInteger(roll.total) &&
    (roll.label === null || typeof roll.label === 'string') &&
    typeof roll.rolledAt === 'string' &&
    !Number.isNaN(Date.parse(roll.rolledAt))
  );
}

function isRollPage(value: unknown): value is RollPage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.items) &&
    page.items.every(isStoredRoll) &&
    Number.isInteger(page.total) &&
    (page.nextCursor === undefined || typeof page.nextCursor === 'string')
  );
}

function path(campaignId: string, shieldId: string): string {
  return `${encodeURIComponent(campaignId)}/shields/${encodeURIComponent(shieldId)}/rolls`;
}

/** Sends a roll: the roll as stored (201) or as already held under its key (200), or the problem the relay answered. */
export async function sendRoll(campaignId: string, shieldId: string, roll: NewRoll): Promise<Kept> {
  try {
    const response = await fetch(`/api/v1/campaigns/${path(campaignId, shieldId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roll),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(ROLL_REQUEST_TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    if ((response.status === 201 || response.status === 200) && isStoredRoll(body)) {
      return { ok: true, roll: body, created: response.status === 201 };
    }
    return { ok: false, status: response.status, problem: body ?? UNAVAILABLE };
  } catch {
    return { ok: false, status: UNAVAILABLE.status, problem: UNAVAILABLE };
  }
}

/** Reads a page of the log after `cursor` (from the newest without one), `limit` a page. */
export async function readRolls(campaignId: string, shieldId: string, limit: number, cursor?: string): Promise<Listed> {
  const query = new URLSearchParams({ limit: String(limit), ...(cursor === undefined ? {} : { cursor }) });
  try {
    const response = await fetch(`/api/v1/campaigns/${path(campaignId, shieldId)}?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(ROLL_REQUEST_TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 200 && isRollPage(body)) {
      return { ok: true, page: body };
    }
    return { ok: false, status: response.status, problem: body ?? UNAVAILABLE };
  } catch {
    return { ok: false, status: UNAVAILABLE.status, problem: UNAVAILABLE };
  }
}

/** Clears the Shield's stored rolls (204), or answers the problem the relay answered. */
export async function clearRolls(campaignId: string, shieldId: string): Promise<Cleared> {
  try {
    const response = await fetch(`/api/v1/campaigns/${path(campaignId, shieldId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(ROLL_REQUEST_TIMEOUT_MS),
    });
    if (response.status === 204) {
      return { ok: true };
    }
    const body: unknown = await response.json().catch(() => null);
    return { ok: false, status: response.status, problem: body ?? UNAVAILABLE };
  } catch {
    return { ok: false, status: UNAVAILABLE.status, problem: UNAVAILABLE };
  }
}
