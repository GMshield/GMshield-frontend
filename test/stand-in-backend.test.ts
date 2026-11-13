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
