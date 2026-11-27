import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureOutput } from './support/capture';
import { startScripted, type Scripted } from './support/servers';

const { NextRequest } = await import('next/server');
const route = await import('@/app/api/v1/campaigns/[id]/artifacts/export/route');
const { exportFileName } = await import('@/client/exports');

const CREDENTIAL = 'configured-service-credential-0123456789';
const SESSION = 'sessionTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SITE = 'http://localhost:3000';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const A = '0190a0b0-0000-7000-8000-000000000900';
const B = '0190a0b0-0000-7000-8000-000000000901';
const DISPOSITION = "attachment; filename=\"Espada de Kael.pdf\"; filename*=UTF-8''Espada%20de%20Kael.pdf";

function request(query: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${SITE}/api/v1/campaigns/${CAMPAIGN}/artifacts/export?${query}`, {
    headers: { cookie: `__Host-gmshield-session=${SESSION}.4102444800`, ...headers },
  });
}

const params = (id: string = CAMPAIGN) => ({ params: Promise.resolve({ id }) });

/** The export route (Story 5.7 part A), as Next.js calls it: the relay of `GET …/artifacts/export`. */
describe('export route', () => {
  let backend: Scripted | undefined;
  beforeEach(() => {
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  });
  afterEach(async () => {
    await backend?.close();
    backend = undefined;
    vi.unstubAllEnvs();
  });

  it('runs on the Node runtime and is never cached', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
  });

  it('relays the ids, the format and the visitor\'s language, the session as X-Session-Token, and the file back as an attachment', async () => {
    backend = await startScripted({
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${A}%2C${B}&format=pdf&language=en`]: {
        status: 200,
        body: '%PDF-1.7',
        contentType: 'application/pdf',
        headers: { 'content-disposition': DISPOSITION, 'x-secret': 'never relayed' },
      },
    });
    vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
    const output = captureOutput();

    const answer = await route.GET(request(`ids=${A},${B}&format=pdf&other=x`, { 'accept-language': 'en-US,en;q=0.9' }), params());

    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('%PDF-1.7');
    expect(answer.headers.get('content-type')).toBe('application/pdf');
    expect(answer.headers.get('content-disposition')).toBe(DISPOSITION);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(answer.headers.get('x-secret')).toBeNull();
    const call = backend.calls[0]!;
    expect(call.url).toBe(`/api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${A}%2C${B}&format=pdf&language=en`);
    expect(call.headers['x-session-token']).toBe(SESSION);
    expect(call.headers.cookie).toBeUndefined();
    // No header of the browser's: its language goes only as the query's `language` (Node's fetch sends its own `*`).
    expect([undefined, '*']).toContain(call.headers['accept-language']);
    expect(call.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
    // The line names the count and the format, never the file or its name.
    const lines = output.lines();
    expect(lines).toContainEqual(expect.objectContaining({ event: 'export.relayed', backendStatus: 200, count: 2, format: 'pdf' }));
    expect(JSON.stringify(lines)).not.toContain('Kael');
  });

  it('takes the language cookie first, else pt-BR', async () => {
    backend = await startScripted({
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${A}&format=txt&language=pt-BR`]: { status: 200, body: 'texto', contentType: 'text/plain;charset=UTF-8' },
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${A}&format=jpg&language=en`]: { status: 200, body: 'jpeg', contentType: 'image/jpeg' },
    });
    vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
    captureOutput();

    const plain = await route.GET(request(`ids=${A}&format=txt`), params());
    const english = await route.GET(
      request(`ids=${A}&format=jpg`, { cookie: `__Host-gmshield-session=${SESSION}.4102444800; __Host-gmshield-lang=en`, 'accept-language': 'pt-BR' }),
      params(),
    );

    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-type')).toBe('text/plain;charset=UTF-8');
    expect(english.status).toBe(200);
    expect(english.headers.get('content-type')).toBe('image/jpeg');
  });

  it('relays a Markdown file and a zip of images with their types and names unchanged', async () => {
    const zipName = "attachment; filename=\"artefatos.zip\"; filename*=UTF-8''artefatos.zip";
    backend = await startScripted({
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${A}&format=markdown&language=pt-BR`]: {
        status: 200,
        body: '# Espada de Kael',
        contentType: 'text/markdown;charset=UTF-8',
        headers: { 'content-disposition': "attachment; filename=\"Espada de Kael.md\"; filename*=UTF-8''Espada%20de%20Kael.md" },
      },
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${A}%2C${B}&format=jpg&language=pt-BR`]: {
        status: 200,
        body: 'PK',
        contentType: 'application/zip',
        headers: { 'content-disposition': zipName },
      },
    });
    vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
    captureOutput();

    const markdown = await route.GET(request(`ids=${A}&format=markdown`), params());
    const zip = await route.GET(request(`ids=${A},${B}&format=jpg`), params());

    expect(markdown.status).toBe(200);
    expect(markdown.headers.get('content-type')).toBe('text/markdown;charset=UTF-8');
    expect(markdown.headers.get('content-disposition')).toContain('Espada%20de%20Kael.md');
    expect(await markdown.text()).toBe('# Espada de Kael');
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect(zip.headers.get('content-disposition')).toBe(zipName);
    expect(await zip.text()).toBe('PK');
  });

  it('a refusal comes back as its problem, with no file name; an unknown type as an octet stream', async () => {
    backend = await startScripted({
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${A}&format=pdf&language=pt-BR`]: {
        status: 404,
        body: JSON.stringify({ code: 'request.not_found' }),
        contentType: 'application/problem+json',
        headers: { 'content-disposition': DISPOSITION },
      },
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${B}&format=pdf&language=pt-BR`]: {
        status: 200,
        body: '<html>',
        contentType: 'text/html',
        headers: { 'content-disposition': 'inline; filename="x.html"' },
      },
    });
    vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
    captureOutput();

    const refused = await route.GET(request(`ids=${A}&format=pdf`), params());
    const odd = await route.GET(request(`ids=${B}&format=pdf`), params());

    expect(refused.status).toBe(404);
    expect(refused.headers.get('content-type')).toBe('application/problem+json');
    expect(refused.headers.get('content-disposition')).toBeNull();
    expect(odd.headers.get('content-type')).toBe('application/octet-stream');
    expect(odd.headers.get('content-disposition')).toBeNull();
  });

  it('never reaches the backend with a malformed campaign, id list, id or format', async () => {
    backend = await startScripted({});
    vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
    captureOutput();
    const many = Array.from({ length: 51 }, () => A).join(',');

    const notFound = await route.GET(request(`ids=${A}&format=pdf`), params('not-a-uuid'));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ code: 'request.not_found' });
    // A malformed id in a well-formed list is one that exists nowhere, as the backend answers it.
    for (const query of [`ids=${A},x&format=pdf`, `ids=x&format=jpg`]) {
      const answer = await route.GET(request(query), params());
      expect(answer.status, query).toBe(404);
      expect(await answer.json()).toMatchObject({ code: 'request.not_found' });
    }
    for (const query of [`format=pdf`, `ids=&format=pdf`, `ids=${A},&format=pdf`, `ids=${many}&format=pdf`, `ids=${A}&format=docx`, `ids=${A}`]) {
      const answer = await route.GET(request(query), params());
      expect(answer.status, query).toBe(400);
      expect(answer.headers.get('content-type')).toBe('application/problem+json');
      expect(answer.headers.get('cache-control')).toBe('no-store');
    }
    expect(backend.calls).toEqual([]);
  });

  it('answers 503 when the backend does not answer', async () => {
    vi.stubEnv('GMSHIELD_BACKEND_URL', 'http://127.0.0.1:1');
    const output = captureOutput();

    const answer = await route.GET(request(`ids=${A}&format=pdf`), params());

    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ code: 'server.unavailable' });
    expect(output.lines()).toContainEqual(expect.objectContaining({ event: 'export.backend_unreachable' }));
  });
});

describe('an exported file\'s name', () => {
  it('is the UTF-8 filename*, else the plain filename, else the fallback; never a path', () => {
    expect(exportFileName("attachment; filename=\"Cronica.pdf\"; filename*=UTF-8''Cr%C3%B4nica.pdf", 'x.pdf')).toBe('Crônica.pdf');
    expect(exportFileName('attachment; filename="artefatos.zip"', 'x.zip')).toBe('artefatos.zip');
    expect(exportFileName("attachment; filename*=UTF-8''%E0%A4%A.pdf", 'x.pdf')).toBe('x.pdf');
    expect(exportFileName("attachment; filename*=UTF-8''..%2F..%2Fetc%2Fpasswd", 'x.pdf')).toBe('passwd');
    expect(exportFileName(null, 'artefato.md')).toBe('artefato.md');
  });
});
