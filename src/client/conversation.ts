import type { components } from '@/server/backend/generated/public';

/**
 * The browser's side of the conversation (Story 2.4), towards this site only: a question is posted to the relay
 * `POST /api/v1/campaigns/{id}/turns`, and a turn's answer is read from `GET /api/v1/turns/{id}/events` with
 * `EventSource`. Story 2.6: a turn's answer is stopped with `POST /api/v1/turns/{id}/stop`, and a stream the page
 * reopens itself names the last event id in its address. Story 2.7: a page a turn's reference names is read from
 * `GET /api/v1/turns/{id}/references/{number}/pages/{page}`, and its picture from `.../picture`. The indexing notice
 * reads the count of passages still being prepared for search, and of those that could not be, from
 * `GET /api/v1/conversations/current`. Story 3.10: a question names the conversation it continues, or the area of the
 * new one it starts. The relays reach the backend; the browser never does.
 */

/** The areas of the sidebar a conversation belongs to (Story 3.10). */
export const AREAS = ['questions', 'rules'] as const;
export type Area = (typeof AREAS)[number];

/** Where a question goes (Story 3.10): the conversation it continues, else a new one of `area`. */
export type QuestionTarget = { readonly conversationId?: string | null; readonly area?: Area };

/** A conversation's stored turn with its events, as the server read it (Story 3.10). */
export type StoredTurn = components['schemas']['StoredTurn'];

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

/**
 * Posts a question on the campaign; answers the turn, or the problem the relay answered. Story 3.10: in the
 * conversation `target` names, else in a new one of its area (without either, the campaign's latest questions one).
 */
export async function postQuestion(campaignId: string, question: string, target: QuestionTarget = {}): Promise<AskResult> {
  const where = target.conversationId ? { conversationId: target.conversationId } : target.area === undefined ? {} : { area: target.area };
  try {
    const response = await fetch(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, ...where }),
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

/** A tier of the campaign's scope, as the backend labels a source (Story 3.7). */
export type Tier = NonNullable<components['schemas']['TurnSourceReference']['tier']>;

/** The tiers the backend writes on a reference, in tier order. */
export const TIERS: readonly Tier[] = ['campaign', 'system', 'other'];

/**
 * A tier word of a turn's `tier` event (`TurnTierEvent`): a tier of the scope (Story 3.7), or `model` (Story 3.8), which
 * starts a part from the model's own knowledge. A reference never carries `model`.
 */
export type TurnTier = components['schemas']['TurnTierEvent']['tier'];

/** The tier word of a part from the model's own knowledge (Story 3.8). */
export const MODEL_TIER = 'model' satisfies TurnTier;

/** The tier words a turn's `tier` event may carry. */
export const TURN_TIERS: readonly TurnTier[] = [...TIERS, MODEL_TIER];

/** A tier's version of the answer starts at a code-point offset of its text (Story 3.7, `TurnTierEvent`). */
export type TierStart = { readonly tier: TurnTier; readonly offset: number };

function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

function isTurnTier(value: unknown): value is TurnTier {
  return typeof value === 'string' && (TURN_TIERS as readonly string[]).includes(value);
}

/**
 * The `done` event's data: its references, whether the GM stopped the answer (Story 2.6), whether the sources say
 * nothing (no reference, no part from the model's knowledge, and not stopped), and (Story 3.8) whether the turn's model
 * knowledge was on, as frozen when the question was asked.
 */
export type Done = {
  readonly stopped: boolean;
  readonly silent: boolean;
  readonly modelKnowledge: boolean;
  readonly references: readonly SourceReference[];
};

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
    && Number.isInteger(reference.page) && isStrings(reference.passageIds) && typeof reference.removed === 'boolean'
    // Story 3.7: a tier is optional (none on a reference stored before it), and only one the backend writes.
    && (reference.tier === undefined || isTier(reference.tier));
}

/**
 * The data of a `done` event. Only what it carries is shown: a reference that is not well formed is left out, and an
 * answer with no reference left is silent, whatever the event said (no uncited text stays on screen), unless (Story 3.8)
 * the turn had a `model` tier event (`modelPart`): that part is marked, so it stays. A stopped answer (Story 2.6) is
 * never silent: its partial text stays, marked stopped, with whatever references it has. `modelKnowledge` is true only
 * when the event says so.
 */
export function parseDone(data: Record<string, unknown> | null, modelPart = false): Done {
  const stopped = data?.stopped === true;
  const modelKnowledge = data?.modelKnowledge === true;
  const references = Array.isArray(data?.references) ? data.references.filter(isReference) : [];
  if (stopped) {
    return { stopped, silent: false, modelKnowledge, references };
  }
  if (data?.silent === true) {
    return { stopped, silent: true, modelKnowledge, references: [] };
  }
  return { stopped, silent: references.length === 0 && !modelPart, modelKnowledge, references };
}

/** The data of a `citation` event, or null when it is not one. */
export function parseCitation(data: Record<string, unknown> | null): Citation | null {
  if (typeof data?.passageId !== 'string' || !Number.isInteger(data.offset) || (data.offset as number) < 0) {
    return null;
  }
  return { passageId: data.passageId, offset: data.offset as number };
}

/**
 * The data of a `tier` event (Story 3.7), or null when it is not one: a tier word the backend writes (`model` too, Story
 * 3.8) at an offset from 0.
 */
export function parseTier(data: Record<string, unknown> | null): TierStart | null {
  if (!isTurnTier(data?.tier) || !Number.isInteger(data.offset) || (data.offset as number) < 0) {
    return null;
  }
  return { tier: data.tier, offset: data.offset as number };
}

/** How many code points a conversation's default name keeps (Story 3.10, the backend's `Conversations.DEFAULT_NAME`). */
export const DEFAULT_NAME = 60;

/**
 * A conversation's default name, as the backend gives it until it is renamed (Story 3.10): the first question's runs of
 * white space made one space, then its first {@link DEFAULT_NAME} code points, cut back to the last space when that
 * would split a word (a word longer than all of them is cut where they end).
 */
export function defaultName(question: string): string {
  const flat = question.replace(/\p{White_Space}+/gu, ' ').trim();
  const points = Array.from(flat);
  if (points.length <= DEFAULT_NAME) {
    return flat;
  }
  if (points[DEFAULT_NAME] === ' ') {
    return points.slice(0, DEFAULT_NAME).join('');
  }
  const cut = points.slice(0, DEFAULT_NAME).join('');
  const space = cut.lastIndexOf(' ');
  return space > 0 ? cut.slice(0, space) : cut;
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

/**
 * Whether the relay's answer is a page: its numbers, its picture's size or none, its lines, text and passages (Story 3.9:
 * the search's page relay checks it too).
 */
export function isSourcePage(value: unknown): value is SourcePage {
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
    return response.status === 200 && isSourcePage(body) ? body : null;
  } catch {
    return null;
  }
}

/** Passages that could not be prepared for search, and whether a retry remains (public contract 1.16.0). */
export type IndexingFailed = { readonly passages: number; readonly retrying: boolean };

/**
 * What one read of the indexing state gave: the passages still being prepared for search and those that could not be
 * (`read`, each null when there is none), or no usable answer (`failed`: the relay refused, did not answer, or
 * answered something else).
 */
export type IndexingPoll =
  | { readonly kind: 'read'; readonly remaining: number | null; readonly failed: IndexingFailed | null }
  | { readonly kind: 'failed' };

const POLL_FAILED: IndexingPoll = { kind: 'failed' };

/** A count from 1, as the contract has it; anything else is `undefined`. */
function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** `indexing` as the contract has it: null, or `{remaining}` from 1; `undefined` for anything else. */
function remainingOf(indexing: unknown): number | null | undefined {
  if (indexing === null) {
    return null;
  }
  return typeof indexing === 'object' ? countOf((indexing as { remaining?: unknown }).remaining) : undefined;
}

/**
 * `indexingFailed` as the contract has it: null, or `{passages, retrying}` with `passages` from 1; `undefined` for
 * anything else. Absent reads as null.
 */
function failedOf(failed: unknown): IndexingFailed | null | undefined {
  if (failed === null || failed === undefined) {
    return null;
  }
  if (typeof failed !== 'object') {
    return undefined;
  }
  const passages = countOf((failed as { passages?: unknown }).passages);
  const retrying = (failed as { retrying?: unknown }).retrying;
  return passages !== undefined && typeof retrying === 'boolean' ? { passages, retrying } : undefined;
}

/**
 * Reads the current conversation's indexing state from the relay on this site: `read` with the passages still being
 * prepared (`indexing.remaining`, null when none is) and those that could not be (`indexingFailed`, null when none
 * failed), and `failed` for anything else, so a failed read never hides the notice.
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
    const remaining = remainingOf((body as { indexing: unknown }).indexing);
    const failed = failedOf((body as { indexingFailed?: unknown }).indexingFailed);
    return remaining === undefined || failed === undefined ? POLL_FAILED : { kind: 'read', remaining, failed };
  } catch {
    return POLL_FAILED;
  }
}
