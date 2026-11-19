import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { relayTurnEvents, type StreamRequest } from '@/server/conversations';

import { closedAddress, startScripted, type Scripted } from './support/servers';

const CREDENTIAL = 'configured-service-credential-0123456789';
const SESSION = 'sessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const TURN = '0190a0b0-0000-7000-8000-000000000021';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';

type Live = { url: string; seen: IncomingMessage[]; closed: Promise<void>; send: (text: string) => void; close: () => Promise<void> };

/** A backend whose event stream the test writes into, and which notes when the relay goes away. */
async function streamingBackend(): Promise<Live> {
  const seen: IncomingMessage[] = [];
  const responses: ServerResponse[] = [];
  let gone: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => (gone = resolve));
  const server = createServer((request, response) => {
    seen.push(request);
    responses.push(response);
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Secret': 'backend' });
    response.flushHeaders();
    request.on('close', () => gone());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    closed,
    send: (text) => responses.forEach((response) => response.write(text)),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function incoming(headers: Record<string, string> = {}, extra: Partial<StreamRequest> = {}): StreamRequest {
  return {
    headers: new Headers({ traceparent: TRACEPARENT, ...headers }),
    signal: new AbortController().signal,
    sessionToken: SESSION,
    sameOrigin: true,
    ...extra,
  };
}

describe('the turn event stream relay (Story 2.4)', () => {
  let live: Live | undefined;
  let scripted: Scripted | undefined;
  beforeEach(() => {
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_BACKEND_URL', 'http://backend.invalid:8080');
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  });
  afterEach(async () => {
    await live?.close();
    await scripted?.close();
    live = undefined;
    scripted = undefined;
    vi.unstubAllEnvs();
  });

  it('streams the backend events as they come, forwarding Last-Event-ID and the session, nothing of the browser', async () => {
    live = await streamingBackend();
    const relayed = await relayTurnEvents(
      incoming({ 'last-event-id': '3', cookie: 'secret=1', authorization: 'Bearer browser' }),
      TURN,
      { baseUrl: live.url },
    );

    expect(relayed.status).toBe(200);
    expect(relayed.headers.get('content-type')).toBe('text/event-stream');
    expect(relayed.headers.get('cache-control')).toBe('no-store');
    expect(relayed.headers.get('x-accel-buffering')).toBe('no');
    expect(relayed.headers.get('x-secret')).toBeNull();
    const request = live.seen[0]!;
    expect(request.url).toBe(`/api/v1/turns/${TURN}/events`);
    expect(request.headers['last-event-id']).toBe('3');
    expect(request.headers['x-session-token']).toBe(SESSION);
    expect(request.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
    expect(request.headers.accept).toBe('text/event-stream');
    expect(request.headers.cookie).toBeUndefined();

    // An event reaches the browser before the stream ends: nothing is buffered.
    const reader = relayed.body!.getReader();
    live.send('id:4\nevent:delta\ndata:{"text":"Fire"}\n\n');
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('id:4\nevent:delta');
    await reader.cancel();
  });

  it('forwards only a Last-Event-ID that is a sequence', async () => {
    live = await streamingBackend();
    const relayed = await relayTurnEvents(incoming({ 'last-event-id': '3; x-evil' }), TURN, { baseUrl: live.url });
    expect(live.seen[0]!.headers['last-event-id']).toBeUndefined();
    await relayed.body?.cancel();
  });

  it('forwards a valid lastEventId query as Last-Event-ID when the header is absent, and drops an invalid one (Story 2.6)', async () => {
    live = await streamingBackend();
    const resumed = await relayTurnEvents(incoming({}, { lastEventId: '7' }), TURN, { baseUrl: live.url });
    expect(live.seen[0]!.headers['last-event-id']).toBe('7');
    await resumed.body?.cancel();

    const invalid = await relayTurnEvents(incoming({}, { lastEventId: '7\r\nx-evil: 1' }), TURN, { baseUrl: live.url });
    expect(live.seen[1]!.headers['last-event-id']).toBeUndefined();
    expect(live.seen[1]!.headers['x-evil']).toBeUndefined();
    await invalid.body?.cancel();

    // The browser's own header wins over the query.
    const both = await relayTurnEvents(incoming({ 'last-event-id': '9' }, { lastEventId: '7' }), TURN, { baseUrl: live.url });
    expect(live.seen[2]!.headers['last-event-id']).toBe('9');
    await both.body?.cancel();
  });

  it('reads the lastEventId query of the route address (Story 2.6)', async () => {
    live = await streamingBackend();
    vi.stubEnv('GMSHIELD_BACKEND_URL', live.url);
    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/v1/turns/[id]/events/route');
    const controller = new AbortController();
    const request = new NextRequest(`http://gm.test/api/v1/turns/${TURN}/events?lastEventId=8`, {
      headers: { host: 'gm.test', origin: 'http://gm.test', cookie: `__Host-gmshield-session=${SESSION}.4102444800` },
      signal: controller.signal,
    });
    const relayed = await GET(request, { params: Promise.resolve({ id: TURN }) });
    expect(relayed.status).toBe(200);
    expect(live.seen[0]!.url).toBe(`/api/v1/turns/${TURN}/events`);
    expect(live.seen[0]!.headers['last-event-id']).toBe('8');
    controller.abort();
    await relayed.body?.cancel().catch(() => undefined);
  });

  it('aborts the backend request when the browser leaves', async () => {
    live = await streamingBackend();
    const leaving = new AbortController();
    const relayed = await relayTurnEvents(incoming({}, { signal: leaving.signal }), TURN, { baseUrl: live.url });
    expect(relayed.status).toBe(200);

    leaving.abort();

    await expect(live.closed).resolves.toBeUndefined();
  });

  it('refuses another origin and an id that is not one without reaching the backend', async () => {
    scripted = await startScripted({});
    const crossOrigin = await relayTurnEvents(incoming({}, { sameOrigin: false }), TURN, { baseUrl: scripted.url });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toMatchObject({ code: 'request.cross_origin' });
    const malformed = await relayTurnEvents(incoming(), '../me', { baseUrl: scripted.url });
    expect(malformed.status).toBe(404);
    expect(scripted.calls).toEqual([]);
  });

  it('passes a refusal on as its problem detail, and an unreachable backend as unavailable', async () => {
    scripted = await startScripted({
      [`GET /api/v1/turns/${TURN}/events`]: { status: 404, body: { status: 404, category: 'request', code: 'request.not_found', params: {} } },
    });
    const refused = await relayTurnEvents(incoming(), TURN, { baseUrl: scripted.url });
    expect(refused.status).toBe(404);
    expect(refused.headers.get('content-type')).toBe('application/problem+json');
    expect(await refused.json()).toMatchObject({ code: 'request.not_found' });

    const unreachable = await relayTurnEvents(incoming(), TURN, { baseUrl: await closedAddress() });
    expect(unreachable.status).toBe(503);
    expect(await unreachable.json()).toMatchObject({ code: 'server.unavailable' });
  });
});

describe('the question relay (Story 2.4)', () => {
  let scripted: Scripted | undefined;
  afterEach(async () => {
    await scripted?.close();
    scripted = undefined;
    vi.unstubAllEnvs();
  });

  async function post(headers: Record<string, string>, body: string, id = CAMPAIGN): Promise<Response> {
    const { NextRequest } = await import('next/server');
    const { POST } = await import('@/app/api/v1/campaigns/[id]/turns/route');
    const request = new NextRequest(`http://gm.test/api/v1/campaigns/${id}/turns`, {
      method: 'POST',
      headers: { host: 'gm.test', 'content-type': 'application/json', ...headers },
      body,
    });
    return POST(request, { params: Promise.resolve({ id }) });
  }

  function useBackend(routes: Parameters<typeof startScripted>[0]) {
    return startScripted(routes).then((running) => {
      scripted = running;
      vi.stubEnv('GMSHIELD_MODE', '');
      vi.stubEnv('GMSHIELD_BACKEND_URL', running.url);
      vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
      return running;
    });
  }

  it('records the question through the typed client with the session, and answers the turn', async () => {
    const turn = { id: TURN, conversationId: '0190a0b0-0000-7000-8000-000000000020', language: 'pt-BR' };
    const backend = await useBackend({ [`POST /api/v1/campaigns/${CAMPAIGN}/turns`]: { status: 201, body: turn } });

    const answered = await post(
      { origin: 'http://gm.test', cookie: `__Host-gmshield-session=${SESSION}.4102444800` },
      JSON.stringify({ question: 'Quanto dano causa Fire Bolt?' }),
    );

    expect(answered.status).toBe(201);
    expect(await answered.json()).toEqual(turn);
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(JSON.parse(backend.calls[0]!.body)).toEqual({ question: 'Quanto dano causa Fire Bolt?' });
  });

  it('refuses another origin, a malformed body and no session without reaching the backend', async () => {
    const backend = await useBackend({});
    const cookie = `__Host-gmshield-session=${SESSION}.4102444800`;
    expect((await post({ origin: 'http://evil.test', cookie }, '{"question":"x"}')).status).toBe(403);
    expect((await post({ origin: 'http://gm.test', cookie }, '{nope')).status).toBe(400);
    expect((await post({ origin: 'http://gm.test', cookie }, '{"question":7}')).status).toBe(400);
    expect((await post({ origin: 'http://gm.test' }, '{"question":"x"}')).status).toBe(401);
    expect((await post({ origin: 'http://gm.test', cookie }, '{"question":"x"}', 'nope')).status).toBe(404);
    expect(backend.calls).toEqual([]);
  });

  it('passes the backend refusal on with its status', async () => {
    await useBackend({
      [`POST /api/v1/campaigns/${CAMPAIGN}/turns`]: { status: 400, body: { status: 400, category: 'request', code: 'request.invalid', params: {} } },
    });
    const refused = await post({ origin: 'http://gm.test', cookie: `__Host-gmshield-session=${SESSION}.4102444800` }, '{"question":" "}');
    expect(refused.status).toBe(400);
    expect(refused.headers.get('content-type')).toBe('application/problem+json');
    expect(await refused.json()).toMatchObject({ code: 'request.invalid' });
  });
});

describe("the browser's question call (Story 2.4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to the relay on this site and answers the turn or the problem', async () => {
    const { postQuestion, turnEventsUrl } = await import('@/client/conversation');
    const turn = { id: TURN, conversationId: 'c', language: null };
    const send = vi.fn(async () => new Response(JSON.stringify(turn), { status: 201 }));
    vi.stubGlobal('fetch', send);

    expect(await postQuestion(CAMPAIGN, 'Quanto?')).toEqual({ ok: true, turn });
    expect(send).toHaveBeenCalledWith(`/api/v1/campaigns/${CAMPAIGN}/turns`, expect.objectContaining({ method: 'POST', body: '{"question":"Quanto?"}' }));

    const problem = { status: 404, category: 'request', code: 'request.not_found', params: {} };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(problem), { status: 404 })));
    expect(await postQuestion(CAMPAIGN, 'Quanto?')).toEqual({ ok: false, problem });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 502 })));
    expect(await postQuestion(CAMPAIGN, 'Quanto?')).toMatchObject({ ok: false, problem: { code: 'server.unavailable' } });

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await postQuestion(CAMPAIGN, 'Quanto?')).toMatchObject({ ok: false, problem: { code: 'server.unavailable' } });

    expect(turnEventsUrl(TURN)).toBe(`/api/v1/turns/${TURN}/events`);
  });
});

describe('the stop relay (Story 2.6)', () => {
  let scripted: Scripted | undefined;
  afterEach(async () => {
    await scripted?.close();
    scripted = undefined;
    vi.unstubAllEnvs();
  });

  async function stop(headers: Record<string, string>, id = TURN): Promise<Response> {
    const { NextRequest } = await import('next/server');
    const { POST } = await import('@/app/api/v1/turns/[id]/stop/route');
    const request = new NextRequest(`http://gm.test/api/v1/turns/${id}/stop`, { method: 'POST', headers: { host: 'gm.test', ...headers } });
    return POST(request, { params: Promise.resolve({ id }) });
  }

  function useBackend(routes: Parameters<typeof startScripted>[0]) {
    return startScripted(routes).then((running) => {
      scripted = running;
      vi.stubEnv('GMSHIELD_MODE', '');
      vi.stubEnv('GMSHIELD_BACKEND_URL', running.url);
      vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
      return running;
    });
  }

  const cookie = `__Host-gmshield-session=${SESSION}.4102444800`;

  it('stops the turn through the typed client with the session, and answers 204', async () => {
    const backend = await useBackend({ [`POST /api/v1/turns/${TURN}/stop`]: { status: 204 } });

    const stopped = await stop({ origin: 'http://gm.test', cookie });

    expect(stopped.status).toBe(204);
    expect(stopped.headers.get('cache-control')).toBe('no-store');
    expect(await stopped.text()).toBe('');
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(backend.calls[0]!.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
  });

  it('refuses another origin, an id that is not one and no session without reaching the backend', async () => {
    const backend = await useBackend({});
    expect((await stop({ origin: 'http://evil.test', cookie })).status).toBe(403);
    expect((await stop({ origin: 'http://gm.test', cookie }, 'nope')).status).toBe(404);
    expect((await stop({ origin: 'http://gm.test' })).status).toBe(401);
    expect(backend.calls).toEqual([]);
  });

  it("passes another owner's turn on as not found", async () => {
    await useBackend({
      [`POST /api/v1/turns/${TURN}/stop`]: { status: 404, body: { status: 404, category: 'request', code: 'request.not_found', params: {} } },
    });
    const refused = await stop({ origin: 'http://gm.test', cookie });
    expect(refused.status).toBe(404);
    expect(refused.headers.get('content-type')).toBe('application/problem+json');
    expect(await refused.json()).toMatchObject({ code: 'request.not_found' });
  });
});

describe("the browser's stop call and stream address (Story 2.6)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the stop to the relay on this site, true only for 204', async () => {
    const { stopTurn } = await import('@/client/conversation');
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', send);
    expect(await stopTurn(TURN)).toBe(true);
    expect(send).toHaveBeenCalledWith(`/api/v1/turns/${TURN}/stop`, expect.objectContaining({ method: 'POST' }));

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await stopTurn(TURN)).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await stopTurn(TURN)).toBe(false);
  });

  it('names the last event id of a reopened stream in its address', async () => {
    const { turnEventsUrl } = await import('@/client/conversation');
    expect(turnEventsUrl(TURN, '7')).toBe(`/api/v1/turns/${TURN}/events?lastEventId=7`);
    expect(turnEventsUrl(TURN, null)).toBe(`/api/v1/turns/${TURN}/events`);
  });

  it('reads a stopped done: never silent, its references kept', async () => {
    const { parseDone } = await import('@/client/conversation');
    const reference = { number: 1, materialName: 'Livro', sectionPath: [], page: 2, passageIds: ['p'], removed: false };
    expect(parseDone({ stopped: true, silent: false, references: [] })).toEqual({ stopped: true, silent: false, references: [] });
    expect(parseDone({ stopped: true, silent: true, references: [reference] })).toEqual({ stopped: true, silent: false, references: [reference] });
    expect(parseDone({ stopped: false, silent: false, references: [] })).toEqual({ stopped: false, silent: true, references: [] });
    expect(parseDone({ silent: false, references: [reference] })).toEqual({ stopped: false, silent: false, references: [reference] });
  });
});
