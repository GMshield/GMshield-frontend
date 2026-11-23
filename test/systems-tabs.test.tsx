import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: () => undefined,
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));
// "Excluir" (Story 3.1 part B) posts to its own action, which these tests never call.
const deleteSystemAction = vi.fn();
vi.mock('@/app/(signed-in)/systems/actions', () => ({
  deleteSystemAction: (...args: unknown[]) => deleteSystemAction(...args),
}));

const { default: SystemPage } = await import('@/app/(signed-in)/systems/[id]/page');

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ID = '0190a0b0-0000-7000-8000-000000000030';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const MATERIAL = '0190a0b0-0000-7000-8000-000000000003';
const MATERIALS = `GET /api/v1/materials?state=uploading&state=waiting&state=processing&state=needs_review&state=ready&state=failed&system=${ID}&limit=10`;

/** Twelve campaigns of the system: two pages of ten. */
const CAMPAIGNS = [{ id: CAMPAIGN, name: 'A Coroa Partida' }, ...Array.from({ length: 11 }, (_, index) => ({ id: `0190a0b0-0000-7000-8000-0000000004${String(index).padStart(2, '0')}`, name: `Mesa ${index + 2}` }))];

let backend: Server | undefined;

/** A backend that answers each `METHOD path` from a table (test/support/servers.ts reads a file URL jsdom lacks). */
async function scripted(routes: Readonly<Record<string, { status: number; body: unknown }>>): Promise<string> {
  backend = createServer((request, response) => {
    const reply = routes[`${request.method} ${request.url}`] ?? { status: 404, body: { status: 404, category: 'request', code: 'request.not_found' } };
    response.writeHead(reply.status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => backend!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
  const url = await scripted({
    [`GET /api/v1/systems/${ID}`]: { status: 200, body: { id: ID, name: 'D&D', edition: '5.2.1', description: null, version: 0 } },
    [`GET /api/v1/campaigns?system=${ID}&limit=10`]: { status: 200, body: { items: CAMPAIGNS.slice(0, 10), nextCursor: CAMPAIGNS[9]!.id, total: 12 } },
    [`GET /api/v1/campaigns?system=${ID}&limit=10&offset=10`]: { status: 200, body: { items: CAMPAIGNS.slice(10), total: 12 } },
    [MATERIALS]: {
      status: 200,
      body: {
        items: [{ id: MATERIAL, name: 'SRD.pdf', state: 'ready', actions: [], version: 0, belonging: { campaign: null, systems: [{ id: ID, name: 'D&D' }] } }],
        total: 1,
      },
    },
  });
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', 'configured-service-credential-0123456789');
});

afterEach(async () => {
  cleanup();
  backend?.closeAllConnections();
  await new Promise<void>((resolve) => (backend === undefined ? resolve() : backend.close(() => resolve())));
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('a system page\'s tabs (Story 3.1)', () => {
  it('each tab shows its own page of rows, with a pager above and under them once there is more than one page', async () => {
    const page = (tab: string, number?: string) =>
      SystemPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(number === undefined ? { tab } : { tab, page: number }) });

    const { rerender } = render(await page('campaigns'));
    let list = screen.getByRole('list', { name: 'Campanhas deste sistema' });
    expect(within(list).getAllByRole('link')).toHaveLength(10);
    expect(within(list).getByText('A Coroa Partida')).toBeTruthy();
    // Two ways to turn the page: the small one in the toolbar, and the numbered one under the rows.
    const above = screen.getByRole('navigation', { name: 'Paginação, acima da lista' });
    expect(within(above).getByRole('link', { name: 'Próxima' }).getAttribute('href')).toBe(`/systems/${ID}?tab=campaigns&page=2`);
    const under = screen.getByRole('navigation', { name: 'Paginação' });
    expect(within(under).getByRole('link', { name: 'Página 1, página atual' }).getAttribute('aria-current')).toBe('page');
    expect(within(under).getByRole('link', { name: 'Página 2' }).getAttribute('href')).toBe(`/systems/${ID}?tab=campaigns&page=2`);
    expect(screen.getAllByText('1–10 de 12')).toHaveLength(2);

    const second = await page('campaigns', '2');
    await act(async () => rerender(second));
    list = screen.getByRole('list', { name: 'Campanhas deste sistema' });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByText('A Coroa Partida')).toBeNull();

    // The materials tab is another list: one material, its count, and no pager.
    const materials = await page('materials');
    await act(async () => rerender(materials));
    expect(screen.queryByText('Mesa 12')).toBeNull();
    list = screen.getByRole('list', { name: 'Materiais deste sistema' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('SRD.pdf')).toBeTruthy();
    expect(screen.getByText('1 item')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });
});
