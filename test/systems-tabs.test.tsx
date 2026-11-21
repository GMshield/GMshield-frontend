import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
// "Carregar mais" posts to these; the tabs' first pages come from the scripted backend. "Excluir" (Story 3.1 part B)
// posts to its own, which these tests never call.
const moreCampaigns = vi.fn();
const moreMaterials = vi.fn();
const deleteSystemAction = vi.fn();
vi.mock('@/app/(signed-in)/systems/actions', () => ({
  moreCampaigns: (...args: unknown[]) => moreCampaigns(...args),
  moreMaterials: (...args: unknown[]) => moreMaterials(...args),
  deleteSystemAction: (...args: unknown[]) => deleteSystemAction(...args),
}));

const { default: SystemPage } = await import('@/app/(signed-in)/systems/[id]/page');

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ID = '0190a0b0-0000-7000-8000-000000000030';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const MATERIAL = '0190a0b0-0000-7000-8000-000000000003';
const MATERIALS = `GET /api/v1/materials?state=uploading&state=waiting&state=processing&state=needs_review&state=ready&state=failed&system=${ID}`;

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
    [`GET /api/v1/campaigns?system=${ID}`]: { status: 200, body: { items: [{ id: CAMPAIGN, name: 'A Coroa Partida' }], nextCursor: CAMPAIGN } },
    [MATERIALS]: { status: 200, body: { items: [{ id: MATERIAL, name: 'SRD.pdf', state: 'ready', actions: [] }], nextCursor: MATERIAL } },
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
  moreCampaigns.mockReset();
  moreMaterials.mockReset();
});

describe('a system page\'s tabs (Story 3.1)', () => {
  it('rows added under the campaigns tab are gone on the materials tab, whose "Carregar mais" posts its own cursor', async () => {
    const user = userEvent.setup();
    moreCampaigns.mockResolvedValueOnce({
      rows: [{ id: 'added', label: 'Campanha adicionada', detail: null, href: null, state: null }],
      nextCursor: null,
      error: null,
      added: 1,
    });
    moreMaterials.mockResolvedValueOnce({ rows: [], nextCursor: null, error: null, added: 0 });
    const page = (tab: string) => SystemPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({ tab }) });

    const { rerender } = render(await page('campaigns'));
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('Campanha adicionada');
    expect((moreCampaigns.mock.calls[0]?.[1] as FormData).get('cursor')).toBe(CAMPAIGN);

    const materials = await page('materials');
    await act(async () => rerender(materials));
    expect(screen.queryByText('Campanha adicionada')).toBeNull();
    expect(screen.queryByText('A Coroa Partida')).toBeNull();
    const list = screen.getByRole('list', { name: 'Materiais deste sistema' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(moreMaterials).toHaveBeenCalledTimes(1);
    const sent = moreMaterials.mock.calls[0]?.[1] as FormData;
    expect(sent.get('cursor')).toBe(MATERIAL);
    expect(sent.get('system')).toBe(ID);
  });
});
