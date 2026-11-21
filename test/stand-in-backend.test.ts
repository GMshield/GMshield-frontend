import { afterEach, describe, expect, it } from 'vitest';

import { ANSWER_DONE, REFERENCE_TEXT_PAGE, answer, exampleOf, loadContract } from '../stand-in-backend/server.mjs';

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

  it('answers the campaign paths (Story 3.2): the starter campaign listed, a new one, a change, a choice and its conversation', () => {
    const system = { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Sistema sem nome', edition: null };
    const campaign = { id: '0190a0b0-0000-7000-8000-000000000002', name: 'Primeira campanha' };
    expect(answer(contract, 'GET', '/api/v1/campaigns', 't')).toMatchObject({
      status: 200,
      body: { items: [{ ...campaign, system, archived: false }] },
    });
    expect(answer(contract, 'GET', `/api/v1/campaigns/${campaign.id}`, 't')).toMatchObject({
      status: 200,
      body: { ...campaign, archived: false, version: 0 },
    });
    expect(answer(contract, 'POST', '/api/v1/campaigns', 't')).toMatchObject({
      status: 201,
      body: { name: 'Mesa de quinta', system: { id: system.id }, archived: false, version: 0 },
    });
    expect(answer(contract, 'PATCH', `/api/v1/campaigns/${campaign.id}`, 't')).toMatchObject({ status: 200, body: { ...campaign, version: 1 } });
    expect(answer(contract, 'PUT', '/api/v1/campaigns/current', 't')).toMatchObject({ status: 200, body: { ...campaign, version: 0 } });
    expect(answer(contract, 'GET', `/api/v1/campaigns/${campaign.id}/conversation`, 't')).toMatchObject({
      status: 200,
      body: { id: '0190a0b0-0000-7000-8000-000000000020', questions: 1 },
    });
  });

  it('answers the systems paths (Story 3.1): the starter system in the list, its campaign, a new system and an edit', () => {
    const system = { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Sistema sem nome', edition: null, description: null, version: 0 };
    const campaign = { id: '0190a0b0-0000-7000-8000-000000000002', name: 'Primeira campanha' };
    expect(answer(contract, 'GET', '/api/v1/systems', 't')).toMatchObject({ status: 200, body: { items: [system] } });
    expect(answer(contract, 'GET', `/api/v1/systems/${system.id}`, 't')).toMatchObject({ status: 200, body: system });
    expect(answer(contract, 'GET', '/api/v1/campaigns/current', 't')).toMatchObject({ status: 200, body: { ...campaign, system } });
    expect(answer(contract, 'GET', '/api/v1/campaigns', 't')).toMatchObject({ status: 200, body: { items: [{ ...campaign, archived: false }] } });
    expect(answer(contract, 'POST', '/api/v1/systems', 't')).toMatchObject({
      status: 201,
      body: { name: 'D&D', edition: '5.2.1', version: 0 },
    });
    expect(answer(contract, 'PATCH', `/api/v1/systems/${system.id}`, 't')).toMatchObject({ status: 200, body: { ...system, version: 1 } });
    // Story 3.1 part B: what the starter system's deletion takes, and the delete itself (202, no body).
    expect(answer(contract, 'GET', `/api/v1/systems/${system.id}/deletion`, 't')).toMatchObject({
      status: 200,
      body: { campaigns: 1, conversations: 1, materials: 0 },
    });
    expect(answer(contract, 'DELETE', `/api/v1/systems/${system.id}`, 't')).toEqual({ status: 202, type: null, body: null });
    expect(answer(contract, 'PUT', `/api/v1/systems/${system.id}`, 't')).toMatchObject({ status: 405 });
    // Story 3.2 part B: what the starter campaign's deletion takes, and the delete itself (202, no body).
    expect(answer(contract, 'GET', `/api/v1/campaigns/${campaign.id}/deletion`, 't')).toMatchObject({
      status: 200,
      body: { conversations: 1, materials: 0 },
    });
    expect(answer(contract, 'DELETE', `/api/v1/campaigns/${campaign.id}`, 't')).toEqual({ status: 202, type: null, body: null });
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

  it('answers the materials paths (Story 1.14) with an empty tray and a material being processed', () => {
    expect(answer(contract, 'GET', '/api/v1/materials', 't')).toMatchObject({ status: 200, body: { items: [] } });
    expect(answer(contract, 'GET', '/api/v1/materials/0190a0b0-0000-7000-8000-000000000003', 't')).toMatchObject({
      status: 200,
      body: { id: '0190a0b0-0000-7000-8000-000000000003', name: 'Livro do Jogador.pdf', state: 'processing', pages: { done: 40, total: 444, text: { done: 40, total: 364 }, image: { done: 0, total: 80 }, readDirectly: 40, readByOcr: 0, unreadable: 0, reading: 'text' }, actions: [] },
    });
  });

  it('answers where a material belongs (Story 3.3): the starter campaign, and a change to its system at version 1', () => {
    const id = '0190a0b0-0000-7000-8000-000000000003';
    const campaign = { id: '0190a0b0-0000-7000-8000-000000000002', name: 'Primeira campanha', system: { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Sistema sem nome' } };
    expect(answer(contract, 'GET', `/api/v1/materials/${id}`, 't')).toMatchObject({
      status: 200,
      body: { version: 0, size: 134217728, belonging: { campaign, systems: [] } },
    });
    expect(answer(contract, 'PATCH', `/api/v1/materials/${id}`, 't')).toMatchObject({
      status: 200,
      body: { id, version: 1, belonging: { campaign: null, systems: [{ id: '0190a0b0-0000-7000-8000-000000000001', name: 'Sistema sem nome' }] } },
    });
    // Every other action's material carries a version and a place too, as the contract requires.
    for (const action of ['reprocess', 'retry', 'discard']) {
      const body = answer(contract, 'POST', `/api/v1/materials/${id}/${action}`, 't').body as { version?: unknown; belonging?: unknown };
      expect(typeof body.version, action).toBe('number');
      expect(body.belonging, action).toBeTruthy();
    }
  });

  it('answers the report and the actions (Story 1.20): an outline with its warnings, and a material for each action', () => {
    const id = '0190a0b0-0000-7000-8000-000000000003';
    expect(answer(contract, 'GET', `/api/v1/materials/${id}/report`, 't')).toMatchObject({
      status: 200,
      body: { outline: [{ level: 1, title: 'Equipment', page: 92 }, { level: 2 }], unreadable: [{ firstPage: 40, lastPage: 41 }] },
    });
    expect(answer(contract, 'POST', `/api/v1/materials/${id}/accept`, 't')).toMatchObject({ status: 200, body: { state: 'ready', actions: [] } });
    for (const action of ['reprocess', 'retry', 'discard']) {
      const answered = answer(contract, 'POST', `/api/v1/materials/${id}/${action}`, 't');
      expect(answered.status, action).toBe(200);
      expect(Array.isArray((answered.body as { actions?: unknown }).actions), action).toBe(true);
    }
    expect(answer(contract, 'GET', `/api/v1/materials/${id}/accept`, 't')).toMatchObject({ status: 405 });
  });

  it('answers a page (Story 1.19) as a picture page with lines, and its picture as a WebP', async () => {
    const id = '0190a0b0-0000-7000-8000-000000000003';
    expect(answer(contract, 'GET', `/api/v1/materials/${id}/pages/13`, 't')).toMatchObject({
      status: 200,
      type: 'application/json',
      body: { page: 13, pageTotal: 444, picture: { width: 1545, height: 2000 }, text: null, outcome: 'read_directly' },
    });
    running = await startStandIn();
    const picture = await fetch(`${running.url}/api/v1/materials/${id}/pages/13/picture?ground=review`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get('content-type')).toBe('image/webp');
    const bytes = Buffer.from(await picture.arrayBuffer());
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('answers the conversation paths (Story 2.4) with sources, a recorded question and a short streamed answer', async () => {
    expect(answer(contract, 'GET', '/api/v1/conversations/current', 't')).toMatchObject({
      status: 200,
      body: { campaignId: '0190a0b0-0000-7000-8000-000000000002', hasSources: true, indexing: null, indexingFailed: null },
    });
    expect(answer(contract, 'POST', '/api/v1/campaigns/0190a0b0-0000-7000-8000-000000000002/turns', 't')).toMatchObject({
      status: 201,
      body: { language: 'pt-BR' },
    });
    running = await startStandIn();
    const stream = await fetch(`${running.url}/api/v1/turns/0190a0b0-0000-7000-8000-000000000021/events`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    const text = await stream.text();
    expect(text).toContain('event:delta');
    // Story 2.5: done carries the references, as TurnDoneEvent says.
    const done = /event:done\ndata:(.*)$/.exec(text.trimEnd());
    expect(done).not.toBeNull();
    expect(JSON.parse(done![1]!)).toEqual(ANSWER_DONE);
    // Every key the contract requires of TurnDoneEvent and TurnSourceReference, with its declared JSON type.
    type Schema = { required?: string[]; properties?: Record<string, { type?: string }> };
    const schemas = (contract.components as { schemas: Record<string, Schema> }).schemas;
    const jsonType = (value: unknown) => (Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);
    const expectShape = (name: string, value: Record<string, unknown>) => {
      const schema = schemas[name]!;
      expect(schema.required?.length, name).toBeGreaterThan(0);
      for (const key of schema.required ?? []) {
        expect(value, `${name}.${key}`).toHaveProperty(key);
        expect(jsonType(value[key]), `${name}.${key}`).toBe(schema.properties?.[key]?.type);
      }
    };
    expectShape('TurnDoneEvent', ANSWER_DONE as unknown as Record<string, unknown>);
    // Story 2.7: a second reference, into a text page.
    expect(ANSWER_DONE.references).toHaveLength(2);
    for (const reference of ANSWER_DONE.references) {
      expectShape('TurnSourceReference', reference as Record<string, unknown>);
    }
    expect(ANSWER_DONE.silent).toBe(false);
    // Story 2.6: done says whether the GM stopped the answer, and the stop route answers 204.
    expect(ANSWER_DONE.stopped).toBe(false);
    const stopped = await fetch(`${running.url}/api/v1/turns/0190a0b0-0000-7000-8000-000000000021/stop`, { method: 'POST' });
    expect(stopped.status).toBe(204);
    expect(await stopped.text()).toBe('');
  });

  it('answers the reference pages (Story 2.7): reference 1 the picture page its passage is on, reference 2 a text page', async () => {
    const turn = '0190a0b0-0000-7000-8000-000000000021';
    const [first, second] = ANSWER_DONE.references;
    const picture = answer(contract, 'GET', `/api/v1/turns/${turn}/references/1/pages/13`, 't');
    expect(picture).toMatchObject({ status: 200, type: 'application/json', body: { page: 13, picture: { width: 1545, height: 2000 }, text: null } });
    const pictureBody = picture.body as { passages: { id: string; boxes: number[][] }[] };
    expect(pictureBody.passages.map((passage) => passage.id)).toEqual(first!.passageIds);
    const text = answer(contract, 'GET', `/api/v1/turns/${turn}/references/2/pages/2`, 't');
    expect(text).toMatchObject({ status: 200, body: { page: 2, picture: null, lines: [] } });
    expect(text.body).toEqual(REFERENCE_TEXT_PAGE);
    expect(REFERENCE_TEXT_PAGE.passages.map((passage) => passage.id)).toEqual(second!.passageIds);
    const [start, end] = REFERENCE_TEXT_PAGE.passages[0]!.range;
    expect(Array.from(REFERENCE_TEXT_PAGE.text).slice(start, end).join('')).toBe('Fire Bolt causa 1d10 de dano de fogo.');
    // Both shapes are MaterialPageView's, as the contract says.
    type Schema = { required?: string[] };
    const schema = (contract.components as { schemas: Record<string, Schema> }).schemas.MaterialPageView!;
    for (const key of schema.required ?? []) {
      expect(picture.body, key).toHaveProperty(key);
      expect(text.body, key).toHaveProperty(key);
    }
    running = await startStandIn();
    const bytes = await fetch(`${running.url}/api/v1/turns/${turn}/references/1/pages/13/picture`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toBe('image/webp');
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
