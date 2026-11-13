// The stand-in backend: a tiny server, with nothing beyond Node, that answers every path of
// contracts/public.json with a valid example and every other path with a 404 problem detail.
// GET /api/v1/version reports the contract's info.version. The frontend uses it in
// GMSHIELD_MODE=test, where the real backend is not there (Dockerfile stage `stand-in-backend`).
//
//   node stand-in-backend/server.mjs        PORT (default 8080), STAND_IN_CONTRACT (default ../contracts/public.json)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

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

function templateToPattern(template) {
  const escaped = template
    .split(/(\{[^}]+\})/)
    .map((part) => (part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${escaped}$`);
}

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
      .sort();
    const status = Number(statuses[0] ?? 204);
    const content = operation.responses?.[String(status)]?.content ?? {};
    const [type, media] = Object.entries(content)[0] ?? [];
    if (type === undefined || status === 204) {
      return { status, type: null, body: null };
    }
    const body = media.example !== undefined ? media.example : exampleOf(contract, media.schema ?? {});
    return { status, type, body };
  }
  return problem(404, 'not_found', 'Not found', traceId);
}

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
    const pathname = new URL(request.url ?? '/', 'http://stand-in').pathname;
    const result = answer(contract, request.method ?? 'GET', pathname, traceId);
    // The request body is never read: drain it so that the connection can be reused.
    request.resume();
    response.statusCode = result.status;
    response.setHeader('Cache-Control', 'no-store');
    if (result.type !== null) {
      response.setHeader('Content-Type', result.type);
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(result.body));
    } else {
      response.end();
    }
    if (!quiet) {
      log(traceId, 'request.completed', { method: request.method ?? 'GET', status: result.status });
    }
  });
}

if (import.meta.main) {
  const contractPath = process.env.STAND_IN_CONTRACT ?? new URL('../contracts/public.json', import.meta.url).pathname;
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
