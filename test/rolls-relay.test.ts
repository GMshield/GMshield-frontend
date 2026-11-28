import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureOutput } from './support/capture';
import { startScripted, type Scripted } from './support/servers';

/**
 * Story 6.4 part A: the relay of a Shield's stored rolls (POST a roll, GET the log a page at a time, DELETE to clear),
 * and the browser's calls to it (`src/client/rolls.ts`).
 */
const CREDENTIAL = 'configured-service-credential-0123456789';
const SESSION = 'sessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const COOKIE = `__Host-gmshield-session=${SESSION}.4102444800`;
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const SHIELD = '0190a0b0-0000-7000-8000-000000000a01';
const PATH = `/api/v1/campaigns/${CAMPAIGN}/shields/${SHIELD}/rolls`;
const KEY = '3b241101-e2bb-4255-8caf-4136c566a962';

const SENT = { key: KEY, formula: '2d6+3', results: [4, 5], label: 'Iniciativa', rolledAt: '2026-11-27T12:00:00.000Z' };
const STORED = {
  id: '0190a0b0-0000-7000-8000-000000000b01',
  key: KEY,
  formula: '2d6+3',
  results: [4, 5],
  total: 12,
  label: 'Iniciativa',
  rolledAt: '2026-11-27T12:00:00Z',
};
const PAGE = { items: [STORED], nextCursor: STORED.id, total: 11 };
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin', cookie: COOKIE };

function problem(status: number, code: string) {
  return { status, body: { status, category: code.split('.')[0], code, params: {} } };
}

describe("the relay of a Shield's rolls (Story 6.4 part A)", () => {
  let scripted: Scripted | undefined;
  afterEach(async () => {
    await scripted?.close();
    scripted = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function useBackend(routes: Parameters<typeof startScripted>[0]) {
    scripted = await startScripted(routes);
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_BACKEND_URL', scripted.url);
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
    return scripted;
  }

  async function relay(
    method: 'GET' | 'POST' | 'DELETE',
    headers: Record<string, string>,
    options: { readonly body?: string; readonly query?: string; readonly id?: string; readonly shieldId?: string } = {},
  ): Promise<Response> {
    const { NextRequest } = await import('next/server');
    const route = await import('@/app/api/v1/campaigns/[id]/shields/[shieldId]/rolls/route');
    const id = options.id ?? CAMPAIGN;
    const shieldId = options.shieldId ?? SHIELD;
    const request = new NextRequest(`http://gm.test/api/v1/campaigns/${id}/shields/${shieldId}/rolls${options.query ?? ''}`, {
      method,
      headers: { host: 'gm.test', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(options.body === undefined ? {} : { body: options.body }),
    });
    return route[method](request, { params: Promise.resolve({ id, shieldId }) });
  }

  it('relays a roll with the session: 201 for one stored now, 200 for one already held, and a refusal as its problem', async () => {
    const route = await import('@/app/api/v1/campaigns/[id]/shields/[shieldId]/rolls/route');
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    captureOutput();
    let backend = await useBackend({ [`POST ${PATH}`]: { status: 201, body: STORED } });
    const created = await relay('POST', SAME_ORIGIN, { body: JSON.stringify(SENT) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(STORED);
    expect(created.headers.get('cache-control')).toBe('no-store');
    expect(backend.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(backend.calls[0]!.headers.cookie).toBeUndefined();
    expect(JSON.parse(backend.calls[0]!.body)).toEqual(SENT);
    await scripted?.close();

    backend = await useBackend({ [`POST ${PATH}`]: { status: 200, body: STORED } });
    const held = await relay('POST', SAME_ORIGIN, { body: JSON.stringify({ ...SENT, label: null }) });
    expect(held.status).toBe(200);
    // A null label is no label.
    expect(JSON.parse(backend.calls[0]!.body)).not.toHaveProperty('label');
    await scripted?.close();

    await useBackend({ [`POST ${PATH}`]: problem(400, 'request.roll_invalid') });
    const refused = await relay('POST', SAME_ORIGIN, { body: JSON.stringify(SENT) });
    expect(refused.status).toBe(400);
    expect(refused.headers.get('content-type')).toBe('application/problem+json');
    expect((await refused.json()).code).toBe('request.roll_invalid');
  });

  it('reads the log a page at a time and clears it with 204', async () => {
    const backend = await useBackend({
      [`GET ${PATH}?limit=10&cursor=${STORED.id}`]: { status: 200, body: PAGE },
      [`DELETE ${PATH}`]: { status: 204 },
    });
    const listed = await relay('GET', SAME_ORIGIN, { query: `?limit=10&cursor=${STORED.id}` });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual(PAGE);
    const cleared = await relay('DELETE', SAME_ORIGIN);
    expect(cleared.status).toBe(204);
    expect(await cleared.text()).toBe('');
    expect(backend.calls.map((call) => `${call.method} ${call.url}`)).toEqual([`GET ${PATH}?limit=10&cursor=${STORED.id}`, `DELETE ${PATH}`]);
    expect(backend.calls.every((call) => call.headers['x-session-token'] === SESSION)).toBe(true);
  });

  it('refuses another origin, no session, ids that cannot be ones, a malformed body or query, without reaching the backend', async () => {
    const backend = await useBackend({});
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const body = method === 'POST' ? JSON.stringify(SENT) : undefined;
      expect((await relay(method, { origin: 'http://evil.test', cookie: COOKIE }, { body })).status).toBe(403);
      expect((await relay(method, { origin: 'http://gm.test' }, { body })).status).toBe(401);
      expect((await relay(method, SAME_ORIGIN, { body, id: 'nope' })).status).toBe(404);
      expect((await relay(method, SAME_ORIGIN, { body, shieldId: '../x' })).status).toBe(404);
    }
    for (const body of [
      'not json',
      'null',
      '[]',
      JSON.stringify({ ...SENT, key: 5 }),
      JSON.stringify({ ...SENT, formula: undefined }),
      JSON.stringify({ ...SENT, results: [4.5] }),
      JSON.stringify({ ...SENT, results: '4' }),
      JSON.stringify({ ...SENT, label: 3 }),
      JSON.stringify({ ...SENT, rolledAt: 0 }),
    ]) {
      const refused = await relay('POST', SAME_ORIGIN, { body });
      expect(refused.status, body).toBe(400);
      expect((await refused.json()).code).toBe('request.invalid');
    }
    for (const query of ['?limit=0', '?limit=51', '?limit=01', '?cursor=nope']) {
      expect((await relay('GET', SAME_ORIGIN, { query })).status, query).toBe(400);
    }
    expect(backend.calls).toEqual([]);
  });

  it('the browser sends, reads and clears through this site only, and anything unexpected is "not saved"', async () => {
    const { clearRolls, readRolls, sendRoll } = await import('@/client/rolls');
    const send = vi.fn(async () => Response.json(STORED, { status: 201 }));
    vi.stubGlobal('fetch', send);
    expect(await sendRoll(CAMPAIGN, SHIELD, SENT)).toEqual({ ok: true, roll: STORED, created: true });
    expect(send).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify(SENT) }));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(STORED, { status: 200 })));
    expect(await sendRoll(CAMPAIGN, SHIELD, SENT)).toEqual({ ok: true, roll: STORED, created: false });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...STORED, total: 'doze' }, { status: 201 })));
    expect((await sendRoll(CAMPAIGN, SHIELD, SENT)).ok).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'request.roll_invalid' }, { status: 400 })));
    expect(await sendRoll(CAMPAIGN, SHIELD, SENT)).toEqual({ ok: false, status: 400, problem: { code: 'request.roll_invalid' } });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await sendRoll(CAMPAIGN, SHIELD, SENT)).toMatchObject({ ok: false, status: 503 });

    const read = vi.fn(async () => Response.json(PAGE));
    vi.stubGlobal('fetch', read);
    expect(await readRolls(CAMPAIGN, SHIELD, 10, STORED.id)).toEqual({ ok: true, page: PAGE });
    expect(read).toHaveBeenCalledWith(`${PATH}?limit=10&cursor=${STORED.id}`, expect.objectContaining({ credentials: 'same-origin' }));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [{ ...STORED, results: 'x' }], total: 1 })));
    expect((await readRolls(CAMPAIGN, SHIELD, 10)).ok).toBe(false);

    const clear = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', clear);
    expect(await clearRolls(CAMPAIGN, SHIELD)).toEqual({ ok: true });
    expect(clear).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: 'DELETE' }));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'request.not_found' }, { status: 404 })));
    expect(await clearRolls(CAMPAIGN, SHIELD)).toMatchObject({ ok: false, status: 404 });
  });

  it('gives each request a time limit: a stalled one ends as unanswered, so the roll is "not saved" and the log never waits', async () => {
    const { clearRolls, readRolls, ROLL_REQUEST_TIMEOUT_MS, sendRoll } = await import('@/client/rolls');
    expect(ROLL_REQUEST_TIMEOUT_MS).toBe(15_000);
    const controllers: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    // A relay that never answers, but gives up when its signal fires.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation timed out.', 'TimeoutError')));
          }),
      ),
    );
    const pending = [sendRoll(CAMPAIGN, SHIELD, SENT), readRolls(CAMPAIGN, SHIELD, 10), clearRolls(CAMPAIGN, SHIELD)];
    expect(timeout).toHaveBeenCalledTimes(3);
    expect(timeout.mock.calls.every(([ms]) => ms === ROLL_REQUEST_TIMEOUT_MS)).toBe(true);
    controllers.forEach((controller) => controller.abort());
    for (const result of await Promise.all(pending)) {
      expect(result).toMatchObject({ ok: false, status: 503, problem: { code: 'server.unavailable' } });
    }
    timeout.mockRestore();
  });
});
