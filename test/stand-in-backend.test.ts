import { afterEach, describe, expect, it } from 'vitest';

import {
  ANSWER_DONE,
  ARTIFACT,
  ARTIFACT_PAGE,
  ARTIFACT_VERSIONS,
  BOOK_VERSION,
  CONVERSATION,
  CONVERSATION_ID,
  EDITED_ARTIFACT,
  STORED_DRAFT,
  STORED_TURN,
  NOTES_VERSION,
  RECORD,
  CORRECTED_RECORD,
  RECORD_ID,
  RECORD_PAGE,
  REFERENCE_TEXT_PAGE,
  SEARCH_DONE,
  SEARCH_ID,
  STARTING_SCOPE,
  answer,
  exampleOf,
  loadContract,
} from '../stand-in-backend/server.mjs';

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
      body: { id: '0190a0b0-0000-7000-8000-000000000020', questions: 2 },
    });
  });

  it("answers a campaign's scope (Story 3.6): the starting one with materials in every tier, and a change at version 1", () => {
    const campaign = '0190a0b0-0000-7000-8000-000000000002';
    const read = answer(contract, 'GET', `/api/v1/campaigns/${campaign}/scope`, 't');
    expect(read).toMatchObject({ status: 200, body: { version: 0, campaignTier: true, systemTier: true, otherTier: false, modelKnowledge: false } });
    expect(read.body).toBe(STARTING_SCOPE);
    // In tier order (campaign, system, other), each on, so a test-mode shell shows every tier's materials.
    expect(STARTING_SCOPE.materials.map((material) => material.tier)).toEqual(['campaign', 'campaign', 'system', 'other']);
    expect(STARTING_SCOPE.materials.every((material) => material.on)).toBe(true);
    expect(new Set(STARTING_SCOPE.materials.map((material) => material.id)).size).toBe(STARTING_SCOPE.materials.length);
    expect(answer(contract, 'PUT', `/api/v1/campaigns/${campaign}/scope`, 't')).toMatchObject({
      status: 200,
      body: { ...STARTING_SCOPE, version: 1 },
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
      body: { campaigns: 1, conversations: 1, materials: 0, artifacts: 3 },
    });
    expect(answer(contract, 'DELETE', `/api/v1/systems/${system.id}`, 't')).toEqual({ status: 202, type: null, body: null });
    expect(answer(contract, 'PUT', `/api/v1/systems/${system.id}`, 't')).toMatchObject({ status: 405 });
    // Story 3.2 part B: what the starter campaign's deletion takes, and the delete itself (202, no body).
    expect(answer(contract, 'GET', `/api/v1/campaigns/${campaign.id}/deletion`, 't')).toMatchObject({
      status: 200,
      body: { conversations: 1, materials: 0, artifacts: 3 },
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

  it('answers a material with no superseded version, its deletion count, and both deletes with 202 (Story 3.4 part B)', () => {
    const id = '0190a0b0-0000-7000-8000-000000000003';
    expect(answer(contract, 'GET', `/api/v1/materials/${id}`, 't')).toMatchObject({ status: 200, body: { superseded: [] } });
    expect(answer(contract, 'GET', `/api/v1/materials/${id}/deletion`, 't')).toMatchObject({
      status: 200,
      body: { versions: 1, pages: 444 },
    });
    expect(answer(contract, 'DELETE', `/api/v1/materials/${id}`, 't')).toEqual({ status: 202, type: null, body: null });
    expect(answer(contract, 'DELETE', `/api/v1/materials/${id}/versions/0190a0b0-0000-7000-8000-00000000000a`, 't')).toEqual({
      status: 202,
      type: null,
      body: null,
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

  it('answers a reprocess of a ready material (Story 3.4) as a new version waiting while the accepted one serves', () => {
    const id = '0190a0b0-0000-7000-8000-000000000003';
    expect(answer(contract, 'POST', `/api/v1/materials/${id}/reprocess`, 't')).toMatchObject({
      status: 200,
      body: { id, state: 'waiting', actions: [], serving: { pages: 444, size: 134217728 } },
    });
    expect(answer(contract, 'GET', `/api/v1/materials/${id}`, 't')).toMatchObject({ status: 200, body: { serving: null } });
    // Every material answer carries serving, as the contract requires.
    for (const [method, path] of [
      ['POST', 'accept'],
      ['POST', 'retry'],
      ['POST', 'discard'],
      ['PATCH', ''],
    ] as const) {
      const body = answer(contract, method, `/api/v1/materials/${id}${path === '' ? '' : `/${path}`}`, 't').body as Record<string, unknown>;
      expect('serving' in body, `${method} ${path}`).toBe(true);
    }
  });

  it('answers the report and the actions (Story 1.20): an outline with its warnings, and a material for each action', () => {
    const id = '0190a0b0-0000-7000-8000-000000000003';
    expect(answer(contract, 'GET', `/api/v1/materials/${id}/report`, 't')).toMatchObject({
      status: 200,
      body: { outline: [{ level: 1, title: 'Equipment', page: 92 }, { level: 2 }], unreadable: [{ firstPage: 40, lastPage: 41 }] },
    });
    // Story 4.2: its records by type, and the warning that some pages' records were unread.
    expect(answer(contract, 'GET', `/api/v1/materials/${id}/report`, 't')).toMatchObject({
      body: { records: [{ type: 'rule', count: 12 }, { type: 'spell', count: 30 }, { type: 'item', count: 4 }, { type: 'talento', count: 3 }] },
    });
    expect(answer(contract, 'POST', `/api/v1/materials/${id}/accept`, 't')).toMatchObject({ status: 200, body: { state: 'ready', actions: ['reprocess'] } });
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
    // Story 2.7: a second reference, into a text page; Story 4.3 part C: a third, a cited record with its fields;
    // Story 5.1 part B: a fourth, a cited artifact.
    expect(ANSWER_DONE.references).toHaveLength(4);
    for (const reference of ANSWER_DONE.references) {
      expectShape('TurnSourceReference', reference as Record<string, unknown>);
    }
    expect(ANSWER_DONE.references.map((reference) => reference.kind)).toEqual(['passage', 'passage', 'record', 'artifact']);
    const record = ANSWER_DONE.references[2]! as Record<string, unknown>;
    const properties = schemas.TurnSourceReference!.properties as Record<string, { type?: string; enum?: string[]; pattern?: string }>;
    for (const key of ['recordId', 'recordType', 'name', 'fields']) {
      expect(jsonType(record[key]), key).toBe(properties[key]?.type);
    }
    // Story 4.4 part B (contract 1.39.0): a record type is any key of the pattern, an approved type's too.
    expect(record.recordType).toMatch(new RegExp(properties.recordType?.pattern ?? '^$'));
    for (const field of record.fields as Record<string, unknown>[]) {
      expectShape('TurnReferenceField', field);
    }
    // The answer cites the record by its id, as TurnCitationEvent allows.
    const citations = [...text.matchAll(/event:citation\ndata:(.*)\n/g)].map((match) => JSON.parse(match[1]!) as Record<string, unknown>);
    expect(citations.filter((citation) => citation.recordId === record.recordId)).toHaveLength(1);
    expect(citations.every((citation) => (typeof citation.passageId === 'string') !== (typeof citation.recordId === 'string'))).toBe(true);
    // Story 3.7: a tier event opens each version, the campaign's first, and each reference carries its tier.
    const tierEnum = properties.tier?.enum;
    expect(ANSWER_DONE.references.map((reference) => reference.tier)).toEqual(['campaign', 'system', 'system', 'campaign']);
    // Story 5.1 part B (contract 1.43.0): the artifact's reference names its artifact and version, and no place; the
    // answer cites it by its id, as a record.
    const artifact = ANSWER_DONE.references[3]! as Record<string, unknown>;
    expect(properties.kind?.enum).toContain('artifact');
    for (const key of ['artifactId', 'artifactVersion', 'recordType', 'name', 'fields', 'removed']) {
      expect(jsonType(artifact[key]), key).toBe(properties[key]?.type);
    }
    for (const key of ['materialName', 'sectionPath', 'page', 'passageIds', 'recordId']) {
      expect(artifact, key).not.toHaveProperty(key);
    }
    expect(artifact.artifactId).toBe(ARTIFACT.id);
    expect(citations.filter((citation) => citation.recordId === artifact.artifactId)).toHaveLength(1);
    for (const reference of ANSWER_DONE.references) {
      expect(tierEnum).toContain(reference.tier);
    }
    const tiers = [...text.matchAll(/event:tier\ndata:(.*)\n/g)].map((match) => JSON.parse(match[1]!) as { tier: string; offset: number });
    expect(tiers.map((tier) => tier.tier)).toEqual(['campaign', 'system']);
    expect(tiers[0]!.offset).toBe(0);
    expectShape('TurnTierEvent', tiers[1]! as unknown as Record<string, unknown>);
    const deltas = [...text.matchAll(/event:delta\ndata:(.*)\n/g)].map((match) => (JSON.parse(match[1]!) as { text: string }).text).join('');
    expect(Array.from(deltas).slice(tiers[1]!.offset).join('')).toMatch(/^No livro/);
    expect(ANSWER_DONE.silent).toBe(false);
    // Story 2.6: done says whether the GM stopped the answer, and the stop route answers 204.
    expect(ANSWER_DONE.stopped).toBe(false);
    const stopped = await fetch(`${running.url}/api/v1/turns/0190a0b0-0000-7000-8000-000000000021/stop`, { method: 'POST' });
    expect(stopped.status).toBe(204);
    expect(await stopped.text()).toBe('');
  });

  it('answers the reference pages (Story 2.7): reference 2 the picture page its passage is on, reference 1 a text page', async () => {
    const turn = '0190a0b0-0000-7000-8000-000000000021';
    const [textReference, pictureReference] = ANSWER_DONE.references;
    const picture = answer(contract, 'GET', `/api/v1/turns/${turn}/references/2/pages/13`, 't');
    expect(picture).toMatchObject({ status: 200, type: 'application/json', body: { page: 13, picture: { width: 1545, height: 2000 }, text: null } });
    const pictureBody = picture.body as { passages: { id: string; boxes: number[][] }[] };
    expect(pictureBody.passages.map((passage) => passage.id)).toEqual(pictureReference!.passageIds);
    const text = answer(contract, 'GET', `/api/v1/turns/${turn}/references/1/pages/2`, 't');
    expect(text).toMatchObject({ status: 200, body: { page: 2, picture: null, lines: [] } });
    expect(text.body).toEqual(REFERENCE_TEXT_PAGE);
    expect(REFERENCE_TEXT_PAGE.passages.map((passage) => passage.id)).toEqual(textReference!.passageIds);
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
    const bytes = await fetch(`${running.url}/api/v1/turns/${turn}/references/2/pages/13/picture`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toBe('image/webp');
  });

  it('answers a search (Story 3.9): recorded with its id, done with a record, then a result in the campaign and one in the system, each page opening', async () => {
    const campaign = '0190a0b0-0000-7000-8000-000000000002';
    expect(answer(contract, 'POST', `/api/v1/campaigns/${campaign}/searches`, 't')).toMatchObject({ status: 202, body: { id: SEARCH_ID } });
    const read = answer(contract, 'GET', `/api/v1/searches/${SEARCH_ID}`, 't');
    expect(read).toMatchObject({ status: 200, body: SEARCH_DONE });
    expect(SEARCH_DONE.results.map((result) => result.tier)).toEqual(['system', 'campaign', 'system', 'system']);
    // Story 4.3 part B: the record named as the query leads, and opens from the campaign as its system shows it.
    expect(SEARCH_DONE.results.map((result) => result.kind)).toEqual(['record', 'passage', 'passage', 'record']);
    // Story 4.4 part B: a record of a type the GM approved names its key.
    expect(SEARCH_DONE.results[3]).toMatchObject({ kind: 'record', recordType: 'talento', name: 'Conjurador de Guerra' });
    expect(SEARCH_DONE.results[0]).toMatchObject({ recordId: RECORD_ID, name: RECORD.name, recordType: RECORD.recordType.core, versionId: BOOK_VERSION, page: 2 });
    // Its passage is one of its own version's, none of the notes' passages.
    expect(SEARCH_DONE.results[0]!.passageIds).toEqual(['0190a0b0-0000-7000-8000-000000000013']);
    expect(SEARCH_DONE.results.map((result) => result.passageId)).not.toContain('0190a0b0-0000-7000-8000-000000000013');
    expect(answer(contract, 'GET', `/api/v1/campaigns/${campaign}/records/${RECORD_ID}`, 't')).toMatchObject({ status: 200, body: RECORD });
    type Schema = { required?: string[] };
    const schemas = (contract.components as { schemas: Record<string, Schema> }).schemas;
    for (const key of schemas.Search!.required ?? []) {
      expect(SEARCH_DONE, key).toHaveProperty(key);
    }
    for (const key of schemas.SearchResult!.required ?? []) {
      for (const result of SEARCH_DONE.results) {
        expect(result, key).toHaveProperty(key);
      }
    }
    // A result's page, on the ground of the current scope: the notes' text page, the book's picture page.
    const notes = answer(contract, 'GET', `/api/v1/campaigns/${campaign}/sources/${NOTES_VERSION}/pages/2`, 't');
    expect(notes.body).toEqual(REFERENCE_TEXT_PAGE);
    expect(REFERENCE_TEXT_PAGE.passages.map((passage) => passage.id)).toEqual([SEARCH_DONE.results[1]!.passageId]);
    const book = answer(contract, 'GET', `/api/v1/campaigns/${campaign}/sources/${BOOK_VERSION}/pages/13`, 't');
    expect(book).toMatchObject({ status: 200, body: { page: 13, picture: { width: 1545, height: 2000 } } });
    expect((book.body as { passages: { id: string }[] }).passages.map((passage) => passage.id)).toEqual([SEARCH_DONE.results[2]!.passageId]);
    running = await startStandIn();
    const bytes = await fetch(`${running.url}/api/v1/campaigns/${campaign}/sources/${BOOK_VERSION}/pages/13/picture`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toBe('image/webp');
  });

  it('answers the conversations by area (Story 3.10): a list, one conversation, its stored turn, a rename and a delete', () => {
    const campaign = '0190a0b0-0000-7000-8000-000000000002';
    type Schema = { required?: string[] };
    const schemas = (contract.components as { schemas: Record<string, Schema> }).schemas;
    const listed = answer(contract, 'GET', `/api/v1/campaigns/${campaign}/conversations`, 't');
    expect(listed).toMatchObject({ status: 200, body: { total: 1, items: [{ id: CONVERSATION_ID, area: 'questions', questions: 2 }] } });
    for (const key of schemas.ConversationSummary!.required ?? []) {
      expect((listed.body as { items: unknown[] }).items[0], key).toHaveProperty(key);
    }
    expect(answer(contract, 'GET', `/api/v1/conversations/${CONVERSATION_ID}`, 't')).toMatchObject({ status: 200, body: CONVERSATION });
    expect(answer(contract, 'PATCH', `/api/v1/conversations/${CONVERSATION_ID}`, 't')).toMatchObject({
      status: 200,
      body: { id: CONVERSATION_ID, name: 'Viagem ao norte', version: 1 },
    });
    // Story 3.10 part B: what the conversation's deletion takes, and the delete itself (202, no body).
    expect(answer(contract, 'GET', `/api/v1/conversations/${CONVERSATION_ID}/deletion`, 't')).toMatchObject({
      status: 200,
      body: { questions: 2 },
    });
    expect(answer(contract, 'DELETE', `/api/v1/conversations/${CONVERSATION_ID}`, 't')).toEqual({ status: 202, type: null, body: null });
    const turns = answer(contract, 'GET', `/api/v1/conversations/${CONVERSATION_ID}/turns`, 't');
    expect(turns).toMatchObject({ status: 200, body: { items: [STORED_TURN, STORED_DRAFT] } });
    for (const key of schemas.StoredTurn!.required ?? []) {
      expect(STORED_TURN, key).toHaveProperty(key);
      expect(STORED_DRAFT, key).toHaveProperty(key);
    }
    // Story 5.3 part A: the answered question and a cited draft, each with its kind, as the contract allows.
    expect(schemas.StoredTurn!.required).toContain('kind');
    expect(STORED_TURN.kind).toBe('question');
    expect(STORED_DRAFT.kind).toBe('draft');
    expect(STORED_DRAFT.events.map((event) => event.type)).toEqual(['delta', 'citation', 'done']);
    expect(STORED_DRAFT.events[0]).toMatchObject({ type: 'delta', data: { text: expect.stringMatching(/^## /) } });
    // The stored events are the streamed answer's, by sequence, ending with its done.
    expect(STORED_TURN.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(STORED_TURN.events.at(-1)).toEqual({ sequence: 10, type: 'done', data: ANSWER_DONE });
  });

  it('answers a record type\'s records, a record and its version\'s pages (Story 4.3)', async () => {
    const system = '0190a0b0-0000-7000-8000-000000000001';
    const spell = '0190a0b0-0000-7000-8000-000000000601';
    type Schema = { required?: string[] };
    const schemas = (contract.components as { schemas: Record<string, Schema> }).schemas;
    const listed = answer(contract, 'GET', `/api/v1/record-types/${spell}/records`, 't');
    expect(listed).toMatchObject({ status: 200, body: RECORD_PAGE });
    for (const key of schemas.RecordSummary!.required ?? []) {
      expect(RECORD_PAGE.items[0], key).toHaveProperty(key);
    }
    const read = answer(contract, 'GET', `/api/v1/systems/${system}/records/${RECORD_ID}`, 't');
    expect(read).toMatchObject({ status: 200, body: RECORD });
    for (const key of schemas.Record!.required ?? []) {
      expect(RECORD, key).toHaveProperty(key);
    }
    for (const key of schemas.RecordReference!.required ?? []) {
      expect(RECORD.references[0], key).toHaveProperty(key);
    }
    expect(RECORD.recordType.id).toBe(spell);
    const page = answer(contract, 'GET', `/api/v1/systems/${system}/records/${RECORD_ID}/pages/2`, 't');
    expect(page).toMatchObject({ status: 200, body: REFERENCE_TEXT_PAGE });
    // The first reference's page holds the record's passage it names, so the source view marks it.
    expect(RECORD.references[0]!.page).toBe(REFERENCE_TEXT_PAGE.page);
    expect(REFERENCE_TEXT_PAGE.passages.map((passage) => passage.id)).toEqual(RECORD.references[0]!.passageIds);
    for (const reference of RECORD.references) {
      expect(reference.passageIds.length).toBeGreaterThan(0);
    }
    running = await startStandIn();
    const bytes = await fetch(`${running.url}/api/v1/systems/${system}/records/${RECORD_ID}/pages/2/picture`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toBe('image/webp');
  });

  it('answers a record\'s correction on both pages with the record as stored, its version raised (Story 4.5)', () => {
    const system = '0190a0b0-0000-7000-8000-000000000001';
    const campaign = '0190a0b0-0000-7000-8000-000000000002';
    type Schema = { required?: string[] };
    const schemas = (contract.components as { schemas: Record<string, Schema> }).schemas;
    expect(schemas.Record!.required).toContain('version');
    expect(RECORD.version).toBe(0);
    for (const path of [`/api/v1/systems/${system}/records/${RECORD_ID}`, `/api/v1/campaigns/${campaign}/records/${RECORD_ID}`]) {
      const corrected = answer(contract, 'PATCH', path, 't');
      expect(corrected).toMatchObject({ status: 200, body: CORRECTED_RECORD });
    }
    for (const key of schemas.Record!.required ?? []) {
      expect(CORRECTED_RECORD, key).toHaveProperty(key);
    }
    expect(CORRECTED_RECORD).toMatchObject({ id: RECORD.id, version: 1, references: RECORD.references });
    expect(schemas.RecordCorrection!.required).toEqual(['fields', 'name', 'recordType', 'version']);
  });

  it('answers a record\'s delete on both pages with 204 and no body (Story 4.5 part B)', () => {
    const system = '0190a0b0-0000-7000-8000-000000000001';
    const campaign = '0190a0b0-0000-7000-8000-000000000002';
    for (const path of [`/api/v1/systems/${system}/records/${RECORD_ID}`, `/api/v1/campaigns/${campaign}/records/${RECORD_ID}`]) {
      expect(answer(contract, 'DELETE', path, 't')).toMatchObject({ status: 204, type: null, body: null });
    }
  });

  it('answers an artifact\'s edit, its versions, one version and a restore (Story 5.2)', () => {
    const campaign = '0190a0b0-0000-7000-8000-000000000002';
    type Schema = { required?: string[] };
    const schemas = (contract.components as { schemas: Record<string, Schema> }).schemas;
    const artifact = `/api/v1/campaigns/${campaign}/artifacts/${ARTIFACT.id}`;
    expect(answer(contract, 'PATCH', artifact, 't')).toMatchObject({ status: 200, body: EDITED_ARTIFACT });
    expect(answer(contract, 'GET', `${artifact}/versions`, 't')).toMatchObject({ status: 200, body: ARTIFACT_VERSIONS });
    expect(answer(contract, 'GET', `${artifact}/versions/1`, 't')).toMatchObject({ status: 200, body: ARTIFACT });
    expect(answer(contract, 'POST', `${artifact}/versions/1/restore`, 't')).toMatchObject({ status: 200, body: EDITED_ARTIFACT });
    for (const key of schemas.Artifact!.required ?? []) {
      expect(EDITED_ARTIFACT, key).toHaveProperty(key);
    }
    for (const key of schemas.ArtifactVersionPage!.required ?? []) {
      expect(ARTIFACT_VERSIONS, key).toHaveProperty(key);
    }
    for (const item of ARTIFACT_VERSIONS.items) {
      for (const key of schemas.ArtifactVersionSummary!.required ?? []) {
        expect(item, key).toHaveProperty(key);
      }
    }
  });

  it('answers an artifact\'s delete with 202 and no body (Story 5.2 part B)', () => {
    const campaign = '0190a0b0-0000-7000-8000-000000000002';
    expect(answer(contract, 'DELETE', `/api/v1/campaigns/${campaign}/artifacts/${ARTIFACT.id}`, 't')).toEqual({
      status: 202,
      type: null,
      body: null,
    });
  });

  it('answers a campaign\'s artifacts, one artifact and a new one (Story 5.1)', () => {
    const campaign = '0190a0b0-0000-7000-8000-000000000002';
    type Schema = { required?: string[] };
    const schemas = (contract.components as { schemas: Record<string, Schema> }).schemas;
    expect(answer(contract, 'GET', `/api/v1/campaigns/${campaign}/artifacts`, 't')).toMatchObject({ status: 200, body: ARTIFACT_PAGE });
    expect(answer(contract, 'GET', `/api/v1/campaigns/${campaign}/artifacts/${ARTIFACT.id}`, 't')).toMatchObject({ status: 200, body: ARTIFACT });
    expect(answer(contract, 'POST', `/api/v1/campaigns/${campaign}/artifacts`, 't')).toMatchObject({ status: 201, body: ARTIFACT });
    for (const key of schemas.Artifact!.required ?? []) {
      expect(ARTIFACT, key).toHaveProperty(key);
    }
    for (const key of schemas.ArtifactPage!.required ?? []) {
      expect(ARTIFACT_PAGE, key).toHaveProperty(key);
    }
    for (const item of ARTIFACT_PAGE.items) {
      for (const key of schemas.ArtifactSummary!.required ?? []) {
        expect(item, key).toHaveProperty(key);
      }
    }
    // The types in use count the rows, as the backend counts them.
    expect(ARTIFACT_PAGE.types.reduce((sum, type) => sum + type.count, 0)).toBe(ARTIFACT_PAGE.total);
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
