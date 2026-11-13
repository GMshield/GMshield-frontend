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
