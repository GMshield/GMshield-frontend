import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { picturePath, relayPicture, type PictureRequest } from '@/server/backend/picture-relay';

import { captureOutput } from './support/capture';
import { closedAddress, startScripted, type Scripted } from './support/servers';

const CREDENTIAL = 'configured-service-credential-0123456789';
const SESSION = 'sessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const ID = '0190a0b0-0000-7000-8000-000000000003';
const PICTURE_PATH = `/api/v1/materials/${ID}/pages/13/picture?ground=review`;

function incoming(headers: Record<string, string> = {}, extra: Partial<PictureRequest> = {}): PictureRequest {
  return {
    headers: new Headers(headers),
    signal: new AbortController().signal,
    sessionCookie: `${SESSION}.4102444800`,
    ground: 'review',
    ...extra,
  };
}

/** A WebP file's first bytes, then a pattern. */
function webp(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '));
  for (let i = 16; i < size; i++) {
    bytes[i] = (i * 13) % 256;
  }
  return bytes;
}

describe('picture relay (Story 1.19)', () => {
  let running: Scripted | undefined;
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

  it('maps only a material id, a page number and a plain ground to the backend path', () => {
    expect(picturePath(ID, '13', 'review')).toBe(PICTURE_PATH);
    expect(picturePath(ID, '1', null)).toBe(`/api/v1/materials/${ID}/pages/1/picture`);
    for (const [id, page, ground] of [
      ['..', '1', 'review'],
      ['not-a-uuid', '1', 'review'],
      [`${ID}/..`, '1', 'review'],
      [ID, '0', 'review'],
      [ID, '013', 'review'],
      [ID, '-1', 'review'],
      [ID, '1.5', 'review'],
      [ID, '12345678', 'review'],
      [ID, '1', 'review&x=1'],
      [ID, '1', 'Review'],
      [ID, '1', ''],
    ] as const) {
      expect(picturePath(id, page, ground), `${id} ${page} ${ground}`).toBeNull();
    }
  });

  it('streams the WebP back with only its type and length, never stored or sniffed, and sends only the credential, the session and the trace', async () => {
    const picture = webp(300_000);
    const fake = vi.fn(
      async () =>
        new Response(new Blob([picture]).stream(), {
          status: 200,
          headers: {
            'Content-Type': 'image/webp',
            'Content-Length': String(picture.length),
            'Set-Cookie': 'backend=secret',
            'X-Internal': 'secret',
            'Cache-Control': 'max-age=60',
          },
        }),
    );
    captureOutput();
    const answer = await relayPicture(
      incoming({ traceparent: TRACEPARENT, cookie: '__Host-gmshield-session=secret', authorization: 'Bearer browser', 'x-session-token': 'forged', accept: 'image/webp' }),
      ID,
      '13',
      { fetch: fake as typeof fetch },
    );
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('image/webp');
    expect(answer.headers.get('content-length')).toBe('300000');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(answer.headers.get('set-cookie')).toBeNull();
    expect(answer.headers.get('x-internal')).toBeNull();
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(picture);
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://backend.invalid:8080${PICTURE_PATH}`);
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    const sent = new Headers(init.headers);
    expect([...sent.keys()].sort()).toEqual(['authorization', 'traceparent', 'x-session-token']);
    expect(sent.get('authorization')).toBe(`Bearer ${CREDENTIAL}`);
    expect(sent.get('x-session-token')).toBe(SESSION);
    expect(sent.get('traceparent')).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
  });

  it("passes the backend's not found and ground refusal through as problems, and sends no session without a cookie", async () => {
    const notFound = { status: 404, category: 'request', code: 'request.not_found', params: {} };
    running = await startScripted({
      [`GET ${PICTURE_PATH}`]: { status: 404, body: notFound, contentType: 'application/problem+json' },
      [`GET /api/v1/materials/${ID}/pages/13/picture`]: {
        status: 400,
        body: { status: 400, category: 'page', code: 'page.ground_unknown', params: {} },
        contentType: 'application/problem+json',
      },
    });
    captureOutput();
    const missing = await relayPicture(incoming({}, { sessionCookie: undefined }), ID, '13', { baseUrl: running.url });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toBe('application/problem+json');
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect((await missing.json()).code).toBe('request.not_found');
    expect(running.calls[0]!.headers['x-session-token']).toBeUndefined();
    const groundless = await relayPicture(incoming({}, { ground: null }), ID, '13', { baseUrl: running.url });
    expect(groundless.status).toBe(400);
    expect((await groundless.json()).code).toBe('page.ground_unknown');
  });

  it('answers a malformed id, page or ground as not found without reaching the backend', async () => {
    const fake = vi.fn();
    for (const [id, page, ground] of [
      ['../../me', '1', 'review'],
      [ID, '0', 'review'],
      [ID, '1', '../x'],
    ] as const) {
      const answer = await relayPicture(incoming({}, { ground }), id, page, { fetch: fake as unknown as typeof fetch });
      expect(answer.status).toBe(404);
      expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
      expect((await answer.json()).code).toBe('request.not_found');
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('answers unavailable when the backend does not answer', async () => {
    const output = captureOutput();
    const answer = await relayPicture(incoming({ traceparent: TRACEPARENT }), ID, '13', { baseUrl: await closedAddress() });
    expect(answer.status).toBe(503);
    expect((await answer.json()).code).toBe('server.unavailable');
    expect(output.lines()).toContainEqual(expect.objectContaining({ level: 'WARN', event: 'picture.backend_unreachable' }));
  });
});
