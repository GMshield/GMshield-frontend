import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UPLOAD_REQUEST_HEADERS, UPLOAD_RESPONSE_HEADERS, backendPath, relayUpload, type RelayedRequest } from '@/server/backend/upload-relay';

import { captureOutput } from './support/capture';
import { closedAddress, startScripted, type Running, type Scripted } from './support/servers';

const CREDENTIAL = 'configured-service-credential-0123456789';
const SESSION = 'sessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const MIB = 1024 * 1024;

function incoming(method: string, headers: Record<string, string>, body: ReadableStream<Uint8Array> | null = null, extra: Partial<RelayedRequest> = {}): RelayedRequest {
  return {
    method,
    headers: new Headers(headers),
    body,
    signal: new AbortController().signal,
    sessionCookie: `${SESSION}.4102444800`,
    sameOrigin: true,
    ...extra,
  };
}

function bytes(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

/** A backend that counts the bytes of each request body as they arrive, and answers 204 with the count at the end. */
async function startCounting(): Promise<Running & { received: () => number }> {
  let received = 0;
  const requests: Running['requests'] = [];
  const server = createServer((request, response) => {
    requests.push({ headers: { ...request.headers } });
    request.on('data', (chunk: Buffer) => {
      received += chunk.length;
    });
    request.on('end', () => {
      response.writeHead(204, { 'Upload-Offset': String(received), 'Tus-Resumable': '1.0.0' });
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    received: () => received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('upload relay (Story 1.13)', () => {
  let running: Running | Scripted | undefined;
  beforeEach(() => {
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_BACKEND_URL', 'http://backend.invalid:8080');
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  });
  afterEach(async () => {
    await running?.close();
    running = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('maps only the three upload shapes to backend paths, never a step out of them', () => {
    expect(backendPath(undefined)).toBe('/api/v1/uploads');
    expect(backendPath([])).toBe('/api/v1/uploads');
    expect(backendPath(['0190a0b0-0000-7000-8000-000000000005'])).toBe('/api/v1/uploads/0190a0b0-0000-7000-8000-000000000005');
    expect(backendPath(['abc', 'completion'])).toBe('/api/v1/uploads/abc/completion');
    for (const segments of [['..'], ['.'], ['..', 'me'], ['abc', 'other'], ['abc', 'completion', 'x'], ['a/b'], ['a%2F..'], ['x'.repeat(65)], ['']]) {
      expect(backendPath(segments), segments.join('/')).toBeNull();
    }
  });

  it('forwards only the tus headers, Content-Type and Content-Length, with the credential, the session and the trace', async () => {
    const backend = await startScripted({ 'POST /api/v1/uploads': { status: 201 } });
    running = backend;
    captureOutput();
    const answer = await relayUpload(
      incoming('POST', {
        'tus-resumable': '1.0.0',
        'upload-length': '2147483648',
        'upload-metadata': 'filename cnVsZXMucGRm',
        'upload-offset': '0',
        'upload-checksum': 'sha256 47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
        'content-type': 'application/offset+octet-stream',
        traceparent: TRACEPARENT,
        cookie: '__Host-gmshield-session=secret',
        authorization: 'Bearer browser',
        'x-session-token': 'forged',
        'x-forwarded-for': '203.0.113.9',
        'accept-language': 'en',
        origin: 'http://localhost:3000',
      }),
      [],
      { baseUrl: backend.url },
    );
    expect(answer.status).toBe(201);
    const sent = backend.calls[0]!.headers;
    for (const name of UPLOAD_REQUEST_HEADERS.filter((header) => header !== 'content-length')) {
      expect(sent[name], name).toBeDefined();
    }
    expect(sent.authorization).toBe(`Bearer ${CREDENTIAL}`);
    expect(sent['x-session-token']).toBe(SESSION);
    expect(String(sent.traceparent)).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
    expect(sent.traceparent).not.toBe(TRACEPARENT);
    expect(sent['accept-language']).not.toBe('en');
    for (const name of ['cookie', 'x-forwarded-for', 'origin']) {
      expect(sent[name], name).toBeUndefined();
    }
    expect(backend.calls[0]!.url).toBe('/api/v1/uploads');
  });

  it('sends no session without a valid cookie', async () => {
    const backend = await startScripted({ 'HEAD /api/v1/uploads/abc': { status: 401 } });
    running = backend;
    captureOutput();
    await relayUpload(incoming('HEAD', { 'tus-resumable': '1.0.0' }, null, { sessionCookie: 'not a token' }), ['abc'], { baseUrl: backend.url });
    expect(backend.calls[0]!.headers['x-session-token']).toBeUndefined();
  });

  it('passes back only Location, the tus and Upload headers and Content-Type, never stored', async () => {
    const fake = vi.fn(
      async () =>
        new Response(null, {
          status: 201,
          headers: {
            Location: '/api/v1/uploads/0190a0b0-0000-7000-8000-000000000005',
            'Tus-Resumable': '1.0.0',
            'Upload-Expires': 'Tue, 17 Nov 2026 06:00:00 GMT',
            'Upload-Offset': '0',
            'Set-Cookie': 'backend=secret',
            'X-Internal': 'secret',
            'Cache-Control': 'max-age=60',
          },
        }),
    );
    captureOutput();
    const answer = await relayUpload(incoming('POST', { 'tus-resumable': '1.0.0' }), undefined, { fetch: fake as typeof fetch });
    expect(answer.headers.get('location')).toBe('/api/v1/uploads/0190a0b0-0000-7000-8000-000000000005');
    expect(answer.headers.get('upload-expires')).toBe('Tue, 17 Nov 2026 06:00:00 GMT');
    expect(answer.headers.get('tus-resumable')).toBe('1.0.0');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(answer.headers.get('set-cookie')).toBeNull();
    expect(answer.headers.get('x-internal')).toBeNull();
    expect(UPLOAD_RESPONSE_HEADERS).toContain('upload-offset');
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://backend.invalid:8080/api/v1/uploads');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
  });

  it('refuses a request from another origin before reaching the backend', async () => {
    const fake = vi.fn();
    const output = captureOutput();
    const answer = await relayUpload(incoming('PATCH', { 'tus-resumable': '1.0.0' }, bytes('part'), { sameOrigin: false }), ['abc'], {
      fetch: fake as unknown as typeof fetch,
    });
    expect(answer.status).toBe(403);
    expect(answer.headers.get('content-type')).toBe('application/problem+json');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect((await answer.json()).code).toBe('request.cross_origin');
    expect(fake).not.toHaveBeenCalled();
    expect(output.lines()[0]).toMatchObject({ level: 'WARN', event: 'request.refused', reason: 'request.cross_origin' });
  });

  it('answers a path outside the upload routes as not found, without reaching the backend', async () => {
    const fake = vi.fn();
    const answer = await relayUpload(incoming('POST', {}), ['..', 'me'], { fetch: fake as unknown as typeof fetch });
    expect(answer.status).toBe(404);
    expect((await answer.json()).code).toBe('request.not_found');
    expect(fake).not.toHaveBeenCalled();
  });

  it("passes the backend's problems through, 460 included, and answers unavailable when the backend does not answer", async () => {
    const problem = { type: 'urn:gmshield:problem:upload.part_checksum_mismatch', title: 'Part checksum mismatch', status: 460, category: 'upload', code: 'upload.part_checksum_mismatch', params: {}, traceId: 't' };
    const backend = await startScripted({ 'PATCH /api/v1/uploads/abc': { status: 460, body: problem } });
    running = backend;
    const output = captureOutput();
    const mismatch = await relayUpload(incoming('PATCH', { 'tus-resumable': '1.0.0', 'content-type': 'application/offset+octet-stream' }, bytes('part')), ['abc'], {
      baseUrl: backend.url,
    });
    expect(mismatch.status).toBe(460);
    expect(mismatch.headers.get('content-type')).toBe('application/problem+json');
    expect(await mismatch.json()).toEqual(problem);
    expect(backend.calls[0]!.body).toBe('part');

    const nowhere = await relayUpload(incoming('HEAD', { 'tus-resumable': '1.0.0' }), ['abc'], { baseUrl: await closedAddress() });
    expect(nowhere.status).toBe(503);
    expect(await nowhere.text()).toBe('');
    const unavailable = await relayUpload(incoming('POST', { 'tus-resumable': '1.0.0' }), [], { baseUrl: await closedAddress() });
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).code).toBe('server.unavailable');
    const events = output.lines().map((line) => line.event);
    expect(events).toContain('upload.relayed');
    expect(events).toContain('upload.backend_unreachable');
    expect(output.raw()).not.toContain(SESSION);
    expect(output.raw()).not.toContain(CREDENTIAL);
  });

  it('streams a body larger than the heap budget to the backend without holding it', async () => {
    const backend = await startCounting();
    running = backend;
    captureOutput();
    const total = 768 * MIB;
    const chunk = 1 * MIB;
    const window = 16 * MIB;
    let produced = 0;
    let peak = 0;
    const baseline = process.memoryUsage();
    // Each chunk is produced only once the backend has received all but the last 16 MiB: had the relay read the whole
    // body before sending it on, this source would wait for ever.
    const source = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (produced >= total) {
          controller.close();
          return;
        }
        const started = Date.now();
        while (produced - backend.received() > window) {
          if (Date.now() - started > 5_000) {
            controller.error(new Error('the relay is not streaming'));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        const usage = process.memoryUsage();
        peak = Math.max(peak, usage.heapUsed + usage.arrayBuffers - baseline.heapUsed - baseline.arrayBuffers);
        controller.enqueue(new Uint8Array(chunk).fill(0x61));
        produced += chunk;
      },
    });

    const answer = await relayUpload(
      incoming('PATCH', { 'tus-resumable': '1.0.0', 'content-type': 'application/offset+octet-stream', 'content-length': String(total) }, source),
      ['abc'],
      { baseUrl: backend.url },
    );

    expect(answer.status).toBe(204);
    expect(answer.headers.get('upload-offset')).toBe(String(total));
    expect(backend.received()).toBe(total);
    expect(String(backend.requests[0]!.headers['content-length'] as IncomingHttpHeaders[string])).toBe(String(total));
    // A few windows of memory at most, never the body.
    expect(peak).toBeLessThan(128 * MIB);
  }, 60_000);
});
