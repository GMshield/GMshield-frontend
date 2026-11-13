import { afterEach, describe, expect, it, vi } from 'vitest';

import { FORWARDED_HEADERS, allowedHeaders, createBackendClient } from '@/server/backend/client';

import { startStandIn, type Running } from './support/servers';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('backend client', () => {
  let running: Running | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
    vi.restoreAllMocks();
  });

  it('keeps only the headers of the fixed list', () => {
    const headers = new Headers({
      accept: 'application/json',
      'accept-language': 'pt-BR',
      'content-type': 'application/json',
      traceparent: TRACEPARENT,
      cookie: '__Host-session=secret',
      authorization: 'Bearer secret',
      'x-forwarded-for': '203.0.113.9',
      host: 'evil.example',
      'x-session-token': 'secret',
    });
    const allowed = allowedHeaders(headers);
    expect([...allowed.keys()].sort()).toEqual(['accept', 'accept-language', 'content-type', 'traceparent']);
    expect(FORWARDED_HEADERS).toEqual(['accept', 'accept-language', 'content-type', 'traceparent']);
  });

  it('sends only allowed headers, the traceparent, and asks for no cache', async () => {
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
    expect(sent.get('authorization')).toBeNull();
    for (const name of sent.keys()) {
      expect(FORWARDED_HEADERS).toContain(name);
    }
  });

  it('builds an independent client for each request', () => {
    const a = createBackendClient({ baseUrl: 'http://backend:8080', traceparent: TRACEPARENT });
    const b = createBackendClient({ baseUrl: 'http://backend:8080', traceparent: TRACEPARENT });
    expect(a).not.toBe(b);
  });

  it('reaches a real server with only allowed headers on the wire', async () => {
    running = await startStandIn();
    const client = createBackendClient({ baseUrl: running.url, traceparent: TRACEPARENT });
    const { data } = await client.GET('/api/v1/version', { headers: { cookie: 'session=secret' } });
    expect(data?.version).toBe('1.0.0');
    const headers = running.requests[0]!.headers;
    expect(headers.traceparent).toBe(TRACEPARENT);
    expect(headers.cookie).toBeUndefined();
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
