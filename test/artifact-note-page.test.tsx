import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { cleanup, render, screen } from '@testing-library/react';
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

/**
 * Story 6.2: the editor types an artifact's page chooses, seen in the page itself (jsdom, the page rendered and "Editar"
 * pressed): a note a Shield holds offers its one type as text, any other artifact the system's types in a select. The
 * rest of the page is test/artifacts.test.tsx's (Node, as markup).
 */
const { default: ArtifactPage } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/[artifactId]/page');

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const ID = '0190a0b0-0000-7000-8000-000000000900';
const SHIELD = '0190a0b0-0000-7000-8000-000000000a01';
const CORE = ['rule', 'spell', 'item', 'creature', 'character_sheet', 'encounter', 'dungeon', 'note'];
const TYPES = CORE.map((core, index) => ({
  id: `0190a0b0-0000-7000-8000-00000000060${index}`,
  name: core,
  core,
  key: core,
  origin: { kind: 'core', proposalId: null, materialId: null, materialName: null },
  records: 0,
  version: 0,
}));
const CAMPAIGN_BODY = { id: CAMPAIGN, name: 'Mesa de quinta', system: { id: SYSTEM, name: 'D&D', edition: null, description: null, version: 0 }, archived: false, version: 0 };
const NOTE = {
  id: ID,
  campaignId: CAMPAIGN,
  recordType: 'note',
  name: 'Pistas',
  fields: [],
  content: 'O sacerdote mente.',
  version: 1,
  currentVersion: 1,
  createdAt: '2026-11-27T12:00:00Z',
  conversationId: null,
  references: [],
  overrides: null,
  related: [],
  sharedWith: [],
  sharedFrom: null,
  shieldId: SHIELD,
};

let backend: Server | undefined;

/** A backend that answers each `METHOD path` from a table (test/support/servers.ts reads a file URL jsdom lacks). */
async function scripted(artifact: unknown): Promise<void> {
  const routes: Record<string, { status: number; body: unknown }> = {
    [`GET /api/v1/campaigns/${CAMPAIGN}`]: { status: 200, body: CAMPAIGN_BODY },
    [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/${ID}`]: { status: 200, body: artifact },
    [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/${ID}/versions?limit=10`]: {
      status: 200,
      body: { items: [{ number: 1, recordType: 'note', name: 'Pistas', createdAt: '2026-11-27T12:00:00Z' }], total: 1 },
    },
    [`GET /api/v1/campaigns/${CAMPAIGN}/shields/${SHIELD}`]: { status: 200, body: { id: SHIELD, name: null, version: 0 } },
    [`GET /api/v1/systems/${SYSTEM}/record-types?limit=50`]: { status: 200, body: { items: TYPES, total: TYPES.length } },
  };
  backend = createServer((request, response) => {
    const reply = routes[`${request.method} ${request.url}`] ?? { status: 404, body: { status: 404, category: 'request', code: 'request.not_found', params: {} } };
    response.writeHead(reply.status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => backend!.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', `http://127.0.0.1:${(backend.address() as AddressInfo).port}`);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
}

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999`, '__Host-gmshield-lang': 'pt-BR' };
});

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => (backend ? backend.close(() => resolve()) : resolve()));
  backend = undefined;
  vi.unstubAllEnvs();
});

describe("an artifact page's editor types (Story 6.2)", () => {
  it('a note a Shield holds shows its type as fixed text, with no select', async () => {
    const user = userEvent.setup();
    await scripted(NOTE);
    render(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: ID }) }));

    await user.click(screen.getByRole('button', { name: 'Editar' }));

    expect(screen.getByRole('form', { name: 'Editar «Pistas»' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Tipo de registro')).toBeTruthy();
    expect(screen.getAllByText('Nota').some((element) => element.tagName === 'P')).toBe(true);
  });

  it('an artifact no Shield holds offers the system\'s types in a select', async () => {
    const user = userEvent.setup();
    await scripted({ ...NOTE, shieldId: null });
    render(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: ID }) }));

    await user.click(screen.getByRole('button', { name: 'Editar' }));

    const select = screen.getByRole('combobox', { name: 'Tipo de registro' }) as HTMLSelectElement;
    expect(select.value).toBe('note');
    expect(select.options.length).toBe(CORE.length);
  });
});
