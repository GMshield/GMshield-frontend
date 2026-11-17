import { afterEach, describe, expect, it } from 'vitest';

import { answer, exampleOf, loadContract } from '../stand-in-backend/server.mjs';

import { CONTRACT_PATH, startStandIn, type Running } from './support/servers';

const contract = loadContract(CONTRACT_PATH);

describe('stand-in backend', () => {
  let running: Running | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it('reports the contract version', async () => {
    running = await startStandIn();
    const response = await fetch(`${running.url}/api/v1/version`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ version: contract.info.version });
  });

  it('answers every path of the contract with a valid example', () => {
    for (const [path, item] of Object.entries(contract.paths as Record<string, Record<string, unknown>>)) {
      for (const method of Object.keys(item).filter((key) => key !== 'parameters')) {
        const concrete = path.replace(/\{[^}]+\}/g, 'x');
        const result = answer(contract, method.toUpperCase(), concrete, 't');
        expect(result.status, `${method} ${path}`).toBeGreaterThanOrEqual(200);
        expect(result.status, `${method} ${path}`).toBeLessThan(300);
      }
    }
  });

  it('answers the sign-in and session paths (Story 1.9) with examples that complete a sign-in without Google', () => {
    const started = answer(contract, 'POST', '/api/v1/sign-in/google', 't');
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ authorizationUrl: expect.stringMatching(/^\/auth\/google\/callback\?/), expiresInSeconds: 600 });
    const outcome = answer(contract, 'POST', '/api/v1/sign-in/google/callback', 't');
    expect(outcome.body).toEqual({
      outcome: 'signed_in',
      session: { sessionToken: 'example-session-token', expiresInSeconds: 604800, renewAfterSeconds: 900 },
    });
    expect(answer(contract, 'POST', '/api/v1/sign-in/complete', 't').body).toMatchObject({ sessionToken: 'example-session-token' });
    // Story 1.10: the renewal answers the same example grant, so the proxy's renewal works in test mode.
    expect(answer(contract, 'POST', '/api/v1/session/renewal', 't').body).toEqual({
      sessionToken: 'example-session-token',
      expiresInSeconds: 604800,
      renewAfterSeconds: 900,
    });
    expect(answer(contract, 'GET', '/api/v1/me', 't').body).toEqual({ username: 'mestre_ana' });
    expect(answer(contract, 'DELETE', '/api/v1/session', 't')).toEqual({ status: 204, type: null, body: null });
  });

  it('answers the library paths (Story 1.11) with a starter system and campaign', () => {
    const system = { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Sistema sem nome' };
    const campaign = { id: '0190a0b0-0000-7000-8000-000000000002', name: 'Primeira campanha', system };
    expect(answer(contract, 'GET', '/api/v1/campaigns/current', 't')).toMatchObject({ status: 200, body: campaign });
    expect(answer(contract, 'GET', `/api/v1/campaigns/${campaign.id}`, 't')).toMatchObject({ status: 200, body: campaign });
    expect(answer(contract, 'GET', `/api/v1/systems/${system.id}`, 't')).toMatchObject({ status: 200, body: system });
  });

  it('answers the upload paths (Story 1.13) with their tus headers, and a part with the offset it reaches', async () => {
    const created = answer(contract, 'POST', '/api/v1/uploads', 't');
    expect(created.status).toBe(201);
    expect(created.headers).toMatchObject({ Location: expect.stringMatching(/^\/api\/v1\/uploads\/[0-9a-f-]{36}$/), 'Tus-Resumable': '1.0.0' });
    expect(answer(contract, 'HEAD', '/api/v1/uploads/x', 't').headers).toMatchObject({ 'Upload-Offset': expect.any(String), 'Tus-Resumable': '1.0.0' });
    expect(answer(contract, 'POST', '/api/v1/uploads/x/completion', 't')).toMatchObject({ status: 201, body: { state: 'waiting' } });

    running = await startStandIn();
    const location = (await fetch(`${running.url}/api/v1/uploads`, { method: 'POST' })).headers.get('location')!;
    const part = await fetch(`${running.url}${location}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '1000' },
      body: new Uint8Array(500),
    });
    expect(part.status).toBe(204);
    expect(part.headers.get('upload-offset')).toBe('1500');
    expect(part.headers.get('tus-resumable')).toBe('1.0.0');
    const head = await fetch(`${running.url}${location}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('upload-length')).toMatch(/^\d+$/);
  });

  it('answers any other path with a 404 problem detail', async () => {
    running = await startStandIn();
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const response = await fetch(`${running.url}/api/v1/nothing`, { headers: { traceparent } });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toEqual({
      type: 'urn:gmshield:problem:request.not_found',
      title: 'Not found',
      status: 404,
      category: 'request',
      code: 'request.not_found',
      params: {},
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });
  });

  it('answers a method the contract does not have with 405', async () => {
    running = await startStandIn();
    const response = await fetch(`${running.url}/api/v1/version`, { method: 'DELETE' });
    expect(response.status).toBe(405);
    expect((await response.json()).code).toBe('request.method_not_allowed');
  });

  it('builds examples from schemas', () => {
    const document = {
      components: {
        schemas: {
          Item: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              count: { type: 'integer', minimum: 1 },
              tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
              done: { type: 'boolean' },
              note: { type: ['string', 'null'] },
              named: { type: 'string', example: 'given' },
            },
          },
        },
      },
    };
    expect(exampleOf(document, { $ref: '#/components/schemas/Item' })).toEqual({
      id: '01890a5d-ac96-774b-bcce-b302099a8057',
      count: 1,
      tags: ['a'],
      done: false,
      note: 'example',
      named: 'given',
    });
    expect(exampleOf(document, { allOf: [{ type: 'object', properties: { a: { const: 1 } } }, { type: 'object', properties: { b: { type: 'number' } } }] })).toEqual({ a: 1, b: 0 });
    expect(exampleOf(document, { oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('example');
  });

  it('matches path templates', () => {
    const templated = { info: { version: '1.0.0' }, paths: { '/api/v1/items/{itemId}': { get: { responses: { '204': { description: 'gone' } } } } } };
    expect(answer(templated, 'GET', '/api/v1/items/abc', 't').status).toBe(204);
    expect(answer(templated, 'GET', '/api/v1/items/abc/more', 't').status).toBe(404);
  });
});
