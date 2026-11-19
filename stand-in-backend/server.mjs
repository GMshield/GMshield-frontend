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
// conversation has sources, a question is recorded in Portuguese, and a turn's events (text/event-stream) are a short
// cited answer and `done`.
//
//   node stand-in-backend/server.mjs        PORT (default 8080), STAND_IN_CONTRACT (default ../contracts/public.json)
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

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

/** Answers chosen here rather than built from the contract's schemas, by `METHOD template`. */
export const EXAMPLES = {
  'GET /api/v1/materials': { items: [] },
  'GET /api/v1/materials/{id}': {
    id: '0190a0b0-0000-7000-8000-000000000003',
    name: 'Livro do Jogador.pdf',
    state: 'processing',
    kind: 'rulebook',
    // Story 1.17: a mixed book whose text pages are being read, its scanned pages waiting for OCR.
    pages: { done: 40, total: 444, text: { done: 40, total: 364 }, image: { done: 0, total: 80 }, readDirectly: 40, readByOcr: 0, unreadable: 0, reading: 'text' },
    // Story 1.20: a processing material allows no action.
    actions: [],
  },
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
    ],
  },
  'POST /api/v1/materials/{id}/accept': {
    id: '0190a0b0-0000-7000-8000-000000000003',
    name: 'Livro do Jogador.pdf',
    state: 'ready',
    kind: 'rulebook',
    pages: { done: 444, total: 444, text: { done: 364, total: 364 }, image: { done: 80, total: 80 }, readDirectly: 364, readByOcr: 78, unreadable: 2, reading: null },
    actions: [],
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
  // Story 2.4: the current campaign's conversation, with sources; a question recorded in Portuguese.
  'GET /api/v1/conversations/current': { campaignId: '0190a0b0-0000-7000-8000-000000000002', hasSources: true },
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

/** Story 2.5: the data of the stand-in answer's `done` event, with its one source reference. */
export const ANSWER_DONE = {
  stopped: false,
  silent: false,
  references: [
    {
      number: 1,
      materialName: 'Livro do Jogador.pdf',
      sectionPath: ['Spells', 'Fire Bolt'],
      page: 13,
      passageIds: ['0190a0b0-0000-7000-8000-000000000009'],
      removed: false,
    },
  ],
};

/**
 * Story 2.4: a turn's answer as server-sent events, each with its sequence, ending with `done` (Story 2.5: its
 * references; Story 2.6: not stopped). `POST /api/v1/turns/{id}/stop` (Story 2.6) answers 204, as the contract
 * declares.
 */
export const ANSWER_EVENTS = [
  'id:1\nevent:delta\ndata:{"text":"**Fire Bolt** causa 1d10 de dano de fogo."}\n\n',
  'id:2\nevent:citation\ndata:{"passageId":"0190a0b0-0000-7000-8000-000000000009","offset":40}\n\n',
  `id:3\nevent:done\ndata:${JSON.stringify(ANSWER_DONE)}\n\n`,
].join('');

/** A 1 x 1 WebP: the body of every binary answer (Story 1.19: a page's picture). */
export const PICTURE = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

/** The answer to a request: status, content type and body. */
export function answer(contract, method, pathname, traceId) {
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
    const status = Number(statuses[0] ?? 204);
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
    const pathname = new URL(request.url ?? '/', 'http://stand-in').pathname; // NOSONAR: not a connection
    const result = answer(contract, request.method ?? 'GET', pathname, traceId);
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
