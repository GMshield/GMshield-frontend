import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FORWARDED_HEADERS, allowedHeaders, createBackendClient } from '@/server/backend/client';
import { TEST_MODE_FRONTEND_CREDENTIAL } from '@/server/settings';

import { startStandIn, type Running } from './support/servers';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

const CREDENTIAL = 'configured-service-credential-0123456789';

describe('backend client', () => {
  let running: Running | undefined;
  beforeEach(() => {
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_BACKEND_URL', 'http://backend:8080');
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  });
  afterEach(async () => {
    await running?.close();
    running = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('keeps only the headers of the fixed list, the session token included (Story 1.9)', () => {
    const headers = new Headers({
      accept: 'application/json',
      'accept-language': 'pt-BR',
      'content-type': 'application/json',
      traceparent: TRACEPARENT,
      cookie: '__Host-session=secret',
      authorization: 'Bearer secret',
      'x-forwarded-for': '203.0.113.9',
      host: 'evil.example',
      'x-session-token': 'session-token',
      'x-sign-in-token': 'secret',
    });
    const allowed = allowedHeaders(headers);
    expect([...allowed.keys()].sort()).toEqual(['accept', 'accept-language', 'content-type', 'traceparent', 'x-session-token']);
    expect(allowed.get('x-session-token')).toBe('session-token');
    expect(FORWARDED_HEADERS).toEqual(['accept', 'accept-language', 'content-type', 'traceparent', 'x-session-token']);
  });

  it('sends only allowed headers, the traceparent and the configured service credential, never the browser\'s, and asks for no cache', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({ version: '1.0.0' });
    });
    const client = createBackendClient({ baseUrl: 'http://backend:8080', traceparent: TRACEPARENT, fetch: fake as typeof fetch });
    const { data } = await client.GET('/api/v1/version', {
      headers: { cookie: 'a=b', authorization: 'Bearer x', 'accept-language': 'en' },
    });
    expect(data).toEqual({ version: '1.0.0' });
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe('http://backend:8080/api/v1/version');
    expect(init.cache).toBe('no-store');
    const sent = new Headers(init.headers);
    expect(sent.get('traceparent')).toBe(TRACEPARENT);
    expect(sent.get('accept-language')).toBe('en');
    expect(sent.get('cookie')).toBeNull();
    // The browser's Bearer x is dropped; the credential of the settings takes its place (Story 1.10).
    expect(sent.get('authorization')).toBe(`Bearer ${CREDENTIAL}`);
    for (const name of sent.keys()) {
      expect([...FORWARDED_HEADERS, 'authorization']).toContain(name);
    }
  });

  it('takes the credential from the settings: the fixed one in test mode, and no client without one', async () => {
    const calls: Headers[] = [];
    const fake = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(new Headers(init?.headers));
      return Response.json({ version: '1.2.0' });
    });
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', '');
    vi.stubEnv('GMSHIELD_MODE', 'test');
    await createBackendClient({ baseUrl: 'http://backend:8080', traceparent: TRACEPARENT, fetch: fake as typeof fetch }).GET('/api/v1/version');
    expect(calls[0]?.get('authorization')).toBe(`Bearer ${TEST_MODE_FRONTEND_CREDENTIAL}`);
    vi.stubEnv('GMSHIELD_MODE', '');
    expect(() => createBackendClient({ baseUrl: 'http://backend:8080', traceparent: TRACEPARENT })).toThrow(/GMSHIELD_FRONTEND_CREDENTIAL/);
  });

  it('builds an independent client for each request', () => {
    const a = createBackendClient({ baseUrl: 'http://backend:8080', traceparent: TRACEPARENT });
    const b = createBackendClient({ baseUrl: 'http://backend:8080', traceparent: TRACEPARENT });
    expect(a).not.toBe(b);
  });

  it('reaches a real server with only allowed headers on the wire', async () => {
    running = await startStandIn();
    const client = createBackendClient({ baseUrl: running.url, traceparent: TRACEPARENT });
    const { data } = await client.GET('/api/v1/version', { headers: { cookie: 'session=secret', authorization: 'Bearer browser' } });
    expect(data?.version).toBe('1.33.0');
    const headers = running.requests[0]!.headers;
    expect(headers.traceparent).toBe(TRACEPARENT);
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
  });

  it('gives up after the timeout', async () => {
    const hanging = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const client = createBackendClient({ baseUrl: 'http://backend:8080', traceparent: TRACEPARENT, timeoutMs: 50, fetch: hanging as typeof fetch });
    await expect(client.GET('/api/v1/version')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
