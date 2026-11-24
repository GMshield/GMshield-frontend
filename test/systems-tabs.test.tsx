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
// "Excluir" (Story 3.1 part B) posts to its own action, which these tests never call.
const deleteSystemAction = vi.fn();
vi.mock('@/app/(signed-in)/systems/actions', () => ({
  deleteSystemAction: (...args: unknown[]) => deleteSystemAction(...args),
}));
// Story 4.4: a proposal's decisions post to their own action, which these tests never call.
vi.mock('@/app/(signed-in)/proposal-actions', () => ({ decideProposalAction: vi.fn() }));

const { default: SystemPage } = await import('@/app/(signed-in)/systems/[id]/page');
const { recordTypeRow } = await import('@/app/(signed-in)/systems/rows');
const { translator } = await import('@/messages');

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ID = '0190a0b0-0000-7000-8000-000000000030';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const MATERIAL = '0190a0b0-0000-7000-8000-000000000003';
const MATERIALS = `GET /api/v1/materials?state=uploading&state=waiting&state=processing&state=needs_review&state=ready&state=failed&system=${ID}&limit=10`;

/** Twelve campaigns of the system: two pages of ten. */
const CAMPAIGNS = [{ id: CAMPAIGN, name: 'A Coroa Partida' }, ...Array.from({ length: 11 }, (_, index) => ({ id: `0190a0b0-0000-7000-8000-0000000004${String(index).padStart(2, '0')}`, name: `Mesa ${index + 2}` }))];

/** Story 4.1: the eight core record types every system has, in their fixed order, by their stored (English) names. */
const CORE = ['rule', 'spell', 'item', 'creature', 'character_sheet', 'encounter', 'dungeon', 'note'];
const RECORD_TYPES = CORE.map((core, index) => ({
  id: `0190a0b0-0000-7000-8000-0000000006${String(index).padStart(2, '0')}`,
  name: core.replace('_', ' '),
  core,
  key: core,
  origin: { kind: 'core' as const, proposalId: null, materialId: null, materialName: null },
  records: index === 0 ? 1 : 0,
  version: 0,
}));

/** Story 4.4: the system's pending proposals (a type and a term), and its one approved term. */
const PROPOSALS = [
  {
    id: '0190a0b0-0000-7000-8000-000000000800',
    systemId: ID,
    materialId: MATERIAL,
    materialName: 'SRD.pdf',
    kind: 'record_type',
    name: 'Talento',
    definition: null,
    examples: [{ page: 40, quote: 'Talentos são habilidades especiais' }],
    state: 'pending',
    version: 0,
  },
  {
    id: '0190a0b0-0000-7000-8000-000000000801',
    systemId: ID,
    materialId: MATERIAL,
    materialName: 'SRD.pdf',
    kind: 'term',
    name: 'PV',
    definition: 'Pontos de Vida (PV) medem a saúde.',
    examples: [{ page: 12, quote: 'Pontos de Vida (PV)' }],
    state: 'pending',
    version: 0,
  },
];
const TERMS = [
  {
    id: '0190a0b0-0000-7000-8000-000000000811',
    name: 'Pontos de Vida',
    definition: 'Pontos de Vida (PV) medem a saúde.',
    aliases: ['HP'],
    origin: { kind: 'proposal', proposalId: '0190a0b0-0000-7000-8000-000000000802', materialId: MATERIAL, materialName: 'SRD.pdf' },
    version: 0,
  },
];

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
    [`GET /api/v1/systems/${ID}/record-types?limit=10`]: { status: 200, body: { items: RECORD_TYPES, total: 8 } },
    [`GET /api/v1/systems/${ID}/record-types?limit=50`]: { status: 200, body: { items: RECORD_TYPES, total: 8 } },
    [`GET /api/v1/systems/${ID}/proposals?limit=10`]: { status: 200, body: { items: PROPOSALS, total: 2 } },
    [`GET /api/v1/systems/${ID}/terms?limit=10`]: { status: 200, body: { items: TERMS, total: 1 } },
    [`GET /api/v1/systems/${ID}/terms?limit=50`]: { status: 200, body: { items: TERMS, total: 1 } },
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

  it('the records tab lists the eight core record types by their own names, with a count, each opening its records (Stories 4.1, 4.3)', async () => {
    const records = await SystemPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({ tab: 'records' }) });
    render(records);

    const tabs = screen.getByRole('navigation', { name: 'Seções do sistema' });
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Campanhas',
      'Materiais',
      'Registros',
      'Ontologia',
    ]);
    expect(within(tabs).getByRole('link', { name: 'Registros' }).getAttribute('aria-current')).toBe('page');
    const list = screen.getByRole('list', { name: 'Tipos de registro deste sistema' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Regra1 registro',
      'Magia0 registros',
      'Item0 registros',
      'Criatura0 registros',
      'Ficha de personagem0 registros',
      'Encontro0 registros',
      'Masmorra0 registros',
      'Nota0 registros',
    ]);
    // The stored name of a core type is never shown, and a row offers no rename or removal. Story 4.3: each row opens
    // its type's records list.
    expect(screen.queryByText('character sheet')).toBeNull();
    expect(within(list).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(
      RECORD_TYPES.map((type) => `/systems/${ID}/record-types/${type.id}`),
    );
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('8 itens')).toBeTruthy();
  });

  it('in English the core record types read in English', async () => {
    cookieJar['__Host-gmshield-lang'] = 'en';
    render(await SystemPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({ tab: 'records' }) }));

    const list = screen.getByRole('list', { name: 'Record types of this system' });
    expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Rule1 record',
      'Spell0 records',
      'Item0 records',
      'Creature0 records',
      'Character sheet0 records',
      'Encounter0 records',
      'Dungeon0 records',
      'Note0 records',
    ]);
  });

  it('the Ontologia tab lists the pending proposals, then the approved terms, and every tab is reached from the keyboard', async () => {
    const user = userEvent.setup();
    render(await SystemPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({ tab: 'proposals' }) }));

    expect(screen.getByRole('heading', { name: 'Propostas pendentes' })).toBeTruthy();
    const proposals = screen.getByRole('list', { name: 'Propostas de ontologia deste sistema' });
    expect(within(proposals).getByText('Talento')).toBeTruthy();
    expect(within(proposals).getByText('«Talentos são habilidades especiais», p. 40')).toBeTruthy();
    for (const pill of ['Aprovar', 'Renomear', 'Mesclar', 'Rejeitar']) {
      expect(within(screen.getByRole('group', { name: 'Decidir sobre «PV»' })).getByRole('button', { name: pill })).toBeTruthy();
    }
    expect(screen.getByRole('heading', { name: 'Termos aprovados' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Termos aprovados deste sistema' })).getByRole('listitem').textContent).toBe(
      'Pontos de VidaPontos de Vida (PV) medem a saúde. · Também chamado: HP · De SRD.pdf',
    );
    expect(screen.queryByRole('list', { name: 'Tipos de registro deste sistema' })).toBeNull();
    const tabs = within(screen.getByRole('navigation', { name: 'Seções do sistema' })).getAllByRole('link');
    expect(tabs.at(-1)!.getAttribute('aria-current')).toBe('page');
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      `/systems/${ID}?tab=campaigns`,
      `/systems/${ID}?tab=materials`,
      `/systems/${ID}?tab=records`,
      `/systems/${ID}?tab=proposals`,
    ]);
    // Each tab is a link: Tab reaches them in order.
    tabs[0]!.focus();
    for (const tab of tabs.slice(1)) {
      await user.tab();
      expect(document.activeElement).toBe(tab);
    }
  });

  it('a core key this frontend does not know yet shows its stored name instead of failing the page', () => {
    const t = translator('pt-BR');
    // A newer backend's core key, outside this contract's list.
    const newer = { id: RECORD_TYPES[0]!.id, name: 'vehicle', core: 'vehicle', records: 2, version: 0 } as unknown as Parameters<typeof recordTypeRow>[0];

    expect(recordTypeRow(newer, t, ID)).toMatchObject({
      label: 'vehicle',
      detail: '2 registros',
      href: `/systems/${ID}/record-types/${RECORD_TYPES[0]!.id}`,
      state: null,
    });
    expect(recordTypeRow({ ...RECORD_TYPES[4]!, core: 'character_sheet' }, t, ID).label).toBe('Ficha de personagem');
    expect(recordTypeRow({ ...RECORD_TYPES[0]!, core: null, name: 'Montaria' }, t, ID).label).toBe('Montaria');
  });

  it('Story 4.4 part B: a type the GM approved shows by its name with its record count, opening its records', () => {
    const t = translator('pt-BR');
    const talent = {
      ...RECORD_TYPES[0]!,
      id: '0190a0b0-0000-7000-8000-000000000608',
      core: null,
      key: 'talento',
      name: 'Talento',
      origin: { kind: 'proposal' as const, proposalId: '0190a0b0-0000-7000-8000-000000000802', materialId: null, materialName: null },
      records: 3,
    };
    expect(recordTypeRow(talent, t, ID)).toMatchObject({
      label: 'Talento',
      detail: '3 registros',
      href: `/systems/${ID}/record-types/0190a0b0-0000-7000-8000-000000000608`,
      state: null,
    });
  });

  it('an unknown tab is the campaigns tab', async () => {
    render(await SystemPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({ tab: 'admin' }) }));

    expect(screen.getByRole('list', { name: 'Campanhas deste sistema' })).toBeTruthy();
  });
});
