import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { createStandInServer, loadContract } from '../../stand-in-backend/server.mjs';

export const CONTRACT_PATH = fileURLToPath(new URL('../../contracts/public.json', import.meta.url));

export type Running = { url: string; close: () => Promise<void>; requests: { headers: Record<string, unknown> }[] };

async function listen(server: Server, requests: Running['requests']): Promise<Running> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The stand-in backend, optionally reporting another contract version. */
export async function startStandIn(version?: string): Promise<Running> {
  const contract = loadContract(CONTRACT_PATH);
  if (version !== undefined) {
    contract.info.version = version;
  }
  const requests: Running['requests'] = [];
  const server: Server = createStandInServer(contract, { quiet: true });
  server.prependListener('request', (request) => requests.push({ headers: { ...request.headers } }));
  return listen(server, requests);
}

/** A server that answers every request with the given status and body. */
export async function startFixed(status: number, body: string, contentType = 'application/json'): Promise<Running> {
  const requests: Running['requests'] = [];
  const server = createServer((request, response) => {
    requests.push({ headers: { ...request.headers } });
    response.writeHead(status, { 'Content-Type': contentType });
    response.end(body);
  });
  return listen(server, requests);
}

/** A server that accepts connections and never answers. */
export async function startSilent(): Promise<Running> {
  const requests: Running['requests'] = [];
  const server = createServer((request) => {
    requests.push({ headers: { ...request.headers } });
  });
  return listen(server, requests);
}

/** An address where nothing listens. */
export async function closedAddress(): Promise<string> {
  const running = await startFixed(200, '');
  await running.close();
  return running.url;
}

export type Recorded = { method: string; url: string; headers: Record<string, unknown>; body: string };
export type Scripted = Running & { calls: Recorded[] };
export type Reply = { status: number; body?: unknown; contentType?: string; delayMs?: number };

/** A backend that answers each `METHOD path` from a table, and records every request with its body. */
export async function startScripted(routes: Readonly<Record<string, Reply>>): Promise<Scripted> {
  const calls: Recorded[] = [];
  const requests: Running['requests'] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      calls.push({ method: request.method ?? '', url: request.url ?? '', headers: { ...request.headers }, body: Buffer.concat(chunks).toString('utf8') });
      requests.push({ headers: { ...request.headers } });
      const reply = routes[`${request.method} ${request.url}`] ?? { status: 404, body: { status: 404, category: 'request', code: 'request.not_found', params: {} } };
      setTimeout(() => answerWith(reply), reply.delayMs ?? 0);
    });
    function answerWith(reply: Reply): void {
      if (reply.body === undefined) {
        response.writeHead(reply.status);
        response.end();
        return;
      }
      const type = reply.contentType ?? (reply.status >= 400 ? 'application/problem+json' : 'application/json');
      response.writeHead(reply.status, { 'Content-Type': type });
      response.end(JSON.stringify(reply.body));
    }
  });
  return { ...(await listen(server, requests)), calls };
}
