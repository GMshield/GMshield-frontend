// The stand-in backend: a tiny server, with nothing beyond Node, that answers every path of
// contracts/public.json with a valid example and every other path with a 404 problem detail.
// GET /api/v1/version reports the contract's info.version. The frontend uses it in
// GMSHIELD_MODE=test, where the real backend is not there (Dockerfile stage `stand-in-backend`).
// An answer also carries the example of each header its response declares (the tus upload headers of
// Story 1.13: Location, Upload-Offset, Tus-Resumable...); a tus part (PATCH /api/v1/uploads/{id}) is read
// to its end and answers the offset it would reach.
// A few answers are set in EXAMPLES instead (Story 1.14): the materials list is empty, so the tray of a test-mode
// shell stays still, and a material reads as one being processed, its pages known (Story 1.15). A page reads as a
// picture page with two lines (Story 1.19), and a binary answer (a page's picture, image/webp) is a 1 x 1 WebP. An
// image set (Story 1.21) is created with two images, and leaving one out answers it waiting. Story 2.4: the current
// conversation has sources (all indexed: no indexing count), a question is recorded in Portuguese, and a turn's events
// (text/event-stream) are a short cited answer and `done`. Story 2.7: the page of reference 1 is the picture page whose
// passage it cites, and the page of reference 2 a text page with the cited passage's range. Story 3.1: the systems list
// holds the starter system (no edition, no description, version 0), whose one campaign is the current campaign; a new
// system is "D&D" 5.2.1, and an edit answers the starter system at version 1. Story 3.1 part B: the starter system's
// deletion takes its one campaign, its one conversation and no material; a delete answers 202 with no body. Story 3.2:
// the starter campaign (in use, version 0) is the only campaign, with its system; a new campaign is "Mesa de quinta" of
// the starter system; a rename, archive or restore answers the starter campaign at version 1, a choice the starter
// campaign, and its conversation holds one question. Story 3.2 part B: the starter campaign's deletion takes its one
// conversation and no material; a delete answers 202 with no body. Story 3.3: a material belongs to the starter
// campaign (version 0, 134 MB), and a change of where it belongs answers it in the starter system at version 1.
// Story 3.4: a material has no other version serving; once accepted (or moved) it is ready and may be reprocessed, and a
// reprocess answers a new version waiting while the accepted one, its 444 pages, keeps serving. Story 3.4 part B: a
// material has no superseded version (`superseded: []`); its deletion takes its one version and its 444 pages, and a
// delete of it, or of one of its versions, answers 202 with no body. Story 3.6: a campaign's scope is the starting one
// (campaign and system on, other and model knowledge off, version 0) with two campaign materials, one of the system and
// one of another campaign, all on; a change answers the same settings at version 1. Story 3.9: a search is recorded
// (202 with its id) and reads as done with two results, a passage of the campaign's notes (a text page) then one of
// the book (a picture page); a page of the current scope is the notes' text page for the notes' version and the book's
// picture page for any other. Story 3.10: the starter campaign has one conversation (whatever area is listed), the
// questions one every question continues; it holds one answered turn, its stored events the stand-in answer's; a
// rename answers it at version 1 under the new name. Story 3.10 part B: its deletion takes its one question, and a
// delete of it answers 202 with no body. Story 3.12: its stored turn is not saved (`bookmarked: false`), a bookmark and
// its removal answer 204 (as the contract declares), and the saved answers are two: the stored turn's answer in the
// starter campaign and one in another campaign ("A Coroa Partida"). Story 4.1: every system has the eight core record
// types, in their fixed order, none with records yet; one of them reads as the rule type. Story 5.1: the starter campaign
// has three artifacts (two character sheets and an item), and a new artifact answers as stored, version 1. Story 5.2:
// an edit or a restore answers version 2, and an artifact's versions are its one version 1. Story 5.2 part B: an
// artifact's delete answers 202 with no body, as the contract declares. Story 5.3 part A: a question is recorded
// whatever its kind (the body is never read), and the conversation holds two turns: the answered question
// (`kind: question`) and a cited draft (`kind: draft`), so it counts two questions. Story 5.4 part A: the draft's done
// carries its proposal ("Emboscada na Cripta", an encounter) and its stored turn is offered for saving
// (`saving: offered`); a save answers 201 with the draft saved as an artifact of the conversation (its content the
// draft's text, its one reference copied), "Agora não" and "Salvar como artefato" answer 204, and an artifact written by
// hand has no conversation and no references. Story 5.4 part B: the conversation's deletion lists one saved artifact
// (the stored draft as a save answers it; from Story 5.6 part B shared with another campaign), and its deletion with the
// ticked artifacts (POST .../deletion) answers 202 with no body.
// Story 5.5 part A: an artifact overrides no record (`overrides: null`); a mark (PUT .../override) answers it overriding
// the stand-in record "Fire Bolt", its removal (DELETE) answers 204, and the records it can override are that one record.
// Story 5.5 part B: an artifact is related to nothing (`related: []`); a relation (POST .../relations) answers it related
// to "Fire Bolt", its removal (DELETE .../relations/{recordId}) answers 204, the records it can be related to are that
// one record, and the campaign's read of a record lists the stand-in artifact as related to it. Story 5.6 part A: an
// artifact is shared with no campaign (`sharedWith: []`, `sharedFrom: null`); a sharing (PUT .../sharing) answers it
// shared with "Mesa de quinta"; and an artifact read under any campaign but the starter one (and a version of it) reads
// as shared from the starter campaign, read-only. Story 5.6 part B: the starter campaign's artifacts list also holds
// "Escudo de Lyra", an item of "Mesa de quinta" shared into it (`sharedFrom`), which reads there as shared from "Mesa de
// quinta"; and the conversation's deletion lists one saved artifact, shared with another campaign (`shared: true`).
// Story 5.7 part A: an export (GET .../artifacts/export?ids=...&format=...) answers a small file of its format, named
// after the stand-in artifact for one id and "artefatos" ("artifacts" with language=en) for several, as an attachment:
// a one-page PDF, the artifact as text or Markdown, an 8 x 8 JPEG, or for several JPG ids a zip of one JPEG each; an
// unknown format is request.invalid. Without a query it answers the PDF of one artifact.
// Story 6.1 part A: the starter campaign has two Shields, its first one unnamed (`name: null`) and "Combate"; a new
// Shield answers "Combate", one Shield reads as the unnamed first one, and a rename answers it as "Exploração", version 1.
// Story 6.1 part B: a Shield's deletion preview names no rolls and that it is not the campaign's last, and its deletion
// answers with no body, as declared (202 from Story 6.2 part B, contract 1.58.0). Story 6.2 part A: every artifact names
// no Shield (`shieldId: null`) but the first Shield's one note, "Pistas da cripta", which its list holds, a new note
// answers and its artifact page reads. Story 6.2 part B: the preview names that one note, and a note's move (PUT
// .../artifacts/{artifactId}/shield) answers it held by "Combate". Story 6.4 part A: a Shield's log holds one stored roll,
// "2d6+3" labelled "Iniciativa", which the preview counts; a roll sent answers that roll stored now (201), and a clear
// answers 204. Story 6.4 part B (contract 1.60.0): the account (GET /api/v1/me) carries the contract's example id.
//
//   node stand-in-backend/server.mjs        PORT (default 8080), STAND_IN_CONTRACT (default ../contracts/public.json)
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const PROBLEM_TYPE = 'application/problem+json';
const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}/;
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function loadContract(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function resolve(contract, schema) {
  let current = schema;
  for (let depth = 0; current && typeof current.$ref === 'string' && depth < 32; depth++) {
    const path = current.$ref.replace(/^#\//, '').split('/');
    current = path.reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], contract);
  }
  return current ?? {};
}

/** A value that matches the schema: its example when it has one, otherwise one built from its type. */
export function exampleOf(contract, schema, depth = 0) {
  const resolved = resolve(contract, schema);
  if (depth > 16) {
    return null;
  }
  if (resolved.example !== undefined) {
    return resolved.example;
  }
  if (Array.isArray(resolved.examples) && resolved.examples.length > 0) {
    return resolved.examples[0];
  }
  if (resolved.const !== undefined) {
    return resolved.const;
  }
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }
  const variants = resolved.allOf ?? resolved.oneOf ?? resolved.anyOf;
  if (Array.isArray(variants) && variants.length > 0) {
    if (resolved.allOf) {
      return Object.assign({}, ...variants.map((part) => exampleOf(contract, part, depth + 1)));
    }
    return exampleOf(contract, variants[0], depth + 1);
  }
  const type = Array.isArray(resolved.type) ? resolved.type.find((t) => t !== 'null') : resolved.type;
  switch (type ?? (resolved.properties ? 'object' : undefined)) {
    case 'object':
      return Object.fromEntries(
        Object.entries(resolved.properties ?? {}).map(([name, property]) => [name, exampleOf(contract, property, depth + 1)]),
      );
    case 'array':
      return [exampleOf(contract, resolved.items ?? {}, depth + 1)];
    case 'string':
      return stringExample(resolved.format);
    case 'integer':
    case 'number':
      return resolved.minimum ?? 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function stringExample(format) {
  switch (format) {
    case 'uuid':
      return '01890a5d-ac96-774b-bcce-b302099a8057';
    case 'date-time':
      return '2026-01-01T00:00:00Z';
    case 'date':
      return '2026-01-01';
    case 'uri':
      return 'https://example.invalid/';
    case 'email':
      return 'gm@example.invalid';
    default:
      return 'example';
  }
}

function escapeForPattern(text) {
  return text.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

/** `/a/{id}/b` -> /^\/a\/[^/]+\/b$/, scanned by hand: no regular expression that can backtrack. */
function templateToPattern(template) {
  let pattern = '';
  let rest = template;
  for (;;) {
    const open = rest.indexOf('{');
    const close = open === -1 ? -1 : rest.indexOf('}', open + 1);
    if (close <= open + 1) {
      pattern += escapeForPattern(rest);
      break;
    }
    pattern += `${escapeForPattern(rest.slice(0, open))}[^/]+`;
    rest = rest.slice(close + 1);
  }
  return new RegExp(`^${pattern}$`);
}

/** Story 3.1: the starter system of a first sign-in, as the backend answers it, and its one campaign. */
export const STARTER_SYSTEM = {
  id: '0190a0b0-0000-7000-8000-000000000001',
  name: 'Sistema sem nome',
  edition: null,
  description: null,
  version: 0,
};
const STARTER_CAMPAIGN = { id: '0190a0b0-0000-7000-8000-000000000002', name: 'Primeira campanha' };
/** Story 3.2: the starter campaign as a list row (its system's name and edition) and as one campaign (with its version). */
const STARTER_ROW = { ...STARTER_CAMPAIGN, system: { id: STARTER_SYSTEM.id, name: STARTER_SYSTEM.name, edition: null }, archived: false };
const STARTER = { ...STARTER_CAMPAIGN, system: STARTER_SYSTEM, archived: false, version: 0 };
/** Story 3.3: where the example material belongs, the starter campaign, and the same material moved to its system. */
const IN_STARTER_CAMPAIGN = { campaign: { ...STARTER_CAMPAIGN, system: { id: STARTER_SYSTEM.id, name: STARTER_SYSTEM.name } }, systems: [] };
const IN_STARTER_SYSTEM = { campaign: null, systems: [{ id: STARTER_SYSTEM.id, name: STARTER_SYSTEM.name }] };

/** Story 3.6: the starting scope of a campaign, with a few materials in each tier (newest first within a tier). */
export const STARTING_SCOPE = {
  version: 0,
  campaignTier: true,
  systemTier: true,
  otherTier: false,
  modelKnowledge: false,
  materials: [
    { id: '0190a0b0-0000-7000-8000-000000000060', name: 'Notas da campanha.md', tier: 'campaign', on: true },
    { id: '0190a0b0-0000-7000-8000-000000000003', name: 'Livro do Jogador.pdf', tier: 'campaign', on: true },
    { id: '0190a0b0-0000-7000-8000-000000000061', name: 'Guia do Mestre.pdf', tier: 'system', on: true },
    { id: '0190a0b0-0000-7000-8000-000000000062', name: 'Bestiário de outra mesa.pdf', tier: 'other', on: true },
  ],
};

/**
 * Story 3.9: the versions of the two materials a search finds, and the search, done with a result in each. Story 4.3
 * part B: no record-type filter, and the record named as the query (the record `RECORD`, "Fire Bolt", a spell of the
 * book) leads, before the two passages.
 */
export const NOTES_VERSION = '0190a0b0-0000-7000-8000-000000000070';
export const BOOK_VERSION = '0190a0b0-0000-7000-8000-000000000071';
export const SEARCH_ID = '0190a0b0-0000-7000-8000-000000000072';
export const SEARCH_DONE = {
  id: SEARCH_ID,
  campaignId: STARTER_CAMPAIGN.id,
  query: 'Fire Bolt',
  tier: null,
  materialId: null,
  recordType: null,
  state: 'done',
  results: [
    {
      kind: 'record',
      recordId: '0190a0b0-0000-7000-8000-000000000700',
      versionId: BOOK_VERSION,
      materialName: 'Livro do Jogador.pdf',
      sectionPath: ['Magias', 'Fire Bolt'],
      page: 2,
      name: 'Fire Bolt',
      recordType: 'spell',
      // A passage of the book's page 2, its own version's.
      passageIds: ['0190a0b0-0000-7000-8000-000000000013'],
      tier: 'system',
    },
    {
      kind: 'passage',
      passageId: '0190a0b0-0000-7000-8000-000000000010',
      versionId: NOTES_VERSION,
      materialName: 'Notas da campanha.md',
      sectionPath: ['Magias'],
      page: 2,
      firstWords: 'Fire Bolt causa 1d10 de dano de fogo.',
      tier: 'campaign',
    },
    {
      kind: 'passage',
      passageId: '0190a0b0-0000-7000-8000-000000000009',
      versionId: BOOK_VERSION,
      materialName: 'Livro do Jogador.pdf',
      sectionPath: ['Spells', 'Fire Bolt'],
      page: 13,
      firstWords: 'Fire Bolt. Evocation cantrip. You hurl a mote of fire at a creature or an object within range.',
      tier: 'system',
    },
    // Story 4.4 part B: a record of a type the GM approved in the starter system ("Talento", key `talento`).
    {
      kind: 'record',
      recordId: '0190a0b0-0000-7000-8000-000000000703',
      versionId: BOOK_VERSION,
      materialName: 'Livro do Jogador.pdf',
      sectionPath: ['Talentos'],
      page: 168,
      name: 'Conjurador de Guerra',
      recordType: 'talento',
      passageIds: ['0190a0b0-0000-7000-8000-000000000014'],
      tier: 'system',
    },
  ],
};

/** Story 3.10: the starter campaign's questions conversation, the one the stand-in's turns belong to. */
export const CONVERSATION_ID = '0190a0b0-0000-7000-8000-000000000020';
export const CONVERSATION = {
  id: CONVERSATION_ID,
  campaignId: '0190a0b0-0000-7000-8000-000000000002',
  area: 'questions',
  name: 'Quanto dano causa Fire Bolt?',
  version: 0,
};

/** Answers chosen here rather than built from the contract's schemas, by `METHOD template`. */
export const EXAMPLES = {
  'GET /api/v1/campaigns/current': STARTER,
  'PUT /api/v1/campaigns/current': STARTER,
  'GET /api/v1/campaigns/{id}': STARTER,
  'PATCH /api/v1/campaigns/{id}': { ...STARTER, version: 1 },
  'GET /api/v1/campaigns': { items: [STARTER_ROW], total: 1 },
  'POST /api/v1/campaigns': {
    id: '0190a0b0-0000-7000-8000-000000000040',
    name: 'Mesa de quinta',
    system: STARTER_SYSTEM,
    archived: false,
    version: 0,
  },
  'GET /api/v1/campaigns/{campaignId}/conversation': { id: '0190a0b0-0000-7000-8000-000000000020', questions: 2 },
  // Story 3.10: one conversation, whatever area is asked (the stand-in reads no query).
  'GET /api/v1/campaigns/{campaignId}/conversations': {
    items: [
      {
        id: CONVERSATION_ID,
        area: 'questions',
        name: CONVERSATION.name,
        questions: 2,
        createdAt: '2026-11-22T12:00:00Z',
        lastAskedAt: '2026-11-22T12:02:00Z',
        version: 0,
      },
    ],
    total: 1,
  },
  'GET /api/v1/conversations/{conversationId}': CONVERSATION,
  'PATCH /api/v1/conversations/{conversationId}': { ...CONVERSATION, name: 'Viagem ao norte', version: 1 },
  // Story 5.4 part B: its deletion lists the artifacts saved from it; Story 5.6 part B: one, shared with another
  // campaign (the stored draft, as a save answers it).
  'GET /api/v1/conversations/{conversationId}/deletion': {
    questions: 2,
    artifacts: [{ id: '0190a0b0-0000-7000-8000-000000000903', name: 'Emboscada na Cripta', recordType: 'encounter', overrides: false, shared: true }],
  },
  // Story 5.1: the starter campaign's three artifacts go with it.
  'GET /api/v1/campaigns/{id}/deletion': { conversations: 1, materials: 0, artifacts: 3 },
  'GET /api/v1/campaigns/{id}/scope': STARTING_SCOPE,
  'PUT /api/v1/campaigns/{id}/scope': { ...STARTING_SCOPE, version: 1 },
  'GET /api/v1/systems': { items: [STARTER_SYSTEM], total: 1 },
  'GET /api/v1/systems/{id}': STARTER_SYSTEM,
  'POST /api/v1/systems': {
    id: '0190a0b0-0000-7000-8000-000000000030',
    name: 'D&D',
    edition: '5.2.1',
    description: 'As regras básicas, sem suplementos.',
    version: 0,
  },
  'PATCH /api/v1/systems/{id}': { ...STARTER_SYSTEM, version: 1 },
  'GET /api/v1/systems/{id}/deletion': { campaigns: 1, conversations: 1, materials: 0, artifacts: 3 },
  'GET /api/v1/materials': { items: [], total: 0 },
  'GET /api/v1/materials/{id}': {
    id: '0190a0b0-0000-7000-8000-000000000003',
    name: 'Livro do Jogador.pdf',
    state: 'processing',
    kind: 'rulebook',
    // Story 1.17: a mixed book whose text pages are being read, its scanned pages waiting for OCR.
    pages: { done: 40, total: 444, text: { done: 40, total: 364 }, image: { done: 0, total: 80 }, readDirectly: 40, readByOcr: 0, unreadable: 0, reading: 'text' },
    // Story 1.20: a processing material allows no action.
    actions: [],
    // Story 3.3: its version, size and place.
    version: 0,
    size: 134217728,
    belonging: IN_STARTER_CAMPAIGN,
    // Story 3.4: no other version serves beside it.
    serving: null,
    // Story 3.4 part B: and none was superseded.
    superseded: [],
  },
  // Story 3.4 part B: what the material's deletion takes.
  'GET /api/v1/materials/{id}/deletion': { versions: 1, pages: 444 },
  // Story 1.20: the report of a book under review, and the book once accepted.
  'GET /api/v1/materials/{id}/report': {
    outline: [
      { level: 1, title: 'Equipment', page: 92 },
      { level: 2, title: 'Armor', page: 93 },
    ],
    unreadable: [{ firstPage: 40, lastPage: 41 }],
    warnings: [
      { code: 'report.pages_unreadable', count: 2 },
      { code: 'report.pages_unopened', count: 1 },
      // Story 4.2: the records of pages 31 to 40 could not be read.
      { code: 'report.records_unread', count: 10 },
    ],
    // Story 4.2: the records found by type.
    records: [
      { type: 'rule', count: 12 },
      { type: 'spell', count: 30 },
      { type: 'item', count: 4 },
      // Story 4.4 part B: a type the GM approved, after the core types.
      { type: 'talento', count: 3 },
    ],
  },
  'POST /api/v1/materials/{id}/accept': {
    id: '0190a0b0-0000-7000-8000-000000000003',
    name: 'Livro do Jogador.pdf',
    state: 'ready',
    kind: 'rulebook',
    pages: { done: 444, total: 444, text: { done: 364, total: 364 }, image: { done: 80, total: 80 }, readDirectly: 364, readByOcr: 78, unreadable: 2, reading: null },
    // Story 3.4: a ready material may be reprocessed (and replaced).
    actions: ['reprocess'],
    version: 0,
    size: 134217728,
    belonging: IN_STARTER_CAMPAIGN,
    serving: null,
    superseded: [],
  },
  // Story 3.4: the book reprocessed from its stored original: a new version waits, and the accepted one keeps serving.
  'POST /api/v1/materials/{id}/reprocess': {
    id: '0190a0b0-0000-7000-8000-000000000003',
    name: 'Livro do Jogador.pdf',
    state: 'waiting',
    kind: 'rulebook',
    pages: { done: 0, total: 444, text: { done: 0, total: 0 }, image: { done: 0, total: 0 }, readDirectly: 0, readByOcr: 0, unreadable: 0, reading: null },
    actions: [],
    version: 0,
    size: 134217728,
    belonging: IN_STARTER_CAMPAIGN,
    serving: { pages: 444, size: 134217728 },
    superseded: [],
  },
  // Story 3.3: the book moved to the starter system.
  'PATCH /api/v1/materials/{id}': {
    id: '0190a0b0-0000-7000-8000-000000000003',
    name: 'Livro do Jogador.pdf',
    state: 'ready',
    kind: 'rulebook',
    pages: { done: 444, total: 444, text: { done: 364, total: 364 }, image: { done: 80, total: 80 }, readDirectly: 364, readByOcr: 78, unreadable: 2, reading: null },
    actions: ['reprocess'],
    version: 1,
    size: 134217728,
    belonging: IN_STARTER_SYSTEM,
    serving: null,
    superseded: [],
  },
  // Story 1.21: a set of two images, created with its order; the set once its failed image is left out.
  'POST /api/v1/image-sets': {
    id: '0190a0b0-0000-7000-8000-000000000004',
    materialId: '0190a0b0-0000-7000-8000-000000000003',
    expiresAt: '2026-11-17T06:00:00Z',
    images: [
      { position: 1, uploadId: '0190a0b0-0000-7000-8000-000000000011' },
      { position: 2, uploadId: '0190a0b0-0000-7000-8000-000000000012' },
    ],
  },
  'DELETE /api/v1/image-sets/{id}/images/{position}': {
    materialId: '0190a0b0-0000-7000-8000-000000000003',
    versionId: '0190a0b0-0000-7000-8000-000000000004',
    state: 'waiting',
  },
  // Story 2.4: the current campaign's conversation, with sources; a question recorded in Portuguese. Its sources are
  // indexed (indexing and indexingFailed null), so a test-mode shell shows no indexing notice and reads no count.
  'GET /api/v1/conversations/current': {
    campaignId: '0190a0b0-0000-7000-8000-000000000002',
    hasSources: true,
    indexing: null,
    indexingFailed: null,
  },
  'POST /api/v1/campaigns/{campaignId}/searches': { id: SEARCH_ID },
  'GET /api/v1/searches/{searchId}': SEARCH_DONE,
  'POST /api/v1/campaigns/{campaignId}/turns': {
    id: '0190a0b0-0000-7000-8000-000000000021',
    conversationId: '0190a0b0-0000-7000-8000-000000000020',
    language: 'pt-BR',
  },
  // Story 1.19: page 13 of a book under review, a picture page with two lines and one passage.
  'GET /api/v1/materials/{id}/pages/{page}': {
    page: 13,
    pageTotal: 444,
    picture: { width: 1545, height: 2000 },
    lines: [
      { text: 'Armor', box: [0.1, 0.1, 0.3, 0.125] },
      { text: 'Plate | 1,500 gp | 18', box: [0.1, 0.15, 0.6, 0.17] },
    ],
    text: null,
    passages: [{ id: '0190a0b0-0000-7000-8000-000000000009', boxes: [[0.1, 0.1, 0.6, 0.17]] }],
    outcome: 'read_directly',
  },
};

/** Story 4.3 part C: the record the stand-in answer cites (the Fire Bolt record of Story 4.3). */
export const ANSWER_RECORD_ID = '0190a0b0-0000-7000-8000-000000000700';

/** Story 5.1 part B: the starter campaign's artifact the stand-in answer cites ("Espada de Kael", `ARTIFACT`). */
export const ANSWER_ARTIFACT_ID = '0190a0b0-0000-7000-8000-000000000900';

/**
 * Story 2.5: the data of the stand-in answer's `done` event, with its source references: Story 2.7 adds one into a
 * Markdown material (a text page). Story 3.7: the answer is the campaign's house rule, then the book's rule; each
 * reference carries its tier, the campaign's (1, the text page) first, then the system's (2, the picture page). Story
 * 3.8: the turn's model knowledge, frozen with it, was off (the starting scope's). Story 4.3 part C: the book's rule
 * also cites the Fire Bolt spell record, reference 3, with its name, type and fields as written, placed at the picture
 * page whose passage it was read from. Story 5.1 part B (contract 1.43.0): the book's rule then cites the campaign's
 * artifact "Espada de Kael", reference 4, with its version, type, name and fields and no place.
 */
export const ANSWER_DONE = {
  stopped: false,
  silent: false,
  modelKnowledge: false,
  references: [
    {
      number: 1,
      kind: 'passage',
      materialName: 'Notas da campanha.md',
      sectionPath: ['Magias'],
      page: 2,
      passageIds: ['0190a0b0-0000-7000-8000-000000000010'],
      removed: false,
      tier: 'campaign',
    },
    {
      number: 2,
      kind: 'passage',
      materialName: 'Livro do Jogador.pdf',
      sectionPath: ['Spells', 'Fire Bolt'],
      page: 13,
      passageIds: ['0190a0b0-0000-7000-8000-000000000009'],
      removed: false,
      tier: 'system',
    },
    {
      number: 3,
      kind: 'record',
      recordId: ANSWER_RECORD_ID,
      recordType: 'spell',
      name: 'Fire Bolt',
      fields: [
        { name: 'Alcance', value: '36 metros' },
        { name: 'Dano', value: '1d10 de fogo' },
      ],
      materialName: 'Livro do Jogador.pdf',
      sectionPath: ['Spells', 'Fire Bolt'],
      page: 13,
      passageIds: ['0190a0b0-0000-7000-8000-000000000009'],
      removed: false,
      tier: 'system',
    },
    {
      number: 4,
      kind: 'artifact',
      artifactId: ANSWER_ARTIFACT_ID,
      artifactVersion: 1,
      recordType: 'item',
      name: 'Espada de Kael',
      fields: [
        { name: 'Dano', value: '1d8 cortante' },
        { name: 'Peso', value: '1,5 kg' },
      ],
      removed: false,
      tier: 'campaign',
    },
  ],
};

/** Story 2.7: the page of reference 2, the picture page of Story 1.19 whose passage reference 2 cites. */
export const REFERENCE_PAGE = EXAMPLES['GET /api/v1/materials/{id}/pages/{page}'];

/** Story 2.7: the page of reference 1, a text page whose cited passage is code points 10 to 46 of its text. */
export const REFERENCE_TEXT_PAGE = {
  page: 2,
  pageTotal: 3,
  picture: null,
  lines: [],
  text: '# Magias\n\nFire Bolt causa 1d10 de dano de fogo.\n',
  passages: [{ id: '0190a0b0-0000-7000-8000-000000000010', range: [10, 47] }],
  outcome: 'read_directly',
};

const REFERENCE_PAGE_PATH = /^\/api\/v1\/turns\/[^/]+\/references\/([^/]+)\/pages\/[^/]+$/;
/** Story 4.3: a page of a record's version, on the record's ground. */
const RECORD_PAGE_PATH = /^\/api\/v1\/systems\/[^/]+\/records\/[^/]+\/pages\/[^/]+$/;
/** Story 3.9: a page of the current scope, by version. */
const SOURCE_PAGE_PATH = /^\/api\/v1\/campaigns\/[^/]+\/sources\/([^/]+)\/pages\/[^/]+$/;

/** Story 3.7: the two versions of the stand-in answer, the campaign's house rule first, then the book's rule. */
export const HOUSE_RULE = 'Na mesa, **Fire Bolt** causa 2d10 de dano de fogo.';
export const BOOK_RULE = 'No livro, **Fire Bolt** causa 1d10 de dano de fogo.';
const BOOK_AT = Array.from(HOUSE_RULE).length + 2;

/**
 * Story 2.4: a turn's answer as server-sent events, each with its sequence, ending with `done` (Story 2.5: its
 * references; Story 2.6: not stopped). Story 3.7: the sources disagree, so a `tier` event opens each version: the
 * campaign's at 0, the system's after the blank line. Story 4.3 part C: the book's rule cites a record too. Story 5.1
 * part B: then the campaign's artifact, after the record in the text and in order, so it is reference 4.
 * `POST /api/v1/turns/{id}/stop` (Story 2.6) answers 204, as the contract declares.
 */
export const ANSWER_EVENTS = [
  ['tier', { tier: 'campaign', offset: 0 }],
  ['delta', { text: HOUSE_RULE }],
  ['citation', { passageId: '0190a0b0-0000-7000-8000-000000000010', offset: BOOK_AT - 2 }],
  ['delta', { text: '\n\n' }],
  ['tier', { tier: 'system', offset: BOOK_AT }],
  ['delta', { text: BOOK_RULE }],
  ['citation', { passageId: '0190a0b0-0000-7000-8000-000000000009', offset: BOOK_AT + Array.from(BOOK_RULE).length }],
  ['citation', { recordId: ANSWER_RECORD_ID, offset: BOOK_AT + Array.from(BOOK_RULE).length }],
  ['citation', { recordId: ANSWER_ARTIFACT_ID, offset: BOOK_AT + Array.from(BOOK_RULE).length }],
  ['done', ANSWER_DONE],
]
  .map(([name, data], index) => `id:${index + 1}\nevent:${name}\ndata:${JSON.stringify(data)}\n\n`)
  .join('');

/** Story 3.10: the stand-in answer's events as a conversation's stored turn carries them, by sequence. */
export const STORED_TURN = {
  id: '0190a0b0-0000-7000-8000-000000000021',
  question: CONVERSATION.name,
  language: 'pt-BR',
  createdAt: '2026-11-22T12:00:00Z',
  events: [
    ['tier', { tier: 'campaign', offset: 0 }],
    ['delta', { text: HOUSE_RULE }],
    ['citation', { passageId: '0190a0b0-0000-7000-8000-000000000010', offset: BOOK_AT - 2 }],
    ['delta', { text: '\n\n' }],
    ['tier', { tier: 'system', offset: BOOK_AT }],
    ['delta', { text: BOOK_RULE }],
    ['citation', { passageId: '0190a0b0-0000-7000-8000-000000000009', offset: BOOK_AT + Array.from(BOOK_RULE).length }],
    ['citation', { recordId: ANSWER_RECORD_ID, offset: BOOK_AT + Array.from(BOOK_RULE).length }],
    ['citation', { recordId: ANSWER_ARTIFACT_ID, offset: BOOK_AT + Array.from(BOOK_RULE).length }],
    ['done', ANSWER_DONE],
  ].map(([type, data], index) => ({ sequence: index + 1, type, data })),
  bookmarked: false,
  kind: 'question',
};

/**
 * Story 5.3 part A: a draft the GM asked for in the same conversation, cited and done, as a stored turn carries it.
 * Story 5.4 part A: its done carries its proposal, and it is offered for saving.
 */
export const DRAFT_HEADING = '## Encontro na cripta';
export const DRAFT_TEXT = `${DRAFT_HEADING}\n\n- Inimigos: três esqueletos guardam a porta.`;
export const DRAFT_PROPOSAL = { name: 'Emboscada na Cripta', recordType: 'encounter' };
export const STORED_DRAFT = {
  id: '0190a0b0-0000-7000-8000-000000000022',
  question: 'Um encontro para a cripta',
  language: 'pt-BR',
  createdAt: '2026-11-22T12:02:00Z',
  events: [
    ['delta', { text: DRAFT_TEXT }],
    ['citation', { passageId: '0190a0b0-0000-7000-8000-000000000010', offset: Array.from(DRAFT_TEXT).length }],
    ['done', { stopped: false, silent: false, modelKnowledge: false, references: [ANSWER_DONE.references[0]], proposal: DRAFT_PROPOSAL }],
  ].map(([type, data], index) => ({ sequence: index + 1, type, data })),
  bookmarked: false,
  kind: 'draft',
  saving: { state: 'offered', artifactId: null },
};
EXAMPLES['GET /api/v1/conversations/{conversationId}/turns'] = { items: [STORED_TURN, STORED_DRAFT] };

/** Story 3.12: the saved answers: the stored turn's, in the starter campaign, then one in another campaign. */
EXAMPLES['GET /api/v1/saved-answers'] = {
  items: [
    {
      turnId: STORED_TURN.id,
      conversationId: CONVERSATION_ID,
      campaignId: CONVERSATION.campaignId,
      campaignName: STARTER_CAMPAIGN.name,
      area: 'questions',
      conversationName: CONVERSATION.name,
      savedAt: '2026-11-22T12:05:00Z',
      excerpt: 'Fire Bolt causa 1d10 de dano de fogo.',
    },
    {
      turnId: '0190a0b0-0000-7000-8000-000000000051',
      conversationId: '0190a0b0-0000-7000-8000-000000000050',
      campaignId: '0190a0b0-0000-7000-8000-000000000040',
      campaignName: 'A Coroa Partida',
      area: 'rules',
      conversationName: 'Descanso longo',
      savedAt: '2026-11-22T12:01:00Z',
      excerpt: 'Um descanso longo dura oito horas.',
    },
  ],
  total: 2,
};

/** Story 4.1: the eight core record types every system has, in their fixed order, none with records yet. */
const CORE_RECORD_TYPES = ['rule', 'spell', 'item', 'creature', 'character_sheet', 'encounter', 'dungeon', 'note'].map((core, index) => ({
  id: `0190a0b0-0000-7000-8000-0000000006${String(index).padStart(2, '0')}`,
  name: core.replace('_', ' '),
  core,
  // Story 4.4: a core type's key is its core key, and its origin is core.
  key: core,
  origin: { kind: 'core', proposalId: null, materialId: null, materialName: null },
  records: 0,
  version: 0,
}));
/** Story 4.4 part B: the type the GM approved in the starter system from the guide's proposal, with its records. */
export const TALENT_TYPE = {
  id: '0190a0b0-0000-7000-8000-000000000608',
  name: 'Talento',
  core: null,
  key: 'talento',
  origin: {
    kind: 'proposal',
    proposalId: '0190a0b0-0000-7000-8000-000000000802',
    materialId: '0190a0b0-0000-7000-8000-000000000004',
    materialName: 'Guia do Mestre.pdf',
  },
  records: 3,
  version: 0,
};
const RECORD_TYPES = [...CORE_RECORD_TYPES, TALENT_TYPE];
EXAMPLES['GET /api/v1/systems/{id}/record-types'] = { items: RECORD_TYPES, total: RECORD_TYPES.length };
EXAMPLES['GET /api/v1/record-types/{id}'] = CORE_RECORD_TYPES[0];

/**
 * Story 4.4: the starter system's pending ontology proposals (a record type and a term the guide proposed, each with its
 * quoted examples), the same on the guide's material page, a decision on one (the record type approved), and the
 * system's one approved term with its alias and origin.
 */
export const PROPOSAL_PAGE = {
  items: [
    {
      id: '0190a0b0-0000-7000-8000-000000000800',
      systemId: '0190a0b0-0000-7000-8000-000000000001',
      materialId: '0190a0b0-0000-7000-8000-000000000004',
      materialName: 'Guia do Mestre.pdf',
      kind: 'record_type',
      name: 'Talento',
      definition: null,
      examples: [
        { page: 40, quote: 'Talentos são habilidades especiais' },
        { page: 42, quote: 'Cada talento tem um pré-requisito' },
      ],
      state: 'pending',
      version: 0,
    },
    {
      id: '0190a0b0-0000-7000-8000-000000000801',
      systemId: '0190a0b0-0000-7000-8000-000000000001',
      materialId: '0190a0b0-0000-7000-8000-000000000004',
      materialName: 'Guia do Mestre.pdf',
      kind: 'term',
      name: 'PV',
      definition: 'Pontos de Vida (PV) medem a saúde do personagem.',
      examples: [{ page: 12, quote: 'Pontos de Vida (PV)' }],
      state: 'pending',
      version: 0,
    },
  ],
  total: 2,
};
EXAMPLES['GET /api/v1/systems/{id}/proposals'] = PROPOSAL_PAGE;
EXAMPLES['GET /api/v1/materials/{id}/proposals'] = PROPOSAL_PAGE;
const DECIDED = { proposal: { ...PROPOSAL_PAGE.items[0], state: 'approved', version: 1 }, resultId: '0190a0b0-0000-7000-8000-000000000810' };
EXAMPLES['POST /api/v1/proposals/{id}/approval'] = DECIDED;
EXAMPLES['POST /api/v1/proposals/{id}/merge'] = { proposal: { ...PROPOSAL_PAGE.items[1], state: 'merged', version: 1 }, resultId: '0190a0b0-0000-7000-8000-000000000811' };
EXAMPLES['POST /api/v1/proposals/{id}/rejection'] = { proposal: { ...PROPOSAL_PAGE.items[0], state: 'rejected', version: 1 }, resultId: null };
EXAMPLES['GET /api/v1/systems/{id}/terms'] = {
  items: [
    {
      id: '0190a0b0-0000-7000-8000-000000000811',
      name: 'Pontos de Vida',
      definition: 'Pontos de Vida (PV) medem a saúde do personagem.',
      aliases: ['PV'],
      origin: { kind: 'proposal', proposalId: '0190a0b0-0000-7000-8000-000000000802', materialId: '0190a0b0-0000-7000-8000-000000000004', materialName: 'Guia do Mestre.pdf' },
      version: 0,
    },
  ],
  total: 1,
};

/**
 * Story 4.3: a record type's records, alphabetical by name, each with its material and first page (two records named
 * alike are two rows, as they were extracted), and one record as its system shows it: its fields in stored order and
 * one reference per version, section path and page, each with the record's passages there. Its version's pages are the
 * text page of Fire Bolt, whose passage the first reference names.
 */
export const RECORD_ID = '0190a0b0-0000-7000-8000-000000000700';
export const RECORD_PAGE = {
  items: [
    { id: '0190a0b0-0000-7000-8000-000000000701', name: 'Bola de Fogo', materialName: 'Livro do Jogador.pdf', page: 241 },
    { id: RECORD_ID, name: 'Fire Bolt', materialName: 'Livro do Jogador.pdf', page: 2 },
    { id: '0190a0b0-0000-7000-8000-000000000702', name: 'Fire Bolt', materialName: 'Notas da campanha.md', page: 1 },
  ],
  total: 3,
};
export const RECORD = {
  id: RECORD_ID,
  name: 'Fire Bolt',
  recordType: { id: CORE_RECORD_TYPES[1].id, core: 'spell', key: 'spell', name: 'spell' },
  fields: [
    { name: 'Nível', value: 'Truque de evocação' },
    { name: 'Tempo de conjuração', value: '1 ação' },
    { name: 'Alcance', value: '36 metros' },
    { name: 'Dano', value: '1d10 de fogo' },
  ],
  references: [
    {
      versionId: BOOK_VERSION,
      materialName: 'Livro do Jogador.pdf',
      sectionPath: ['Magias', 'Fire Bolt'],
      page: 2,
      passageIds: ['0190a0b0-0000-7000-8000-000000000010'],
    },
    {
      versionId: BOOK_VERSION,
      materialName: 'Livro do Jogador.pdf',
      sectionPath: ['Magias', 'Fire Bolt'],
      page: 3,
      passageIds: ['0190a0b0-0000-7000-8000-000000000011', '0190a0b0-0000-7000-8000-000000000012'],
    },
  ],
  version: 0,
};
EXAMPLES['GET /api/v1/record-types/{id}/records'] = RECORD_PAGE;
EXAMPLES['GET /api/v1/systems/{systemId}/records/{recordId}'] = RECORD;
// Story 4.3 part B: the same record as a campaign shows it (the search's record result) is set with Story 5.5 part B's
// related artifacts below.
/** Story 4.5 (contract 1.40.0): a correction answers the record as stored, its version raised by one. */
export const CORRECTED_RECORD = { ...RECORD, fields: RECORD.fields.slice(0, 3), version: 1 };
EXAMPLES['PATCH /api/v1/systems/{systemId}/records/{recordId}'] = CORRECTED_RECORD;
EXAMPLES['PATCH /api/v1/campaigns/{campaignId}/records/{recordId}'] = CORRECTED_RECORD;
// Story 4.5 part B (contract 1.41.0): a record's delete on either page answers 204 with no body, as its contract says.

/**
 * Story 5.1 (contract 1.42.0): the starter campaign's artifacts written by hand, newest first: two character sheets and
 * an item, with the types in use; one of them as its page reads it; and a new artifact answered as stored, version 1.
 */
export const ARTIFACT = {
  id: ANSWER_ARTIFACT_ID,
  campaignId: STARTER_CAMPAIGN.id,
  recordType: 'item',
  name: 'Espada de Kael',
  fields: [
    { name: 'Dano', value: '1d8 cortante' },
    { name: 'Peso', value: '1,5 kg' },
  ],
  content: 'Forjada nas montanhas do norte.',
  version: 1,
  currentVersion: 1,
  createdAt: '2026-11-26T12:00:00Z',
  // Story 5.4 part A (contract 1.48.0): written by hand, so no conversation and no references.
  conversationId: null,
  references: [],
  // Story 5.5 part A (contract 1.50.0): it overrides no record.
  overrides: null,
  // Story 5.5 part B (contract 1.51.0): it is related to no record.
  related: [],
  // Story 5.6 part A (contract 1.52.0): it is shared with no campaign, and read in its own.
  sharedWith: [],
  sharedFrom: null,
  // Story 6.2 part A (contract 1.57.0): no Shield holds it.
  shieldId: null,
};
/** Story 5.6 part B (contract 1.53.0): an item of "Mesa de quinta" shared into the starter campaign. */
export const SHARED_INTO_ID = '0190a0b0-0000-7000-8000-000000000904';
export const ARTIFACT_PAGE = {
  items: [
    {
      id: SHARED_INTO_ID,
      recordType: 'item',
      name: 'Escudo de Lyra',
      version: 1,
      createdAt: '2026-11-26T12:03:00Z',
      sharedFrom: { campaignId: '0190a0b0-0000-7000-8000-000000000040', name: 'Mesa de quinta' },
      shieldId: null,
    },
    { id: '0190a0b0-0000-7000-8000-000000000902', recordType: 'character_sheet', name: 'Lyra', version: 1, createdAt: '2026-11-26T12:02:00Z', sharedFrom: null, shieldId: null },
    { id: '0190a0b0-0000-7000-8000-000000000901', recordType: 'character_sheet', name: 'Kael', version: 1, createdAt: '2026-11-26T12:01:00Z', sharedFrom: null, shieldId: null },
    { id: ARTIFACT.id, recordType: ARTIFACT.recordType, name: ARTIFACT.name, version: 1, createdAt: ARTIFACT.createdAt, sharedFrom: null, shieldId: null },
  ],
  total: 4,
  types: [
    { key: 'character_sheet', count: 2 },
    { key: 'item', count: 2 },
  ],
};
EXAMPLES['GET /api/v1/campaigns/{campaignId}/artifacts'] = ARTIFACT_PAGE;
EXAMPLES['POST /api/v1/campaigns/{campaignId}/artifacts'] = ARTIFACT;
EXAMPLES['GET /api/v1/campaigns/{campaignId}/artifacts/{artifactId}'] = ARTIFACT;

/**
 * Story 5.2 part A (contract 1.44.0): an edit and a restore each answer the artifact's next version, 2; its versions
 * list its one version 1; and that version opens as the artifact does.
 */
export const EDITED_ARTIFACT = { ...ARTIFACT, name: 'Espada de Kael, a Rubra', version: 2, currentVersion: 2 };
export const ARTIFACT_VERSIONS = {
  items: [{ number: 1, recordType: ARTIFACT.recordType, name: ARTIFACT.name, createdAt: ARTIFACT.createdAt }],
  total: 1,
};
EXAMPLES['PATCH /api/v1/campaigns/{campaignId}/artifacts/{artifactId}'] = EDITED_ARTIFACT;
EXAMPLES['GET /api/v1/campaigns/{campaignId}/artifacts/{artifactId}/versions'] = ARTIFACT_VERSIONS;
EXAMPLES['GET /api/v1/campaigns/{campaignId}/artifacts/{artifactId}/versions/{number}'] = ARTIFACT;
EXAMPLES['POST /api/v1/campaigns/{campaignId}/artifacts/{artifactId}/versions/{number}/restore'] = EDITED_ARTIFACT;

/**
 * Story 5.4 part A (contract 1.48.0): the stored draft saved as an artifact of the conversation's campaign: the
 * proposal's name and type, the draft's text as its content, its one reference copied, and its conversation.
 */
export const SAVED_DRAFT = {
  id: '0190a0b0-0000-7000-8000-000000000903',
  campaignId: STARTER_CAMPAIGN.id,
  recordType: DRAFT_PROPOSAL.recordType,
  name: DRAFT_PROPOSAL.name,
  fields: [],
  content: DRAFT_TEXT,
  version: 1,
  currentVersion: 1,
  createdAt: '2026-11-26T12:05:00Z',
  conversationId: CONVERSATION_ID,
  references: [ANSWER_DONE.references[0]],
  overrides: null,
  related: [],
  sharedWith: [],
  sharedFrom: null,
  shieldId: null,
};
EXAMPLES['POST /api/v1/turns/{turnId}/artifact'] = SAVED_DRAFT;

/**
 * Story 5.5 part A (contract 1.50.0): a mark answers the artifact overriding the stand-in record "Fire Bolt" of the
 * starter system; its removal answers 204 with no body, as declared; the records an artifact can override are that one.
 */
export const OVERRIDDEN_ARTIFACT = {
  ...ARTIFACT,
  overrides: { recordId: RECORD.id, name: RECORD.name, recordType: 'spell', systemId: STARTER_SYSTEM.id, removed: false },
};
export const OVERRIDE_TARGETS = {
  items: [{ id: RECORD.id, name: RECORD.name, recordType: 'spell', materialName: 'Livro do Jogador' }],
  total: 1,
};
EXAMPLES['PUT /api/v1/campaigns/{campaignId}/artifacts/{artifactId}/override'] = OVERRIDDEN_ARTIFACT;
EXAMPLES['GET /api/v1/campaigns/{campaignId}/override-targets'] = OVERRIDE_TARGETS;

/**
 * Story 5.5 part B (contract 1.51.0): a relation answers the artifact related to the stand-in record "Fire Bolt" of the
 * system tier; its removal answers 204 with no body, as declared; the records it can be related to are that one; the
 * campaign's read of a record lists the stand-in artifact as related to it.
 */
export const RELATED_ARTIFACT = {
  ...ARTIFACT,
  related: [{ recordId: RECORD.id, name: RECORD.name, recordType: 'spell', tier: 'system', artifact: false, removed: false }],
};
export const RELATION_TARGETS = {
  items: [{ id: RECORD.id, name: RECORD.name, recordType: 'spell', tier: 'system', artifact: false, materialName: 'Livro do Jogador' }],
  total: 1,
};
EXAMPLES['POST /api/v1/campaigns/{campaignId}/artifacts/{artifactId}/relations'] = RELATED_ARTIFACT;
EXAMPLES['GET /api/v1/campaigns/{campaignId}/artifacts/{artifactId}/relation-targets'] = RELATION_TARGETS;
// The record as a campaign shows it (Story 4.3 part B), with the stand-in artifact related to it (Story 5.5 part B).
EXAMPLES['GET /api/v1/campaigns/{campaignId}/records/{recordId}'] = {
  ...RECORD,
  related: [{ artifactId: ARTIFACT.id, name: ARTIFACT.name, recordType: ARTIFACT.recordType }],
};
// "Agora não" (PUT) and "Salvar como artefato" (DELETE) on /api/v1/turns/{turnId}/save-decline answer 204, as declared.

/** Story 5.6 part A (contract 1.52.0): "Mesa de quinta", the new campaign of the starter system (`POST /campaigns`). */
export const SECOND_CAMPAIGN_ID = '0190a0b0-0000-7000-8000-000000000040';
/** A sharing answers the artifact shared with "Mesa de quinta". */
export const SHARED_ARTIFACT = {
  ...ARTIFACT,
  sharedWith: [{ campaignId: SECOND_CAMPAIGN_ID, name: 'Mesa de quinta', archived: false }],
};
EXAMPLES['PUT /api/v1/campaigns/{campaignId}/artifacts/{artifactId}/sharing'] = SHARED_ARTIFACT;
/**
 * The artifact as another campaign of the system reads it (shared into it): read-only, naming the starter campaign it
 * is shared from, with no mark, relation, sharing or conversation.
 */
export const SHARED_FROM_ARTIFACT = {
  ...ARTIFACT,
  overrides: null,
  related: [],
  sharedWith: [],
  conversationId: null,
  sharedFrom: { campaignId: STARTER_CAMPAIGN.id, name: STARTER_CAMPAIGN.name },
};
/**
 * Story 5.6 part B: the shared row of the starter campaign's list, as the starter campaign reads it: an item of "Mesa de
 * quinta", read-only there.
 */
export const SHARED_INTO_ARTIFACT = {
  ...SHARED_FROM_ARTIFACT,
  id: SHARED_INTO_ID,
  campaignId: SECOND_CAMPAIGN_ID,
  name: 'Escudo de Lyra',
  fields: [{ name: 'Defesa', value: '+2' }],
  content: null,
  createdAt: '2026-11-26T12:03:00Z',
  sharedFrom: { campaignId: SECOND_CAMPAIGN_ID, name: 'Mesa de quinta' },
};
/** An artifact's page or one of its versions, under the campaign of the first group, the artifact of the second. */
const ARTIFACT_READ_PATH = /^\/api\/v1\/campaigns\/([^/]+)\/artifacts\/([^/]+)(?:\/versions\/[^/]+)?$/;

/** Story 5.7 part A: an artifacts export, whose answer depends on its query. */
const EXPORT_PATH = /^\/api\/v1\/campaigns\/[^/]+\/artifacts\/export$/;
/** An 8 x 8 white JPEG: the stand-in's image of one artifact. */
export const EXPORT_JPEG = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgo' +
    'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEA' +
    'AAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z',
  'base64',
);

/**
 * Story 6.1 part A: the starter campaign's Shields, oldest first: its first one, unnamed (the screens name it "Escudo do
 * Mestre"), then "Combate". A new Shield answers "Combate" as stored (201, version 0), and a rename answers the first
 * one renamed "Exploração" at version 1.
 */
export const FIRST_SHIELD = { id: '0190a0b0-0000-7000-8000-000000000a01', name: null, version: 0 };
export const COMBAT_SHIELD = { id: '0190a0b0-0000-7000-8000-000000000a02', name: 'Combate', version: 0 };
export const SHIELD_PAGE = { items: [FIRST_SHIELD, COMBAT_SHIELD], total: 2 };
export const RENAMED_SHIELD = { ...FIRST_SHIELD, name: 'Exploração', version: 1 };
EXAMPLES['GET /api/v1/campaigns/{id}/shields'] = SHIELD_PAGE;
EXAMPLES['POST /api/v1/campaigns/{id}/shields'] = COMBAT_SHIELD;
EXAMPLES['GET /api/v1/campaigns/{id}/shields/{shieldId}'] = FIRST_SHIELD;
EXAMPLES['PATCH /api/v1/campaigns/{id}/shields/{shieldId}'] = RENAMED_SHIELD;
/**
 * Story 6.1 part B: what goes with a Shield: from Story 6.2 part B its one note, from Story 6.4 its one stored roll, and
 * it is not the campaign's last (it has two).
 */
export const SHIELD_DELETION = { notes: 1, rolls: 1, last: false };
EXAMPLES['GET /api/v1/campaigns/{id}/shields/{shieldId}/deletion'] = SHIELD_DELETION;

/**
 * Story 6.2 part A (contract 1.57.0): the first Shield holds one note, "Pistas da cripta" (an artifact of the starter
 * campaign of type note, no fields, version 1, naming the Shield); a new note answers it as stored (201), and the note
 * reads as it on its artifact page.
 */
export const SHIELD_NOTE = {
  ...ARTIFACT,
  id: '0190a0b0-0000-7000-8000-000000000a11',
  recordType: 'note',
  name: 'Pistas da cripta',
  fields: [],
  content: 'O sacerdote mente sobre a chave.',
  createdAt: '2026-11-27T12:00:00Z',
  shieldId: FIRST_SHIELD.id,
};
export const SHIELD_NOTES = {
  items: [
    {
      id: SHIELD_NOTE.id,
      recordType: 'note',
      name: SHIELD_NOTE.name,
      version: 1,
      createdAt: SHIELD_NOTE.createdAt,
      sharedFrom: null,
      shieldId: FIRST_SHIELD.id,
    },
  ],
  total: 1,
};
EXAMPLES['GET /api/v1/campaigns/{id}/shields/{shieldId}/notes'] = SHIELD_NOTES;
EXAMPLES['POST /api/v1/campaigns/{id}/shields/{shieldId}/notes'] = SHIELD_NOTE;
/** Story 6.2 part B (contract 1.58.0): a note's move answers the note held by "Combate", its version unchanged. */
export const MOVED_NOTE = { ...SHIELD_NOTE, shieldId: COMBAT_SHIELD.id };
EXAMPLES['PUT /api/v1/campaigns/{campaignId}/artifacts/{artifactId}/shield'] = MOVED_NOTE;
/**
 * Story 6.4 part A (contract 1.59.0): a Shield's log holds one stored roll, "2d6+3" labelled "Iniciativa"; a roll sent
 * answers it as stored now (201: a POST that declares 201 answers it rather than its 200, the repeat).
 */
export const STORED_ROLL = {
  id: '0190a0b0-0000-7000-8000-000000000b01',
  key: '3b241101-e2bb-4255-8caf-4136c566a962',
  formula: '2d6+3',
  results: [4, 5],
  total: 12,
  label: 'Iniciativa',
  rolledAt: '2026-11-27T12:00:00Z',
};
export const ROLL_PAGE = { items: [STORED_ROLL], total: 1 };
EXAMPLES['GET /api/v1/campaigns/{id}/shields/{shieldId}/rolls'] = ROLL_PAGE;
EXAMPLES['POST /api/v1/campaigns/{id}/shields/{shieldId}/rolls'] = STORED_ROLL;

/** A one-page PDF that prints `text` (ASCII), its cross-reference table counted. */
export function tinyPdf(text) {
  const stream = `BT /F1 18 Tf 72 760 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A zip of these files, each stored as it is (no compression), in order. */
export function storedZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    const fileName = Buffer.from(name, 'utf8');
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, bytes);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + bytes.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** `Content-Disposition` for an attachment named `name` (RFC 6266), as the backend writes it. */
export function attachment(name) {
  const ascii = name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7E]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Story 5.7 part A: the answer to an export, by its query (`ids`, `format`, `language`). */
export function exportAnswer(search, traceId) {
  const query = new URLSearchParams(search);
  const ids = (query.get('ids') ?? '').split(',').filter((id) => id !== '');
  const format = query.get('format') ?? 'pdf';
  const several = ids.length > 1;
  const base = several ? (query.get('language') === 'en' ? 'artifacts' : 'artefatos') : ARTIFACT.name;
  const text = `${ARTIFACT.name}\nItem\n\nDano: 1d8 cortante\nPeso: 1,5 kg\n`;
  const files = {
    pdf: ['application/pdf', 'pdf', () => tinyPdf(ARTIFACT.name)],
    txt: ['text/plain;charset=UTF-8', 'txt', () => Buffer.from(text, 'utf8')],
    markdown: ['text/markdown;charset=UTF-8', 'md', () => Buffer.from(`# ${ARTIFACT.name}\n\n*Item*\n`, 'utf8')],
    jpg: several
      ? ['application/zip', 'zip', () => storedZip(ids.map((id, index) => ({ name: `${String(index + 1).padStart(2, '0')}-${ARTIFACT.name}.jpg`, bytes: EXPORT_JPEG })))]
      : ['image/jpeg', 'jpg', () => EXPORT_JPEG],
  };
  const chosen = Object.hasOwn(files, format) ? files[format] : undefined;
  if (chosen === undefined) {
    return problem(400, 'invalid', 'Invalid request', traceId);
  }
  const [type, extension, body] = chosen;
  return {
    status: 200,
    type,
    body: body(),
    headers: { 'Content-Disposition': attachment(`${base}.${extension}`), 'X-Content-Type-Options': 'nosniff' },
  };
}

/** A 1 x 1 WebP: the body of every binary answer (Story 1.19: a page's picture). */
export const PICTURE = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

/** The answer to a request: status, content type and body. */
export function answer(contract, method, pathname, traceId, search = '') {
  if (EXPORT_PATH.test(pathname) && method.toUpperCase() === 'GET') {
    return exportAnswer(search, traceId);
  }
  for (const [template, item] of Object.entries(contract.paths ?? {})) {
    if (!templateToPattern(template).test(pathname)) {
      continue;
    }
    const operation = item[method.toLowerCase()];
    if (!METHODS.includes(method.toLowerCase()) || operation === undefined) {
      return problem(405, 'method_not_allowed', 'Method not allowed', traceId);
    }
    if (template === '/api/v1/version' && method === 'GET') {
      return { status: 200, type: 'application/json', body: { version: contract.info.version } };
    }
    const statuses = Object.keys(operation.responses ?? {})
      .filter((code) => /^2\d\d$/.test(code))
      .sort((a, b) => a.localeCompare(b));
    // Story 6.4: a POST that declares 201 and 200 (a roll stored now, or its repeat) answers 201.
    const status = method.toUpperCase() === 'POST' && statuses.includes('201') ? 201 : Number(statuses[0] ?? 204);
    const declared = operation.responses?.[String(status)] ?? {};
    const headers = headersOf(contract, declared.headers);
    const content = declared.content ?? {};
    const [type, media] = Object.entries(content)[0] ?? [];
    if (type === undefined || status === 204) {
      return { status, type: null, body: null, ...headers };
    }
    if (type === 'text/event-stream') {
      return { status, type, body: Buffer.from(ANSWER_EVENTS, 'utf8'), ...headers };
    }
    if (!type.includes('json')) {
      return { status, type, body: PICTURE, ...headers };
    }
    const reference = REFERENCE_PAGE_PATH.exec(pathname)?.[1];
    if (reference !== undefined && method.toUpperCase() === 'GET') {
      return { status: 200, type, body: reference === '1' ? REFERENCE_TEXT_PAGE : REFERENCE_PAGE, ...headers };
    }
    const source = SOURCE_PAGE_PATH.exec(pathname)?.[1];
    if (source !== undefined && method.toUpperCase() === 'GET') {
      return { status: 200, type, body: source === NOTES_VERSION ? REFERENCE_TEXT_PAGE : REFERENCE_PAGE, ...headers };
    }
    if (RECORD_PAGE_PATH.test(pathname) && method.toUpperCase() === 'GET') {
      return { status: 200, type, body: REFERENCE_TEXT_PAGE, ...headers };
    }
    // Story 5.6 part A: under another campaign than the starter one, an artifact reads as shared from the starter one.
    const read = ARTIFACT_READ_PATH.exec(pathname);
    if (read !== null && method.toUpperCase() === 'GET' && !pathname.endsWith('/versions')) {
      if (read[1] !== STARTER_CAMPAIGN.id) {
        return { status: 200, type, body: SHARED_FROM_ARTIFACT, ...headers };
      }
      // Story 5.6 part B: the starter campaign's shared row reads as shared from "Mesa de quinta".
      if (read[2] === SHARED_INTO_ID) {
        return { status: 200, type, body: SHARED_INTO_ARTIFACT, ...headers };
      }
      // Story 6.2 part A: the first Shield's note reads as itself.
      if (read[2] === SHIELD_NOTE.id) {
        return { status: 200, type, body: SHIELD_NOTE, ...headers };
      }
    }
    const chosen = EXAMPLES[`${method.toUpperCase()} ${template}`];
    const body = chosen !== undefined ? chosen : media.example !== undefined ? media.example : exampleOf(contract, media.schema ?? {});
    return { status, type, body, ...headers };
  }
  return problem(404, 'not_found', 'Not found', traceId);
}

/** `{ headers }` with the example of each declared response header, or nothing when none is declared. */
function headersOf(contract, declared) {
  const entries = Object.entries(declared ?? {}).map(([name, header]) => {
    const resolved = resolve(contract, header);
    const value = resolved.example ?? exampleOf(contract, resolved.schema ?? {});
    return [name, String(value)];
  });
  return entries.length === 0 ? {} : { headers: Object.fromEntries(entries) };
}

/** A tus part: PATCH /api/v1/uploads/{id}. */
const UPLOAD_PART = /^\/api\/v1\/uploads\/[^/]+$/;

function problem(status, reason, title, traceId) {
  return {
    status,
    type: PROBLEM_TYPE,
    body: {
      type: `urn:gmshield:problem:request.${reason}`,
      title,
      status,
      category: 'request',
      code: `request.${reason}`,
      params: {},
      traceId,
    },
  };
}

function log(traceId, event, fields = {}) {
  process.stdout.write(
    JSON.stringify({ timestamp: new Date().toISOString(), level: 'INFO', traceId, unit: 'stand-in-backend', event, ...fields }) + '\n',
  );
}

export function createStandInServer(contract, { quiet = false } = {}) {
  return createServer((request, response) => {
    const traceId = TRACEPARENT.exec(request.headers.traceparent ?? '')?.[1] ?? randomBytes(16).toString('hex');
    // A base only to parse the request's path; nothing connects to it.
    const url = new URL(request.url ?? '/', 'http://stand-in'); // NOSONAR: not a connection
    const pathname = url.pathname;
    const result = answer(contract, request.method ?? 'GET', pathname, traceId, url.search);
    // The request body is only counted, never kept: read to its end, the connection can be reused.
    let received = 0;
    request.on('data', (chunk) => {
      received += chunk.length;
    });
    request.on('end', () => {
      response.statusCode = result.status;
      response.setHeader('Cache-Control', 'no-store');
      for (const [name, value] of Object.entries(result.headers ?? {})) {
        response.setHeader(name, value);
      }
      if (request.method === 'PATCH' && UPLOAD_PART.test(pathname) && result.status < 300) {
        const start = Number(request.headers['upload-offset'] ?? 0);
        response.setHeader('Upload-Offset', String((Number.isSafeInteger(start) ? start : 0) + received));
      }
      if (result.type !== null) {
        response.setHeader('Content-Type', result.type);
        const body = Buffer.isBuffer(result.body) ? result.body : JSON.stringify(result.body);
        response.end(request.method === 'HEAD' ? undefined : body);
      } else {
        response.end();
      }
      if (!quiet) {
        log(traceId, 'request.completed', { method: request.method ?? 'GET', status: result.status });
      }
    });
  });
}

if (import.meta.main) {
  const contractPath = process.env.STAND_IN_CONTRACT ?? fileURLToPath(new URL('../contracts/public.json', import.meta.url));
  const port = Number(process.env.PORT ?? 8080);
  const contract = loadContract(contractPath);
  const server = createStandInServer(contract);
  server.listen(port, '0.0.0.0', () => {
    log('0'.repeat(32), 'stand_in.started', { port, contractVersion: String(contract.info?.version ?? 'unknown') });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
