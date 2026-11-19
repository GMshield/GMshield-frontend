import type { components } from '@/server/backend/generated/public';

/**
 * The browser's side of the conversation (Story 2.4), towards this site only: a question is posted to the relay
 * `POST /api/v1/campaigns/{id}/turns`, and a turn's answer is read from `GET /api/v1/turns/{id}/events` with
 * `EventSource`. Story 2.6: a turn's answer is stopped with `POST /api/v1/turns/{id}/stop`, and a stream the page
 * reopens itself names the last event id in its address. Story 2.7: a page a turn's reference names is read from
 * `GET /api/v1/turns/{id}/references/{number}/pages/{page}`, and its picture from `.../picture`. The indexing notice
 * reads the count of passages still being prepared for search from `GET /api/v1/conversations/current`. The relays
 * reach the backend; the browser never does.
 */

/** A recorded turn, as the relay answers it. */
export type AskedTurn = { readonly id: string; readonly conversationId: string; readonly language: string | null };

export type AskResult = { readonly ok: true; readonly turn: AskedTurn } | { readonly ok: false; readonly problem: unknown };

/** The problem used when the relay does not answer or answers something else: the generic "unavailable" text. */
const UNAVAILABLE = { status: 503, category: 'server', code: 'server.unavailable', params: {} } as const;

function isTurn(value: unknown): value is AskedTurn {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const turn = value as Record<string, unknown>;
  return typeof turn.id === 'string' && typeof turn.conversationId === 'string'
    && (turn.language === null || typeof turn.language === 'string');
}

/** Posts a question on the campaign; answers the turn, or the problem the relay answered. */
export async function postQuestion(campaignId: string, question: string): Promise<AskResult> {
  try {
    const response = await fetch(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 201 && isTurn(body)) {
      return { ok: true, turn: body };
    }
    return { ok: false, problem: body ?? UNAVAILABLE };
  } catch {
    return { ok: false, problem: UNAVAILABLE };
  }
}

/**
 * The address of a turn's event stream; with `lastEventId` (Story 2.6), a reopened stream that resumes after that
 * event (`?lastEventId=`, which the relay forwards as `Last-Event-ID`).
 */
export function turnEventsUrl(turnId: string, lastEventId?: string | null): string {
  const base = `/api/v1/turns/${encodeURIComponent(turnId)}/events`;
  return lastEventId ? `${base}?lastEventId=${encodeURIComponent(lastEventId)}` : base;
}

/**
 * Asks to stop a turn's answer (Story 2.6). True when the relay answered 204 (also for an answer that had ended);
 * false otherwise, the answer then going on until its own end.
 */
export async function stopTurn(turnId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/v1/turns/${encodeURIComponent(turnId)}/stop`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return response.status === 204;
  } catch {
    return false;
  }
}

/** A source reference of a finished answer, as the `done` event carries it (Story 2.5, `TurnSourceReference`). */
export type SourceReference = Readonly<Omit<components['schemas']['TurnSourceReference'], 'sectionPath' | 'passageIds'>> & {
  readonly sectionPath: readonly string[];
  readonly passageIds: readonly string[];
};

/** A citation of the answer: a passage id at a code-point offset of the answer's text (`TurnCitationEvent`). */
export type Citation = { readonly passageId: string; readonly offset: number };

/**
 * The `done` event's data: its references, whether the GM stopped the answer (Story 2.6), and whether the sources say
 * nothing (no reference, and not stopped).
 */
export type Done = { readonly stopped: boolean; readonly silent: boolean; readonly references: readonly SourceReference[] };

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isReference(value: unknown): value is SourceReference {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const reference = value as Record<string, unknown>;
  return Number.isInteger(reference.number) && (reference.number as number) >= 1
    && typeof reference.materialName === 'string' && isStrings(reference.sectionPath)
    && Number.isInteger(reference.page) && isStrings(reference.passageIds) && typeof reference.removed === 'boolean';
}

/**
 * The data of a `done` event. Only what it carries is shown: a reference that is not well formed is left out, and an
 * answer with no reference left is silent, whatever the event said (no uncited text stays on screen). A stopped answer
 * (Story 2.6) is never silent: its partial text stays, marked stopped, with whatever references it has.
 */
export function parseDone(data: Record<string, unknown> | null): Done {
  const stopped = data?.stopped === true;
  const references = Array.isArray(data?.references) ? data.references.filter(isReference) : [];
  if (stopped) {
    return { stopped, silent: false, references };
  }
  return { stopped, silent: data?.silent === true || references.length === 0, references: data?.silent === true ? [] : references };
}

/** The data of a `citation` event, or null when it is not one. */
export function parseCitation(data: Record<string, unknown> | null): Citation | null {
  if (typeof data?.passageId !== 'string' || !Number.isInteger(data.offset) || (data.offset as number) < 0) {
    return null;
  }
  return { passageId: data.passageId, offset: data.offset as number };
}

/** A page a turn's reference names (Story 2.7), as the relay answers it: the shape of a material's page. */
export type SourcePage = components['schemas']['MaterialPageView'];

function isNumbers(value: unknown, length?: number): value is number[] {
  return Array.isArray(value) && (length === undefined || value.length === length) && value.every((item) => typeof item === 'number');
}

function isPassage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const passage = value as Record<string, unknown>;
  const boxes = passage.boxes === undefined || (Array.isArray(passage.boxes) && passage.boxes.every((box) => isNumbers(box, 4)));
  const range = passage.range === undefined || isNumbers(passage.range, 2);
  return typeof passage.id === 'string' && boxes && range;
}

/** Whether the relay's answer is a page: its numbers, its picture's size or none, its lines, text and passages. */
function isPage(value: unknown): value is SourcePage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const page = value as Record<string, unknown>;
  const picture = page.picture as Record<string, unknown> | null | undefined;
  return Number.isInteger(page.page) && Number.isInteger(page.pageTotal)
    && (picture === null || (typeof picture === 'object' && picture !== undefined && typeof picture.width === 'number' && typeof picture.height === 'number'))
    && Array.isArray(page.lines) && page.lines.every((line: unknown) => typeof (line as { text?: unknown } | null)?.text === 'string'
      && isNumbers((line as { box?: unknown }).box, 4))
    && (page.text === null || typeof page.text === 'string')
    && Array.isArray(page.passages) && page.passages.every(isPassage);
}

/**
 * The relay's path of a page a turn's reference names, from 1 (Story 2.7), under `/api/v1/`: each caller writes that
 * prefix itself, so every `fetch` here visibly reaches this site's relays (`test/boundaries.test.ts`).
 */
function referencePagePath(turnId: string, number: number, page: number): string {
  return `turns/${encodeURIComponent(turnId)}/references/${number}/pages/${page}`;
}

/** The address of the picture of a page a turn's reference names (Story 2.7), through the picture relay. */
export function referencePictureUrl(turnId: string, number: number, page: number): string {
  return `/api/v1/${referencePagePath(turnId, number, page)}/picture`;
}

/**
 * Reads a page a turn's reference names (Story 2.7): the page, or null when the relay refused it (a removed source,
 * a page that is not one, no session) or did not answer one.
 */
export async function fetchReferencePage(turnId: string, number: number, page: number, signal?: AbortSignal): Promise<SourcePage | null> {
  try {
    const response = await fetch(`/api/v1/${referencePagePath(turnId, number, page)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return response.status === 200 && isPage(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * What one read of the indexing count gave: the passages still being prepared for search, nothing pending any more
 * (`none`), or no usable answer (`failed`: the relay refused, did not answer, or answered something else).
 */
export type IndexingPoll =
  | { readonly kind: 'count'; readonly remaining: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed' };

const POLL_FAILED: IndexingPoll = { kind: 'failed' };

/**
 * Reads the current conversation's indexing count from the relay on this site: `count` for `{remaining}` (an integer
 * from 1), `none` for null, and `failed` for anything else, so a failed read never hides the notice.
 */
export async function fetchIndexing(signal?: AbortSignal): Promise<IndexingPoll> {
  try {
    const response = await fetch(`/api/v1/conversations/current`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== 200 || typeof body !== 'object' || body === null || !('indexing' in body)) {
      return POLL_FAILED;
    }
    const indexing = (body as { indexing: unknown }).indexing;
    if (indexing === null) {
      return { kind: 'none' };
    }
    const remaining = (indexing as { remaining?: unknown } | undefined)?.remaining;
    return typeof remaining === 'number' && Number.isInteger(remaining) && remaining >= 1
      ? { kind: 'count', remaining }
      : POLL_FAILED;
  } catch {
    return POLL_FAILED;
  }
}
