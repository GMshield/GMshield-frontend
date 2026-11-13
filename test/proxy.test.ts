import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config, contentSecurityPolicy, proxy, siteOrigin } from '@/proxy';

import { captureOutput } from './support/capture';

const SITE = 'http://127.0.0.1:3000';

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(new URL(path, SITE), {
    method: init.method ?? 'GET',
    headers: { host: '127.0.0.1:3000', ...init.headers },
  });
}

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe('proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('Page: GET / passes with a nonce CSP and no-store', () => {
    const response = proxy(request('/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const policy = response.headers.get('content-security-policy')!;
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    expect(nonce).toBeDefined();
    // Next.js reads the nonce from the request's policy: the same policy is forwarded.
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
  });

  it('allows the site itself only: every fetch directive is self, plus the nonce on scripts and styles', () => {
    const map = directives(contentSecurityPolicy('abc123==', false));
    const fetchDirectives = ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'media-src', 'manifest-src', 'worker-src', 'frame-src', 'child-src'];
    for (const name of fetchDirectives) {
      const values = map.get(name);
      expect(values, name).toBeDefined();
      const expected = name === 'script-src' || name === 'style-src' ? ["'self'", "'nonce-abc123=='"] : ["'self'"];
      expect(values, name).toEqual(expected);
    }
    expect(map.get('object-src')).toEqual(["'none'"]);
    expect(map.get('frame-ancestors')).toEqual(["'none'"]);
    expect(map.get('base-uri')).toEqual(["'self'"]);
    expect(map.get('form-action')).toEqual(["'self'"]);
    expect([...map.keys()].sort()).toEqual([...fetchDirectives, 'object-src', 'frame-ancestors', 'base-uri', 'form-action'].sort());
  });

  it('uses a new nonce for every request', () => {
    const a = proxy(request('/')).headers.get('content-security-policy');
    const b = proxy(request('/')).headers.get('content-security-policy');
    expect(a).not.toBe(b);
  });

  it('marks API answers no-store too', () => {
    const response = proxy(request('/api/health'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('Cross-origin POST: 403 problem detail request.cross_origin', async () => {
    const output = captureOutput();
    const response = proxy(request('/api/health', { method: 'POST', headers: { origin: 'https://evil.example' } }));
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-middleware-next')).toBeNull();
    const body = await response.json();
    expect(body).toMatchObject({
      type: 'urn:gmshield:problem:request.cross_origin',
      status: 403,
      category: 'request',
      code: 'request.cross_origin',
      params: {},
    });
    expect(body.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(output.lines()[0]).toMatchObject({ event: 'request.refused', unit: 'proxy', method: 'POST', traceId: body.traceId });
    expect(output.raw()).not.toContain('evil.example');
  });

  it('refuses every state-changing method without the same origin', () => {
    captureOutput();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const variants: Record<string, string>[] = [
        { origin: 'https://evil.example' },
        { origin: 'null' },
        { origin: 'http://127.0.0.1:3001' },
        { origin: 'https://127.0.0.1:3000' },
        {},
        { 'sec-fetch-site': 'same-site' },
        { 'sec-fetch-site': 'cross-site' },
        { 'sec-fetch-site': 'none' },
        // An Origin header decides even when Sec-Fetch-Site claims the same origin.
        { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' },
      ];
      for (const headers of variants) {
        expect(proxy(request('/', { method, headers })).status, `${method} ${JSON.stringify(headers)}`).toBe(403);
      }
    }
  });

  it('lets same-origin state changes through', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(proxy(request('/', { method, headers: { origin: SITE } })).headers.get('x-middleware-next')).toBe('1');
      expect(proxy(request('/', { method, headers: { 'sec-fetch-site': 'same-origin' } })).headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('takes the scheme from X-Forwarded-Proto behind a TLS proxy', () => {
    const behindTunnel = request('/', { method: 'POST', headers: { host: 'gmshield.example', 'x-forwarded-proto': 'https', origin: 'https://gmshield.example' } });
    expect(siteOrigin(behindTunnel)).toBe('https://gmshield.example');
    expect(proxy(behindTunnel).headers.get('x-middleware-next')).toBe('1');
  });

  it('does not refuse safe methods from elsewhere', () => {
    expect(proxy(request('/', { headers: { origin: 'https://evil.example' } })).headers.get('x-middleware-next')).toBe('1');
  });

  it('gives the request a traceparent when it has no valid one, and keeps a valid one', () => {
    const created = proxy(request('/')).headers.get('x-middleware-request-traceparent');
    expect(created).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const valid = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const kept = proxy(request('/', { headers: { traceparent: valid } }));
    expect(kept.headers.get('x-middleware-request-traceparent')).toBe(valid);
  });

  it('adds unsafe-eval in development only', () => {
    expect(contentSecurityPolicy('n', true)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy('n', false)).not.toContain('unsafe');
  });

  it('runs on everything except Next.js static files', () => {
    const [source] = config.matcher;
    const pattern = new RegExp(`^${source!}$`);
    for (const path of ['/', '/api/health', '/campaigns/1']) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico']) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});
