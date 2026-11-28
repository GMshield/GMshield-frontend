// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pendingRolls = await import('@/client/pending-rolls');
const { addPending, dropShield, flush, onOutcome, pendingFor, removeRoll, resetPendingRolls, restoreRolls, sendingFor, subscribe } = pendingRolls;
const { PendingRollsSync, PENDING_ROLLS_RETRY_MS } = await import('@/components/PendingRollsSync');
type PendingRoll = import('@/client/pending-rolls').PendingRoll;
type Outcome = import('@/client/pending-rolls').Outcome;

/** Story 6.4 part B: the browser's pending rolls and the one sender (AD-31). */

const ACCOUNT = '0190a0b0-0000-7000-8000-0000000000a1';
const OTHER_ACCOUNT = '0190a0b0-0000-7000-8000-0000000000b2';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const SHIELD = '0190a0b0-0000-7000-8000-000000000a01';
const OTHER_SHIELD = '0190a0b0-0000-7000-8000-000000000a02';
const KEY_OF = (account: string, shield: string) => `gmshield:rolls:${account}:${shield}`;

type Fetched = { readonly url: string; readonly init: RequestInit | undefined };
let fetched: Fetched[] = [];
/** How the relay answers a roll; the default stores it (201). */
let relay: (url: string, init: RequestInit | undefined) => Promise<Response> = defaultRelay;
let onLine = true;

async function defaultRelay(_url: string, init: RequestInit | undefined): Promise<Response> {
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  const results = body.results as number[];
  return Response.json(
    {
      id: '0190a0b0-0000-7000-8000-00000000f001',
      key: body.key,
      formula: body.formula,
      results,
      total: results.reduce((sum, face) => sum + face, 0),
      label: body.label ?? null,
      rolledAt: body.rolledAt,
    },
    { status: 201 },
  );
}

function answering(status: number): (url: string, init: RequestInit | undefined) => Promise<Response> {
  return async () => Response.json({ status, category: 'request', code: 'x', params: {} }, { status });
}

let serial = 0;
function newRoll(campaignId = CAMPAIGN): Omit<PendingRoll, 'state'> {
  serial += 1;
  return {
    key: `3b241101-e2bb-4255-8caf-${String(serial).padStart(12, '0')}`,
    campaignId,
    formula: '1d20',
    results: [17],
    total: 17,
    label: null,
    rolledAt: new Date(Date.now() - serial * 1000).toISOString(),
  };
}

function stored(account: string, shield: string): unknown {
  const text = localStorage.getItem(KEY_OF(account, shield));
  return text === null ? null : JSON.parse(text);
}

function posts(): Record<string, unknown>[] {
  return fetched.filter((call) => call.init?.method === 'POST').map((call) => JSON.parse(String(call.init?.body)) as Record<string, unknown>);
}

beforeEach(() => {
  localStorage.clear();
  resetPendingRolls();
  fetched = [];
  relay = defaultRelay;
  onLine = true;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetched.push({ url, init });
      return relay(url, init);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the pending rolls (Story 6.4 part B)', () => {
  it('offline: a roll is kept as pending under the account and the Shield, and nothing is fetched', async () => {
    onLine = false;
    const roll = newRoll();

    addPending(ACCOUNT, SHIELD, roll);
    await flush(ACCOUNT);

    expect(fetched).toHaveLength(0);
    expect(stored(ACCOUNT, SHIELD)).toEqual([{ ...roll, state: 'pending' }]);
    expect(pendingFor(ACCOUNT, SHIELD)).toEqual([{ ...roll, state: 'pending' }]);
    // The same list until it changes (for useSyncExternalStore).
    expect(pendingFor(ACCOUNT, SHIELD)).toBe(pendingFor(ACCOUNT, SHIELD));
  });

  it('back online: the layout sync posts each roll once to its Shield, and a 201 removes it from storage', async () => {
    onLine = false;
    const first = newRoll();
    const second = { ...newRoll(), label: 'Iniciativa' };
    addPending(ACCOUNT, SHIELD, first);
    addPending(ACCOUNT, OTHER_SHIELD, second);
    render(createElement(PendingRollsSync, { accountId: ACCOUNT }));
    expect(fetched).toHaveLength(0);

    onLine = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await vi.waitFor(() => expect(localStorage.length).toBe(0));
    expect(fetched.map((call) => [call.url, call.init?.method]).sort()).toEqual(
      [
        [`/api/v1/campaigns/${CAMPAIGN}/shields/${SHIELD}/rolls`, 'POST'],
        [`/api/v1/campaigns/${CAMPAIGN}/shields/${OTHER_SHIELD}/rolls`, 'POST'],
      ].sort(),
    );
    // The roll as it was made: its key, formula, results, label when it has one, and time; never the total or the state.
    const sent = posts().find((body) => body.key === second.key);
    expect(sent).toEqual({ key: second.key, formula: '1d20', results: [17], label: 'Iniciativa', rolledAt: second.rolledAt });
    expect(posts().find((body) => body.key === first.key)).not.toHaveProperty('label');
    expect(pendingFor(ACCOUNT, SHIELD)).toEqual([]);
  });

  it('a tab closed before the roll was saved: a later signed-in page load sends it', async () => {
    onLine = false;
    const roll = newRoll();
    addPending(ACCOUNT, SHIELD, roll);
    onLine = true;
    // A new tab: nothing of this one's memory is left, only storage.
    resetPendingRolls();

    render(createElement(PendingRollsSync, { accountId: ACCOUNT }));

    await vi.waitFor(() => expect(stored(ACCOUNT, SHIELD)).toBeNull());
    expect(posts().map((body) => body.key)).toEqual([roll.key]);
  });

  it('signed out (401), unavailable, timed out or with no connection: the roll stays pending and is sent at the next try', async () => {
    const roll = newRoll();
    addPending(ACCOUNT, SHIELD, roll);
    for (const answer of [
      answering(401),
      answering(500),
      answering(503),
      async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      },
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ]) {
      relay = answer;
      await flush(ACCOUNT);
      expect(stored(ACCOUNT, SHIELD)).toEqual([{ ...roll, state: 'pending' }]);
      expect(sendingFor(ACCOUNT, SHIELD)).toBe(false);
    }
    expect(posts()).toHaveLength(5);

    // The next sign-in: the same roll, the same key, stored now.
    relay = defaultRelay;
    await flush(ACCOUNT);
    expect(stored(ACCOUNT, SHIELD)).toBeNull();
    expect(new Set(posts().map((body) => body.key))).toEqual(new Set([roll.key]));
  });

  it('refused (400 or 409): the roll stays as refused, is never sent again, and removing it deletes it', async () => {
    const invalid = newRoll();
    const taken = newRoll();
    addPending(ACCOUNT, SHIELD, invalid);
    relay = answering(400);
    await flush(ACCOUNT);
    addPending(ACCOUNT, SHIELD, taken);
    relay = answering(409);
    await flush(ACCOUNT);

    expect(stored(ACCOUNT, SHIELD)).toEqual([
      { ...invalid, state: 'refused' },
      { ...taken, state: 'refused' },
    ]);
    relay = defaultRelay;
    await flush(ACCOUNT);
    expect(posts()).toHaveLength(2);

    removeRoll(ACCOUNT, SHIELD, invalid.key);
    expect(stored(ACCOUNT, SHIELD)).toEqual([{ ...taken, state: 'refused' }]);
    removeRoll(ACCOUNT, SHIELD, taken.key);
    expect(stored(ACCOUNT, SHIELD)).toBeNull();
  });

  it('the Shield is gone (404), with or without a problem body: the roll stays as refused until the GM removes it', async () => {
    const withProblem = newRoll();
    const plain = newRoll();
    const outcomes: Outcome[] = [];
    const stop = onOutcome((outcome) => outcomes.push(outcome));
    addPending(ACCOUNT, SHIELD, withProblem);
    relay = answering(404);
    await flush(ACCOUNT);
    addPending(ACCOUNT, SHIELD, plain);
    // A proxy's or a deploy window's 404: no problem body at all.
    relay = async () => new Response('<html>Not Found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    await flush(ACCOUNT);
    stop();

    expect(stored(ACCOUNT, SHIELD)).toEqual([
      { ...withProblem, state: 'refused' },
      { ...plain, state: 'refused' },
    ]);
    expect(outcomes).toEqual([]);
    relay = defaultRelay;
    await flush(ACCOUNT);
    expect(posts()).toHaveLength(2);
    removeRoll(ACCOUNT, SHIELD, withProblem.key);
    removeRoll(ACCOUNT, SHIELD, plain.key);
    expect(stored(ACCOUNT, SHIELD)).toBeNull();
  });

  it('a saved roll tells the screens the stored roll and whether it is new', async () => {
    const roll = newRoll();
    const outcomes: Outcome[] = [];
    const stop = onOutcome((outcome) => outcomes.push(outcome));
    addPending(ACCOUNT, SHIELD, roll);

    await flush(ACCOUNT);
    stop();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'saved', accountId: ACCOUNT, shieldId: SHIELD, created: true, stored: { key: roll.key, total: 17 } });
  });

  it('two senders in one tab (the Shield screen and the layout sync): one POST per key', async () => {
    let answer: (response: Response) => void = () => undefined;
    relay = () => new Promise<Response>((resolve) => (answer = resolve));
    const roll = newRoll();
    addPending(ACCOUNT, SHIELD, roll);

    const screen = flush(ACCOUNT);
    render(createElement(PendingRollsSync, { accountId: ACCOUNT }));
    const again = flush(ACCOUNT);
    expect(sendingFor(ACCOUNT, SHIELD)).toBe(true);
    expect(sendingFor(ACCOUNT, OTHER_SHIELD)).toBe(false);
    expect(posts()).toHaveLength(1);

    const body = posts()[0]!;
    await act(async () => {
      answer(await defaultRelay('', { method: 'POST', body: JSON.stringify(body) }));
      await Promise.all([screen, again]);
    });
    expect(posts()).toHaveLength(1);
    expect(sendingFor(ACCOUNT, SHIELD)).toBe(false);
    expect(stored(ACCOUNT, SHIELD)).toBeNull();
  });

  it("another account signing in where one left pending rolls: those are never read, sent or removed", async () => {
    onLine = false;
    const left = newRoll();
    addPending(ACCOUNT, SHIELD, left);
    const before = localStorage.getItem(KEY_OF(ACCOUNT, SHIELD));
    onLine = true;

    render(createElement(PendingRollsSync, { accountId: OTHER_ACCOUNT }));
    await flush(OTHER_ACCOUNT);
    dropShield(OTHER_ACCOUNT, SHIELD);

    expect(fetched).toHaveLength(0);
    expect(pendingFor(OTHER_ACCOUNT, SHIELD)).toEqual([]);
    expect(localStorage.getItem(KEY_OF(ACCOUNT, SHIELD))).toBe(before);
  });

  it('dropping a Shield removes only its own list, answers what it removed, and those can be put back as they were', async () => {
    const mine = newRoll();
    const refused = newRoll();
    const other = newRoll();
    addPending(ACCOUNT, SHIELD, mine);
    addPending(ACCOUNT, SHIELD, refused);
    relay = async (_url, init) => (String(init?.body).includes(refused.key) ? answering(400)('', init) : new Promise<Response>(() => undefined));
    void flush(ACCOUNT);
    await vi.waitFor(() => expect(pendingFor(ACCOUNT, SHIELD).map((roll) => roll.state)).toEqual(['pending', 'refused']));
    resetPendingRolls();
    addPending(ACCOUNT, OTHER_SHIELD, other);

    const dropped = dropShield(ACCOUNT, SHIELD);

    expect(stored(ACCOUNT, SHIELD)).toBeNull();
    expect(stored(ACCOUNT, OTHER_SHIELD)).toEqual([{ ...other, state: 'pending' }]);
    restoreRolls(ACCOUNT, SHIELD, dropped);
    expect(stored(ACCOUNT, SHIELD)).toEqual([
      { ...mine, state: 'pending' },
      { ...refused, state: 'refused' },
    ]);
  });

  it('a 200 or 201 whose body is not a stored roll still counts as saved: the roll leaves, with no stored roll told', async () => {
    for (const [status, created] of [[201, true], [200, false]] as const) {
      const roll = newRoll();
      const outcomes: Outcome[] = [];
      const stop = onOutcome((outcome) => outcomes.push(outcome));
      addPending(ACCOUNT, SHIELD, roll);
      relay = async (url, init) => {
        const answer = (await (await defaultRelay(url, init)).json()) as Record<string, unknown>;
        return Response.json({ ...answer, total: 'doze' }, { status });
      };

      await flush(ACCOUNT);
      stop();

      expect(stored(ACCOUNT, SHIELD)).toBeNull();
      expect(outcomes).toEqual([{ kind: 'saved', accountId: ACCOUNT, shieldId: SHIELD, roll: { ...roll, state: 'pending' }, stored: null, created }]);
      const sent = posts().length;
      await flush(ACCOUNT);
      expect(posts()).toHaveLength(sent);
    }
  });

  it('the layout sync tries again every 30 s while the tab is visible, and when it becomes visible', async () => {
    vi.useFakeTimers();
    try {
      let visibility: DocumentVisibilityState = 'visible';
      vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
      const roll = newRoll();
      addPending(ACCOUNT, SHIELD, roll);
      relay = answering(503);
      render(createElement(PendingRollsSync, { accountId: ACCOUNT }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(posts()).toHaveLength(1);

      // Still online, but the backend did not answer: 30 s later it is sent again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PENDING_ROLLS_RETRY_MS);
      });
      expect(posts()).toHaveLength(2);

      // Hidden: no retry; visible again: sent at once.
      visibility = 'hidden';
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(3 * PENDING_ROLLS_RETRY_MS);
      });
      expect(posts()).toHaveLength(2);
      visibility = 'visible';
      relay = defaultRelay;
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(posts()).toHaveLength(3);
      expect(stored(ACCOUNT, SHIELD)).toBeNull();

      // Nothing pending: the next ticks send nothing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * PENDING_ROLLS_RETRY_MS);
      });
      expect(posts()).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('broken storage: when setItem throws, the roll is still listed and sent (this tab only)', async () => {
    onLine = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    const roll = newRoll();

    addPending(ACCOUNT, SHIELD, roll);

    expect(localStorage.length).toBe(0);
    expect(pendingFor(ACCOUNT, SHIELD)).toEqual([{ ...roll, state: 'pending' }]);
    onLine = true;
    await flush(ACCOUNT);
    expect(posts().map((body) => body.key)).toEqual([roll.key]);
    expect(pendingFor(ACCOUNT, SHIELD)).toEqual([]);
  });

  it('broken storage: when localStorage itself cannot be reached, the roll is still listed and sent', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('SecurityError', 'SecurityError');
    });
    onLine = false;
    const roll = newRoll();
    addPending(ACCOUNT, SHIELD, roll);
    expect(pendingFor(ACCOUNT, SHIELD)).toEqual([{ ...roll, state: 'pending' }]);

    onLine = true;
    await flush(ACCOUNT);
    expect(posts().map((body) => body.key)).toEqual([roll.key]);
  });

  it('malformed data under a key is ignored, never thrown', async () => {
    const good = { ...newRoll(), state: 'pending' };
    for (const text of ['{not json', '"text"', 'null', '{"key":"x"}', JSON.stringify([{ ...good, results: ['x'] }, 7, null])]) {
      localStorage.setItem(KEY_OF(ACCOUNT, SHIELD), text);
      resetPendingRolls();
      expect(pendingFor(ACCOUNT, SHIELD)).toEqual([]);
      await expect(flush(ACCOUNT)).resolves.toBeUndefined();
    }
    expect(fetched).toHaveLength(0);

    // The well-formed entries of a list are kept, each key once; a malformed key (an extra ":") is not sent.
    localStorage.setItem(KEY_OF(ACCOUNT, SHIELD), JSON.stringify([good, { ...good }, { ...good, state: 'lost' }]));
    localStorage.setItem(`${KEY_OF(ACCOUNT, SHIELD)}:extra`, JSON.stringify([{ ...newRoll(), state: 'pending' }]));
    resetPendingRolls();
    expect(pendingFor(ACCOUNT, SHIELD)).toEqual([good]);
    await flush(ACCOUNT);
    expect(posts().map((body) => body.key)).toEqual([good.key]);
  });

  it('without an account id, the rolls live in this tab only and are still sent', async () => {
    onLine = false;
    const roll = newRoll();
    addPending(null, SHIELD, roll);
    expect(localStorage.length).toBe(0);
    expect(pendingFor(null, SHIELD)).toEqual([{ ...roll, state: 'pending' }]);

    onLine = true;
    await flush(ACCOUNT);
    expect(fetched).toHaveLength(0);
    await flush(null);
    expect(posts().map((body) => body.key)).toEqual([roll.key]);
  });

  it("another tab's change reaches the subscribers through the storage event", () => {
    const listener = vi.fn();
    const stop = subscribe(listener);
    const roll = { ...newRoll(), state: 'pending' as const };
    expect(pendingFor(ACCOUNT, SHIELD)).toEqual([]);

    localStorage.setItem(KEY_OF(ACCOUNT, SHIELD), JSON.stringify([roll]));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY_OF(ACCOUNT, SHIELD) }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pendingFor(ACCOUNT, SHIELD)).toEqual([roll]);

    // Other keys are not the rolls'.
    window.dispatchEvent(new StorageEvent('storage', { key: 'gmshield:draft:x' }));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY_OF(ACCOUNT, SHIELD) }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('this module keeps only the pending list, and never in a cookie', async () => {
    addPending(ACCOUNT, SHIELD, newRoll());
    await flush(ACCOUNT);
    addPending(ACCOUNT, SHIELD, newRoll());
    expect(document.cookie).toBe('');
    expect(sessionStorage.length).toBe(0);
    expect(Object.keys(localStorage)).toEqual([KEY_OF(ACCOUNT, SHIELD)]);
  });
});
