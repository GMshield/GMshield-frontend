/**
 * The browser's side of the conversation (Story 2.4), towards this site only: a question is posted to the relay
 * `POST /api/v1/campaigns/{id}/turns`, and a turn's answer is read from `GET /api/v1/turns/{id}/events` with
 * `EventSource`. The relays reach the backend; the browser never does.
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

/** The address of a turn's event stream. */
export function turnEventsUrl(turnId: string): string {
  return `/api/v1/turns/${encodeURIComponent(turnId)}/events`;
}
